import { useEffect, useRef } from 'react';
import { Alert, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import { useInventory } from '../context/InventoryContext';

const SPIN_DURATION = 1200;

export function SyncButton() {
  const {
    pendingSyncCount,
    isSyncing,
    syncFatalError,
    triggerSync,
    clearPendingSyncs,
  } = useInventory();
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

  const baseIconColor = syncFatalError
    ? colors.error
    : pendingSyncCount > 0
    ? colors.warning
    : colors.velocityPositive;
  const showBadge = pendingSyncCount > 0 || syncFatalError !== null;
  const badgeValue = syncFatalError ? '!' : String(pendingSyncCount);

  const handlePress = () => {
    if (syncFatalError) {
      Alert.alert(
        'Stuck Sync Queue',
        `${syncFatalError}\n\nClearing the queue will mark these local changes as skipped so the app can continue syncing. You may need to re-enter any data that caused the error.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Clear Stuck Queue',
            style: 'destructive',
            onPress: () => clearPendingSyncs(),
          },
        ]
      );
      return;
    }
    triggerSync();
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={isSyncing}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      accessibilityLabel="Sync with cloud"
      accessibilityRole="button">
      <View style={styles.container}>
        <Animated.View style={spinStyle}>
          <Ionicons
            name={syncFatalError ? 'alert-circle' : 'sync'}
            size={22}
            color={baseIconColor}
          />
        </Animated.View>
        {showBadge && (
          <View
            style={[
              styles.badge,
              syncFatalError && { borderColor: colors.error },
            ]}>
            <Text
              style={[
                styles.badgeText,
                syncFatalError && { color: colors.error },
              ]}>
              {badgeValue}
            </Text>
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
