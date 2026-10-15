// ShowVendorScreen's brain: show-vendor store wiring (selections, listings,
// uploads, publish trigger), vendor name/table defaults, entitlement
// gating, inventory search, and the upload/publish handlers.
//
// Boundary: owns all store subscriptions and async work; the screen keeps
// tab state, paywall visibility, and JSX.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useInventoryStore } from '../store/inventoryStore';
import { useShowVendorStore } from '../store/showVendorStore';
import { useVendorFeatures } from './useVendorFeatures';
import { toErrorMessage } from '../utils/log';
import { normalizeSearchTerm } from '../utils/search';
import { buildSearchIndex } from '../services/inventorySearch';
import type { ShowItem } from '../services/ShowListService';

export function useShowVendor(show: ShowItem) {
  // null = untouched; the derived setup/profile default shows through until
  // the vendor types, so a profile that loads after mount still fills the
  // fields instead of leaving them empty.
  const [vendorName, setVendorName] = useState<string | null>(null);
  const [vendorTable, setVendorTable] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [publishMessage, setPublishMessage] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);
  const [showPaywall, setShowPaywall] = useState(false);

  const activeInventory = useInventoryStore((state) => state.activeInventory);
  const profile = useShowVendorStore((state) => state.profile);
  const setups = useShowVendorStore((state) => state.setups);
  const requestsByShow = useShowVendorStore((state) => state.requestsByShow);
  const selections = useShowVendorStore((state) => state.selections);
  const listings = useShowVendorStore((state) => state.listings);
  const isUploading = useShowVendorStore((state) => state.isUploading[show.id]);
  const uploadError = useShowVendorStore((state) => state.uploadError[show.id]);
  const isLoadingListings = useShowVendorStore(
    (state) => state.isLoadingListings[show.id]
  );
  const listingsError = useShowVendorStore(
    (state) => state.listingsError[show.id]
  );
  const isTriggering = useShowVendorStore(
    (state) => state.isTriggering[show.id]
  );
  const loadListings = useShowVendorStore((state) => state.loadListings);
  const uploadToShow = useShowVendorStore((state) => state.uploadToShow);
  const triggerSnapshot = useShowVendorStore((state) => state.triggerSnapshot);

  const refreshInventoryState = useInventoryStore(
    (state) => state.refreshInventoryState
  );
  const loadVendorProfile = useShowVendorStore((state) => state.loadVendorProfile);

  const { paymentsLive, canUseVendorFeatures } = useVendorFeatures();

  useEffect(() => {
    loadVendorProfile().catch((err) => {
      console.error('Failed to load vendor profile:', err);
    });
  }, [loadVendorProfile]);

  // Entitlement arriving late clears the paywall — render-adjusted on the
  // flag transition.
  const [prevCanUse, setPrevCanUse] = useState(canUseVendorFeatures);
  if (canUseVendorFeatures !== prevCanUse) {
    setPrevCanUse(canUseVendorFeatures);
    if (canUseVendorFeatures) setShowPaywall(false);
  }

  useEffect(() => {
    loadListings(show.id).catch((err) => {
      console.error('Failed to load show listings:', err);
    });
  }, [loadListings, show.id]);

  useEffect(() => {
    if (activeInventory.length === 0) {
      refreshInventoryState();
    }
  }, [activeInventory.length, refreshInventoryState]);

  const showSetup = setups[show.id];
  const effectiveVendorName =
    vendorName ?? showSetup?.vendorName ?? profile?.name ?? '';
  // Organizer-assigned table number prefills when the vendor hasn't set one.
  const effectiveVendorTable =
    vendorTable ??
    showSetup?.vendorTable ??
    (requestsByShow[show.id]?.table || undefined) ??
    profile?.tableDefault ??
    '';

  const selectedMap = useMemo(
    () => selections[show.id] || {},
    [selections, show.id]
  );

  const selectedCount = useMemo(
    () => Object.keys(selectedMap).length,
    [selectedMap]
  );

  const searchIndex = useMemo(
    () => buildSearchIndex(activeInventory),
    [activeInventory]
  );

  const filteredInventory = useMemo(() => {
    const raw = searchQuery.trim();
    if (!raw) return activeInventory;
    const needle = normalizeSearchTerm(raw);
    if (!needle) return activeInventory;
    return searchIndex
      .filter((entry) => entry.haystack.includes(needle))
      .map((entry) => entry.card);
  }, [activeInventory, searchIndex, searchQuery]);

  const listingData = useMemo(
    () => listings[show.id] || [],
    [listings, show.id]
  );

  const handleUpload = useCallback(async () => {
    if (!canUseVendorFeatures) {
      setShowPaywall(true);
      return;
    }
    if (!effectiveVendorName.trim()) return;
    if (selectedCount === 0) return;
    try {
      await uploadToShow(
        show.id,
        effectiveVendorName.trim(),
        effectiveVendorTable.trim()
      );
      return true; // caller flips to the listings tab
    } catch {
      // Error is already in store state.
      return false;
    }
  }, [canUseVendorFeatures, effectiveVendorName, effectiveVendorTable, selectedCount, show.id, uploadToShow]);

  const handlePublish = useCallback(async () => {
    if (!canUseVendorFeatures) {
      setShowPaywall(true);
      return;
    }
    setPublishMessage(null);
    try {
      await triggerSnapshot(show.id);
      setPublishMessage({
        text: 'Published! Attendees can refresh to see your listings.',
        isError: false,
      });
    } catch (err) {
      setPublishMessage({
        text: `Publish didn't go through — ${toErrorMessage(err)}`,
        isError: true,
      });
      console.error('Failed to trigger snapshot:', err);
    }
  }, [canUseVendorFeatures, show.id, triggerSnapshot]);

  const selectedTotal = useMemo(() => {
    return Object.values(selectedMap).reduce(
      (sum, s) => sum + (s?.stickerPrice || 0) * (s?.quantity || 0),
      0
    );
  }, [selectedMap]);

  return {
    paymentsLive,
    showPaywall,
    setShowPaywall,
    searchQuery,
    setSearchQuery,
    effectiveVendorName,
    setVendorName,
    effectiveVendorTable,
    setVendorTable,
    filteredInventory,
    listingData,
    isLoadingListings,
    listingsError,
    isUploading,
    uploadError,
    isTriggering,
    publishMessage,
    selectedCount,
    selectedTotal,
    handleUpload,
    handlePublish,
  };
}
