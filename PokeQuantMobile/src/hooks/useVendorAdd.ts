// Add-vendor flow — app-vendor picker vs manual entry, and both attach
// paths that write a registration row through the worker.
import { useCallback, useState } from 'react';
import {
  addShowRegistration,
  listVendors,
  type VendorShow,
} from '../services/showVendorService';
import type { VendorOption } from '../services/organizerText';
import { toErrorMessage } from '../utils/log';

export function useVendorAdd({
  selected,
  setError,
  refreshSelected,
}: {
  selected: VendorShow | null;
  setError: (e: string | null) => void;
  refreshSelected: () => Promise<void> | void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [appVendors, setAppVendors] = useState<VendorOption[]>([]);
  const [pickedVendor, setPickedVendor] = useState<VendorOption | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [mName, setMName] = useState('');
  const [mPhone, setMPhone] = useState('');
  const [mTable, setMTable] = useState('');
  const [mDue, setMDue] = useState('');

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
  }, [setError]);

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
  }, [selected, pickedVendor, mPhone, mTable, mDue, setError, refreshSelected]);

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
  }, [selected, mName, mPhone, mTable, mDue, setError, refreshSelected]);

  return {
    addOpen,
    setAddOpen,
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
    openAddVendor,
    attachVendor,
    attachManual,
  };
}
