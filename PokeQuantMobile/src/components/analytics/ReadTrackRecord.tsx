import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../constants/colors';
import { layout, radius } from '../../constants/theme';
import {
  classLabel,
  type DealClassId,
} from '../../scanner/services/deal/dealClassify';
import type { ClassTrackRecord } from '../../scanner/services/deal/dealGradeDb';

/** Per-class outcome record — "when the read said X at add-time, what
 *  did the card actually do?" Honest counts only; small samples flagged. */
export function ReadTrackRecord({ rows }: { rows: ClassTrackRecord[] }) {
  const graded = rows.reduce((n, r) => n + r.graded, 0);
  const open = rows.reduce((n, r) => n + (r.graded - r.sold), 0);
  if (graded === 0) return null;
  return (
    <View style={trackStyles.card}>
      <Text style={trackStyles.title}>Read track record</Text>
      <Text style={trackStyles.sub}>
        What the price read said when you stocked it vs how the sale went.
      </Text>
      {rows.map((r) => {
        const label = classLabel(r.dealClass as DealClassId) ?? r.dealClass;
        const hitRate = r.sold > 0 ? Math.round((r.wins / r.sold) * 100) : null;
        return (
          <View key={r.dealClass} style={trackStyles.row}>
            <Text style={trackStyles.cls} numberOfLines={1}>
              {label}
            </Text>
            <Text style={trackStyles.stat} numberOfLines={1}>
              {r.sold > 0
                ? `${r.sold}/${r.graded} sold · ${hitRate}% over cost` +
                  (r.avgMargin != null
                    ? ` · avg ${r.avgMargin >= 0 ? '+' : '−'}$${Math.abs(r.avgMargin).toFixed(0)}`
                    : '')
                : `${r.graded} in stock — none sold yet`}
              {r.sold > 0 && r.sold < 5 ? ' · small sample' : ''}
            </Text>
          </View>
        );
      })}
      {open > 0 ? (
        <Text style={trackStyles.foot}>
          {open} rated card{open === 1 ? '' : 's'} still in stock — no sale yet.
        </Text>
      ) : null}
    </View>
  );
}

const trackStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.overlay2,
    borderRadius: radius.cardLg,
    padding: layout.cardPadding,
    marginBottom: layout.gridGap,
  },
  title: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  sub: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 2,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    gap: 10,
  },
  cls: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
    width: 110,
    flexShrink: 0,
  },
  stat: {
    color: colors.textMuted,
    fontSize: 11,
    flex: 1,
  },
  foot: {
    color: colors.textMuted,
    fontSize: 10,
    fontStyle: 'italic',
    marginTop: 6,
  },
});

