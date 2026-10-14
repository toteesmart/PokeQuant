import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../constants/colors';
import { controls, spacing, type_, weight } from '../../constants/theme';

type Props = {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  /** Body shown only while expanded — callers supply their own card
   *  chrome (usually an overlay2 card) so the collapsed state stays a
   *  bare, quiet line. */
  children?: ReactNode;
  /** Center the row (page-level toggles like "Details") vs left-aligned
   *  (in-flow disclosures like "The math"). */
  centered?: boolean;
};

/** Bare caret disclosure — the "› The math" idiom. A quiet muted line,
 *  not a boxed module, so receipts stay available without competing
 *  with the verdict above them. */
export function Disclosure({
  label,
  expanded,
  onToggle,
  children,
  centered = false,
}: Props) {
  return (
    <View>
      <Pressable
        onPress={onToggle}
        style={[styles.toggle, centered && styles.toggleCentered]}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={label}
      >
        <Ionicons
          name={expanded ? 'chevron-down' : 'chevron-forward'}
          size={12}
          color={colors.textMuted}
        />
        <Text style={styles.toggleText}>{label}</Text>
      </Pressable>
      {expanded ? children : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing['2xl'],
    marginBottom: spacing.md,
    // Quiet line visually, but still a real control — pad toward the
    // 44pt target instead of relying on hitSlop alone.
    paddingVertical: spacing.sm,
    minHeight: controls.minTouchTarget - spacing['2xl'],
  },
  toggleCentered: {
    justifyContent: 'center',
  },
  toggleText: {
    color: colors.textMuted,
    fontSize: type_.caption,
    fontWeight: weight.semibold,
    letterSpacing: 0.5,
  },
});
