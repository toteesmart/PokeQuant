// Registration actions — approve/reject/payment/table/remind mutation
// flows. Each modal's target + draft fields live here; commits write
// through the worker then refresh the roster.
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import {
  updateShow,
  updateShowRegistration,
  type ShowRegistration,
  type VendorShow,
} from '../services/showVendorService';
import { displayName, sendReminderSms } from '../services/organizerText';
import { toErrorMessage } from '../utils/log';

export function useRegActions({
  selected,
  setSelected,
  setError,
  loadShows,
  refreshSelected,
}: {
  selected: VendorShow | null;
  setSelected: (s: VendorShow | null) => void;
  setError: (e: string | null) => void;
  loadShows: () => Promise<void>;
  refreshSelected: () => Promise<void> | void;
}) {
  // Approve-request modal (table/due/phone seeded from the registration).
  const [approveTarget, setApproveTarget] = useState<ShowRegistration | null>(null);
  const [aTable, setATable] = useState('');
  const [aDue, setADue] = useState('');
  const [aPhone, setAPhone] = useState('');

  // Record-payment modal.
  const [payTarget, setPayTarget] = useState<ShowRegistration | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payDue, setPayDue] = useState('');

  // Assign-table modal.
  const [assignTarget, setAssignTarget] = useState<ShowRegistration | null>(null);
  const [assignTable, setAssignTable] = useState('');

  // Remind modal — only shown when no phone is on file.
  const [remindTarget, setRemindTarget] = useState<ShowRegistration | null>(null);
  const [remindPhone, setRemindPhone] = useState('');

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
      ],
    );
  }, [selected, setSelected, setError, loadShows]);

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
  }, [selected, approveTarget, aTable, aDue, aPhone, setError, refreshSelected]);

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
    [selected, setError, refreshSelected],
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
    [selected, payTarget, payDue, payAmount, setError, refreshSelected],
  );

  const openAssign = useCallback((reg: ShowRegistration) => {
    setAssignTarget(reg);
    setAssignTable(reg.tableNumber);
  }, []);

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
  }, [selected, assignTarget, assignTable, setError, refreshSelected]);

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
    [selected],
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
        } is $${remaining}.`,
      );
      setRemindTarget(null);
      await refreshSelected();
    } catch (err) {
      setError(toErrorMessage(err));
    }
  }, [selected, remindTarget, remindPhone, setError, refreshSelected]);

  return {
    approveTarget,
    setApproveTarget,
    aTable,
    setATable,
    aDue,
    setADue,
    aPhone,
    setAPhone,
    payTarget,
    setPayTarget,
    payAmount,
    setPayAmount,
    payDue,
    setPayDue,
    assignTarget,
    setAssignTarget,
    assignTable,
    setAssignTable,
    remindTarget,
    setRemindTarget,
    remindPhone,
    setRemindPhone,
    confirmUnpublish,
    openApprove,
    commitApprove,
    commitReject,
    openPay,
    commitPay,
    openAssign,
    commitAssign,
    handleRemind,
    commitRemind,
  };
}
