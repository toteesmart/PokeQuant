// MatchReviewSheet family styles — one owner for the sheet and its
// extracted leaves (altRow/altThumb/altScore back OtherMatchCard;
// finishChip/signalDot back FinishChip).
import { StyleSheet } from 'react-native';
import { colors } from '../../constants/colors';

export const styles = StyleSheet.create({
  footerRow: {
    flexDirection: 'row',
    gap: 10,
  },
  footerRetake: {
    flex: 1,
  },
  footerAdd: {
    flex: 2,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  thumbPair: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  thumbArrow: {
    marginHorizontal: 5,
  },
  cropThumb: {
    width: 56,
    height: 78,
    borderRadius: 6,
    backgroundColor: colors.surface,
  },
  headInfo: {
    flex: 1,
    marginLeft: 12,
  },
  name: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  meta: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  setBadge: {
    marginTop: 4,
    marginBottom: 2,
  },
  priceCol: {
    alignItems: 'flex-end',
    marginLeft: 10,
  },
  price: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  priceSub: {
    color: colors.primary,
    fontSize: 11,
    marginTop: 2,
  },
  verdictCol: {
    marginTop: 6,
  },
  signalReason: {
    color: colors.textMuted,
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 10,
  },
  analyzeLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  analyzeText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  signalDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 5,
  },
  finishChipLabel: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  altSection: {
    marginTop: 14,
  },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 8,
  },
  altRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 10,
    backgroundColor: colors.overlay2,
    marginTop: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  altRowSelected: {
    borderColor: colors.primary,
  },
  altThumb: {
    width: 34,
    height: 47,
    borderRadius: 4,
  },
  altThumbPlaceholder: {
    backgroundColor: colors.surface,
  },
  altInfo: {
    flex: 1,
    marginLeft: 10,
  },
  altName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  altSetBadge: {
    marginTop: 4,
  },
  altScore: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 8,
  },
  finishRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  finishChip: {
    minWidth: 96,
    minHeight: 46,
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.overlay3,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
  },
  finishChipSelected: {
    borderColor: colors.primary,
  },
  finishChipText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  finishChipPrice: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  conditionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 14,
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.overlay4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyValue: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    minWidth: 22,
    textAlign: 'center',
  },
  qtyTotal: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
});
