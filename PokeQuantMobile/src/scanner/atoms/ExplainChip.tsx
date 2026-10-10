import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../constants/colors';

// Tap-to-explain wrapper: the child stays looking like a normal badge, a
// tap pops a fading speech bubble with a plain-language gloss. Auto-fades
// so it never blocks the sheet.

const TIP_MS = 4200;

// One bubble at a time — opening a tip dismisses whichever is open,
// so bubbles never stack and fight each other.
let closeOpenTip: (() => void) | null = null;

export function Tip({
  tip,
  align = 'left',
  children,
}: {
  tip: string;
  /** Bubble edge anchor — 'right' for badges near the sheet's right edge. */
  align?: 'left' | 'right';
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const closerRef = useRef<() => void>(() => {});
  closerRef.current = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    opacity.setValue(0);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 140,
      useNativeDriver: true,
    }).start();
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
    setOpen(true);
  };

  return (
    <View style={styles.wrap}>
      <Pressable onPress={toggle} hitSlop={4}>
        {children}
      </Pressable>
      {open ? (
        <Animated.View
          style={[
            styles.bubble,
            align === 'right' ? styles.bubbleRight : styles.bubbleLeft,
            { opacity },
          ]}
        >
          <Text style={styles.bubbleText}>{tip}</Text>
        </Animated.View>
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
  wrap: { position: 'relative', zIndex: 20 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipText: { fontSize: 10, fontWeight: '700' },
  bubble: {
    position: 'absolute',
    top: '100%',
    marginTop: 7,
    width: 240,
    backgroundColor: '#1c2431',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    zIndex: 50,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  bubbleLeft: { left: 0 },
  bubbleRight: { right: 0 },
  bubbleText: {
    color: colors.text,
    fontSize: 11,
    lineHeight: 15,
  },
});
