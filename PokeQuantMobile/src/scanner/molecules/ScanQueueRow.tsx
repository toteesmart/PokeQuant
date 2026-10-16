// One queued scan card: image (tap → viewer), name (tap → deal analysis),
// remove, meta/badges, market + signal, editable offer, est. profit,
// condition cycler, quantity stepper. Row tap opens the variant switcher.

import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../constants/colors';
import { CONDITION_CODES, CONDITION_LABELS } from '../constants/conditions';
import { displayCardName } from '../services/catalog/catalogMatcher';
import { offerBreakdown } from '../utils/pricing';
import { DealClassBadge } from '../atoms/DealClassBadge';
import { JpBadge } from '../../components/JpBadge';
import { SetBadge } from '../../components/SetBadge';
import { isJpSetName } from '../../utils/jp';
import type { ConditionCode, ScannedCard } from '../types/scan';

function nextCondition(code: ConditionCode): ConditionCode {
  const idx = CONDITION_CODES.indexOf(code);
  return CONDITION_CODES[(idx + 1) % CONDITION_CODES.length];
}

type Props = {
  item: ScannedCard;
  onOpenSwitcher: (item: ScannedCard) => void;
  onViewImage: (uri: string, name: string) => void;
  onAnalyze: (item: ScannedCard) => void;
  onRemove: (id: string) => void;
  onEditOffer: (item: ScannedCard) => void;
  onCondition: (id: string, condition: ConditionCode) => void;
  onQuantity: (id: string, quantity: number) => void;
};

export const ScanQueueRow = memo(function ScanQueueRow({
  item,
  onOpenSwitcher,
  onViewImage,
  onAnalyze,
  onRemove,
  onEditOffer,
  onCondition,
  onQuantity,
}: Props) {
  const econ = offerBreakdown(item.marketPrice, item.customOffer);

  return (
    <Pressable style={styles.card} onPress={() => onOpenSwitcher(item)}>
      {item.imageUrl ? (
        // Image tap = card viewer; card tap = variant switcher.
        // The inner Pressable wins the touch.
        <Pressable
          onPress={() => onViewImage(item.imageUrl!, displayCardName(item.name))}
          hitSlop={2}
          accessibilityLabel={`View ${displayCardName(item.name)} image`}
          accessibilityRole="imagebutton"
        >
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
          <Pressable onPress={() => onAnalyze(item)} hitSlop={4} style={styles.nameLinkWrap}>
            <Text style={[styles.name, styles.nameLink]} numberOfLines={1}>
              {displayCardName(item.name)}
            </Text>
            <Ionicons name="analytics-outline" size={13} color={colors.primary} />
          </Pressable>
          {isJpSetName(item.set) ? <JpBadge /> : null}
          <Pressable
            onPress={() => onRemove(item.id)}
            hitSlop={8}
            style={styles.removeButton}
            accessibilityLabel={`Remove ${item.name}`}
            accessibilityRole="button"
          >
            <Ionicons name="close" size={16} color={colors.textMuted} />
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
            <Text style={styles.detailValue}>${item.marketPrice.toFixed(2)}</Text>
            {item.signal ? <DealClassBadge signal={item.signal} /> : null}
          </View>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>You pay</Text>
          <Pressable onPress={() => onEditOffer(item)} style={styles.offerEditRow}>
            <Text style={styles.detailAccent}>
              ${Math.round(econ.offer)} ({econ.offerPct}% of market)
              {item.customOffer != null ? ' · edited' : ''}
            </Text>
            <Ionicons name="pencil" size={11} color={colors.textMuted} />
          </Pressable>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Est. profit</Text>
          <Text style={styles.detailProfit}>+${Math.round(econ.profit)}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Condition</Text>
          <Pressable onPress={() => onCondition(item.id, nextCondition(item.condition))}>
            <Text style={styles.detailAccent}>{CONDITION_LABELS[item.condition]}</Text>
          </Pressable>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Quantity</Text>
          <View style={styles.stepper}>
            <Pressable
              onPress={() => onQuantity(item.id, item.quantity - 1)}
              style={styles.stepButton}
              hitSlop={8}
              accessibilityLabel="Decrease quantity"
              accessibilityRole="button"
            >
              <Ionicons name="remove" size={14} color={colors.text} />
            </Pressable>
            <Text style={styles.qtyValue}>{item.quantity}</Text>
            <Pressable
              onPress={() => onQuantity(item.id, item.quantity + 1)}
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
});

const styles = StyleSheet.create({
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
  offerEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
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
});
