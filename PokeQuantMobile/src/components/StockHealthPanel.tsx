// StockHealthPanel — where the money sits across the five rotation
// buckets. Dollar-weighted: a $2 bulk card counts less than a $200
// chase card. The whole module taps through to the rotation sheet.
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import { layout, radius, spacing, type_, weight } from '../constants/theme';
import {
  BUCKET_COLOR,
  BUCKET_DESC,
  BUCKET_LABEL,
  BUCKET_ORDER,
  type StockHealth,
} from '../scanner/services/deal/stockHealth';
import { ScoreRing } from './ui';

export function StockHealthPanel({
  health,
  onOpenRotation,
}: {
  health: StockHealth;
  onOpenRotation: () => void;
}) {
  const active = BUCKET_ORDER.filter((b) => health.buckets[b].count > 0);
  const rotateCount = health.rotateOut.length;
  const hasData = health.items.length > 0;
  const unreadPct = Math.round((1 - health.coverage) * 100);
  // Segments cover the signaled share only — the unfilled track IS the
  // "no price data" portion, named in the legend so it isn't a silent gap.
  const segments = active.map((b) => ({
    fraction: health.buckets[b].value / health.totalValue,
    color: BUCKET_COLOR[b],
  }));
  const goodPct = Math.round(
    ((health.buckets.grow.value + health.buckets.keep.value) / health.totalValue) * 100,
  );
  return (
    <TouchableOpacity
      style={healthStyles.container}
      activeOpacity={0.85}
      disabled={!hasData}
      onPress={onOpenRotation}
      accessibilityRole="button"
      accessibilityLabel="Stock health details"
      accessibilityState={{ disabled: !hasData }}
    >
      {/* Gloss sheen — same finance-app highlight as AppButton/pills. */}
      <LinearGradient
        colors={[colors.overlay4, 'transparent']}
        locations={[0, 0.55]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <Text style={healthStyles.title}>How your stock is doing</Text>
      <View style={healthStyles.accent} />
      {hasData ? (
        <View style={healthStyles.ringRow}>
          <ScoreRing
            size={76}
            strokeWidth={7}
            segments={segments}
            label={`${goodPct}%`}
            sublabel="healthy"
          />
          <View style={healthStyles.legend}>
            {active.map((b) => (
              <View key={b} style={healthStyles.legendRow}>
                <View style={[healthStyles.legendBar, { backgroundColor: BUCKET_COLOR[b] }]} />
                <Text style={healthStyles.legendItem} numberOfLines={1}>
                  {`${BUCKET_LABEL[b]} — ${BUCKET_DESC[b]}`}
                </Text>
                <Text style={[healthStyles.legendPct, { color: BUCKET_COLOR[b] }]}>
                  {Math.round((health.buckets[b].value / health.totalValue) * 100)}%
                </Text>
              </View>
            ))}
            {unreadPct > 0 ? (
              <View style={healthStyles.legendRow}>
                <View style={[healthStyles.legendBar, { backgroundColor: colors.border }]} />
                <Text style={healthStyles.legendItem} numberOfLines={1}>
                  No price data
                </Text>
                <Text style={healthStyles.legendPct}>{unreadPct}%</Text>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
      {/* Read + action share one line — headline flows left, badge
          pill anchors right. The wrapping View guarantees the text
          shrinks instead of pushing the pill off-edge (flex row +
          Text shrink quirk). The whole module is the touch target. */}
      <View style={healthStyles.footer}>
        <View style={healthStyles.headlineWrap}>
          <Text style={healthStyles.headline}>{health.headline}</Text>
        </View>
        {hasData ? (
          <View style={healthStyles.footerPill}>
            <Text style={healthStyles.link}>
              {rotateCount > 0
                ? `Sell first — ${rotateCount} card${rotateCount === 1 ? '' : 's'}`
                : 'Review your stock'}
            </Text>
            <Ionicons name="chevron-forward" size={12} color={colors.primary} />
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const healthStyles = StyleSheet.create({
  // Glossy module surface — same recipe as the glass rail/circles
  // (overlay3 + hairline + lift) plus the button sheen above.
  container: {
    backgroundColor: colors.overlay3,
    borderRadius: radius.cardLg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: layout.cardPadding,
    marginBottom: layout.gridGap,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: colors.black,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  title: {
    color: colors.text,
    fontSize: type_.body,
    fontWeight: weight.bold,
  },
  accent: {
    width: 24,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  link: {
    color: colors.primary,
    fontSize: type_.label,
    fontWeight: weight.bold,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  // Badge-pill action — verdict-badge recipe (tint fill + colored
  // hairline + colored label), primary being the app's action color.
  footerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primaryTint,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.md,
  },
  ringRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['3xl'],
    marginBottom: spacing.lg,
  },
  legend: {
    flex: 1,
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  legendBar: {
    width: 3,
    height: 14,
    borderRadius: radius.pill,
  },
  legendItem: {
    flex: 1,
    color: colors.textMuted,
    fontSize: type_.caption,
    fontWeight: weight.semibold,
  },
  legendPct: {
    color: colors.text,
    fontSize: type_.label,
    fontWeight: weight.bold,
  },
  headlineWrap: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  headline: {
    color: colors.text,
    fontSize: type_.label,
    lineHeight: 17,
  },
});
