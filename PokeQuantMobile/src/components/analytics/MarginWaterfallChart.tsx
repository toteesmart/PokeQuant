import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../constants/colors';
import { radius } from '../../constants/theme';
import { formatCurrency, formatSignedCurrency } from '../../utils/format';
import type { CompletedSale } from '../../store/inventoryStore';
import { calculateMetrics } from '../../services/salesAnalytics';
import { COST_GRAY, PROFIT_GREEN } from './palette';

export function MarginWaterfallChart({ sales, width }: { sales: CompletedSale[]; width: number }) {
  const metrics = useMemo(() => calculateMetrics(sales), [sales]);
  const costShare = metrics.totalRevenue > 0 ? (metrics.totalCost / metrics.totalRevenue) * 100 : 0;
  const profitShare =
    metrics.totalRevenue > 0 ? (metrics.netProfit / metrics.totalRevenue) * 100 : 0;

  if (sales.length === 0) {
    return (
      <View style={[waterfallStyles.empty, { width }]}>
        <Text style={waterfallStyles.emptyText}>No sales in this period</Text>
      </View>
    );
  }

  return (
    <View style={{ width }}>
      <View style={waterfallStyles.track}>
        <View
          style={[
            waterfallStyles.segment,
            {
              width: `${Math.max(0, Math.min(100, costShare))}%`,
              backgroundColor: COST_GRAY,
            },
          ]}
        />
        <View
          style={[
            waterfallStyles.segment,
            {
              width: `${Math.max(0, Math.min(100, profitShare))}%`,
              backgroundColor: PROFIT_GREEN,
            },
          ]}
        />
      </View>
      <View style={waterfallStyles.legend}>
        <View style={waterfallStyles.legendItem}>
          <View style={[waterfallStyles.legendDot, { backgroundColor: COST_GRAY }]} />
          <Text style={waterfallStyles.legendText}>
            Cost {formatCurrency(metrics.totalCost)} ({costShare.toFixed(1)}%)
          </Text>
        </View>
        <View style={waterfallStyles.legendItem}>
          <View style={[waterfallStyles.legendDot, { backgroundColor: PROFIT_GREEN }]} />
          <Text style={waterfallStyles.legendText}>
            Profit {formatSignedCurrency(metrics.netProfit)} ({profitShare.toFixed(1)}%)
          </Text>
        </View>
      </View>
    </View>
  );
}

const waterfallStyles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    height: 24,
    borderRadius: radius.control,
    overflow: 'hidden',
    backgroundColor: colors.overlay4,
  },
  segment: {
    height: '100%',
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 6,
    marginRight: 6,
  },
  legendText: {
    color: colors.textMuted,
    fontSize: 11,
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
