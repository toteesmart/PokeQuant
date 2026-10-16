// PortfolioHero — the finance-app anatomy adapted to a card binder:
// what it's worth as the big number, the profit delta as a pill, and
// count folded into the label + cost basis into the pill itself.
// "Worth" is projected sticker value, not liquid cash — the label
// keeps that honest.
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../constants/colors';
import { DeltaPill } from './ui';
import { formatCurrency, formatSignedCurrency } from '../utils/format';

type PortfolioMetrics = {
  activeAssets: number;
  totalCostBasis: number;
  projectedSticker: number;
  projectedProfit: number;
};

export function PortfolioHero({ metrics, artUri }: { metrics: PortfolioMetrics; artUri?: string }) {
  const profit = metrics.projectedProfit;
  const profitColor =
    profit > 0 ? colors.velocityPositive : profit < 0 ? colors.velocityNegative : colors.textMuted;
  return (
    <View style={heroStyles.wrap}>
      {artUri ? (
        <>
          <Image
            source={{ uri: artUri }}
            style={StyleSheet.absoluteFill}
            blurRadius={60}
            contentFit="cover"
            cachePolicy="memory-disk"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
          <LinearGradient
            colors={[colors.background, 'transparent', colors.background]}
            locations={[0, 0.45, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </>
      ) : null}
      <Text style={heroStyles.label} numberOfLines={1}>
        Total sticker value · {metrics.activeAssets} {metrics.activeAssets === 1 ? 'card' : 'cards'}
      </Text>
      <Text style={heroStyles.value}>{formatCurrency(metrics.projectedSticker)}</Text>
      <DeltaPill
        text={
          metrics.totalCostBasis > 0
            ? `${formatSignedCurrency(profit)} vs ${formatCurrency(metrics.totalCostBasis)} paid`
            : `${formatSignedCurrency(profit)} vs what you paid`
        }
        color={profitColor}
        icon={profit > 0 ? 'caret-up' : profit < 0 ? 'caret-down' : undefined}
        style={heroStyles.pill}
      />
    </View>
  );
}

const heroStyles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 16,
  },
  label: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  value: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '800',
    marginTop: 4,
  },
  pill: {
    marginTop: 8,
  },
});
