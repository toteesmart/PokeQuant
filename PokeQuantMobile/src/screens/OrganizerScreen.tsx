import { memo, useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import {
  addShowRegistration,
  createShow,
  getShowRegistrations,
  getVendorShows,
  listVendors,
  updateShow,
  updateShowRegistration,
  type ShowRegistration,
  type VendorShow,
} from '../services/showVendorService';
import { toErrorMessage } from '../utils/log';

type VendorOption = { id: string; name: string };

function displayName(reg: ShowRegistration): string {
  return reg.isManual ? reg.manualName || 'Manual vendor' : reg.vendorName || reg.vendorId;
}

// Opens the native Messages app with a prefilled balance reminder. iOS uses
// `&body=` (no `?`) — Android uses `?body=`.
function sendReminderSms(phone: string, message: string) {
  const sep = Platform.OS === 'ios' ? '&' : '?';
  Linking.openURL(`sms:${phone}${sep}body=${encodeURIComponent(message)}`).catch(() => {});
}

// ---------- small shared pieces ----------

const Field = memo(function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.fieldInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType}
      />
    </View>
  );
});

const ModalSheet = memo(function ModalSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalBackdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{title}</Text>
          <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
          <TouchableOpacity style={styles.modalClose} onPress={onClose}>
            <Text style={styles.modalCloseText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
});

// ---------- registration row ----------

