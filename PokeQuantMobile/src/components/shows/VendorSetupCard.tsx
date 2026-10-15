// Vendor name + table/booth inputs for a show. Values come in already
// resolved (untouched override → saved setup → profile default); typing
// reports the raw override back through the onChange props.

import { memo } from 'react';
import { Text, TextInput, View } from 'react-native';
import { colors } from '../../constants/colors';
import { showVendorPanelStyles as styles } from './showVendorPanelStyles';

type Props = {
  vendorName: string;
  onNameChange: (text: string) => void;
  vendorTable: string;
  onTableChange: (text: string) => void;
};

export const VendorSetupCard = memo(function VendorSetupCard({
  vendorName,
  onNameChange,
  vendorTable,
  onTableChange,
}: Props) {
  return (
    <View style={styles.setupCard}>
      <Text style={styles.setupTitle}>Vendor setup for this show</Text>
      <View style={styles.setupRow}>
        <TextInput
          style={[styles.setupInput, { marginRight: 8 }]}
          placeholder="Vendor name"
          placeholderTextColor={colors.textMuted}
          value={vendorName}
          onChangeText={onNameChange}
        />
        <TextInput
          style={styles.setupInput}
          placeholder="Table / booth"
          placeholderTextColor={colors.textMuted}
          value={vendorTable}
          onChangeText={onTableChange}
        />
      </View>
    </View>
  );
});
