import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../constants/colors';
import { radius } from '../../constants/theme';

type Props = {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  /** Icon color — defaults to text; tinted for active states. */
  color?: string;
  size?: number;
  iconSize?: number;
  accessibilityLabel: string;
};

/** 34pt translucent circle icon button — the header chrome piece from
 *  the flagship sheets (back, watchlist, gear, scan). Icon-only, so an
 *  accessibility label is required. */
export function CircleButton({
  icon,
  onPress,
  color = colors.text,
  size = 34,
  iconSize = 18,
  accessibilityLabel,
}: Props) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={[styles.btn, { width: size, height: size, borderRadius: radius.pill }]}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
    >
      <Ionicons name={icon} size={iconSize} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    backgroundColor: colors.overlay3,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
