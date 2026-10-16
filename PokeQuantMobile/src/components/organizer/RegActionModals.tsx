// Registration action modals — approve (seeded from the reg), record
// payment, assign table, and remind (phone collection before SMS).
import { Text, TouchableOpacity } from 'react-native';
import { OrganizerField } from './OrganizerField';
import { OrganizerModalSheet } from './OrganizerModalSheet';
import { organizerStyles as styles } from './organizerStyles';
import { displayName } from '../../services/organizerText';
import type { ShowRegistration } from '../../services/showVendorService';

export function ApproveModal({
  reg,
  aTable,
  setATable,
  aDue,
  setADue,
  aPhone,
  setAPhone,
  onApprove,
  onClose,
}: {
  reg: ShowRegistration;
  aTable: string;
  setATable: (t: string) => void;
  aDue: string;
  setADue: (t: string) => void;
  aPhone: string;
  setAPhone: (t: string) => void;
  onApprove: () => void;
  onClose: () => void;
}) {
  return (
    <OrganizerModalSheet title={`Approve ${displayName(reg)}`} onClose={onClose}>
      <OrganizerField label="Table #" value={aTable} onChangeText={setATable} />
      <OrganizerField
        label="Total due"
        value={aDue}
        onChangeText={setADue}
        keyboardType="decimal-pad"
      />
      <OrganizerField
        label="Phone (SMS reminders)"
        value={aPhone}
        onChangeText={setAPhone}
        placeholder="Optional"
      />
      <TouchableOpacity style={styles.primaryBtn} onPress={onApprove}>
        <Text style={styles.primaryBtnText}>Approve</Text>
      </TouchableOpacity>
    </OrganizerModalSheet>
  );
}

export function PayModal({
  reg,
  payAmount,
  setPayAmount,
  payDue,
  setPayDue,
  onPay,
  onClose,
}: {
  reg: ShowRegistration;
  payAmount: string;
  setPayAmount: (t: string) => void;
  payDue: string;
  setPayDue: (t: string) => void;
  onPay: (full: boolean) => void;
  onClose: () => void;
}) {
  return (
    <OrganizerModalSheet title={`Payment — ${displayName(reg)}`} onClose={onClose}>
      <Text style={styles.hintText}>
        Paid ${reg.paidAmount.toFixed(2)} of ${reg.totalDue.toFixed(2)}
        {'  ·  '}remaining ${(reg.totalDue - reg.paidAmount).toFixed(2)}
      </Text>
      <OrganizerField
        label="Total due"
        value={payDue}
        onChangeText={setPayDue}
        keyboardType="decimal-pad"
      />
      <OrganizerField
        label="Amount received"
        value={payAmount}
        onChangeText={setPayAmount}
        keyboardType="decimal-pad"
      />
      <TouchableOpacity
        style={[styles.primaryBtn, !(Number(payAmount) > 0) && { opacity: 0.5 }]}
        onPress={() => onPay(false)}
        disabled={!(Number(payAmount) > 0)}
      >
        <Text style={styles.primaryBtnText}>Record payment</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondaryBtn} onPress={() => onPay(true)}>
        <Text style={styles.secondaryBtnText}>Mark fully paid</Text>
      </TouchableOpacity>
    </OrganizerModalSheet>
  );
}

export function AssignModal({
  reg,
  assignTable,
  setAssignTable,
  onSave,
  onClose,
}: {
  reg: ShowRegistration;
  assignTable: string;
  setAssignTable: (t: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <OrganizerModalSheet title={`Table — ${displayName(reg)}`} onClose={onClose}>
      <OrganizerField label="Table #" value={assignTable} onChangeText={setAssignTable} />
      <TouchableOpacity style={styles.primaryBtn} onPress={onSave}>
        <Text style={styles.primaryBtnText}>Save</Text>
      </TouchableOpacity>
    </OrganizerModalSheet>
  );
}

export function RemindModal({
  reg,
  remindPhone,
  setRemindPhone,
  onRemind,
  onClose,
}: {
  reg: ShowRegistration;
  remindPhone: string;
  setRemindPhone: (t: string) => void;
  onRemind: () => void;
  onClose: () => void;
}) {
  return (
    <OrganizerModalSheet title={`Remind ${displayName(reg)}`} onClose={onClose}>
      <Text style={styles.hintText}>
        Balance: ${(reg.totalDue - reg.paidAmount).toFixed(2)}. Add a number to text them —
        it&rsquo;s saved for next time.
      </Text>
      <OrganizerField
        label="Phone"
        value={remindPhone}
        onChangeText={setRemindPhone}
        placeholder="e.g. 555-123-4567"
      />
      <TouchableOpacity
        style={[styles.primaryBtn, !remindPhone.trim() && { opacity: 0.5 }]}
        onPress={onRemind}
        disabled={!remindPhone.trim()}
      >
        <Text style={styles.primaryBtnText}>Save & open Messages</Text>
      </TouchableOpacity>
    </OrganizerModalSheet>
  );
}
