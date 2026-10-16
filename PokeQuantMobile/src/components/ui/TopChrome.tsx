import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../constants/colors';
import { controls, radius, spacing, type_, weight } from '../../constants/theme';
import { useProgressStore } from '../../store/progressStore';

/** Vertical space the floating chrome row occupies — add
 *  `insets.top + TOP_CHROME_CLEARANCE` as content paddingTop. */
export const TOP_CHROME_CLEARANCE = 60;
const CIRCLE = controls.minTouchTarget;

/** Frosted glass circle — the floating-chrome counterpart of the pill
 *  rail (same BlurView + overlay + hairline recipe). */
export function GlassCircle({ children }: { children: ReactNode }) {
  return (
    <View style={styles.circle}>
      <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
      {children}
    </View>
  );
}

/** Back affordance for in-screen headers — matches the floating
 *  chrome circles instead of a bare chevron. */
export function GlassBackButton({
  onPress,
  label = 'Back',
}: {
  onPress: () => void;
  label?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityLabel={label}
      accessibilityRole="button"
      style={({ pressed }) => pressed && styles.pressed}
    >
      <GlassCircle>
        <Ionicons name="chevron-back" size={20} color={colors.text} />
      </GlassCircle>
    </Pressable>
  );
}

/** Transient image-pack download pill — self-gates on
 *  `isDownloadingImages`. Mounted inside TopChrome (per-screen) and at
 *  nav level for scenes without their own chrome. */
export function DownloadProgressPill() {
  const isDownloading = useProgressStore((s) => s.isDownloadingImages);
  const progress = useProgressStore((s) => s.imageDownloadProgress);
  const label = useProgressStore((s) => s.imageDownloadLabel);
  if (!isDownloading) return null;
  const pct = Math.round(progress * 100);
  return (
    <View style={styles.progressPill} pointerEvents="none">
      <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
      <Text style={styles.progressLabel} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

/** Floating top chrome — a row of frosted-glass controls pinned under the
 *  status bar, same visual family as the pill rail and floating tab bar.
 *  `left`/`right` take action circles; `center` takes a centered element
 *  (the segmented pill rail on Inventory). Content beneath pads itself
 *  with `insets.top + TOP_CHROME_CLEARANCE`.
 *  All surfaces it overlays belong to the screen that mounts it —
 *  sub-screens inside a tab scene mount their own. */
export function TopChrome({
  left,
  center,
  right,
}: {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { top: insets.top + spacing.lg }]} pointerEvents="box-none">
      <View style={styles.row} pointerEvents="box-none">
        <View style={styles.side}>{left}</View>
        <View style={styles.center} pointerEvents="box-none">
          {center}
        </View>
        <View style={[styles.side, styles.sideRight]}>{right}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing['4xl'],
    gap: spacing.lg,
  },
  side: {
    minWidth: CIRCLE,
    alignItems: 'flex-start',
  },
  sideRight: {
    alignItems: 'flex-end',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    minWidth: 0,
  },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
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
  pressed: {
    opacity: 0.7,
  },
  progressPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    maxWidth: '70%',
    paddingHorizontal: spacing['4xl'],
    paddingVertical: spacing.xl,
    borderRadius: radius.pill,
    backgroundColor: colors.overlay3,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  progressLabel: {
    color: colors.text,
    fontSize: type_.caption,
    fontWeight: weight.semibold,
    flexShrink: 1,
  },
  progressTrack: {
    width: 72,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: radius.badge,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
  },
});
