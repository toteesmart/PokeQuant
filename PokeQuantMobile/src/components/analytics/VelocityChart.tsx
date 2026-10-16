import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../../constants/colors';
import { radius, spacing } from '../../constants/theme';
import { formatCurrency } from '../../utils/format';
import type { Bucket } from '../../services/salesAnalytics';
import { COST_GRAY, REVENUE_GREEN } from './palette';

export function VelocityChart({ buckets, width }: { buckets: Bucket[]; width: number }) {
  const [selected, setSelected] = useState<Bucket | null>(null);
  const chartHeight = 120;
  const max = Math.max(1, ...buckets.map((b) => Math.max(b.revenue, b.cost)));

  if (buckets.length === 0) {
    return (
      <View style={[velocityStyles.empty, { width }]}>
        <Text style={velocityStyles.emptyText}>No sales in this period</Text>
      </View>
    );
  }

  return (
    <View style={{ width }}>
      <View style={[velocityStyles.barsContainer, { height: chartHeight }]}>
        {buckets.map((b, i) => {
          const revH = Math.max(4, (b.revenue / max) * (chartHeight - 24));
          const costH = Math.max(4, (b.cost / max) * (chartHeight - 24));
          return (
            <TouchableOpacity
              key={i}
              activeOpacity={0.8}
              style={velocityStyles.barColumn}
              onPress={() => setSelected(b)}
            >
              <View style={velocityStyles.barPair}>
                <View style={[velocityStyles.revenueBar, { height: revH }]} />
                <View style={[velocityStyles.costBar, { height: costH }]} />
              </View>
              <Text style={velocityStyles.xLabel}>{b.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {selected ? (
        <View style={velocityStyles.tooltip}>
          <Text style={velocityStyles.tooltipText}>
            {selected.label}: {formatCurrency(selected.revenue)} in sales,{' '}
            {formatCurrency(selected.cost)} paid, {selected.units} sold
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const velocityStyles = StyleSheet.create({
  barsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  barPair: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  revenueBar: {
    width: 8,
    backgroundColor: REVENUE_GREEN,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    marginRight: 1,
  },
  costBar: {
    width: 8,
    backgroundColor: COST_GRAY,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    marginLeft: 1,
  },
  xLabel: {
    color: colors.textMuted,
    fontSize: 9,
    marginTop: 4,
    textAlign: 'center',
  },
  tooltip: {
    backgroundColor: colors.overlay3,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginTop: spacing['3xl'],
  },
  tooltipText: {
    color: colors.text,
    fontSize: 11,
    textAlign: 'center',
  },
  empty: {
    minHeight: 160,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 12,
  },
});
