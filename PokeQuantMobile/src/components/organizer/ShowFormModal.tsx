// Create/edit show form — shared by the list-mode "New Show" button and
// the detail-mode edit icon; placeholders + publish hint only show for
// new shows (edit arrives pre-filled, matching the original renders).
import { Text, TouchableOpacity } from 'react-native';
import { OrganizerField } from './OrganizerField';
import { OrganizerModalSheet } from './OrganizerModalSheet';
import { organizerStyles as styles } from './organizerStyles';

export function ShowFormModal({
  editingShow,
  fName,
  setFName,
  fDate,
  setFDate,
  fLocation,
  setFLocation,
  fTables,
  setFTables,
  fPay,
  setFPay,
  saving,
  onSave,
  onClose,
}: {
  editingShow: boolean;
  fName: string;
  setFName: (t: string) => void;
  fDate: string;
  setFDate: (t: string) => void;
  fLocation: string;
  setFLocation: (t: string) => void;
  fTables: string;
  setFTables: (t: string) => void;
  fPay: string;
  setFPay: (t: string) => void;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <OrganizerModalSheet title={editingShow ? 'Edit show' : 'New show'} onClose={onClose}>
      <OrganizerField
        label="Name"
        value={fName}
        onChangeText={setFName}
        placeholder={editingShow ? undefined : 'Card show name'}
      />
      <OrganizerField
        label="Date"
        value={fDate}
        onChangeText={setFDate}
        placeholder={editingShow ? undefined : 'e.g. Sep 19, 2026'}
      />
      <OrganizerField
        label="Location"
        value={fLocation}
        onChangeText={setFLocation}
        placeholder={editingShow ? undefined : 'Venue / city'}
      />
      <OrganizerField
        label="Total tables"
        value={fTables}
        onChangeText={setFTables}
        placeholder={editingShow ? undefined : 'e.g. 40'}
        keyboardType="decimal-pad"
      />
      <OrganizerField
        label="Pay instructions"
        value={fPay}
        onChangeText={setFPay}
        placeholder={editingShow ? undefined : 'e.g. Venmo @you — balance due Friday'}
      />
      <TouchableOpacity
        style={[styles.primaryBtn, saving && { opacity: 0.6 }]}
        onPress={onSave}
        disabled={saving}
      >
        <Text style={styles.primaryBtnText}>
          {saving ? 'Saving…' : editingShow ? 'Save changes' : 'Create show'}
        </Text>
      </TouchableOpacity>
      {!editingShow ? (
        <Text style={styles.hintText}>Shows publish to the public list immediately.</Text>
      ) : null}
    </OrganizerModalSheet>
  );
}
