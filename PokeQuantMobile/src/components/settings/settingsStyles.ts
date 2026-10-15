// Settings screen styles — shared by SettingsScreen and the
// components/settings/* section components (buttons, rule rows, team
// rows, section cards span multiple sections).
import { StyleSheet } from 'react-native';
import { colors } from '../../constants/colors';
import { layout, radius } from '../../constants/theme';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  chromeTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 4,
  },
  tiers: {
    gap: 12,
  },
  tierCard: {
    backgroundColor: colors.overlay2,
    borderRadius: radius.cardLg,
    padding: layout.cardPadding,
  },
  tierHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  tierHeading: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  removeButton: {
    backgroundColor: colors.errorTintStrong,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.error,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  removeButtonDisabled: {
    backgroundColor: colors.overlay2,
    borderColor: colors.border,
  },
  removeButtonText: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '600',
  },
  removeButtonTextDisabled: {
    color: colors.textMuted,
  },
  tierRow: {
    flexDirection: 'row',
    marginHorizontal: -6,
    marginBottom: 12,
  },
  tierCol: {
    flex: 1,
    paddingHorizontal: 6,
  },
  tierLabel: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 4,
  },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 14,
  },
  inputInvalid: {
    borderColor: colors.error,
  },
  marginControl: {
    marginTop: 4,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  slider: {
    flex: 1,
    marginRight: 12,
    height: 40,
  },
  marginInput: {
    width: 64,
    backgroundColor: colors.surface,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    paddingHorizontal: 6,
    paddingVertical: 10,
    fontSize: 14,
    textAlign: 'center',
  },
  tierActions: {
    flexDirection: 'row',
    marginHorizontal: -6,
    marginTop: 8,
  },
  addButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radius.controlLg,
    paddingVertical: 14,
    alignItems: 'center',
    marginHorizontal: 6,
  },
  addButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  resetButton: {
    flex: 1,
    backgroundColor: colors.overlay4,
    borderRadius: radius.controlLg,
    paddingVertical: 14,
    alignItems: 'center',
    marginHorizontal: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resetButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  sectionSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 8,
    marginBottom: 14,
  },
  ruleRow: {
    flexDirection: 'row',
    marginHorizontal: -6,
    marginBottom: 12,
  },
  ruleFull: {
    flex: 1,
    paddingHorizontal: 6,
  },
  ruleHalf: {
    flex: 1,
    paddingHorizontal: 6,
  },
  noticeText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  warningText: {
    color: colors.warning,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.controlLg,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  secondaryButton: {
    backgroundColor: colors.overlay4,
    borderRadius: radius.controlLg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineTimestamp: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: 14,
  },
  devSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 8,
    marginBottom: 14,
  },
  dangerButton: {
    backgroundColor: colors.errorTintStrong,
    borderRadius: radius.controlLg,
    borderWidth: 1,
    borderColor: colors.error,
    paddingVertical: 14,
    alignItems: 'center',
  },
  dangerButtonDisabled: {
    opacity: 0.5,
  },
  dangerButtonText: {
    color: colors.error,
    fontSize: 16,
    fontWeight: '700',
  },
  sectionCard: {
    backgroundColor: colors.overlay2,
    borderRadius: radius.cardLg,
    padding: layout.cardPadding,
    marginBottom: layout.gridGap,
  },
  sectionCardTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  teamCodeBox: {
    backgroundColor: colors.overlay3,
    borderRadius: radius.card,
    padding: layout.cardPadding,
    alignItems: 'center',
    marginBottom: 12,
  },
  teamCodeLabel: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 4,
  },
  teamCodeValue: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 2,
  },
  teamSeatsText: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: 14,
  },
  teamInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  teamInput: {
    width: 140,
    backgroundColor: colors.surface,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 16,
    textAlign: 'center',
    letterSpacing: 2,
  },
  teamNameInput: {
    flex: 1,
    backgroundColor: colors.surface,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 16,
  },
  memberList: {
    marginTop: 14,
    gap: 8,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.overlay3,
    borderRadius: radius.card,
    padding: 10,
  },
  memberText: {
    color: colors.text,
    fontSize: 13,
    flex: 1,
  },
  memberRemove: {
    backgroundColor: colors.errorTintStrong,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.error,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  memberRemoveText: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '600',
  },
});
