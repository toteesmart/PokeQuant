import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../../constants/colors';
import { controls, radius, spacing, type_, weight } from '../../constants/theme';
import { tintBg } from '../../utils/tint';

type Variant = 'primary' | 'ghost' | 'danger';

type Props = {
  title: string;
  onPress: () => void;
  variant?: Variant;
  /** 'sm' for in-card CTAs (44pt floor); default is the 46pt page-level CTA. */
  size?: 'sm' | 'md';
  /** Override fill for verdict-colored CTAs (trade 'Complete trade'). */
  color?: string;
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

/** The one button idiom — rounded, single-line, loading spinner,
 *  disabled dims itself through the same expression that ignores the
 *  tap (a visible-but-dead CTA was a real bug class). */
export function AppButton({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  color,
  loading = false,
  disabled = false,
  icon,
  accessibilityLabel,
  style,
}: Props) {
  const inactive = disabled || loading;
  const bg =
    variant === 'primary'
      ? color ?? colors.primary
      : variant === 'danger'
        ? colors.error
        : tintBg(colors.text);
  const fg =
    variant === 'ghost' ? colors.text : colors.surfaceDeep;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      style={[
        styles.btn,
        size === 'sm' && styles.btnSm,
        { backgroundColor: bg },
        inactive && styles.dim,
        style,
      ]}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
    >
      {/* Gloss sheen — the finance-app highlight. Works over any fill,
          including custom verdict colors, so no extra tokens needed. */}
      <LinearGradient
        colors={[colors.overlay4, 'transparent']}
        locations={[0, 0.55]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <View style={styles.inner}>
          {icon ? (
            <Ionicons name={icon} size={16} color={fg} />
          ) : null}
          <Text
            style={[
              styles.text,
              size === 'sm' && styles.textSm,
              { color: fg },
            ]}
          >
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    borderRadius: radius.controlLg,
    paddingVertical: spacing['2xl'],
    paddingHorizontal: spacing['4xl'],
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: controls.buttonHeight,
    overflow: 'hidden',
  },
  btnSm: {
    paddingVertical: spacing.lg,
    minHeight: controls.minTouchTarget,
  },
  textSm: { fontSize: type_.body },
  dim: { opacity: 0.6 },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  text: {
    fontSize: type_.bodyLarge,
    fontWeight: weight.heavy,
    letterSpacing: 0.3,
  },
});
