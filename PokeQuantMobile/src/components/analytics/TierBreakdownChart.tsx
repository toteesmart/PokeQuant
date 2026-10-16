import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../constants/colors';
import { radius } from '../../constants/theme';
import { formatCurrency } from '../../utils/format';
import type { Tier } from '../../services/salesAnalytics';

export function TierBreakdownChart({ tiers, width }: { tiers: Tier[]; width: number }) {
  if (tiers.every((t) => t.count === 0)) {
    return (
      <View style={[tierStyles.empty, { width }]}>
        <Text style={tierStyles.emptyText}>No sales in this period</Text>
      </View>
    );
  }

  return (
    <View style={{ width }}>
      {tiers.map((t) => (
        <View key={t.key} style={tierStyles.row}>
          <View style={tierStyles.headerRow}>
            <Text style={tierStyles.label}>{t.label}</Text>
            <Text style={tierStyles.value}>
              {formatCurrency(t.revenue)} · {t.count} cards
            </Text>
          </View>
          <View style={tierStyles.track}>
            <View style={[tierStyles.fill, { width: `${Math.min(100, t.share)}%` }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const tierStyles = StyleSheet.create({
  row: {
    marginBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  label: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  value: {
    color: colors.textMuted,
    fontSize: 11,
  },
  track: {
    height: 8,
    backgroundColor: colors.overlay4,
    borderRadius: radius.badge,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: colors.success,
  },
  empty: {
    minHeight: 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 12,
  },
});
