import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../constants/colors';
import { normalizeNumber } from '../utils/normalizeText';
import { catalogName, type CatalogMatch } from '../services/catalog/catalogMatcher';
import type { VariantOption } from '../services/processPhoto';
import type { ConditionCode } from '../types/scan';
import { CONDITION_CODES, CONDITION_LABELS } from '../constants/conditions';
import { ConditionChip } from '../atoms/ConditionChip';

type Props = {
  uri: string;
  match: CatalogMatch | null;
  variantOptions?: VariantOption[];
  otherMatches?: CatalogMatch[];
  onRetake: () => void;
  onConfirm?: (
    condition: ConditionCode,
    quantity: number,
    subType?: string
  ) => void;
  onSelectMatch?: (match: CatalogMatch) => void;
};

export function MatchReviewSheet({
  uri,
  match,
  variantOptions,
  otherMatches,
  onRetake,
  onConfirm,
  onSelectMatch,
}: Props) {
  const insets = useSafeAreaInsets();
  const [quantity, setQuantity] = useState(1);
  const [condition, setCondition] = useState<ConditionCode>('NM');
  const [subType, setSubType] = useState<string | null>(null);

  // Reset the finish selection when the matched card changes.
  const productId = match?.card.productId;
  useEffect(() => {
    setSubType(null);
  }, [productId]);

  // variants[0] is the Normal-resolved default; the picker lets the user
  // switch to e.g. Reverse Holofoil when the physical card differs.
  const finishes = match?.card.variants ?? [];
  const selectedFinish =
    finishes.find((v) => v.subType === subType) ?? finishes[0];
  const unitPrice = selectedFinish?.marketPrice ?? 0;
  const totalPrice = Number((unitPrice * quantity).toFixed(2));

  const handleSelect = (option: VariantOption) => {
    if (!match || option.card.productId === match.card.productId) return;
    onSelectMatch?.({
      card: option.card,
      method: option.score != null ? 'visual' : (match.method ?? 'visual'),
      confidence:
        option.score != null
          ? Math.max(0, Math.min(1, option.score))
          : match.confidence,
    });
  };

  // Only offer variants for the currently selected name/number; if the user
  // switched to a differently-named or -numbered card the stale options are
  // hidden. The name check keeps same-numbered cards from other sets
  // (Plusle/Minun sharing "6/12" with Pikachu) out of the variant list.
  const variants = (variantOptions ?? []).filter(
    (o) =>
      match &&
      normalizeNumber(o.card.number) === normalizeNumber(match.card.number) &&
      catalogName(o.card).split(' ')[0] === catalogName(match.card).split(' ')[0]
  );

  // Other fused candidates (different cards entirely, e.g. a catalog
  // number match that lost to a visual-only candidate, or a same-number
  // alternate from another set) stay selectable.
  const others = (otherMatches ?? [])
    .filter((o) => o.card.productId !== match?.card.productId)
    .filter(
      (o) =>
        !match ||
        normalizeNumber(o.card.number) !== normalizeNumber(match.card.number) ||
        catalogName(o.card).split(' ')[0] !== catalogName(match.card).split(' ')[0]
    )
    .slice(0, 5);

  return (
    <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
      <View style={styles.handle} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <View style={styles.headRow}>
          <Image
            source={{ uri }}
            style={styles.cropThumb}
            contentFit="cover"
            cachePolicy="none"
          />
          <View style={styles.headInfo}>
            {match ? (
              <>
                <Text style={styles.name} numberOfLines={1}>
                  {match.card.name}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  Pokémon • {match.card.set}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {match.card.number} · by {match.method} (
                  {Math.round(match.confidence * 100)}%)
                </Text>
              </>
            ) : (
              <Text style={styles.name}>No catalog match found</Text>
            )}
          </View>
          {match ? (
            <View style={styles.priceCol}>
              <Text style={styles.price}>${unitPrice.toFixed(2)}</Text>
              <Text style={styles.priceSub}>market</Text>
            </View>
          ) : null}
        </View>

        {variants.length > 1 ? (
          <View style={styles.altSection}>
            <Text style={styles.sectionLabel}>
              Variants — tap to switch
            </Text>
            {variants.slice(0, 5).map((o) => {
              const selected = o.card.productId === match?.card.productId;
              return (
                <Pressable
                  key={o.card.productId}
                  onPress={() => handleSelect(o)}
                  style={[styles.altRow, selected && styles.altRowSelected]}
                >
                  {o.card.imageUrl ? (
                    <Image
                      source={{ uri: o.card.imageUrl }}
                      style={styles.altThumb}
                      contentFit="contain"
                      cachePolicy="memory-disk"
                    />
                  ) : (
                    <View
                      style={[styles.altThumb, styles.altThumbPlaceholder]}
                    />
                  )}
                  <View style={styles.altInfo}>
                    <Text style={styles.altName} numberOfLines={1}>
                      {o.card.name} · {o.card.number}
                    </Text>
                    <Text style={styles.altMeta} numberOfLines={1}>
                      {o.card.set}
                    </Text>
                  </View>
                  <Text style={styles.altScore}>
                    {o.score != null ? `${Math.round(o.score * 100)}%` : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {others.length > 0 ? (
          <View style={styles.altSection}>
            <Text style={styles.sectionLabel}>
              Other matches — tap to switch
            </Text>
            {others.map((o) => (
              <Pressable
                key={o.card.productId}
                onPress={() => onSelectMatch?.(o)}
                style={styles.altRow}
              >
                {o.card.imageUrl ? (
                  <Image
                    source={{ uri: o.card.imageUrl }}
                    style={styles.altThumb}
                    contentFit="contain"
                    cachePolicy="memory-disk"
                  />
                ) : (
                  <View
                    style={[styles.altThumb, styles.altThumbPlaceholder]}
                  />
                )}
                <View style={styles.altInfo}>
                  <Text style={styles.altName} numberOfLines={1}>
                    {o.card.name} · {o.card.number}
                  </Text>
                  <Text style={styles.altMeta} numberOfLines={1}>
                    {o.card.set}
                  </Text>
                </View>
                <Text style={styles.altScore}>
                  {Math.round(o.confidence * 100)}%
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {match && finishes.length > 1 ? (
          <View style={styles.altSection}>
            <Text style={styles.sectionLabel}>
              Print finish — tap to switch
            </Text>
            <View style={styles.finishRow}>
              {finishes.map((v) => {
                const selected = v.subType === selectedFinish?.subType;
                return (
                  <Pressable
                    key={v.subType}
                    onPress={() => setSubType(v.subType)}
                    style={[
                      styles.finishChip,
                      selected && styles.finishChipSelected,
                    ]}
                  >
                    <Text style={styles.finishChipText} numberOfLines={1}>
                      {v.subType}
                    </Text>
                    <Text style={styles.finishChipPrice}>
                      ${v.marketPrice.toFixed(2)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {match ? (
          <>
            <View style={styles.conditionRow}>
              {CONDITION_CODES.map((code) => (
                <ConditionChip
                  key={code}
                  code={code}
                  label={CONDITION_LABELS[code].split(' ')[0]}
                  selected={condition === code}
                  onPress={setCondition}
                />
              ))}
            </View>
            <View style={styles.qtyRow}>
              <View style={styles.stepper}>
                <Pressable
                  onPress={() => setQuantity((q) => Math.max(1, q - 1))}
                  style={styles.stepButton}
                  hitSlop={6}
                >
                  <Ionicons name="remove" size={18} color={colors.text} />
                </Pressable>
                <Text style={styles.qtyValue}>{quantity}</Text>
                <Pressable
                  onPress={() => setQuantity((q) => q + 1)}
                  style={styles.stepButton}
                  hitSlop={6}
                >
                  <Ionicons name="add" size={18} color={colors.text} />
                </Pressable>
              </View>
              <Text style={styles.qtyTotal}>${totalPrice.toFixed(2)}</Text>
            </View>
            <View style={styles.buttonRow}>
              <Pressable onPress={onRetake} style={styles.retakeButton}>
                <Text style={styles.retakeText}>Retake</Text>
              </Pressable>
              <Pressable
                onPress={() =>
                  onConfirm?.(condition, quantity, selectedFinish?.subType)
                }
                style={styles.addButton}
              >
                <Text style={styles.addText}>Add to Queue</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <Pressable onPress={onRetake} style={styles.retakeButtonFull}>
            <Text style={styles.retakeText}>Retake photo</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '58%',
    backgroundColor: '#10151c',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginTop: 8,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    padding: 16,
    paddingTop: 12,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cropThumb: {
    width: 56,
    height: 78,
    borderRadius: 6,
    backgroundColor: colors.surface,
  },
  headInfo: {
    flex: 1,
    marginLeft: 12,
  },
  name: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  meta: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  priceCol: {
    alignItems: 'flex-end',
    marginLeft: 10,
  },
  price: {
    color: colors.text,
    fontSize: 18,
    fontWeight: 'bold',
  },
  priceSub: {
    color: colors.primary,
    fontSize: 11,
    marginTop: 2,
  },
  altSection: {
    marginTop: 14,
  },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 8,
  },
  altRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginTop: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  altRowSelected: {
    borderColor: colors.primary,
  },
  altThumb: {
    width: 34,
    height: 47,
    borderRadius: 4,
  },
  altThumbPlaceholder: {
    backgroundColor: colors.surface,
  },
  altInfo: {
    flex: 1,
    marginLeft: 10,
  },
  altName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: 'bold',
  },
  altMeta: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  altScore: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  finishRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
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
  conditionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 14,
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyValue: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
    minWidth: 22,
    textAlign: 'center',
  },
  qtyTotal: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  retakeButton: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  retakeButtonFull: {
    marginTop: 14,
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  retakeText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: 'bold',
  },
  addButton: {
    flex: 2,
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  addText: {
    color: colors.background,
    fontSize: 15,
    fontWeight: 'bold',
  },
});
