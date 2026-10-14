import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../constants/colors';
import { AppButton, CircleButton, GlassSheet } from '../../components/ui';
import { CONDITION_CODES, CONDITION_LABELS } from '../constants/conditions';
import { useScanQueueStore } from '../store/scanQueueStore';
import {
  hydrateVariantPrices,
  loadScannerCatalog,
  matchForCardRef,
  resolveCardImageUri,
} from '../services/catalog/ScannerCatalogProvider';
import { DealAnalysisSheet } from '../molecules/DealAnalysisSheet';
import {
  displayCardName,
  findVariantOptions,
  type CatalogMatch,
} from '../services/catalog/catalogMatcher';
import { scannedCardsToInventoryInputs } from '../utils/toInventoryInput';
import { autoOffer, offerBreakdown } from '../utils/pricing';
import {
  getCardSignals,
  getLatestSubTypePricesForProducts,
  openCatalogDatabase,
} from '../../db/catalogDb';
import { DealClassBadge } from '../atoms/DealClassBadge';
import type { CardSignal } from '../../db/catalogDb';
import { useInventoryStore } from '../../store/inventoryStore';
import { JpBadge } from '../../components/JpBadge';
import { SetBadge } from '../../components/SetBadge';
import { CardImageViewer } from '../../components/CardImageViewer';
import { isJpSetName } from '../../utils/jp';
import { toErrorMessage } from '../../utils/log';
import type { ConditionCode, ScannedCard } from '../types/scan';
import type { ScanCatalogCard } from '../types/catalog';

type Props = {
  onBack?: () => void;
  onDone?: () => void;
};

function nextCondition(code: ConditionCode): ConditionCode {
  const idx = CONDITION_CODES.indexOf(code);
  return CONDITION_CODES[(idx + 1) % CONDITION_CODES.length];
}

