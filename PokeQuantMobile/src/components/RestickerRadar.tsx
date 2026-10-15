import { memo, useCallback, useMemo } from 'react';
import { FlashList, useRecyclingState } from '@shopify/flash-list';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import { radius } from '../constants/theme';
import { useVendorStore } from '../store/vendorStore';
import {
  useInventoryStore,
  type InventoryCard,
} from '../store/inventoryStore';
import { SetBadge } from './SetBadge';
import { displayCardName } from '../scanner/services/catalog/catalogMatcher';
import { formatCurrency } from '../utils/format';

type RestickerItem = {
  card: InventoryCard;
  targetSticker: number;
};

const RestickerRow = memo(function RestickerRow({
  item,
  onUpdate,
}: {
  item: RestickerItem;
  onUpdate: (item: RestickerItem) => Promise<void>;
}) {
  const [updating, setUpdating] = useRecyclingState(false, [item.card.id]);

  const handlePress = async () => {
    if (updating) return;
    setUpdating(true);
    try {
      await onUpdate(item);
    } finally {
      setUpdating(false);
    }
  };

  const meta = [item.card.number]
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .join(' · ');

  return (
    <View style={styles.radarRow}>
      <View style={styles.radarInfo}>
        <Text style={styles.radarName} numberOfLines={1}>
          {displayCardName(item.card.name)}
        </Text>
        {meta.length > 0 && <Text style={styles.radarMeta}>{meta}</Text>}
        <SetBadge set={item.card.set} style={styles.radarSetBadge} />
        <View style={styles.radarPrices}>
          <Text style={styles.radarCurrent}>
            {formatCurrency(item.card.stickerPrice)} now
          </Text>
          <Text style={styles.radarArrow}>→</Text>
          <Text style={styles.radarTarget}>
            {formatCurrency(item.targetSticker)} suggested
          </Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.radarButton, updating && styles.radarButtonDisabled]}
        activeOpacity={updating ? 1 : 0.7}
        onPress={handlePress}
        disabled={updating}>
        <Text
          style={[
            styles.radarButtonText,
            updating && styles.radarButtonTextDisabled,
          ]}>
          {updating ? '...' : 'Update sticker'}
        </Text>
      </TouchableOpacity>
    </View>
  );
});

// Fills its host — the segment provides the bounding box.
export function RestickerRadar() {
  const inventory = useInventoryStore((state) => state.inventory);
  const getStickerPrice = useVendorStore((state) => state.getStickerPrice);
  const stickerRules = useVendorStore((state) => state.stickerRules);
  const updateInventoryCard = useInventoryStore(
    (state) => state.updateInventoryCard
  );

  const radarData = useMemo<RestickerItem[]>(() => {
    const flagged: RestickerItem[] = [];
    for (const card of inventory) {
      const target = getStickerPrice(card.liveMarket);
      if (card.stickerPrice.toFixed(2) !== target.toFixed(2)) {
        flagged.push({ card, targetSticker: target });
      }
    }
    return flagged;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getStickerPrice is a stable store action; stickerRules is the actual reactivity key for rule edits
  }, [inventory, stickerRules, getStickerPrice]);

  const handleUpdate = useCallback(
    async (item: RestickerItem) => {
      await updateInventoryCard({
        id: item.card.id,
        stickerPrice: item.targetSticker,
      });
    },
    [updateInventoryCard]
  );

  const renderItem = useCallback(
    ({ item }: { item: RestickerItem }) => (
      <RestickerRow item={item} onUpdate={handleUpdate} />
    ),
    [handleUpdate]
  );

  return (
    <FlashList<RestickerItem>
      data={radarData}
      renderItem={renderItem}
      keyExtractor={(item) => item.card.id}
      ListEmptyComponent={
        <View style={styles.radarEmpty}>
          <Ionicons
            name="checkmark-circle"
            size={40}
            color={colors.success}
          />
          <Text style={styles.radarEmptyText}>
            Every sticker matches your rules.
          </Text>
        </View>
      }
      contentContainerStyle={styles.radarContent}
      style={styles.radarList}
    />
  );
}

const styles = StyleSheet.create({
  radarList: {
    flex: 1,
  },
  radarContent: {
    paddingVertical: 2,
  },
  radarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.overlay2,
    borderRadius: 12,
    padding: 8,
    marginBottom: 6,
  },
  radarInfo: {
    flex: 1,
    paddingRight: 8,
  },
  radarName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  radarMeta: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
    marginBottom: 4,
  },
  radarSetBadge: {
    marginBottom: 4,
  },
  radarPrices: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  radarCurrent: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '500',
  },
  radarArrow: {
    color: colors.textMuted,
    fontSize: 13,
    marginHorizontal: 6,
  },
  radarTarget: {
    color: colors.success,
    fontSize: 13,
    fontWeight: '700',
  },
  radarButton: {
    backgroundColor: colors.primaryTint,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  radarButtonDisabled: {
    backgroundColor: colors.overlay4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  radarButtonText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  radarButtonTextDisabled: {
    color: colors.textMuted,
  },
  radarEmpty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  radarEmptyText: {
    color: colors.success,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 12,
    textAlign: 'center',
  },
});
