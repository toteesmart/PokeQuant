import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../constants/colors';
import { normalizeNumber } from '../utils/normalizeText';
import {
  catalogName,
  displayCardName,
  type CatalogMatch,
} from '../services/catalog/catalogMatcher';
import { resolveCardImageUri } from '../services/catalog/ScannerCatalogProvider';
import type { VariantOption } from '../services/processPhoto';
import type { ConditionCode } from '../types/scan';
import { CONDITION_CODES, CONDITION_LABELS } from '../constants/conditions';
import { ConditionChip } from '../atoms/ConditionChip';
import { DealClassBadge } from '../atoms/DealClassBadge';
import { SetBadge } from '../../components/SetBadge';
import { AppButton, GlassSheet } from '../../components/ui';
import { FinishChip } from './FinishChip';
import { OtherMatchCard } from './OtherMatchCard';
import { styles } from './matchReviewSheetStyles';

type Props = {
  uri: string;
  match: CatalogMatch | null;
  variantOptions?: VariantOption[];
  otherMatches?: CatalogMatch[];
  onRetake: () => void;
  onConfirm?: (condition: ConditionCode, quantity: number, subType?: string) => void;
  onSelectMatch?: (match: CatalogMatch) => void;
  onAnalyze?: (subType?: string) => void;
  /** Set when the scan is feeding the trade evaluator — the confirm
   *  button becomes "Add to trade" instead of queueing. */
  tradePending?: boolean;
  onTradeAdd?: (quantity: number, subType?: string) => void;
};

