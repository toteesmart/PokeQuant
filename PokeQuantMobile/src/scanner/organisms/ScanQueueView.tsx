import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
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
import { CONDITION_CODES, CONDITION_LABELS } from '../constants/conditions';
import { useScanQueueStore } from '../store/scanQueueStore';
import {
  hydrateVariantPrices,
  loadScannerCatalog,
} from '../services/catalog/ScannerCatalogProvider';
import { findVariantOptions } from '../services/catalog/catalogMatcher';
import { scannedCardsToInventoryInputs } from '../utils/toInventoryInput';
import { autoOffer, offerBreakdown } from '../utils/pricing';
import {
  getLatestSubTypePricesForProducts,
  openCatalogDatabase,
} from '../../db/catalogDb';
import { useInventoryStore } from '../../store/inventoryStore';
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
  const [offerItem, setOfferItem] = useState<ScannedCard | null>(null);
  const [offerDraft, setOfferDraft] = useState('');
  const [dealOpen, setDealOpen] = useState(false);
  const [dealDraft, setDealDraft] = useState('');
  const [finishOptions, setFinishOptions] = useState<
    { subType: string; marketPrice: number }[]
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
        .then((db) => getLatestSubTypePricesForProducts(db, [item.productId]))
        .then((map) =>
          Object.entries(map[item.productId] ?? {})
            .map(([subType, p]) => ({ subType, marketPrice: p.marketPrice }))
            .sort((a, b) => b.marketPrice - a.marketPrice)
        )
        .catch(() => [] as { subType: string; marketPrice: number }[]),
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
    setOfferDraft(current > 0 ? current.toFixed(2) : '');
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
      setFlushError(e instanceof Error ? e.message : 'Failed to add cards');
    } finally {
      setIsFlushing(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Review Your Matches</Text>
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
                  <Image
                    source={{ uri: item.imageUrl }}
                    style={styles.image}
                    contentFit="contain"
                    cachePolicy="memory-disk"
                  />
                ) : (
                  <View style={styles.imagePlaceholder} />
                )}
                <View style={styles.cardBody}>
                  <View style={styles.cardTitleRow}>
                    <Text style={styles.name} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Pressable
                      onPress={() => remove(item.id)}
                      hitSlop={8}
                      style={styles.removeButton}
                    >
                      <Ionicons
                        name="close"
                        size={16}
                        color={colors.textMuted}
                      />
                    </Pressable>
                  </View>
                  <Text style={styles.meta} numberOfLines={1}>
                    Pokémon • {item.set} • {item.number}
                    {item.subType ? ` • ${item.subType}` : ''}
                  </Text>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Price</Text>
                    <Text style={styles.detailValue}>
                      ${item.marketPrice.toFixed(2)}
                    </Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Offer</Text>
                    <Pressable
                      onPress={() => openOfferEdit(item)}
                      style={styles.offerEditRow}
                    >
                      <Text style={styles.detailAccent}>
                        ${econ.offer.toFixed(2)} ({econ.offerPct}%)
                        {item.customOffer != null ? ' •edited' : ''}
                      </Text>
                      <Ionicons
                        name="pencil"
                        size={11}
                        color={colors.textMuted}
                      />
                    </Pressable>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Profit</Text>
                    <Text style={styles.detailProfit}>
                      +${econ.profit.toFixed(2)}
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
                        hitSlop={6}
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
                        hitSlop={6}
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
            style={[styles.footer, { paddingBottom: 10 }]}
          >
            <View style={styles.totalRow}>
              <View>
                <Text style={styles.totalText}>
                  Total: ${totalPrice().toFixed(2)}
                </Text>
                <Text style={styles.countText}>
                  {totalCount()} matched scan
                  {totalCount() === 1 ? '' : 's'} · paying $
                  {queueOfferTotal.toFixed(2)}
                </Text>
              </View>
              <Pressable
                style={styles.dealButton}
                onPress={() => {
                  setDealDraft(queueOfferTotal.toFixed(2));
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

      <Modal
        visible={switchItem !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSwitchItem(null)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setSwitchItem(null)}
        >
          <Pressable
            style={styles.modalCard}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={styles.modalTitle} numberOfLines={1}>
              Switch variant{switchItem ? ` — ${switchItem.name}` : ''}
            </Text>
            {switchLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <ScrollView
                style={styles.modalList}
                showsVerticalScrollIndicator={false}
              >
                {finishOptions.length > 1 ? (
                  <>
                    <Text style={styles.modalSectionLabel}>
                      Print finish — same card
                    </Text>
                    <View style={styles.finishRow}>
                      {finishOptions.map((f) => {
                        const selected = f.subType === switchItem?.subType;
                        return (
                          <Pressable
                            key={f.subType}
                            style={[
                              styles.finishChip,
                              selected && styles.finishChipSelected,
                            ]}
                            onPress={() => {
                              if (switchItem) updateSubType(switchItem.id, f);
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
                    No other variants in the catalog.
                  </Text>
                ) : (
                  switchOptions.map((c) => {
                  const selected = c.productId === switchItem?.productId;
                  return (
                    <Pressable
                      key={c.productId}
                      style={[
                        styles.modalRow,
                        selected && styles.modalRowSelected,
                      ]}
                      onPress={() => {
                        if (switchItem) replaceCard(switchItem.id, c);
                        setSwitchItem(null);
                      }}
                    >
                      {c.imageUrl ? (
                        <Image
                          source={{ uri: c.imageUrl }}
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
                        <Text style={styles.modalMeta} numberOfLines={1}>
                          {c.set}
                        </Text>
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
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Negotiated-offer editor */}
      <Modal
        visible={offerItem != null}
        transparent
        animationType="fade"
        onRequestClose={() => setOfferItem(null)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setOfferItem(null)}
        >
          <Pressable
            style={styles.modalCard}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={styles.modalTitle} numberOfLines={1}>
              Cash offer{offerItem ? ` — ${offerItem.name}` : ''}
            </Text>
            <Text style={styles.offerHint}>
              What you'll pay for this card. Leave blank to use the tier price.
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
            <View style={styles.offerButtonRow}>
              <Pressable
                style={styles.offerResetButton}
                onPress={() => {
                  if (offerItem) updateOffer(offerItem.id, null);
                  setOfferItem(null);
                }}
              >
                <Text style={styles.offerResetText}>Reset to auto</Text>
              </Pressable>
              <Pressable style={styles.offerSetButton} onPress={commitOffer}>
                <Text style={styles.offerSetText}>Set offer</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Whole-queue deal — prorates one negotiated total across cards by
          their current offer share. */}
      <Modal
        visible={dealOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDealOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setDealOpen(false)}
        >
          <Pressable
            style={styles.modalCard}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={styles.modalTitle}>Deal total</Text>
            <Text style={styles.offerHint}>
              One price for everything — split across all {items.length} card
              {items.length === 1 ? '' : 's'} proportional to their offers.
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
            <View style={styles.offerButtonRow}>
              <Pressable
                style={styles.offerResetButton}
                onPress={() => setDealOpen(false)}
              >
                <Text style={styles.offerResetText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.offerSetButton} onPress={commitDeal}>
                <Text style={styles.offerSetText}>Apply to all</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: 18,
    fontWeight: 'bold',
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
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
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
    fontWeight: 'bold',
  },
  removeButton: {
    marginLeft: 8,
    padding: 2,
  },
  meta: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
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
    fontWeight: 'bold',
  },
  detailProfit: {
    color: colors.success,
    fontSize: 13,
    fontWeight: '600',
  },
  detailAccent: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: 'bold',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: 'bold',
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
    fontWeight: 'bold',
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
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: 'rgba(59,130,246,0.12)',
  },
  dealButtonText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: 'bold',
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
    borderRadius: 24,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  addButtonBusy: {
    opacity: 0.7,
  },
  addButtonText: {
    color: colors.background,
    fontSize: 17,
    fontWeight: 'bold',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxHeight: '70%',
    borderRadius: 16,
    backgroundColor: '#10151c',
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  modalEmpty: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 20,
  },
  modalList: {
    flexGrow: 0,
  },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
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
    fontWeight: 'bold',
  },
  modalMeta: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
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
    backgroundColor: 'rgba(255,255,255,0.08)',
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
    fontWeight: 'bold',
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
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
  },
  offerDollar: {
    color: colors.textMuted,
    fontSize: 16,
    fontWeight: 'bold',
    marginRight: 4,
  },
  offerInput: {
    flex: 1,
    color: colors.text,
    fontSize: 18,
    fontWeight: 'bold',
    paddingVertical: 10,
  },
  offerButtonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  offerResetButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  offerResetText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  offerSetButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  offerSetText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: 'bold',
  },
});
