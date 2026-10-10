import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../constants/colors';

export type Timeframe = { label: string; days: number };

export const TIMEFRAMES: Timeframe[] = [
  { label: '1M', days: 31 },
  { label: '3M', days: 92 },
  { label: '6M', days: 183 },
  { label: '1Y', days: 366 },
  { label: '2Y', days: 731 },
  { label: 'MAX', days: Number.POSITIVE_INFINITY },
];

type Props = {
  selected: string;
  onSelect: (label: string) => void;
};

export function TimeframeChips({ selected, onSelect }: Props) {
  return (
    <View style={styles.row}>
      {TIMEFRAMES.map((tf) => {
        const active = tf.label === selected;
        return (
          <Pressable
            key={tf.label}
            onPress={() => onSelect(tf.label)}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.text, active && styles.textActive]}>
              {tf.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6 },
  chip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 7,
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipActive: { borderColor: colors.primary, backgroundColor: '#17253a' },
  text: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  textActive: { color: colors.primary },
});
