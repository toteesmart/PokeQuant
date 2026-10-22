// InventoryScreen styles — the screen shell (status row, list toolbar,
// grid container, floating bulk bar). Per-module styles live with
// their components (hero/search/health/rotation/velocity/shift/cell).
import { StyleSheet } from 'react-native';
import { colors } from '../constants/colors';
import { controls, radius, spacing } from '../constants/theme';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  radarHost: {
    flex: 1,
    paddingHorizontal: 16,
  },
  // One tab-viewport page inside the horizontal pager.
  page: {
    height: '100%',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    flexGrow: 1,
  },
  railInChrome: {
    marginVertical: 0,
  },
  listContentSelecting: {
    paddingBottom: 88,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  listToolbar: {
    marginBottom: spacing['2xl'],
  },
  // Badge-pill toggle — same verdict-badge recipe as the module action:
  // tint fill + primary hairline + primary label.
  selectBtn: {
    height: controls.chipHeight + spacing.sm,
    justifyContent: 'center',
    paddingHorizontal: spacing['2xl'],
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  selectBtnText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  bulkBtnDisabled: {
    opacity: 0.4,
  },
  emptyContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    minHeight: 320,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
  },
  // Floating bulk bar — frosted-chrome family (BlurView + overlay3 +
  // hairline + lift), actions inside are badge pills.
  bulkBar: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.overlay3,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.cardLg,
    overflow: 'hidden',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing['3xl'],
    elevation: 8,
    shadowColor: colors.black,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  bulkCount: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  bulkBtn: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing['3xl'],
    borderRadius: radius.pill,
  },
  bulkCancel: {
    backgroundColor: colors.overlay4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bulkSell: {
    backgroundColor: colors.successTintStrong,
    borderWidth: 1,
    borderColor: colors.success,
  },
  bulkSellText: {
    color: colors.success,
    fontSize: 13,
    fontWeight: '700',
  },
  bulkDel: {
    backgroundColor: colors.errorTintStrong,
    borderWidth: 1,
    borderColor: colors.error,
  },
  bulkDelConfirm: {
    backgroundColor: colors.velocityNegative,
    borderWidth: 1,
    borderColor: colors.velocityNegative,
  },
  bulkDelText: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '700',
  },
  bulkDelTextConfirm: {
    color: colors.background,
  },
  bulkCancelText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
});
