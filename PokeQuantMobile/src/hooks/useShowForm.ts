// Show create/edit form — the five draft fields, open paths for both
// entry points (list "New Show" resets, detail edit seeds from the
// selected show), and the save that writes through the worker.
import { useCallback, useState } from 'react';
import { createShow, updateShow, type VendorShow } from '../services/showVendorService';
import { toErrorMessage } from '../utils/log';

export function useShowForm({
  selected,
  setSelected,
  setError,
  loadShows,
  loadRegs,
}: {
  selected: VendorShow | null;
  setSelected: (s: VendorShow | null) => void;
  setError: (e: string | null) => void;
  loadShows: () => Promise<void>;
  loadRegs: (showId: string) => Promise<void>;
}) {
  const [showFormOpen, setShowFormOpen] = useState(false);
  const [editingShow, setEditingShow] = useState(false);
  const [fName, setFName] = useState('');
  const [fDate, setFDate] = useState('');
  const [fLocation, setFLocation] = useState('');
  const [fTables, setFTables] = useState('');
  const [fPay, setFPay] = useState('');
  const [saving, setSaving] = useState(false);

  const openNewShow = useCallback(() => {
    setEditingShow(false);
    setFName('');
    setFDate('');
    setFLocation('');
    setFTables('');
    setFPay('');
    setShowFormOpen(true);
  }, []);

  const openEditShow = useCallback((show: VendorShow) => {
    setEditingShow(true);
    setFName(show.name);
    setFDate(show.start_date);
    setFLocation(show.location);
    setFTables(show.table_count != null ? String(show.table_count) : '');
    setFPay(show.pay_instructions ?? '');
    setShowFormOpen(true);
  }, []);

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
  }, [
    fName,
    fDate,
    fLocation,
    fTables,
    fPay,
    editingShow,
    selected,
    setSelected,
    setError,
    loadShows,
    loadRegs,
  ]);

  return {
    showFormOpen,
    setShowFormOpen,
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
    openNewShow,
    openEditShow,
    saveShow,
  };
}