export function MatchReviewSheet({
  uri,
  match,
  variantOptions,
  otherMatches,
  onRetake,
  onConfirm,
  onSelectMatch,
  onAnalyze,
  tradePending,
  onTradeAdd,
}: Props) {
  const [quantity, setQuantity] = useState(1);
  const [condition, setCondition] = useState<ConditionCode>('NM');
  const [subType, setSubType] = useState<string | null>(null);

  // Reset the finish selection when the matched card changes —
  // render-adjusted on productId.
  const productId = match?.card.productId;
  const [prevProductId, setPrevProductId] = useState(productId);
  if (productId !== prevProductId) {
    setPrevProductId(productId);
    setSubType(null);
  }

  // variants[0] is the Normal-resolved default; the picker lets the user
  // switch to e.g. Reverse Holofoil when the physical card differs.
  const finishes = match?.card.variants ?? [];
  const selectedFinish = finishes.find((v) => v.subType === subType) ?? finishes[0];
  const unitPrice = selectedFinish?.marketPrice ?? 0;
  const totalPrice = Number((unitPrice * quantity).toFixed(2));

  const handleSelect = (option: VariantOption) => {
    if (!match || option.card.productId === match.card.productId) return;
    onSelectMatch?.({
      card: option.card,
      method: option.score != null ? 'visual' : (match.method ?? 'visual'),
      confidence: option.score != null ? Math.max(0, Math.min(1, option.score)) : match.confidence,
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
      catalogName(o.card).split(' ')[0] === catalogName(match.card).split(' ')[0],
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
        catalogName(o.card).split(' ')[0] !== catalogName(match.card).split(' ')[0],
    )
    .slice(0, 5);

  // The captured photo (or the matched catalog art) blurs into the page
  // backdrop — same glossy bleed the analysis/evaluator sheets carry.
  const bleedArt = match ? resolveCardImageUri(match.card) : null;

  return (
    <GlassSheet
      title="Review scan"
      onClose={onRetake}
      artUri={bleedArt ?? uri}
      footer={
        match ? (
          <View style={styles.footerRow}>
            <AppButton
              title="Retake"
              variant="ghost"
              onPress={onRetake}
              style={styles.footerRetake}
            />
            <AppButton
              title={tradePending ? 'Add to trade' : 'Add to batch'}
              onPress={() =>
                tradePending
                  ? onTradeAdd?.(quantity, selectedFinish?.subType)
                  : onConfirm?.(condition, quantity, selectedFinish?.subType)
              }
              style={styles.footerAdd}
            />
          </View>
        ) : (
          <AppButton title="Retake photo" variant="ghost" onPress={onRetake} />
        )
      }
    >
      <>
        <View style={styles.headRow}>
          <View style={styles.thumbPair}>
            <Image
              source={{ uri }}
              style={styles.cropThumb}
              contentFit="cover"
              cachePolicy="none"
            />
            {match && resolveCardImageUri(match.card) ? (
              <>
                <Ionicons
                  name="arrow-forward"
                  size={13}
                  color={colors.textMuted}
                  style={styles.thumbArrow}
                />
                <Image
                  source={{ uri: resolveCardImageUri(match.card) }}
                  style={styles.cropThumb}
                  contentFit="contain"
                  cachePolicy="memory-disk"
                />
              </>
            ) : null}
          </View>
          <View style={styles.headInfo}>
            {match ? (
              <>
                <Text style={styles.name} numberOfLines={1}>
                  {displayCardName(match.card.name)}
                </Text>
                <SetBadge set={match.card.set} style={styles.setBadge} />
                <Text style={styles.meta} numberOfLines={1}>
                  {match.card.number} · matched by{' '}
                  {match.method === 'visual'
                    ? 'photo'
                    : match.method === 'number'
                      ? 'card number'
                      : 'name'}{' '}
                  ({Math.round(match.confidence * 100)}% sure)
                </Text>
              </>
            ) : (
              <Text style={styles.name}>Card not in the price list</Text>
            )}
          </View>
          {match ? (
            <View style={styles.priceCol}>
              <Text style={styles.price}>${unitPrice.toFixed(2)}</Text>
              <Text style={styles.priceSub}>market price</Text>
              {selectedFinish?.signal ? (
                <View style={styles.verdictCol}>
                  <DealClassBadge signal={selectedFinish.signal} />
                </View>
              ) : null}
            </View>
          ) : null}
        </View>

        {selectedFinish?.signal?.reason ? (
          <Text style={styles.signalReason} numberOfLines={2}>
            {selectedFinish.signal.reason}
          </Text>
        ) : null}

        {match && selectedFinish?.signal ? (
          <Pressable
            onPress={() => onAnalyze?.(selectedFinish.subType)}
            style={styles.analyzeLink}
            hitSlop={6}
          >
            <Ionicons name="analytics-outline" size={14} color={colors.primary} />
            <Text style={styles.analyzeText}>Price analysis</Text>
            <Ionicons name="chevron-forward" size={12} color={colors.primary} />
          </Pressable>
        ) : null}

        {variants.length > 1 ? (
          <View style={styles.altSection}>
            <Text style={styles.sectionLabel}>Variants — tap to switch</Text>
            {variants.slice(0, 5).map((o) => (
              <OtherMatchCard
                key={o.card.productId}
                card={o.card}
                score={o.score}
                selected={o.card.productId === match?.card.productId}
                onPress={() => handleSelect(o)}
              />
            ))}
          </View>
        ) : null}

        {others.length > 0 ? (
          <View style={styles.altSection}>
            <Text style={styles.sectionLabel}>Other matches — tap to switch</Text>
            {others.map((o) => (
              <OtherMatchCard
                key={o.card.productId}
                card={o.card}
                score={o.confidence}
                onPress={() => onSelectMatch?.(o)}
              />
            ))}
          </View>
        ) : null}

        {match && finishes.length > 1 ? (
          <View style={styles.altSection}>
            <Text style={styles.sectionLabel}>Print finish — tap to switch</Text>
            <View style={styles.finishRow}>
              {finishes.map((v) => (
                <FinishChip
                  key={v.subType}
                  variant={v}
                  selected={v.subType === selectedFinish?.subType}
                  onPress={setSubType}
                />
              ))}
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
                  label={CONDITION_LABELS[code]}
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
                  accessibilityLabel="Decrease quantity"
                  accessibilityRole="button"
                >
                  <Ionicons name="remove" size={18} color={colors.text} />
                </Pressable>
                <Text style={styles.qtyValue}>{quantity}</Text>
                <Pressable
                  onPress={() => setQuantity((q) => q + 1)}
                  style={styles.stepButton}
                  hitSlop={6}
                  accessibilityLabel="Increase quantity"
                  accessibilityRole="button"
                >
                  <Ionicons name="add" size={18} color={colors.text} />
                </Pressable>
              </View>
              <Text style={styles.qtyTotal}>${totalPrice.toFixed(2)}</Text>
            </View>
          </>
        ) : null}
      </>
    </GlassSheet>
  );
}
