import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../constants/colors';
import { controls, radius, spacing, type_, weight } from '../../constants/theme';

export type SegmentedPill<T extends string = string> = {
  key: T;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
};

type Props<T extends string> = {
  tabs: readonly SegmentedPill<T>[];
  activeTab: T;
  onChange: (tab: T) => void;
  /** Optional override for the rail container — TopChrome passes
   *  `marginVertical: 0` when the rail rides inside the floating
   *  chrome row. */
  style?: StyleProp<ViewStyle>;
  /** Frosted-glass treatment (BlurView + hairline + shadow) — use when
   *  the rail floats over content inside TopChrome. */
  glass?: boolean;
};

/** Compact pill switcher — a centered translucent rail. In the floating
 *  top chrome it sits in TopChrome's center slot; standalone screens use
 *  it as an in-flow rail. Chips shrink + ellipsize on narrow widths so
 *  the rail never collides with the corner actions. */
export function SegmentedPills<T extends string>({
  tabs,
  activeTab,
  onChange,
  style,
  glass,
}: Props<T>) {
  return (
    <View style={[styles.rail, glass && styles.railGlass, style]}>
      {glass ? (
        <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
      ) : null}
      {tabs.map((tab) => {
        const active = tab.key === activeTab;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            hitSlop={8}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={tab.label}
            style={[styles.chip, active && styles.chipActive]}
          >
            {tab.icon ? (
              <Ionicons name={tab.icon} size={12} color={active ? colors.text : colors.textMuted} />
            ) : null}
            <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
    backgroundColor: colors.overlay2,
    borderRadius: radius.pill,
    padding: spacing.xs,
    marginVertical: spacing.lg,
    maxWidth: '100%',
    flexShrink: 1,
  },
  railGlass: {
    backgroundColor: colors.overlay3,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: colors.black,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    borderRadius: radius.pill,
    minHeight: controls.minTouchTarget - spacing.sm,
    flexShrink: 1,
    minWidth: 0,
  },
  chipActive: { backgroundColor: colors.surface },
  chipText: {
    color: colors.textMuted,
    fontSize: type_.label,
    fontWeight: weight.semibold,
    flexShrink: 1,
  },
  chipTextActive: { color: colors.text },
});
