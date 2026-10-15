// Shared styles for the ShowVendorScreen panels (setup card, pick-list,
// listings) — single definition, same pattern as scannerScreenStyles.

import { StyleSheet } from 'react-native';
import { colors } from '../../constants/colors';
import { layout, radius } from '../../constants/theme';

export const showVendorPanelStyles = StyleSheet.create({
  setupCard: {
    backgroundColor: colors.overlay2,
    borderRadius: radius.cardLg,
    padding: layout.cardPadding,
    marginHorizontal: layout.screenPadding,
    marginBottom: layout.gridGap,
  },
  setupTitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  setupRow: {
    flexDirection: 'row',
  },
  setupInput: {
    flex: 1,
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 14,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    marginLeft: 8,
  },
  listContainer: {
    flex: 1,
    marginHorizontal: 16,
  },
  listContent: {
    paddingBottom: 8,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  footerSummary: {
    flex: 1,
  },
  footerCount: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  footerTotal: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  uploadButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.controlLg,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  uploadButtonDisabled: {
    backgroundColor: colors.border,
  },
  uploadButtonText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: '700',
  },
  publishButton: {
    backgroundColor: colors.success,
    borderRadius: radius.controlLg,
    paddingVertical: 14,
    alignItems: 'center',
  },
  publishButtonDisabled: {
    backgroundColor: colors.border,
  },
  publishButtonText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: '700',
  },
  errorText: {
    color: colors.error,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 8,
  },
  messageText: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 8,
  },
  messageSuccess: {
    color: colors.success,
  },
  messageError: {
    color: colors.error,
  },
});
