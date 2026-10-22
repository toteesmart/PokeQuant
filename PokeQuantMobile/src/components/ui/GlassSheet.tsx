import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Image } from 'expo-image';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../constants/colors';
import { layout, radius, spacing, type_, weight } from '../../constants/theme';

type Props = {
  /** Sheet title, centered in the header. */
  title: string;
  onClose: () => void;
  /** Right-side header slot (watch toggle etc.). Defaults to a spacer
   *  that keeps the title centered. */
  headerRight?: ReactNode;
  /** Single blurred art bleed behind the whole page (analysis-sheet look). */
  artUri?: string | null;
  /** Two blurred halves meeting at center (matchup look) — overrides artUri. */
  artUris?: readonly [string | null | undefined, string | null | undefined];
  /** Pinned footer content (usually one AppButton). Rendered above the
   *  scroll view, padded for the bottom inset. */
  footer?: ReactNode;
  /** Wrap content in KeyboardAvoidingView (forms, search inputs). */
  keyboardAware?: boolean;
  /** Extra props for the inner ScrollView (keyboardShouldPersistTaps etc.). */
  scrollProps?: ScrollViewProps;
  contentStyle?: StyleProp<ViewStyle>;
  /** Set false when children host their own scroller (FlashList) — they
   *  get a flex-1 View instead of the sheet's ScrollView. */
  scrollable?: boolean;
  /** Entry edge: 'bottom' rides the native slide-up; 'top' drops the
   *  sheet in over the current screen and lifts it back out on close. */
  enterFrom?: 'bottom' | 'top';
  children: ReactNode;
};

/** Fullscreen glossy task sheet — the app's premium page idiom.
 *  Modal + slide + hardware back; card art blurs into the background
 *  behind a scrim; circle back button, centered title, optional pinned
 *  footer CTA. Replaces every ad-hoc absolute overlay / pull-sheet. */
export function GlassSheet({
  title,
  onClose,
  headerRight,
  artUri,
  artUris,
  footer,
  keyboardAware = false,
  scrollProps,
  contentStyle,
  scrollable = true,
  enterFrom = 'bottom',
  children,
}: Props) {
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const pullDown = enterFrom === 'top';
  const [drop] = useState(() => new Animated.Value(pullDown ? -screenH : 0));
  const closing = useRef(false);
  const [leftArt, rightArt] = artUris ?? [];
  // Top-entry panes with no card art still read as glass — a frosted
  // wash over the sheet floor instead of falling back to flat dark.
  const glassFloor = pullDown && !artUri && !leftArt && !rightArt;

  useEffect(() => {
    if (!pullDown) return;
    // Decelerate curve — near-zero entry velocity so the drop-in feathers
    // instead of snapping, matching the cut-away's gentle takeoff.
    Animated.timing(drop, {
      toValue: 0,
      duration: 300,
      easing: Easing.bezier(0, 0, 0.2, 1),
      useNativeDriver: true,
    }).start();
  }, [drop, pullDown]);

  // Top-entry sheets reverse the trip on the way out — parents unmount
  // on onClose, so the exit run must finish before onClose fires.
  const handleClose = useCallback(() => {
    if (!pullDown) {
      onClose();
      return;
    }
    if (closing.current) return;
    closing.current = true;
    Animated.timing(drop, {
      toValue: -screenH,
      duration: 240,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => onClose());
  }, [pullDown, onClose, drop, screenH]);

  const body = (
    <>
      {scrollable ? (
        <ScrollView
          contentContainerStyle={[styles.content, contentStyle]}
          showsVerticalScrollIndicator={false}
          {...scrollProps}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.bodyFixed, contentStyle]}>{children}</View>
      )}
      {footer ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing['2xl'] }]}>
          {footer}
        </View>
      ) : null}
    </>
  );

  return (
    <Modal
      visible
      transparent={pullDown}
      animationType={pullDown ? 'none' : 'slide'}
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <Animated.View style={[styles.sheet, { transform: [{ translateY: drop }] }]}>
        {leftArt || rightArt ? (
          <>
            {leftArt ? (
              <Image
                source={{ uri: leftArt }}
                style={[styles.bleedHalf, { left: 0 }]}
                blurRadius={56}
                contentFit="cover"
                cachePolicy="memory-disk"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              />
            ) : null}
            {rightArt ? (
              <Image
                source={{ uri: rightArt }}
                style={[styles.bleedHalf, { right: 0 }]}
                blurRadius={56}
                contentFit="cover"
                cachePolicy="memory-disk"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              />
            ) : null}
          </>
        ) : artUri ? (
          <Image
            source={{ uri: artUri }}
            style={styles.bleedBg}
            blurRadius={48}
            contentFit="cover"
            cachePolicy="memory-disk"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        ) : glassFloor ? (
          <BlurView
            intensity={40}
            tint="light"
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        ) : null}
        {/* Gradient scrim — deep at top under the header, lightest at
            center so the art reads, deep again under the footer CTA. */}
        <LinearGradient
          colors={[colors.scrimDark, colors.backdrop, colors.scrimOpaque]}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          {/* Frosted header — scrolled content washes under the chrome. */}
          <BlurView intensity={22} tint="dark" style={styles.headerBlur} pointerEvents="none" />
          <Pressable
            onPress={handleClose}
            hitSlop={8}
            style={styles.headerBtn}
            accessibilityLabel={`Close ${title}`}
            accessibilityRole="button"
          >
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
          {headerRight ?? <View style={styles.headerBtnSpacer} />}
        </View>

        {keyboardAware ? (
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            {body}
          </KeyboardAvoidingView>
        ) : (
          body
        )}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: colors.sheet,
  },  bleedBg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.55,
  },
  bleedHalf: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    // Halves meet exactly at center — no overlap band; the scrim washes
    // the seam to a quiet value shift.
    width: '50%',
    opacity: 0.5,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing['4xl'],
    paddingBottom: spacing.md,
    overflow: 'hidden',
  },
  headerBlur: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: type_.title,
    fontWeight: weight.semibold,
  },
  headerBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.overlay3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBtnSpacer: { width: 34, height: 34 },
  content: {
    padding: layout.screenPadding,
    paddingTop: spacing.md,
    paddingBottom: spacing['8xl'],
  },
  bodyFixed: {
    flex: 1,
    padding: layout.screenPadding,
    paddingTop: spacing.md,
  },
  footer: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing['2xl'],
    backgroundColor: 'transparent',
  },
});
