import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../constants/colors';

export function SyncBadge({
  isSyncing,
  pendingSyncCount,
}: {
  isSyncing: boolean;
  pendingSyncCount: number;
}) {
  const hasPending = pendingSyncCount > 0;
  const isActive = isSyncing || hasPending;
  const badgeColor = isActive ? colors.warning : colors.success;
  const badgeBg = isActive ? colors.warningTint : colors.successTint;

  let label: string;
  if (isSyncing) {
    label = 'Backing up...';
  } else if (hasPending) {
    label = `${pendingSyncCount} waiting to back up`;
  } else {
    label = 'Backed up';
  }

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: badgeBg,
          borderColor: badgeColor,
        },
      ]}>
      <View style={[styles.badgeDot, { backgroundColor: badgeColor }]} />
      <Text style={[styles.badgeText, { color: badgeColor }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  badgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
