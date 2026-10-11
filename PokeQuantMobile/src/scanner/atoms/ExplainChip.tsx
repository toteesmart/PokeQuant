import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { colors } from '../../constants/colors';

// Tap-to-explain wrapper: the child stays looking like a normal badge, a
// tap pops a fading speech bubble with a plain-language gloss. The bubble
// renders inside a transparent Modal — a separate native layer that always
// composites above the sheet, so sibling zIndex/overflow can't swallow it
// (which they do on iOS when it's an absolute child of a row). Tap anywhere
// dismisses; it also auto-fades so it never blocks the sheet.

const TIP_MS = 4200;
const BUBBLE_W_MAX = 250;
const BUBBLE_H_EST = 120; // flip above the badge when less room than this

// One bubble at a time — opening a tip dismisses whichever is open,
// so bubbles never stack and fight each other.
let closeOpenTip: (() => void) | null = null;

type Anchor = { x: number; y: number; w: number; h: number };

export function Tip({
  tip,
  align = 'left',
  children,
}: {
  tip: string;
  /** Bubble edge anchor — 'right' for badges near the screen's right edge. */
  align?: 'left' | 'right';
  children: React.ReactNode;
}) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor>({ x: 0, y: 0, w: 0, h: 0 });
  const wrapRef = useRef<View>(null);
  const opacity = useRef(new Animated.Value(1)).current;
  const closerRef = useRef<() => void>(() => {});
  closerRef.current = () => setOpen(false);

  // If the sheet unmounts with a tip open, drop the stale singleton ref.
  useEffect(
    () => () => {
      if (closeOpenTip === closerRef.current) closeOpenTip = null;
    },
    []
  );

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }).start(() => {
        setOpen(false);
        if (closeOpenTip === closerRef.current) closeOpenTip = null;
      });
    }, TIP_MS);
    return () => clearTimeout(t);
  }, [open, opacity]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    closeOpenTip?.();
    closeOpenTip = closerRef.current;
    opacity.setValue(1);
    wrapRef.current?.measureInWindow((x, y, w, h) => {
      setAnchor({ x, y, w, h });
      setOpen(true);
    });
  };

  const bubbleW = Math.min(BUBBLE_W_MAX, screenW - 16);
  const below = anchor.y + anchor.h + 6;
  const placeAbove = below + BUBBLE_H_EST > screenH;
  const bubbleStyle = {
    width: bubbleW,
    ...(align === 'right'
      ? { right: Math.max(8, screenW - (anchor.x + anchor.w)) }
      : { left: Math.min(Math.max(8, anchor.x), screenW - bubbleW - 8) }),
    ...(placeAbove
      ? { bottom: screenH - anchor.y + 6 }
      : { top: below }),
  };

  return (
    // collapsable={false}: measureInWindow needs a real native view.
    <View ref={wrapRef} collapsable={false} style={styles.wrap}>
      <Pressable onPress={toggle} hitSlop={4}>
        {children}
      </Pressable>
      {open ? (
        <Modal
          transparent
          visible
          animationType="none"
          statusBarTranslucent
          onRequestClose={() => setOpen(false)}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setOpen(false)}
          >
            <Animated.View
              style={[styles.bubble, bubbleStyle, { opacity }]}
              pointerEvents="none"
            >
              <Text style={styles.bubbleText}>{tip}</Text>
            </Animated.View>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

/** A badge-shaped ExplainChip: tinted pill + tap for the gloss. */
export function ExplainChip({
  label,
  fg,
  bg,
  tip,
  align,
}: {
  label: string;
  fg: string;
  bg: string;
  tip: string;
  align?: 'left' | 'right';
}) {
  return (
    <Tip tip={tip} align={align}>
      <View style={[styles.chip, { borderColor: fg, backgroundColor: bg }]}>
        <Text style={[styles.chipText, { color: fg }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Tip>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipText: { fontSize: 10, fontWeight: '700' },
  bubble: {
    position: 'absolute',
    backgroundColor: '#1c2431',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  bubbleText: {
    color: colors.text,
    fontSize: 11,
    lineHeight: 15,
  },
});
