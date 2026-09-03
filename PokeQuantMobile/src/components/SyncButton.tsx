import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, DeviceEventEmitter, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import { useAuth } from '../context/AuthContext';
import { useInventory } from '../context/InventoryContext';
import { initializeDatabase } from '../db/database';
import { getPendingSyncCount } from '../db/inventoryDb';

const SPIN_DURATION = 1200;

export function SyncButton() {
  const {
    isSyncing,
    syncFatalError,
    triggerSync,
    clearPendingSyncs,
  } = useInventory();
  const { userId } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);
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

  useEffect(() => {
    const fetchCount = async () => {
      if (!userId) return;
      try {
        const { db } = await initializeDatabase();
        const count = await getPendingSyncCount(db, userId);
        setPendingCount(count);
      } catch (e) {
        console.error('Failed to fetch pending sync count:', e);
      }
    };

    fetchCount();
    const subscription = DeviceEventEmitter.addListener(
      'PQ_INVENTORY_MUTATED',
      fetchCount
    );

    return () => {
      subscription.remove();
    };
  }, [userId]);

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
    : pendingCount > 0
    ? colors.warning
    : colors.velocityPositive;
  const showBadge = pendingCount > 0 || syncFatalError !== null;
  const badgeValue = syncFatalError ? '!' : String(pendingCount);

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
        <View style={styles.iconWrapper}>
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
                syncFatalError && { backgroundColor: colors.error },
              ]}>
              <Text style={styles.badgeText}>{badgeValue}</Text>
            </View>
          )}
        </View>
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
  iconWrapper: {
    position: 'relative',
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badge: {
    position: 'absolute',
    right: -4,
    top: -4,
    backgroundColor: '#c93c37',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: 'bold',
  },
});
