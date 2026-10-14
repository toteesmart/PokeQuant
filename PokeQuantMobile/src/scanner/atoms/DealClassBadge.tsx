import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';
import type { CardSignal } from '../../db/catalogDb';
import { classifyDeal, type DealRead } from '../services/deal/dealClassify';

// The single verdict badge — class label in class color. Same word and
// color on every surface (search, inventory, queue, trade, analysis) so
// there's one vocabulary to learn. Tappable glosses come from callers
// wrapping it in <Tip>.

type Props = {
  signal?: CardSignal | null;
  /** Pre-computed read when the caller already classified. */
  read?: DealRead;
  style?: StyleProp<TextStyle>;
};

export function DealClassBadge({ signal, read, style }: Props) {
  const r = read ?? classifyDeal(signal);
  return (
    <Text
      style={[styles.badge, { color: r.color, borderColor: r.color }, style]}
      numberOfLines={1}
    >
      {r.label}
    </Text>
  );
}

const styles = StyleSheet.create({
  badge: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
});
