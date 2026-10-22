import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
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
  /** Sliding-highlight mode — feed a horizontal pager's scroll offset
   *  plus its page width and the active backdrop becomes one indicator
   *  that glides with the swipe instead of snapping. Chip labels still
   *  follow `activeTab`; without these props the rail behaves as before. */
  scrollX?: Animated.Value;
  pageWidth?: number;
  /** No pager to ride? Set this and the same indicator animates between
   *  chips on `activeTab` change — the stock-list glide without the swipe. */
  animated?: boolean;
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
  scrollX,
  pageWidth,
  animated,
}: Props<T>) {
  // Each chip reports its rect; the indicator interpolates between them
  // off the pager offset, so the highlight tracks the drag frame-exact.
  const [rects, setRects] = useState<(null | { x: number; w: number })[]>(() =>
    tabs.map(() => null),
  );
  const sliding =
    scrollX != null && pageWidth != null && pageWidth > 0 && rects.every((r) => r != null);
  const inputRange = tabs.map((_, i) => i * (pageWidth ?? 0));
  // Pager-free glide — the same indicator, timed between chip rects on
  // `activeTab` change. Seeded straight to the active chip so it never
  // flies in from the rail's left edge on first measure.
  const [indX] = useState(() => new Animated.Value(0));
  const [indW] = useState(() => new Animated.Value(0));
  const indSeeded = useRef(false);
  const activeIndex = Math.max(
    0,
    tabs.findIndex((t) => t.key === activeTab),
  );
  const targetX = rects[activeIndex]?.x;
  const targetW = rects[activeIndex]?.w;
  const gliding = !sliding && animated === true && targetX != null && targetW != null;
  useEffect(() => {
    if (!gliding || targetX == null || targetW == null) return;
    if (!indSeeded.current) {
      indSeeded.current = true;
      indX.setValue(targetX);
      indW.setValue(targetW);
      return;
    }
    Animated.parallel([
      Animated.timing(indX, {
        toValue: targetX,
        duration: 220,
        easing: Easing.bezier(0, 0, 0.2, 1),
        useNativeDriver: false,
      }),
      Animated.timing(indW, {
        toValue: targetW,
        duration: 220,
        easing: Easing.bezier(0, 0, 0.2, 1),
        useNativeDriver: false,
      }),
    ]).start();
  }, [gliding, targetX, targetW, indX, indW]);
  return (
    <View style={[styles.rail, glass && styles.railGlass, style]}>
      {glass ? (
        <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
      ) : null}
      {sliding && scrollX ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.indicator,
            {
              left: scrollX.interpolate({
                inputRange,
                outputRange: rects.map((r) => r?.x ?? 0),
                extrapolate: 'clamp',
              }),
              width: scrollX.interpolate({
                inputRange,
                outputRange: rects.map((r) => r?.w ?? 0),
                extrapolate: 'clamp',
              }),
            },
          ]}
        />
      ) : gliding ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.indicator, { left: indX, width: indW }]}
        />
      ) : null}
      {tabs.map((tab, i) => {
        const active = tab.key === activeTab;
        return (
          <Pressable
            key={tab.key}
            onLayout={(e) => {
              const { x, width } = e.nativeEvent.layout;
              setRects((prev) => {
                if (prev[i]?.x === x && prev[i]?.w === width) return prev;
                const next = [...prev];
                next[i] = { x, w: width };
                return next;
              });
            }}
            onPress={() => onChange(tab.key)}
            hitSlop={8}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={tab.label}
            style={[styles.chip, active && !sliding && !gliding && styles.chipActive]}
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
  // Sliding twin of chipActive — same fill, sized/moved by the pager.
  indicator: {
    position: 'absolute',
    top: spacing.xs,
    bottom: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
  },
  chipText: {
    color: colors.textMuted,
    fontSize: type_.label,
    fontWeight: weight.semibold,
    flexShrink: 1,
  },
  chipTextActive: { color: colors.text },
});
