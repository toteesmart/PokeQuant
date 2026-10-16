import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../constants/colors';
import { layout, radius, spacing } from '../../constants/theme';
import { formatCurrency, formatSignedCurrency } from '../../utils/format';
import type { Metrics } from '../../services/salesAnalytics';
import { COST_GRAY, REVENUE_GREEN, ITEMS_PURPLE } from './palette';

export function HeroKPIs(metrics: Metrics) {
  return (
    <View style={heroStyles.container}>
      <View style={heroStyles.grid}>
        <View style={heroStyles.cardWrapper}>
          <View style={[heroStyles.card, heroStyles.revenueCard]}>
            <Text style={heroStyles.value}>{formatCurrency(metrics.totalRevenue)}</Text>
            <Text style={heroStyles.label}>Total sales</Text>
          </View>
        </View>
        <View style={heroStyles.cardWrapper}>
          <View style={[heroStyles.card, heroStyles.profitCard]}>
            <Text style={heroStyles.value}>{formatSignedCurrency(metrics.netProfit)}</Text>
            <View style={[heroStyles.badge, metrics.netProfit < 0 && heroStyles.badgeNegative]}>
              <Text
                style={[
                  heroStyles.badgeText,
                  metrics.netProfit >= 0
                    ? heroStyles.badgeTextPositive
                    : heroStyles.badgeTextNegative,
                ]}
              >
                {metrics.profitMargin >= 0 ? '+' : ''}
                {metrics.profitMargin.toFixed(1)}%
              </Text>
            </View>
            <Text style={heroStyles.label}>Profit</Text>
          </View>
        </View>
        <View style={heroStyles.cardWrapper}>
          <View style={[heroStyles.card, heroStyles.costCard]}>
            <Text style={heroStyles.value}>{formatCurrency(metrics.totalCost)}</Text>
            <Text style={heroStyles.label}>What you paid</Text>
          </View>
        </View>
        <View style={heroStyles.cardWrapper}>
          <View style={[heroStyles.card, heroStyles.itemsCard]}>
            <Text style={heroStyles.value}>{metrics.count}</Text>
            <Text style={heroStyles.subValue}>Avg {formatCurrency(metrics.avgTicket)}</Text>
            <Text style={heroStyles.label}>Sold / avg sale</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const heroStyles = StyleSheet.create({
  container: {
    backgroundColor: colors.overlay2,
    borderRadius: radius.cardLg,
    padding: layout.cardPadding,
    marginBottom: spacing['4xl'],
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cardWrapper: {
    width: '50%',
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  // KPI cell — inset tile, the colored top edge IS the accent bar.
  card: {
    backgroundColor: colors.overlay3,
    borderRadius: radius.card,
    padding: spacing.xl,
    minHeight: 76,
    justifyContent: 'center',
    borderTopWidth: 3,
  },
  revenueCard: {
    borderTopColor: colors.primary,
  },
  profitCard: {
    borderTopColor: REVENUE_GREEN,
  },
  costCard: {
    borderTopColor: COST_GRAY,
  },
  itemsCard: {
    borderTopColor: ITEMS_PURPLE,
  },
  value: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  subValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  label: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.chartGreenTint,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: REVENUE_GREEN,
    paddingVertical: 2,
    paddingHorizontal: 6,
    marginTop: 2,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  badgeTextPositive: {
    color: REVENUE_GREEN,
  },
  badgeTextNegative: {
    color: colors.error,
  },
  badgeNegative: {
    backgroundColor: colors.errorTint,
    borderColor: colors.error,
  },
});
