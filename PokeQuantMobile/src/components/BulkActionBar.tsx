// Bottom bulk-action bar for InventoryScreen's select mode: count,
// Sell, confirm-armed Delete, Cancel. Styles come from inventoryStyles.

import { memo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { styles } from '../screens/inventoryStyles';

type Props = {
  selectedCount: number;
  confirmBulkDelete: boolean;
  onBulkSell: () => void;
  onBulkDelete: () => void;
  onCancel: () => void;
};

export const BulkActionBar = memo(function BulkActionBar({
  selectedCount,
  confirmBulkDelete,
  onBulkSell,
  onBulkDelete,
  onCancel,
}: Props) {
  return (
    <View style={styles.bulkBar}>
      <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
      <Text style={styles.bulkCount}>{selectedCount} selected</Text>
      <TouchableOpacity
        style={[styles.bulkBtn, styles.bulkSell, selectedCount === 0 && styles.bulkBtnDisabled]}
        activeOpacity={0.8}
        disabled={selectedCount === 0}
        onPress={onBulkSell}
      >
        <Text style={styles.bulkSellText}>Sell</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[
          styles.bulkBtn,
          confirmBulkDelete ? styles.bulkDelConfirm : styles.bulkDel,
          selectedCount === 0 && styles.bulkBtnDisabled,
        ]}
        activeOpacity={0.8}
        disabled={selectedCount === 0}
        onPress={onBulkDelete}
      >
        <Text style={[styles.bulkDelText, confirmBulkDelete && styles.bulkDelTextConfirm]}>
          {confirmBulkDelete ? 'Sure?' : 'Delete'}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.bulkBtn, styles.bulkCancel]}
        activeOpacity={0.8}
        onPress={onCancel}
      >
        <Text style={styles.bulkCancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
});
