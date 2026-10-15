// SearchBuyScreen styles — shared owner for the screen and its row
// component. Scout page styles live with ScoutPage.
import { StyleSheet } from 'react-native';
import { colors } from '../constants/colors';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  inner: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.overlay3,
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 46,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    paddingVertical: 9,
  },
  scanButton: {
    width: 46,
    height: 46,
    borderRadius: 10,
    backgroundColor: colors.overlay3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterCard: {
    backgroundColor: colors.overlay2,
    borderRadius: 12,
    padding: 12,
    marginBottom: 4,
  },
  filterRow: {
    flexDirection: 'row',
    marginBottom: 14,
    width: '100%',
  },
  filterHalfLeft: {
    flex: 1,
    paddingRight: 6,
  },
  filterHalfRight: {
    flex: 1,
    paddingLeft: 6,
  },
  filterLabel: {
    color: colors.text,
    fontSize: 12,
    marginBottom: 4,
    fontWeight: '600',
  },
  numberInput: {
    minHeight: 44,
    backgroundColor: colors.overlay3,
    borderRadius: 8,
    color: colors.text,
    paddingHorizontal: 12,
  },
  emptyScroll: {
    paddingTop: 20,
    paddingBottom: 24,
  },
  scoutHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  scoutTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  scoutCount: {
    backgroundColor: colors.accentPurple,
    borderRadius: 999,
    minWidth: 24,
    height: 24,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoutCountText: {
    color: colors.onAccent,
    fontSize: 12,
    fontWeight: '800',
  },
  scoutSwipe: {
    color: colors.accentPurple,
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 'auto',
  },
  chromeHint: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 13,
    maxWidth: 240,
  },
  resultsCount: {
    color: colors.textMuted,
    fontSize: 13,
  },
  listWrapper: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 8,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
  },
  footerSpinner: {
    paddingVertical: 20,
  },
  progressTrack: {
    width: '80%',
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 4,
    marginTop: 16,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
  },
});
