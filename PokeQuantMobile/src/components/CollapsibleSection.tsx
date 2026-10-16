import { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import { radius, spacing, type_, weight } from '../constants/theme';

type CollapsibleSectionProps = {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  maxHeight?: number;
};

/** Card-group collapsible — the section-card variant of the disclosure
 *  idiom: quiet chevron + title header, body expands inside the same
 *  card. For bare inline receipts (no card) use ui/Disclosure. */
export function CollapsibleSection({
  title,
  expanded,
  onToggle,
  children,
  maxHeight = 1200,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(expanded);
  const [anim] = useState(() => new Animated.Value(expanded ? 1 : 0));
  const [prevExpanded, setPrevExpanded] = useState(expanded);
  // Expanding mounts the body during render so the open animation has a
  // target; collapsing unmounts in the timing callback once it finishes.
  if (expanded !== prevExpanded) {
    setPrevExpanded(expanded);
    if (expanded) setIsOpen(true);
  }

  useEffect(() => {
    Animated.timing(anim, {
      toValue: expanded ? 1 : 0,
      duration: expanded ? 300 : 250,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished && !expanded) setIsOpen(false);
    });
  }, [expanded, anim]);

  const animatedStyle = {
    maxHeight: anim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, maxHeight],
    }),
    opacity: anim,
  };

  return (
    <View style={styles.section}>
      <TouchableOpacity
        style={styles.header}
        activeOpacity={0.7}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={title}
      >
        <Ionicons
          name={expanded ? 'chevron-down' : 'chevron-forward'}
          size={14}
          color={colors.textMuted}
        />
        <Text style={styles.title}>{title}</Text>
      </TouchableOpacity>
      {isOpen && (
        <Animated.View
          style={[styles.body, animatedStyle]}
          pointerEvents={expanded ? 'auto' : 'none'}
        >
          {children}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.overlay2,
    borderRadius: radius.cardLg,
    overflow: 'hidden',
    marginBottom: spacing['4xl'],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['2xl'],
    padding: spacing['3xl'],
  },
  title: {
    color: colors.text,
    fontSize: type_.cardTitle,
    fontWeight: weight.semibold,
  },
  body: {
    padding: spacing['3xl'],
    paddingTop: 0,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
