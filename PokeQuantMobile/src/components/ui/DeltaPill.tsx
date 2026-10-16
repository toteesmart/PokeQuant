import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radius, spacing, type_, weight } from '../../constants/theme';
import { tintBg } from '../../utils/tint';

type Props = {
  text: string;
  /** Pill foreground — also drives the translucent background. */
  color: string;
  /** Optional leading glyph ('caret-up' / 'caret-down' for deltas). */
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
};

/** Small tinted pill for signed deltas and status reads — the analysis
 *  sheet's `▼ -10.5% · 3M` / trade sheet's `−$0.77` idiom. */
export function DeltaPill({ text, color, icon, style }: Props) {
  return (
    <View style={[styles.pill, { backgroundColor: tintBg(color) }, style]}>
      {icon ? <Ionicons name={icon} size={11} color={color} /> : null}
      <Text style={[styles.text, { color }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  text: { fontSize: type_.label, fontWeight: weight.bold },
});
