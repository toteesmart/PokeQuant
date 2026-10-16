// useBulkSelection — the inventory bulk-select interaction: long-press
// a card OR the header "Select" button to enter, tap cards to toggle.
// Entered via long-press, deselecting the last card exits; entered via
// the button it stays until Cancel. Delete is a two-tap confirm on a
// 3.5s timer.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useInventoryStore, type InventoryCard } from '../store/inventoryStore';

export function useBulkSelection() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const bulkDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selecting = selectionMode || selectedIds.size > 0;

  const handleStartSelect = useCallback((card: InventoryCard) => {
    setSelectedIds((prev) => {
      if (prev.has(card.id)) return prev;
      const next = new Set(prev);
      next.add(card.id);
      return next;
    });
  }, []);

  const handleToggleSelect = useCallback((card: InventoryCard) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(card.id)) {
        next.delete(card.id);
      } else {
        next.add(card.id);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectionMode(false);
    setConfirmBulkDelete(false);
  }, []);

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((m) => {
      if (m) {
        setSelectedIds(new Set());
        setConfirmBulkDelete(false);
        return false;
      }
      return true;
    });
  }, []);

  const handleBulkSell = useCallback(() => {
    const store = useInventoryStore.getState();
    selectedIds.forEach((id) => store.sellInventoryCard(id));
    clearSelection();
  }, [selectedIds, clearSelection]);

  const handleBulkDelete = useCallback(() => {
    if (!confirmBulkDelete) {
      setConfirmBulkDelete(true);
      if (bulkDeleteTimerRef.current) {
        clearTimeout(bulkDeleteTimerRef.current);
      }
      bulkDeleteTimerRef.current = setTimeout(() => setConfirmBulkDelete(false), 3500);
      return;
    }
    const store = useInventoryStore.getState();
    selectedIds.forEach((id) => store.removeInventoryCard(id));
    clearSelection();
  }, [confirmBulkDelete, selectedIds, clearSelection]);

  useEffect(() => {
    return () => {
      if (bulkDeleteTimerRef.current) {
        clearTimeout(bulkDeleteTimerRef.current);
      }
    };
  }, []);

  return {
    selecting,
    selectedIds,
    confirmBulkDelete,
    handleStartSelect,
    handleToggleSelect,
    clearSelection,
    toggleSelectionMode,
    handleBulkSell,
    handleBulkDelete,
  };
}
