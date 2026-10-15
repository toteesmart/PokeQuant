import { Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../constants/colors';
import { displayCardName } from '../services/catalog/catalogMatcher';
import { DealClassBadge } from '../atoms/DealClassBadge';
import { formatCurrency } from '../../utils/format';
import type { TradeEntry } from '../services/deal/tradeEval';
import { tradeSheetStyles as styles } from './tradeSheetStyles';

export function TradeEntryRow({
  entry,
  onQty,
  onRemove,
  onOpen,
}: {
  entry: TradeEntry;
  onQty: (delta: number) => void;
  onRemove: () => void;
  onOpen: () => void;
}) {
  return (
    <Pressable onPress={onOpen} style={styles.entryRow}>
      {entry.imageUrl ? (
        <Image
          source={{ uri: entry.imageUrl }}
          style={styles.entryThumb}
          contentFit="contain"
          cachePolicy="memory-disk"
        />
      ) : (
        <View style={[styles.entryThumb, styles.thumbPlaceholder]} />
      )}
      <View style={styles.entryInfo}>
        <View style={styles.entryNameRow}>
          <Text style={styles.entryName} numberOfLines={1}>
            {displayCardName(entry.name)}
            {entry.number ? ` · ${entry.number}` : ''}
          </Text>
          <Ionicons
            name="analytics-outline"
            size={11}
            color={colors.primary}
          />
        </View>
        <Text style={styles.entryMeta} numberOfLines={1}>
          {entry.subType ?? '—'} · {formatCurrency(entry.price)}
        </Text>
      </View>
      {entry.signal ? <DealClassBadge signal={entry.signal} /> : null}
      {/* Inventory rows are one physical card each — dupes are separate
          entries, so the stepper only appears on catalog/scan entries. */}
      {entry.inventoryId ? null : (
        <View
          style={styles.qtyBox}
          onStartShouldSetResponder={() => true}
        >
          <Pressable
            onPress={() => onQty(-1)}
            hitSlop={8}
            accessibilityLabel="Decrease quantity"
            accessibilityRole="button"
          >
            <Ionicons name="remove" size={15} color={colors.text} />
          </Pressable>
          <Text style={styles.qtyText}>{entry.qty}</Text>
          <Pressable
            onPress={() => onQty(1)}
            hitSlop={8}
            accessibilityLabel="Increase quantity"
            accessibilityRole="button"
          >
            <Ionicons name="add" size={15} color={colors.text} />
          </Pressable>
        </View>
      )}
      <Text style={styles.entryTotal}>{formatCurrency(entry.price * entry.qty)}</Text>
      <Pressable
        onPress={onRemove}
        hitSlop={8}
        onStartShouldSetResponder={() => true}
        accessibilityLabel={`Remove ${entry.name}`}
        accessibilityRole="button"
      >
        <Ionicons name="close" size={15} color={colors.textMuted} />
      </Pressable>
    </Pressable>
  );
}
