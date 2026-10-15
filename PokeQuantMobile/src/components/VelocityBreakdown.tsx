// VelocityBreakdown — the collapsible "price moves since last update"
// module: summary pills per window on the header, period rail +
// horizontal mover cards when expanded.
import { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../constants/colors';
import { layout, radius, spacing } from '../constants/theme';
import { MiniMoverCard } from './MiniMoverCard';
import { SegmentedPills } from './ui';
import {
  VELOCITY_PERIODS,
  VELOCITY_PILL_TABS,
  type Period,
  type VelocityWindow,
} from '../services/portfolioVelocity';
import { formatSignedCurrency } from '../utils/format';

export function VelocityBreakdown({
  data,
}: {
  data: Record<Period, VelocityWindow>;
}) {
  const [velocityExpanded, setVelocityExpanded] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<Period>('1d');
  const current = data[selectedPeriod];

  return (
    <View style={velocityStyles.container}>
      {/* Gloss sheen — the module-family highlight. */}
      <LinearGradient
        colors={[colors.overlay4, 'transparent']}
        locations={[0, 0.55]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <TouchableOpacity
        style={velocityStyles.header}
        onPress={() => setVelocityExpanded((v) => !v)}>
        <Text style={velocityStyles.title}>Price moves since last update</Text>
        <View style={velocityStyles.summaryPills}>
          {VELOCITY_PERIODS.map((p) => {
            const window = data[p];
            const isPositive = window.change >= 0;
            return (
              <View
                key={p}
                style={[
                  velocityStyles.summaryPill,
                  {
                    backgroundColor: isPositive
                      ? colors.successTint
                      : colors.errorTint,
                    borderColor: isPositive ? colors.success : colors.error,
                  },
                ]}>
                <Text
                  style={[
                    velocityStyles.summaryPillText,
                    { color: isPositive ? colors.success : colors.error },
                  ]}>
                  {window.label}: {formatSignedCurrency(window.change)}
                </Text>
              </View>
            );
          })}
        </View>
      </TouchableOpacity>

      {velocityExpanded && (
        <View style={velocityStyles.body}>
          <SegmentedPills
            tabs={VELOCITY_PILL_TABS}
            activeTab={selectedPeriod}
            onChange={setSelectedPeriod}
            style={velocityStyles.periodRail}
          />

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            nestedScrollEnabled
            contentContainerStyle={velocityStyles.moverScroll}>
            {current.movers.map((mover, index) => (
              <MiniMoverCard key={index} mover={mover} />
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const velocityStyles = StyleSheet.create({
  // Glossy lifted module — same recipe as StockHealthPanel (overlay3 +
  // hairline + lift); the sheen renders inside as first child.
  container: {
    backgroundColor: colors.overlay3,
    borderRadius: radius.cardLg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginTop: layout.gridGap,
    elevation: 8,
    shadowColor: colors.black,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  header: {
    padding: layout.cardPadding,
  },
  title: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 4,
  },
  summaryPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 4,
  },
  summaryPill: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginRight: spacing.sm,
    marginBottom: spacing.xs,
  },
  summaryPillText: {
    fontSize: 9,
    fontWeight: '600',
  },
  body: {
    padding: 8,
    paddingTop: 0,
  },
  periodRail: {
    marginVertical: 0,
    marginBottom: spacing.lg,
    alignSelf: 'stretch',
  },
  moverScroll: {
    paddingVertical: 2,
  },
});