export function ScanQueueView({ onBack, onDone }: Props) {
  const insets = useSafeAreaInsets();
  const {
    items,
    remove,
    updateCondition,
    updateQuantity,
    updateSubType,
    updateOffer,
    applyDealTotal,
    replaceCard,
    clear,
    totalCount,
    totalPrice,
  } = useScanQueueStore();

  const [switchItem, setSwitchItem] = useState<ScannedCard | null>(null);
  const [analysisFor, setAnalysisFor] = useState<{
    match: CatalogMatch;
    subType?: string;
  } | null>(null);
  const [viewerFor, setViewerFor] = useState<{
    uri: string;
    name: string;
  } | null>(null);
  const [offerItem, setOfferItem] = useState<ScannedCard | null>(null);
  const [offerDraft, setOfferDraft] = useState('');
  const [dealOpen, setDealOpen] = useState(false);
  const [dealDraft, setDealDraft] = useState('');
  const [finishOptions, setFinishOptions] = useState<
    { subType: string; marketPrice: number; signal?: CardSignal }[]
  >([]);
  const [switchOptions, setSwitchOptions] = useState<ScanCatalogCard[]>([]);
  const [switchLoading, setSwitchLoading] = useState(false);
  const [isFlushing, setIsFlushing] = useState(false);
  const [flushError, setFlushError] = useState<string | null>(null);

  const openSwitcher = (item: ScannedCard) => {
    setSwitchItem(item);
    setSwitchOptions([]);
    setFinishOptions([]);
    setSwitchLoading(true);
    Promise.all([
      loadScannerCatalog().then(async (catalog) => {
        const options = findVariantOptions(item, catalog);
        // Prices hydrate lazily — without this a switched card would carry a
        // $0 base price into the queue.
        await hydrateVariantPrices(options).catch(() => {});
        return options;
      }),
      // Same product, different print finish (Normal / Holofoil / Reverse
      // Holofoil…) — distinct from the variant printings above.
      openCatalogDatabase()
        .then((db) =>
          Promise.all([
            getLatestSubTypePricesForProducts(db, [item.productId]),
            getCardSignals(db, [item.productId]),
          ])
        )
        .then(([priceMap, signalMap]) => {
          const signals = signalMap[item.productId] ?? {};
          return Object.entries(priceMap[item.productId] ?? {})
            .map(([subType, p]) => ({
              subType,
              marketPrice: p.marketPrice,
              signal: signals[subType],
            }))
            .sort((a, b) => b.marketPrice - a.marketPrice);
        })
        .catch(
          () =>
            [] as {
              subType: string;
              marketPrice: number;
              signal?: CardSignal;
            }[]
        ),
    ])
      .then(([options, finishes]) => {
        setSwitchOptions(options);
        setFinishOptions(finishes);
      })
      .catch((e) => console.warn('ScanQueueView: variant lookup failed', e))
      .finally(() => setSwitchLoading(false));
  };

  const openOfferEdit = (item: ScannedCard) => {
    setOfferItem(item);
    const current = item.customOffer ?? offerBreakdown(item.marketPrice).offer;
    setOfferDraft(current > 0 ? String(Math.round(current)) : '');
  };

  const commitOffer = () => {
    if (!offerItem) return;
    const parsed = parseFloat(offerDraft.replace(/[^0-9.]/g, ''));
    updateOffer(
      offerItem.id,
      Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null
    );
    setOfferItem(null);
  };

  // Sum of every card's current effective offer × qty — what the queue
  // would pay out before any deal negotiation.
  const queueOfferTotal = items.reduce(
    (s, i) =>
      s + (i.customOffer ?? autoOffer(i.marketPrice)) * i.quantity,
    0
  );

  const commitDeal = () => {
    const parsed = parseFloat(dealDraft.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(parsed)) applyDealTotal(Number(parsed.toFixed(2)));
    setDealOpen(false);
  };

  const handleAdd = async () => {
    if (isFlushing) return;
    setIsFlushing(true);
    setFlushError(null);
    try {
      await useInventoryStore
        .getState()
        .addScannedCards(scannedCardsToInventoryInputs(items));
      clear();
      onDone?.();
    } catch (e) {
      setFlushError(toErrorMessage(e));
    } finally {
      setIsFlushing(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <CircleButton
          icon="arrow-back"
          size={40}
          iconSize={20}
          onPress={() => onBack?.()}
          accessibilityLabel="Back to scanner"
        />
        <Text style={styles.title}>Review your scans</Text>
        <View style={styles.backButton} />
      </View>

      {items.length === 0 ? (
        <Text style={styles.empty}>
          No cards yet. Scan one to get started.
        </Text>
      ) : (
        <>
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {items.map((item) => {
              const econ = offerBreakdown(
                item.marketPrice,
                item.customOffer
              );
              return (
              <Pressable
                key={item.id}
                style={styles.card}
                onPress={() => openSwitcher(item)}
              >
                {item.imageUrl ? (
                  // Image tap = card viewer; card tap = variant switcher.
                  // The inner Pressable wins the touch.
                  <Pressable
                    onPress={() =>
                      setViewerFor({
                        uri: item.imageUrl!,
                        name: displayCardName(item.name),
                      })
                    }
                    hitSlop={2}
                    accessibilityLabel={`View ${displayCardName(item.name)} image`}
                    accessibilityRole="imagebutton">
                    <Image
                      source={{ uri: item.imageUrl }}
                      style={styles.image}
                      contentFit="contain"
                      cachePolicy="memory-disk"
                    />
                  </Pressable>
                ) : (
                  <View style={styles.imagePlaceholder} />
                )}
                <View style={styles.cardBody}>
                  <View style={styles.cardTitleRow}>
                    {/* Name tap = deal analysis; row tap = variant switcher. */}
                    <Pressable
                      onPress={() =>
                        void matchForCardRef({
                          ...item,
                          marketPrice: item.baseMarketPrice,
                        })
                          .then((m) =>
                            setAnalysisFor({
                              match: m,
                              subType: item.subType,
                            })
                          )
                          .catch(() => {})
                      }
                      hitSlop={4}
                      style={styles.nameLinkWrap}
                    >
                      <Text
                        style={[styles.name, styles.nameLink]}
                        numberOfLines={1}
                      >
                        {displayCardName(item.name)}
                      </Text>
                      <Ionicons
                        name="analytics-outline"
                        size={13}
                        color={colors.primary}
                      />
                    </Pressable>
                    {isJpSetName(item.set) ? <JpBadge /> : null}
                    <Pressable
                      onPress={() => remove(item.id)}
                      hitSlop={8}
                      style={styles.removeButton}
                      accessibilityLabel={`Remove ${item.name}`}
                      accessibilityRole="button"
                    >
                      <Ionicons
                        name="close"
                        size={16}
                        color={colors.textMuted}
                      />
                    </Pressable>
                  </View>
                  <Text style={styles.meta} numberOfLines={1}>
                    #{item.number}
                    {item.subType ? ` · ${item.subType}` : ''}
                  </Text>
                  <SetBadge set={item.set} style={styles.setBadge} />
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Market</Text>
                    <View style={styles.priceSignalRow}>
                      <Text style={styles.detailValue}>
                        ${item.marketPrice.toFixed(2)}
                      </Text>
                      {item.signal ? (
                        <DealClassBadge signal={item.signal} />
                      ) : null}
                    </View>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>You pay</Text>
                    <Pressable
                      onPress={() => openOfferEdit(item)}
                      style={styles.offerEditRow}
                    >
                      <Text style={styles.detailAccent}>
                        ${Math.round(econ.offer)} ({econ.offerPct}% of market)
                        {item.customOffer != null ? ' · edited' : ''}
                      </Text>
                      <Ionicons
                        name="pencil"
                        size={11}
                        color={colors.textMuted}
                      />
                    </Pressable>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Est. profit</Text>
                    <Text style={styles.detailProfit}>
                      +${Math.round(econ.profit)}
                    </Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Condition</Text>
                    <Pressable
                      onPress={() =>
                        updateCondition(item.id, nextCondition(item.condition))
                      }
                    >
                      <Text style={styles.detailAccent}>
                        {CONDITION_LABELS[item.condition]}
                      </Text>
                    </Pressable>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Quantity</Text>
                    <View style={styles.stepper}>
                      <Pressable
                        onPress={() =>
                          updateQuantity(item.id, item.quantity - 1)
                        }
                        style={styles.stepButton}
                        hitSlop={8}
                        accessibilityLabel="Decrease quantity"
                        accessibilityRole="button"
                      >
                        <Ionicons
                          name="remove"
                          size={14}
                          color={colors.text}
                        />
                      </Pressable>
                      <Text style={styles.qtyValue}>{item.quantity}</Text>
                      <Pressable
                        onPress={() =>
                          updateQuantity(item.id, item.quantity + 1)
                        }
                        style={styles.stepButton}
                        hitSlop={8}
                        accessibilityLabel="Increase quantity"
                        accessibilityRole="button"
                      >
                        <Ionicons name="add" size={14} color={colors.text} />
                      </Pressable>
                    </View>
                  </View>
                </View>
              </Pressable>
              );
            })}
          </ScrollView>

          <View
            style={[styles.footer, { paddingBottom: insets.bottom + 10 }]}
          >
            <View style={styles.totalRow}>
              <View>
                <Text style={styles.totalText}>
                  Total: ${totalPrice().toFixed(2)}
                </Text>
                <Text style={styles.countText}>
                  {totalCount()} card{totalCount() === 1 ? '' : 's'} · you pay $
                  {Math.round(queueOfferTotal)}
                </Text>
              </View>
              <Pressable
                style={styles.dealButton}
                onPress={() => {
                  setDealDraft(String(Math.round(queueOfferTotal)));
                  setDealOpen(true);
                }}
              >
                <Ionicons
                  name="cash-outline"
                  size={15}
                  color={colors.primary}
                />
                <Text style={styles.dealButtonText}>Deal</Text>
              </Pressable>
            </View>
            {flushError ? (
              <Text style={styles.flushError}>{flushError}</Text>
            ) : null}
            <Pressable
              onPress={handleAdd}
              style={[styles.addButton, isFlushing && styles.addButtonBusy]}
              disabled={isFlushing}
            >
              {isFlushing ? (
                <ActivityIndicator color={colors.background} size="small" />
              ) : (
                <Text style={styles.addButtonText}>Add to Inventory</Text>
              )}
            </Pressable>
          </View>
        </>
      )}

      {switchItem !== null ? (
        <GlassSheet
          title="Switch variant"
          onClose={() => setSwitchItem(null)}
          artUri={switchItem.imageUrl || null}
        >
          <>
            <Text style={styles.modalTitle} numberOfLines={1}>
              {displayCardName(switchItem.name)}
            </Text>
            {switchLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <>
                {finishOptions.length > 1 ? (
                  <>
                    <Text style={styles.modalSectionLabel}>
                      Print finish — same card
                    </Text>
                    <View style={styles.finishRow}>
                      {finishOptions.map((f) => {
                        const selected = f.subType === switchItem.subType;
                        return (
                          <Pressable
                            key={f.subType}
                            style={[
                              styles.finishChip,
                              selected && styles.finishChipSelected,
                            ]}
                            onPress={() => {
                              updateSubType(switchItem.id, f);
                              setSwitchItem(null);
                            }}
                          >
                            <Text
                              style={styles.finishChipText}
                              numberOfLines={1}
                            >
                              {f.subType}
                            </Text>
                            <Text style={styles.finishChipPrice}>
                              ${f.marketPrice.toFixed(2)}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </>
                ) : null}
                {switchOptions.length === 0 ? (
                  <Text style={styles.modalEmpty}>
                    No other versions in the price list.
                  </Text>
                ) : (
                  switchOptions.map((c) => {
                  const selected = c.productId === switchItem.productId;
                  return (
                    <Pressable
                      key={c.productId}
                      style={[
                        styles.modalRow,
                        selected && styles.modalRowSelected,
                      ]}
                      onPress={() => {
                        replaceCard(switchItem.id, c);
                        setSwitchItem(null);
                      }}
                    >
                      {resolveCardImageUri(c) ? (
                        <Image
                          source={{ uri: resolveCardImageUri(c) }}
                          style={styles.modalThumb}
                          contentFit="contain"
                          cachePolicy="memory-disk"
                        />
                      ) : (
                        <View
                          style={[
                            styles.modalThumb,
                            styles.modalThumbPlaceholder,
                          ]}
                        />
                      )}
                      <View style={styles.modalInfo}>
                        <Text style={styles.modalName} numberOfLines={1}>
                          {c.name} · {c.number}
                        </Text>
                        <SetBadge set={c.set} style={styles.modalSetBadge} />
                      </View>
                      {selected ? (
                        <Ionicons
                          name="checkmark"
                          size={18}
                          color={colors.primary}
                        />
                      ) : null}
                    </Pressable>
                  );
                })
                )}
              </>
            )}
          </>
        </GlassSheet>
      ) : null}

      {/* Negotiated-offer editor */}
      {offerItem != null ? (
        <GlassSheet
          title="Cash offer"
          onClose={() => setOfferItem(null)}
          keyboardAware
          artUri={offerItem.imageUrl || null}
          scrollProps={{
            keyboardDismissMode: 'interactive',
            keyboardShouldPersistTaps: 'handled',
          }}
          footer={
            <View style={styles.offerButtonRow}>
              <AppButton
                title="Reset to auto"
                variant="ghost"
                onPress={() => {
                  updateOffer(offerItem.id, null);
                  setOfferItem(null);
                }}
                style={styles.offerFooterBtn}
              />
              <AppButton
                title="Set offer"
                onPress={commitOffer}
                style={styles.offerFooterBtn}
              />
            </View>
          }
        >
          <>
            <Text style={styles.modalTitle} numberOfLines={1}>
              {offerItem.name}
            </Text>
            <Text style={styles.offerHint}>
              What you'll pay for this card. Leave blank to use the
              suggested price.
            </Text>
            <View style={styles.offerInputRow}>
              <Text style={styles.offerDollar}>$</Text>
              <TextInput
                style={styles.offerInput}
                value={offerDraft}
                onChangeText={setOfferDraft}
                onSubmitEditing={commitOffer}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.textMuted}
                autoFocus
              />
            </View>
          </>
        </GlassSheet>
      ) : null}

      {/* Whole-queue deal — prorates one negotiated total across cards by
          their current offer share. */}
      {dealOpen ? (
        <GlassSheet
          title="Deal total"
          onClose={() => setDealOpen(false)}
          keyboardAware
          scrollProps={{
            keyboardDismissMode: 'interactive',
            keyboardShouldPersistTaps: 'handled',
          }}
          footer={
            <View style={styles.offerButtonRow}>
              <AppButton
                title="Cancel"
                variant="ghost"
                onPress={() => setDealOpen(false)}
                style={styles.offerFooterBtn}
              />
              <AppButton
                title="Apply to all"
                onPress={commitDeal}
                style={styles.offerFooterBtn}
              />
            </View>
          }
        >
          <>
            <Text style={styles.offerHint}>
              One price for the whole batch — split across all {items.length}{' '}
              card{items.length === 1 ? '' : 's'} in proportion to their
              offers.
            </Text>
            <View style={styles.offerInputRow}>
              <Text style={styles.offerDollar}>$</Text>
              <TextInput
                style={styles.offerInput}
                value={dealDraft}
                onChangeText={setDealDraft}
                onSubmitEditing={commitDeal}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.textMuted}
                autoFocus
              />
            </View>
          </>
        </GlassSheet>
      ) : null}

      {/* Deep-dive on the card behind a queued row — opens on name tap. */}
      {analysisFor ? (
        <DealAnalysisSheet
          match={analysisFor.match}
          subType={analysisFor.subType}
          onClose={() => setAnalysisFor(null)}
        />
      ) : null}

      {viewerFor ? (
        <CardImageViewer
          visible
          uri={viewerFor.uri}
          name={viewerFor.name}
          onClose={() => setViewerFor(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  backButton: {
    width: 40,
    height: 40,
  },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  empty: {
    color: colors.textMuted,
    fontSize: 16,
    textAlign: 'center',
    marginTop: 48,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 4,
  },
  card: {
    flexDirection: 'row',
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.overlay2,
    marginBottom: 10,
  },
  image: {
    width: 96,
    height: 132,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  imagePlaceholder: {
    width: 96,
    height: 132,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  cardBody: {
    flex: 1,
    marginLeft: 14,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  name: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  nameLink: {
    textDecorationLine: 'underline',
    textDecorationColor: colors.textMuted,
  },
  nameLinkWrap: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  removeButton: {
    marginLeft: 8,
    padding: 2,
  },
  meta: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
    marginBottom: 4,
  },
  setBadge: {
    marginBottom: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  detailLabel: {
    color: colors.textMuted,
    fontSize: 13,
  },
  detailValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  priceSignalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailProfit: {
    color: colors.success,
    fontSize: 13,
    fontWeight: '600',
  },
  detailAccent: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepButton: {
    width: 22,
    height: 22,
    borderRadius: 999,
    backgroundColor: colors.overlay4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    minWidth: 16,
    textAlign: 'center',
  },
  footer: {
    paddingTop: 8,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: 'center',
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
  },
  totalText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  countText: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  dealButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primaryTint,
  },
  dealButtonText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  offerEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  flushError: {
    color: colors.error,
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },
  addButton: {
    marginTop: 10,
    alignSelf: 'stretch',
    paddingVertical: 14,
    borderRadius: 20,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  addButtonBusy: {
    opacity: 0.7,
  },
  addButtonText: {
    color: colors.background,
    fontSize: 16,
    fontWeight: '700',
  },
  modalTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 12,
  },
  modalEmpty: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 20,
  },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 10,
    backgroundColor: colors.overlay2,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  modalRowSelected: {
    borderColor: colors.primary,
  },
  modalThumb: {
    width: 40,
    height: 56,
    borderRadius: 4,
  },
  modalThumbPlaceholder: {
    backgroundColor: colors.surface,
  },
  modalInfo: {
    flex: 1,
    marginLeft: 10,
  },
  modalName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  modalSetBadge: {
    marginTop: 4,
  },
  modalSectionLabel: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 8,
  },
  finishRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  finishChip: {
    minWidth: 96,
    minHeight: 46,
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.overlay3,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
  },
  finishChipSelected: {
    borderColor: colors.primary,
  },
  finishChipText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  finishChipPrice: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  offerHint: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 12,
  },
  offerInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.overlay2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
  },
  offerDollar: {
    color: colors.textMuted,
    fontSize: 16,
    fontWeight: '700',
    marginRight: 4,
  },
  offerInput: {
    flex: 1,
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    paddingVertical: 10,
  },
  offerButtonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  offerFooterBtn: {
    flex: 1,
  },
});
