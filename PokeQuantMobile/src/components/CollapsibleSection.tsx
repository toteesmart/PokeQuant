import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../constants/colors';

type CollapsibleSectionProps = {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  maxHeight?: number;
};

export function CollapsibleSection({
  title,
  expanded,
  onToggle,
  children,
  maxHeight = 1200,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(expanded);
  const anim = useRef(new Animated.Value(expanded ? 1 : 0)).current;

  useEffect(() => {
    if (expanded) {
      setIsOpen(true);
      Animated.timing(anim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: false,
      }).start();
    } else {
      Animated.timing(anim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished) setIsOpen(false);
      });
    }
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
        onPress={onToggle}>
        <Text style={styles.arrow}>{expanded ? '▼' : '▶'}</Text>
        <Text style={styles.title}>{title}</Text>
      </TouchableOpacity>
      {isOpen && (
        <Animated.View
          style={[styles.body, animatedStyle]}
          pointerEvents={expanded ? 'auto' : 'none'}>
          {children}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  arrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: 'bold',
    marginRight: 10,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  body: {
    padding: 14,
    paddingTop: 0,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