const RegistrationRow = memo(function RegistrationRow({
  reg,
  showName,
  showDate,
  isOwnerSection,
  onApprove,
  onReject,
  onPay,
  onAssign,
  onRemind,
  onRemove,
}: {
  reg: ShowRegistration;
  showName: string;
  showDate: string;
  isOwnerSection: boolean; // approved rows get payment actions
  onApprove: () => void;
  onReject: () => void;
  onPay: () => void;
  onAssign: () => void;
  onRemind: () => void;
  onRemove: () => void;
}) {
  const remaining = Math.max(0, reg.totalDue - reg.paidAmount);
  const paid = reg.totalDue > 0 && remaining <= 0;
  const hasPhone = Boolean(reg.manualPhone);
  return (
    <View style={styles.regCard}>
      <View style={styles.regHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.regName} numberOfLines={1}>
            {displayName(reg)}
            {reg.isManual ? '  ·not on app' : ''}
          </Text>
          <Text style={styles.regSub}>
            {reg.tableNumber ? `Table ${reg.tableNumber}` : 'No table'}
            {reg.totalDue > 0
              ? `  ·  $${reg.paidAmount.toFixed(2)} / $${reg.totalDue.toFixed(2)}`
              : ''}
          </Text>
        </View>
        {isOwnerSection && reg.totalDue > 0 ? (
          <Text style={[styles.paidBadge, paid ? styles.paidYes : styles.paidNo]}>
            {paid ? 'Paid' : `-$${remaining.toFixed(2)}`}
          </Text>
        ) : null}
      </View>
      <View style={styles.regActions}>
        {reg.status === 'pending' ? (
          <>
            <TouchableOpacity
              style={[styles.miniBtn, styles.approveBtn]}
              onPress={onApprove}>
              <Text style={styles.approveText}>Approve</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.miniBtn, styles.rejectBtn]}
              onPress={onReject}>
              <Text style={styles.rejectText}>Reject</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity style={styles.miniBtn} onPress={onPay}>
              <Ionicons name="cash-outline" size={13} color={colors.success} />
              <Text style={styles.miniBtnText}>Payment</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.miniBtn} onPress={onAssign}>
              <Ionicons name="grid-outline" size={13} color={colors.primary} />
              <Text style={styles.miniBtnText}>Table</Text>
            </TouchableOpacity>
            {remaining > 0 ? (
              <TouchableOpacity style={styles.miniBtn} onPress={onRemind}>
                <Ionicons name="chatbox-outline" size={13} color={colors.warning} />
                <Text style={[styles.miniBtnText, { color: colors.warning }]}>
                  {hasPhone ? 'Remind' : 'Remind…'}
                </Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.miniBtn} onPress={onRemove}>
              <Ionicons name="close-outline" size={13} color={colors.error} />
              <Text style={[styles.miniBtnText, { color: colors.error }]}>
                Remove
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
});

// ---------- main screen ----------

export function OrganizerScreen({ onBack }: { onBack: () => void }) {
  const [shows, setShows] = useState<VendorShow[]>([]);
  const [selected, setSelected] = useState<VendorShow | null>(null);
  const [registrations, setRegistrations] = useState<ShowRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // create/edit show form
  const [showFormOpen, setShowFormOpen] = useState(false);
  const [editingShow, setEditingShow] = useState(false);
  const [fName, setFName] = useState('');
  const [fDate, setFDate] = useState('');
  const [fLocation, setFLocation] = useState('');
  const [fTables, setFTables] = useState('');
  const [fPay, setFPay] = useState('');
  const [saving, setSaving] = useState(false);

  // add-vendor modal
  const [addOpen, setAddOpen] = useState(false);
  const [appVendors, setAppVendors] = useState<VendorOption[]>([]);
  const [pickedVendor, setPickedVendor] = useState<VendorOption | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [mName, setMName] = useState('');
  const [mPhone, setMPhone] = useState('');
  const [mTable, setMTable] = useState('');
  const [mDue, setMDue] = useState('');

  // approve modal (pending → approved + table + due + contact phone)
  const [approveTarget, setApproveTarget] = useState<ShowRegistration | null>(null);
  const [aTable, setATable] = useState('');
  const [aDue, setADue] = useState('');
  const [aPhone, setAPhone] = useState('');

  // payment modal
  const [payTarget, setPayTarget] = useState<ShowRegistration | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payDue, setPayDue] = useState('');

  // assign table modal
  const [assignTarget, setAssignTarget] = useState<ShowRegistration | null>(null);
  const [assignTable, setAssignTable] = useState('');

  // remind modal — set phone when none is on file, then open Messages
  const [remindTarget, setRemindTarget] = useState<ShowRegistration | null>(null);
  const [remindPhone, setRemindPhone] = useState('');

  const loadShows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await getVendorShows();
      setShows(all.filter((s) => s.my_status === 'owner'));
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRegs = useCallback(async (showId: string) => {
    try {
      setRegistrations(await getShowRegistrations(showId));
    } catch (err) {
      setError(toErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    loadShows();
  }, [loadShows]);

  const openDetail = useCallback(
    (show: VendorShow) => {
      setSelected(show);
      loadRegs(show.id);
    },
    [loadRegs]
  );

  const refreshSelected = useCallback(() => {
    if (selected) loadRegs(selected.id);
  }, [selected, loadRegs]);

  // ----- actions -----

  const saveShow = useCallback(async () => {
    if (!fName.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: fName.trim(),
        start_date: fDate.trim(),
        location: fLocation.trim(),
        table_count: fTables.trim() ? Math.floor(Number(fTables)) || 0 : null,
        pay_instructions: fPay.trim(),
      };
      if (editingShow && selected) {
        await updateShow(selected.id, payload);
        setSelected({ ...selected, ...payload });
      } else {
        await createShow(payload);
      }
      setShowFormOpen(false);
      await loadShows();
      if (editingShow && selected) await loadRegs(selected.id);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [fName, fDate, fLocation, fTables, fPay, editingShow, selected, loadShows, loadRegs]);

  const confirmUnpublish = useCallback(() => {
    if (!selected) return;
    Alert.alert(
      'Unpublish show?',
      'The show disappears from the public list and this screen. You can republish by setting it active again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unpublish',
          style: 'destructive',
          onPress: async () => {
            try {
              await updateShow(selected.id, { is_active: false });
              setSelected(null);
              await loadShows();
            } catch (err) {
              setError(toErrorMessage(err));
            }
          },
        },
      ]
    );
  }, [selected, loadShows]);

  const openApprove = useCallback((reg: ShowRegistration) => {
    setApproveTarget(reg);
    setATable(reg.tableNumber);
    setADue(reg.totalDue > 0 ? String(reg.totalDue) : '');
    setAPhone(reg.manualPhone);
  }, []);

  const commitApprove = useCallback(async () => {
    if (!selected || !approveTarget) return;
    try {
      await updateShowRegistration(selected.id, approveTarget.vendorId, {
        status: 'approved',
        table_number: aTable.trim(),
        total_due: aDue.trim() ? Number(aDue) || 0 : 0,
        manual_phone: aPhone.trim(),
      });
      setApproveTarget(null);
      await refreshSelected();
    } catch (err) {
      setError(toErrorMessage(err));
    }
  }, [selected, approveTarget, aTable, aDue, aPhone, refreshSelected]);

  const commitReject = useCallback(
    async (reg: ShowRegistration) => {
      if (!selected) return;
      try {
        await updateShowRegistration(selected.id, reg.vendorId, { status: 'rejected' });
        await refreshSelected();
      } catch (err) {
        setError(toErrorMessage(err));
      }
    },
    [selected, refreshSelected]
  );

  const openPay = useCallback((reg: ShowRegistration) => {
    setPayTarget(reg);
    setPayAmount('');
    setPayDue(reg.totalDue > 0 ? String(reg.totalDue) : '');
  }, []);

  const commitPay = useCallback(
    async (full = false) => {
      if (!selected || !payTarget) return;
      const due = payDue.trim() ? Math.max(0, Number(payDue) || 0) : payTarget.totalDue;
      const add = full ? due - payTarget.paidAmount : Number(payAmount) || 0;
      // Empty/zero amount with a real total → stay open, don't silently drop.
      if (add <= 0 && !full) {
        setError('Enter a payment amount first.');
        return;
      }
      try {
        await updateShowRegistration(selected.id, payTarget.vendorId, {
          paid_amount: Math.min(due, payTarget.paidAmount + Math.max(0, add)),
          total_due: due,
        });
        setPayTarget(null);
        await refreshSelected();
      } catch (err) {
        setError(toErrorMessage(err));
      }
    },
    [selected, payTarget, payAmount, refreshSelected]
  );

  const commitAssign = useCallback(async () => {
    if (!selected || !assignTarget) return;
    try {
      await updateShowRegistration(selected.id, assignTarget.vendorId, {
        table_number: assignTable.trim(),
      });
      setAssignTarget(null);
      await refreshSelected();
    } catch (err) {
      setError(toErrorMessage(err));
    }
  }, [selected, assignTarget, assignTable, refreshSelected]);

  // Remind: phone on file → open Messages immediately; otherwise collect the
  // number first (saved to the registration) then open Messages.
  const handleRemind = useCallback(
    (reg: ShowRegistration) => {
      if (!selected) return;
      const remaining = (reg.totalDue - reg.paidAmount).toFixed(2);
      const message = `Hi ${displayName(reg)}, your table balance for ${selected.name}${
        selected.start_date ? ` (${selected.start_date})` : ''
      } is $${remaining}.`;
      if (reg.manualPhone) {
        sendReminderSms(reg.manualPhone, message);
      } else {
        setRemindTarget(reg);
        setRemindPhone('');
      }
    },
    [selected]
  );

  const commitRemind = useCallback(async () => {
    if (!selected || !remindTarget) return;
    const phone = remindPhone.trim();
    if (!phone) return;
    try {
      await updateShowRegistration(selected.id, remindTarget.vendorId, {
        manual_phone: phone,
      });
      const remaining = (remindTarget.totalDue - remindTarget.paidAmount).toFixed(2);
      sendReminderSms(
        phone,
        `Hi ${displayName(remindTarget)}, your table balance for ${selected.name}${
          selected.start_date ? ` (${selected.start_date})` : ''
        } is $${remaining}.`
      );
      setRemindTarget(null);
      await refreshSelected();
    } catch (err) {
      setError(toErrorMessage(err));
    }
  }, [selected, remindTarget, remindPhone, refreshSelected]);

  const openAddVendor = useCallback(async () => {
    setAddOpen(true);
    setManualMode(false);
    setPickedVendor(null);
    setMName('');
    setMPhone('');
    setMTable('');
    setMDue('');
    try {
      setAppVendors(await listVendors());
    } catch (err) {
      setError(toErrorMessage(err));
    }
  }, []);

  const attachVendor = useCallback(async () => {
    if (!selected || !pickedVendor) return;
    try {
      await addShowRegistration(selected.id, {
        vendor_id: pickedVendor.id,
        manual_phone: mPhone.trim(),
        table_number: mTable.trim(),
        total_due: mDue.trim() ? Number(mDue) || 0 : 0,
      });
      setAddOpen(false);
      await refreshSelected();
    } catch (err) {
      setError(toErrorMessage(err));
    }
  }, [selected, pickedVendor, mPhone, mTable, mDue, refreshSelected]);

  const attachManual = useCallback(async () => {
    if (!selected || !mName.trim()) return;
    try {
      await addShowRegistration(selected.id, {
        manual_name: mName.trim(),
        manual_phone: mPhone.trim(),
        table_number: mTable.trim(),
        total_due: mDue.trim() ? Number(mDue) || 0 : 0,
      });
      setAddOpen(false);
      await refreshSelected();
    } catch (err) {
      setError(toErrorMessage(err));
    }
  }, [selected, mName, mPhone, mTable, mDue, refreshSelected]);

  // ----- list mode -----

  if (!selected) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={18} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Organize</Text>
          <TouchableOpacity
            style={styles.newShowBtn}
            onPress={() => {
              setEditingShow(false);
              setFName('');
              setFDate('');
              setFLocation('');
              setFTables('');
              setFPay('');
              setShowFormOpen(true);
            }}>
            <Ionicons name="add" size={15} color={colors.primary} />
            <Text style={styles.newShowText}>New Show</Text>
          </TouchableOpacity>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : shows.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyText}>
              No shows yet — create one to start managing vendors.
            </Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.listContent}>
            {shows.map((s) => (
              <TouchableOpacity
                key={s.id}
                style={styles.showCard}
                onPress={() => openDetail(s)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.showName}>{s.name}</Text>
                  <Text style={styles.showSub}>
                    {[s.start_date, s.location].filter(Boolean).join('  ·  ')}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {showFormOpen ? (
          <ModalSheet
            title={editingShow ? 'Edit show' : 'New show'}
            onClose={() => setShowFormOpen(false)}>
            <Field label="Name" value={fName} onChangeText={setFName} placeholder="Card show name" />
            <Field label="Date" value={fDate} onChangeText={setFDate} placeholder="e.g. Sep 19, 2026" />
            <Field label="Location" value={fLocation} onChangeText={setFLocation} placeholder="Venue / city" />
            <Field
              label="Total tables"
              value={fTables}
              onChangeText={setFTables}
              placeholder="e.g. 40"
              keyboardType="decimal-pad"
            />
            <Field
              label="Pay instructions"
              value={fPay}
              onChangeText={setFPay}
              placeholder="e.g. Venmo @you — balance due Friday"
            />
            <TouchableOpacity
              style={[styles.primaryBtn, saving && { opacity: 0.6 }]}
              onPress={saveShow}
              disabled={saving}>
              <Text style={styles.primaryBtnText}>
                {saving ? 'Saving…' : editingShow ? 'Save changes' : 'Create show'}
              </Text>
            </TouchableOpacity>
            {!editingShow ? (
              <Text style={styles.hintText}>
                Shows publish to the public list immediately.
              </Text>
            ) : null}
          </ModalSheet>
        ) : null}
      </View>
    );
  }

  // ----- detail mode -----

  const pending = registrations.filter((r) => r.status === 'pending');
  const approved = registrations.filter((r) => r.status === 'approved');
  const tablesUsed = approved.length;
  const collected = approved.reduce((s, r) => s + r.paidAmount, 0);
  const dueTotal = approved.reduce((s, r) => s + r.totalDue, 0);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setSelected(null)} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={18} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {selected.name}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {[selected.start_date, selected.location].filter(Boolean).join('  ·  ')}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => {
            setEditingShow(true);
            setFName(selected.name);
            setFDate(selected.start_date);
            setFLocation(selected.location);
            setFTables(selected.table_count != null ? String(selected.table_count) : '');
            setFPay(selected.pay_instructions ?? '');
            setShowFormOpen(true);
          }}>
          <Ionicons name="create-outline" size={17} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <ScrollView contentContainerStyle={styles.listContent}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryText}>
            {tablesUsed}
            {selected.table_count != null ? `/${selected.table_count}` : ''} tables taken
          </Text>
          <Text style={styles.summaryText}>
            ${collected.toFixed(0)} collected
            {dueTotal > 0 ? ` of $${dueTotal.toFixed(0)} due` : ''}
          </Text>
        </View>

        <TouchableOpacity style={styles.unpublishBtn} onPress={confirmUnpublish}>
          <Text style={styles.unpublishText}>Unpublish show</Text>
        </TouchableOpacity>

        {pending.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Requests ({pending.length})</Text>
            {pending.map((reg) => (
              <RegistrationRow
                key={reg.vendorId}
                reg={reg}
                showName={selected.name}
                showDate={selected.start_date}
                isOwnerSection={false}
                onApprove={() => openApprove(reg)}
                onReject={() => commitReject(reg)}
                onPay={() => {}}
                onAssign={() => {}}
                onRemind={() => {}}
                onRemove={() => {}}
              />
            ))}
          </>
        ) : null}

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Vendors ({approved.length})</Text>
          <TouchableOpacity style={styles.addVendorBtn} onPress={openAddVendor}>
            <Ionicons name="person-add-outline" size={13} color={colors.primary} />
            <Text style={styles.addVendorText}>Add</Text>
          </TouchableOpacity>
        </View>

        {approved.length === 0 ? (
          <Text style={styles.emptyText}>No vendors attached yet.</Text>
        ) : (
          approved.map((reg) => (
            <RegistrationRow
              key={reg.vendorId}
              reg={reg}
              showName={selected.name}
              showDate={selected.start_date}
              isOwnerSection
              onApprove={() => {}}
              onReject={() => {}}
              onPay={() => openPay(reg)}
              onAssign={() => {
                setAssignTarget(reg);
                setAssignTable(reg.tableNumber);
              }}
              onRemind={() => handleRemind(reg)}
              onRemove={() =>
                Alert.alert('Remove vendor?', `Remove ${displayName(reg)} from this show?`, [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: () => commitReject(reg),
                  },
                ])
              }
            />
          ))
        )}
      </ScrollView>

      {/* edit show */}
      {showFormOpen && editingShow ? (
        <ModalSheet title="Edit show" onClose={() => setShowFormOpen(false)}>
          <Field label="Name" value={fName} onChangeText={setFName} />
          <Field label="Date" value={fDate} onChangeText={setFDate} />
          <Field label="Location" value={fLocation} onChangeText={setFLocation} />
          <Field
            label="Total tables"
            value={fTables}
            onChangeText={setFTables}
            keyboardType="decimal-pad"
          />
          <Field
            label="Pay instructions"
            value={fPay}
            onChangeText={setFPay}
          />
          <TouchableOpacity
            style={[styles.primaryBtn, saving && { opacity: 0.6 }]}
            onPress={saveShow}
            disabled={saving}>
            <Text style={styles.primaryBtnText}>
              {saving ? 'Saving…' : 'Save changes'}
            </Text>
          </TouchableOpacity>
        </ModalSheet>
      ) : null}

      {/* add vendor */}
      {addOpen ? (
        <ModalSheet title="Add vendor" onClose={() => setAddOpen(false)}>
          {!pickedVendor ? (
            <TouchableOpacity
              style={styles.modeToggle}
              onPress={() => setManualMode((m) => !m)}>
              <Text style={styles.modeToggleText}>
                {manualMode ? 'Pick an app vendor instead' : 'Vendor not on the app? Add manually'}
              </Text>
            </TouchableOpacity>
          ) : null}

          {pickedVendor ? (
            <>
              <Text style={styles.hintText}>Adding {pickedVendor.name || pickedVendor.id}</Text>
              <Field label="Table #" value={mTable} onChangeText={setMTable} />
              <Field
                label="Total due"
                value={mDue}
                onChangeText={setMDue}
                keyboardType="decimal-pad"
              />
              <Field
                label="Phone (SMS reminders)"
                value={mPhone}
                onChangeText={setMPhone}
                placeholder="Optional"
              />
              <TouchableOpacity style={styles.primaryBtn} onPress={attachVendor}>
                <Text style={styles.primaryBtnText}>Add vendor</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modeToggle}
                onPress={() => setPickedVendor(null)}>
                <Text style={styles.modeToggleText}>Back to list</Text>
              </TouchableOpacity>
            </>
          ) : manualMode ? (
            <>
              <Field label="Name" value={mName} onChangeText={setMName} />
              <Field label="Phone (for SMS reminders)" value={mPhone} onChangeText={setMPhone} />
              <Field label="Table #" value={mTable} onChangeText={setMTable} />
              <Field
                label="Total due"
                value={mDue}
                onChangeText={setMDue}
                keyboardType="decimal-pad"
              />
              <TouchableOpacity style={styles.primaryBtn} onPress={attachManual}>
                <Text style={styles.primaryBtnText}>Add vendor</Text>
              </TouchableOpacity>
            </>
          ) : (
            appVendors.map((v) => (
              <TouchableOpacity
                key={v.id}
                style={styles.vendorOption}
                onPress={() => setPickedVendor(v)}>
                <Text style={styles.vendorOptionText}>{v.name || v.id}</Text>
                <Ionicons name="chevron-forward" size={15} color={colors.textMuted} />
              </TouchableOpacity>
            ))
          )}
        </ModalSheet>
      ) : null}

      {/* approve request */}
      {approveTarget ? (
        <ModalSheet
          title={`Approve ${displayName(approveTarget)}`}
          onClose={() => setApproveTarget(null)}>
          <Field label="Table #" value={aTable} onChangeText={setATable} />
          <Field
            label="Total due"
            value={aDue}
            onChangeText={setADue}
            keyboardType="decimal-pad"
          />
          <Field
            label="Phone (SMS reminders)"
            value={aPhone}
            onChangeText={setAPhone}
            placeholder="Optional"
          />
          <TouchableOpacity style={styles.primaryBtn} onPress={commitApprove}>
            <Text style={styles.primaryBtnText}>Approve</Text>
          </TouchableOpacity>
        </ModalSheet>
      ) : null}

      {/* record payment */}
      {payTarget ? (
        <ModalSheet
          title={`Payment — ${displayName(payTarget)}`}
          onClose={() => setPayTarget(null)}>
          <Text style={styles.hintText}>
            Paid ${payTarget.paidAmount.toFixed(2)} of ${payTarget.totalDue.toFixed(2)}
            {'  ·  '}remaining ${(payTarget.totalDue - payTarget.paidAmount).toFixed(2)}
          </Text>
          <Field
            label="Total due"
            value={payDue}
            onChangeText={setPayDue}
            keyboardType="decimal-pad"
          />
          <Field
            label="Amount received"
            value={payAmount}
            onChangeText={setPayAmount}
            keyboardType="decimal-pad"
          />
          <TouchableOpacity
            style={[styles.primaryBtn, !(Number(payAmount) > 0) && { opacity: 0.5 }]}
            onPress={() => commitPay(false)}
            disabled={!(Number(payAmount) > 0)}>
            <Text style={styles.primaryBtnText}>Record payment</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => commitPay(true)}>
            <Text style={styles.secondaryBtnText}>Mark fully paid</Text>
          </TouchableOpacity>
        </ModalSheet>
      ) : null}

      {/* assign table */}
      {assignTarget ? (
        <ModalSheet
          title={`Table — ${displayName(assignTarget)}`}
          onClose={() => setAssignTarget(null)}>
          <Field label="Table #" value={assignTable} onChangeText={setAssignTable} />
          <TouchableOpacity style={styles.primaryBtn} onPress={commitAssign}>
            <Text style={styles.primaryBtnText}>Save</Text>
          </TouchableOpacity>
        </ModalSheet>
      ) : null}

      {/* remind — collect phone when none saved, then open Messages */}
      {remindTarget ? (
        <ModalSheet
          title={`Remind ${displayName(remindTarget)}`}
          onClose={() => setRemindTarget(null)}>
          <Text style={styles.hintText}>
            Balance: ${(remindTarget.totalDue - remindTarget.paidAmount).toFixed(2)}.
            Add a number to text them — it's saved for next time.
          </Text>
          <Field
            label="Phone"
            value={remindPhone}
            onChangeText={setRemindPhone}
            placeholder="e.g. 555-123-4567"
          />
          <TouchableOpacity
            style={[styles.primaryBtn, !remindPhone.trim() && { opacity: 0.5 }]}
            onPress={commitRemind}
            disabled={!remindPhone.trim()}>
            <Text style={styles.primaryBtnText}>Save & open Messages</Text>
          </TouchableOpacity>
        </ModalSheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 10,
  },
  backBtn: { padding: 4 },
  title: { color: colors.text, fontSize: 20, fontWeight: 'bold', flexShrink: 1 },
  headerSub: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
  newShowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 'auto',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: 'rgba(59,130,246,0.12)',
  },
  newShowText: { color: colors.primary, fontSize: 13, fontWeight: 'bold' },
  iconBtn: { padding: 6 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: {
    color: colors.error,
    fontSize: 12,
    marginHorizontal: 16,
    marginBottom: 6,
  },
  emptyText: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  listContent: { padding: 16, gap: 10, paddingBottom: 32 },
  showCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  showName: { color: colors.text, fontSize: 15, fontWeight: 'bold' },
  showSub: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  unpublishBtn: { alignSelf: 'flex-start', paddingVertical: 4 },
  unpublishText: { color: colors.textMuted, fontSize: 12 },
  sectionTitle: { color: colors.textMuted, fontSize: 13, fontWeight: 'bold', marginTop: 8 },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  addVendorBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 4 },
  addVendorText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  regCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  regHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  regName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  regSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  paidBadge: { fontSize: 12, fontWeight: 'bold', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: 'hidden' },
  paidYes: { color: colors.success, backgroundColor: 'rgba(34,197,94,0.12)' },
  paidNo: { color: colors.warning, backgroundColor: 'rgba(210,153,34,0.12)' },
  regActions: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  miniBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
  },
  miniBtnText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  approveBtn: { borderColor: colors.success, backgroundColor: 'rgba(34,197,94,0.12)' },
  approveText: { color: colors.success, fontSize: 12, fontWeight: 'bold' },
  rejectBtn: { borderColor: colors.error, backgroundColor: 'rgba(239,68,68,0.10)' },
  rejectText: { color: colors.error, fontSize: 12, fontWeight: 'bold' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    maxHeight: '85%',
  },
  modalTitle: { color: colors.text, fontSize: 16, fontWeight: 'bold', marginBottom: 10 },
  modalClose: { marginTop: 12, alignItems: 'center', paddingVertical: 8 },
  modalCloseText: { color: colors.textMuted, fontSize: 14 },
  field: { marginBottom: 10 },
  fieldLabel: { color: colors.textMuted, fontSize: 12, marginBottom: 4 },
  fieldInput: {
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    color: colors.text,
    fontSize: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  primaryBtn: {
    marginTop: 8,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  primaryBtnText: { color: colors.background, fontSize: 14, fontWeight: 'bold' },
  secondaryBtn: {
    marginTop: 8,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.success,
  },
  secondaryBtnText: { color: colors.success, fontSize: 13, fontWeight: 'bold' },
  hintText: { color: colors.textMuted, fontSize: 12, marginTop: 8 },
  modeToggle: { marginBottom: 10 },
  modeToggleText: { color: colors.primary, fontSize: 13 },
  vendorOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  vendorOptionText: { color: colors.text, fontSize: 14 },
});
