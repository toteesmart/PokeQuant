import { useEffect, useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import { useInventory } from '../context/InventoryContext';

const SPIN_DURATION = 1200;

export function SyncButton() {
  const { pendingSyncCount, isSyncing, triggerSync } = useInventory();
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;

    if (isSyncing) {
      loop = Animated.loop(
        Animated.timing(spin, {
          toValue: 1,
          duration: SPIN_DURATION,
          useNativeDriver: true,
        })
      );
      loop.start();
    } else {
      spin.setValue(0);
    }

    return () => {
      loop?.stop();
    };
  }, [isSyncing, spin]);

  const spinStyle = {
    transform: [
      {
        rotate: spin.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', '360deg'],
        }),
      },
    ],
  };

  const iconColor =
    pendingSyncCount > 0 ? colors.warning : colors.velocityPositive;
  const showBadge = pendingSyncCount > 0;

  return (
    <Pressable
      onPress={triggerSync}
      disabled={isSyncing}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      accessibilityLabel="Sync with cloud"
      accessibilityRole="button">
      <View style={styles.container}>
        <Animated.View style={spinStyle}>
          <Ionicons name="sync" size={22} color={iconColor} />
        </Animated.View>
        {showBadge && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{pendingSyncCount}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  badge: {
    backgroundColor: colors.surfaceLight,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badgeText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: 'bold',
  },
});
