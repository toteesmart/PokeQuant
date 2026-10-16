// Add-vendor modal — three modes: app-vendor pick list, picked-vendor
// detail fields, or manual entry for vendors not on the app.
import { Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../constants/colors';
import { OrganizerField } from './OrganizerField';
import { OrganizerModalSheet } from './OrganizerModalSheet';
import { organizerStyles as styles } from './organizerStyles';
import type { VendorOption } from '../../services/organizerText';

export function AddVendorModal({
  appVendors,
  pickedVendor,
  setPickedVendor,
  manualMode,
  setManualMode,
  mName,
  setMName,
  mPhone,
  setMPhone,
  mTable,
  setMTable,
  mDue,
  setMDue,
  onAttachVendor,
  onAttachManual,
  onClose,
}: {
  appVendors: VendorOption[];
  pickedVendor: VendorOption | null;
  setPickedVendor: (v: VendorOption | null) => void;
  manualMode: boolean;
  setManualMode: (m: boolean | ((p: boolean) => boolean)) => void;
  mName: string;
  setMName: (t: string) => void;
  mPhone: string;
  setMPhone: (t: string) => void;
  mTable: string;
  setMTable: (t: string) => void;
  mDue: string;
  setMDue: (t: string) => void;
  onAttachVendor: () => void;
  onAttachManual: () => void;
  onClose: () => void;
}) {
  return (
    <OrganizerModalSheet title="Add vendor" onClose={onClose}>
      {!pickedVendor ? (
        <TouchableOpacity style={styles.modeToggle} onPress={() => setManualMode((m) => !m)}>
          <Text style={styles.modeToggleText}>
            {manualMode ? 'Pick an app vendor instead' : 'Vendor not on the app? Add manually'}
          </Text>
        </TouchableOpacity>
      ) : null}

      {pickedVendor ? (
        <>
          <Text style={styles.hintText}>Adding {pickedVendor.name || pickedVendor.id}</Text>
          <OrganizerField label="Table #" value={mTable} onChangeText={setMTable} />
          <OrganizerField
            label="Total due"
            value={mDue}
            onChangeText={setMDue}
            keyboardType="decimal-pad"
          />
          <OrganizerField
            label="Phone (SMS reminders)"
            value={mPhone}
            onChangeText={setMPhone}
            placeholder="Optional"
          />
          <TouchableOpacity style={styles.primaryBtn} onPress={onAttachVendor}>
            <Text style={styles.primaryBtnText}>Add vendor</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.modeToggle} onPress={() => setPickedVendor(null)}>
            <Text style={styles.modeToggleText}>Back to list</Text>
          </TouchableOpacity>
        </>
      ) : manualMode ? (
        <>
          <OrganizerField label="Name" value={mName} onChangeText={setMName} />
          <OrganizerField
            label="Phone (for SMS reminders)"
            value={mPhone}
            onChangeText={setMPhone}
          />
          <OrganizerField label="Table #" value={mTable} onChangeText={setMTable} />
          <OrganizerField
            label="Total due"
            value={mDue}
            onChangeText={setMDue}
            keyboardType="decimal-pad"
          />
          <TouchableOpacity style={styles.primaryBtn} onPress={onAttachManual}>
            <Text style={styles.primaryBtnText}>Add vendor</Text>
          </TouchableOpacity>
        </>
      ) : (
        appVendors.map((v) => (
          <TouchableOpacity
            key={v.id}
            style={styles.vendorOption}
            onPress={() => setPickedVendor(v)}
          >
            <Text style={styles.vendorOptionText}>{v.name || v.id}</Text>
            <Ionicons name="chevron-forward" size={15} color={colors.textMuted} />
          </TouchableOpacity>
        ))
      )}
    </OrganizerModalSheet>
  );
}
