// Organizer data — owned shows list, the selected show, its registration
// roster, and the load/refresh plumbing every action circles back to.
import { useCallback, useEffect, useState } from 'react';
import {
  getShowRegistrations,
  getVendorShows,
  type ShowRegistration,
  type VendorShow,
} from '../services/showVendorService';
import { toErrorMessage } from '../utils/log';

export function useOrganizerShows() {
  const [shows, setShows] = useState<VendorShow[]>([]);
  const [selected, setSelected] = useState<VendorShow | null>(null);
  const [registrations, setRegistrations] = useState<ShowRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return {
    shows,
    selected,
    setSelected,
    registrations,
    loading,
    error,
    setError,
    loadShows,
    loadRegs,
    openDetail,
    refreshSelected,
  };
}
