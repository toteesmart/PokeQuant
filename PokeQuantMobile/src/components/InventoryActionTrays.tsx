import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, Animated } from 'react-native';
import { colors } from '../constants/colors';
import { AddAssetForm } from './AddAssetForm';


const TRAY_MAX_HEIGHT = 600;

type ActionTrayProps = {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
};

function ActionTray({ title, expanded, onToggle, children }: ActionTrayProps) {
  const [isOpen, setIsOpen] = useState(expanded);
  const maxHeight = useRef(new Animated.Value(expanded ? 1 : 0)).current;

  useEffect(() => {
    if (expanded) {
      setIsOpen(true);
      Animated.timing(maxHeight, {
        toValue: 1,
        duration: 300,
        useNativeDriver: false,
      }).start();
    } else {
      Animated.timing(maxHeight, {
        toValue: 0,
        duration: 250,
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished) setIsOpen(false);
      });
    }
  }, [expanded, maxHeight]);

  const animatedStyle = {
    maxHeight: maxHeight.interpolate({
      inputRange: [0, 1],
      outputRange: [0, TRAY_MAX_HEIGHT],
    }),
    opacity: maxHeight,
  };

  return (
    <View style={trayStyles.tray}>
      <TouchableOpacity
        style={trayStyles.header}
        activeOpacity={0.7}
        onPress={onToggle}>
        <Text style={trayStyles.arrow}>{expanded ? '▼' : '▶'}</Text>
        <Text style={trayStyles.title}>{title}</Text>
      </TouchableOpacity>
      {isOpen && (
        <Animated.View
          style={[trayStyles.body, animatedStyle]}
          pointerEvents={expanded ? 'auto' : 'none'}>
          {children}
        </Animated.View>
      )}
    </View>
  );
}

export function InventoryActionTrays() {
  const [addExpanded, setAddExpanded] = useState(false);

  return (
    <View style={styles.container}>
      <ActionTray
        title="Add Asset (Manual Entry)"
        expanded={addExpanded}
        onToggle={() => setAddExpanded((v) => !v)}>
        <AddAssetForm
          onComplete={() => setAddExpanded(false)}
          onCancel={() => setAddExpanded(false)}
        />
      </ActionTray>
    </View>
  );
}

const trayStyles = StyleSheet.create({
  tray: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: 12,
    zIndex: 1,
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
    fontSize: 14,
    fontWeight: '600',
  },
  body: {
    padding: 14,
    paddingTop: 0,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});

const styles = StyleSheet.create({
  container: {
    marginBottom: 4,
    zIndex: 1,
  },
});
