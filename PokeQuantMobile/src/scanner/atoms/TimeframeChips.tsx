import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../constants/colors';
import { controls, radius, spacing, type_, weight } from '../../constants/theme';

export type Timeframe = { label: string; display: string; days: number };

export const TIMEFRAMES: Timeframe[] = [
  { label: '1M', display: '1 mo', days: 31 },
  { label: '3M', display: '3 mo', days: 92 },
  { label: '6M', display: '6 mo', days: 183 },
  { label: '1Y', display: '1 yr', days: 366 },
  { label: '2Y', display: '2 yrs', days: 731 },
  { label: 'MAX', display: 'All', days: Number.POSITIVE_INFINITY },
];

/** Display word for a timeframe label — pills/deltas show "3 mo", not "3M". */
export function timeframeDisplay(label: string): string {
  return TIMEFRAMES.find((t) => t.label === label)?.display ?? label;
}

type Props = {
  selected: string;
  onSelect: (label: string) => void;
  /** Windows longer than the card's own history are greyed out — a card
   *  released last month has no meaningful "2Y" view. */
  maxDays?: number | null;
};

export function TimeframeChips({ selected, onSelect, maxDays }: Props) {
  return (
    <View style={styles.row}>
      {TIMEFRAMES.map((tf) => {
        const active = tf.label === selected;
        const disabled = Number.isFinite(tf.days) && maxDays != null && tf.days > maxDays;
        return (
          <Pressable
            key={tf.label}
            onPress={() => !disabled && onSelect(tf.label)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled }}
            style={[styles.chip, active && styles.chipActive, disabled && styles.chipDisabled]}
          >
            <Text
              style={[styles.text, active && styles.textActive, disabled && styles.textDisabled]}
            >
              {tf.display}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignSelf: 'center',
    backgroundColor: colors.overlay2,
    borderRadius: radius.pill,
    padding: spacing.sm,
    marginTop: spacing['2xl'],
  },
  chip: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing['3xl'],
    borderRadius: radius.pill,
    minHeight: controls.minTouchTarget - spacing.sm,
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.surface },
  chipDisabled: { opacity: 0.35 },
  text: {
    color: colors.textMuted,
    fontSize: type_.label,
    fontWeight: weight.semibold,
  },
  textActive: { color: colors.text },
  textDisabled: { color: colors.textMuted },
});
