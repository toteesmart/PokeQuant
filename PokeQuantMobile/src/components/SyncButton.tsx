import { useEffect, useState } from 'react';
import { Alert, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import { useInventoryStore } from '../store/inventoryStore';
import { GlassCircle } from './ui/TopChrome';

const SPIN_DURATION = 1200;

export function SyncButton({
  variant = 'bare',
}: {
  /** 'glass' wraps the button in the frosted-circle chrome (TopChrome);
   *  'bare' is the plain header/inline form. */
  variant?: 'bare' | 'glass';
}) {
  const isSyncing = useInventoryStore((state) => state.isSyncing);
  const syncFatalError = useInventoryStore((state) => state.syncFatalError);
  const pendingSyncCount = useInventoryStore((state) => state.pendingSyncCount);
  const triggerSync = useInventoryStore((state) => state.triggerSync);
  const clearPendingSyncs = useInventoryStore((state) => state.clearPendingSyncs);
  const [spin] = useState(() => new Animated.Value(0));

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;

    if (isSyncing) {
      loop = Animated.loop(
        Animated.timing(spin, {
          toValue: 1,
          duration: SPIN_DURATION,
          useNativeDriver: true,
        }),
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
        'Backup is stuck',
        `${syncFatalError}\n\nSkipping these changes lets the backup finish, but you may need to re-enter the data that caused the error.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Skip stuck changes',
            style: 'destructive',
            onPress: () => clearPendingSyncs(),
          },
        ],
      );
      return;
    }
    triggerSync();
  };

  const icon = (
    <View style={styles.iconWrapper}>
      <Animated.View style={spinStyle}>
        <Ionicons name={syncFatalError ? 'alert-circle' : 'sync'} size={22} color={baseIconColor} />
      </Animated.View>
      {showBadge && (
        <View style={[styles.badge, syncFatalError && { backgroundColor: colors.error }]}>
          <Text style={styles.badgeText}>{badgeValue}</Text>
        </View>
      )}
    </View>
  );

  return (
    <Pressable
      onPress={handlePress}
      disabled={isSyncing}
      style={({ pressed }) => [
        variant === 'bare' && styles.button,
        pressed && styles.buttonPressed,
      ]}
      accessibilityLabel="Back up to cloud"
      accessibilityRole="button"
    >
      {variant === 'glass' ? (
        <GlassCircle>{icon}</GlassCircle>
      ) : (
        <View style={styles.container}>{icon}</View>
      )}
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
    backgroundColor: colors.error,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    color: colors.onAccent,
    fontSize: 10,
    fontWeight: '700',
  },
});
