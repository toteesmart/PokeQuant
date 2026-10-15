// ShiftBanner — deal-class shifts since the last catalog refresh.
// Held rows tap through to owner analysis; watched (unowned) cards are
// tagged so a revival doesn't read as inventory.
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import { layout, radius, spacing } from '../constants/theme';
import { displayCardName } from '../scanner/services/catalog/catalogMatcher';
import type { DealShift } from '../scanner/services/deal/dealShiftTracker';
import type { InventoryCard } from '../store/inventoryStore';
import type { WatchedCard } from '../store/watchlistStore';

export function ShiftBanner({
  classShifts,
  watchShifts,
  onAnalyze,
  onWatchAnalyze,
  onDismiss,
}: {
  classShifts: DealShift<InventoryCard>[];
  watchShifts: DealShift<WatchedCard>[];
  onAnalyze: (card: InventoryCard) => void;
  onWatchAnalyze: (card: WatchedCard) => void;
  onDismiss: () => void;
}) {
  if (classShifts.length + watchShifts.length === 0) return null;
  return (
    <View style={shiftStyles.banner}>
      <View style={shiftStyles.head}>
        <View>
          <Text style={shiftStyles.title}>Movement shifts</Text>
          <View style={shiftStyles.accent} />
        </View>
        <TouchableOpacity
          onPress={onDismiss}
          hitSlop={8}
          accessibilityLabel="Dismiss movement shifts"
          accessibilityRole="button">
          <Ionicons
            name="close"
            size={16}
            color={colors.textMuted}
          />
        </TouchableOpacity>
      </View>
      {classShifts.slice(0, 4).map((s) => (
        <TouchableOpacity
          key={s.card.id}
          style={shiftStyles.row}
          onPress={() => onAnalyze(s.card)}>
          <Text style={shiftStyles.name} numberOfLines={1}>
            {displayCardName(s.card.name)}
            {s.kind !== 'move' ? (
              <Text style={shiftStyles.kindTag}>
                {s.kind === 'revival' ? ' · starting to rise' : ' · floor broke'}
              </Text>
            ) : null}
          </Text>
          <Text style={shiftStyles.move} numberOfLines={1}>
            {s.from.label} →{' '}
            <Text style={{ color: s.color }}>{s.to.label}</Text>
          </Text>
        </TouchableOpacity>
      ))}
      {watchShifts.slice(0, Math.max(0, 4 - classShifts.length)).map((s) => (
        <TouchableOpacity
          key={`w${s.card.productId}${s.card.subType}`}
          style={shiftStyles.row}
          onPress={() => onWatchAnalyze(s.card)}>
          <Text style={shiftStyles.name} numberOfLines={1}>
            {s.card.name}
            <Text style={shiftStyles.watchTag}> · on your watchlist</Text>
            {s.kind !== 'move' ? (
              <Text style={shiftStyles.kindTag}>
                {s.kind === 'revival' ? ' · starting to rise' : ' · floor broke'}
              </Text>
            ) : null}
          </Text>
          <Text style={shiftStyles.move} numberOfLines={1}>
            {s.from.label} →{' '}
            <Text style={{ color: s.color }}>{s.to.label}</Text>
          </Text>
        </TouchableOpacity>
      ))}
      {classShifts.length + watchShifts.length > 4 ? (
        <Text style={shiftStyles.more}>
          +{classShifts.length + watchShifts.length - 4} more
        </Text>
      ) : null}
    </View>
  );
}

const shiftStyles = StyleSheet.create({
  // Soft tile + warning accent — the box border retired; the warning
  // accent bar carries the "pay attention" signal instead.
  banner: {
    backgroundColor: colors.overlay2,
    borderRadius: radius.cardLg,
    padding: layout.cardPadding,
    marginBottom: layout.gridGap,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  title: {
    color: colors.warning,
    fontSize: 12,
    fontWeight: '700',
  },
  accent: {
    width: 24,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.warning,
    marginTop: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    gap: 8,
  },
  name: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
  },
  move: {
    color: colors.textMuted,
    fontSize: 11,
    marginLeft: 'auto',
    flexShrink: 1,
  },
  kindTag: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '700',
  },
  watchTag: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
  },
  more: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 4,
    textAlign: 'right',
  },
});
