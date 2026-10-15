// DealAnalysisSheet family styles — one owner for the sheet and its
// extracted sections (dealCard/dealAction/dealHeadline/dealScript are
// shared chrome across PositionSection, DealReadSection, EngineLines).
import { StyleSheet } from 'react-native';
import { colors } from '../../constants/colors';
import {
  CARD_ASPECT_RATIO,
  layout,
  radius,
  spacing,
  type_,
  weight,
} from '../../constants/theme';

export const styles = StyleSheet.create({
  // Chrome (Modal, bleed backdrop, header, scroll container) now comes
  // from ui/GlassSheet — these styles are page content only.
  hero: { alignItems: 'center', marginTop: spacing.lg },
  heroImage: {
    width: 140,
    height: 140 / CARD_ASPECT_RATIO,
    borderRadius: radius.card,
  },
  heroName: {
    color: colors.text,
    fontSize: type_.title,
    fontWeight: weight.bold,
    textAlign: 'center',
    marginTop: spacing['2xl'],
  },
  heroMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  heroNumber: { color: colors.textMuted, fontSize: type_.label },
  priceHero: {
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing['4xl'],
  },
  priceValue: {
    color: colors.text,
    fontSize: type_.display,
    fontWeight: weight.heavy,
  },
  finishRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: spacing['2xl'],
  },
  finishChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: colors.overlay3,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  finishChipActive: { borderColor: colors.primary },
  finishText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  finishTextActive: { color: colors.primary },
  // zIndex lifts the whole row above the deal card so tip bubbles
  // dropping from its badges draw on top instead of behind it.
  verdictRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    zIndex: 30,
    marginTop: spacing['2xl'],
  },
  moduleRow: {
    flexDirection: 'row',
    gap: layout.gridGap,
    marginTop: spacing['4xl'],
  },
  moduleCard: {
    flex: 1,
    backgroundColor: colors.overlay2,
    borderRadius: radius.card,
    padding: layout.cardPadding,
  },
  moduleTitle: {
    color: colors.textMuted,
    fontSize: type_.label,
    fontWeight: weight.semibold,
  },
  moduleAccent: {
    width: 24,
    height: 3,
    borderRadius: radius.pill,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  moduleStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  moduleStatLabel: { color: colors.textMuted, fontSize: type_.meta },
  moduleStatValue: {
    color: colors.text,
    fontSize: type_.body,
    fontWeight: weight.semibold,
  },
  metricUp: { color: colors.velocityPositive },
  metricDown: { color: colors.velocityNegative },
  trackedSince: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  chartWrap: { marginTop: spacing['4xl'] },
  chartLoading: {
    height: 150,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dealCard: {
    marginTop: 12,
    backgroundColor: colors.overlay2,
    borderRadius: 10,
    borderLeftWidth: 3,
    padding: 12,
  },
  dealHeadline: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 7,
  },
  dealAction: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  positionHero: {
    fontSize: 16,
    fontWeight: '800',
    marginTop: 5,
  },
  positionMeta: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  facetCard: {
    marginTop: 8,
    backgroundColor: colors.overlay1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  facetRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 5,
    gap: 10,
  },
  facetLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    width: 76,
    marginTop: 1,
  },
  facetText: {
    color: colors.text,
    fontSize: 11,
    flex: 1,
    lineHeight: 15,
  },
  dealOffer: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    marginTop: 5,
  },
  positionLine: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 6,
  },
  dealScript: {
    color: colors.textMuted,
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 8,
    lineHeight: 16,
  },
  triggerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 7,
    marginTop: 8,
  },
  triggerTag: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  triggerPrice: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  triggerTail: {
    color: colors.textMuted,
    fontSize: 10,
    flex: 1,
    flexShrink: 1,
  },
  engineBlock: {
    marginTop: 8,
    gap: 4,
  },
  engineLine: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
  },
  engineWarn: {
    color: colors.velocityNegative,
  },
});
