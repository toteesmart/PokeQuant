// useInventorySignals — the catalog-backed pipeline behind the
// inventory header: per-period portfolio velocity windows, the raw
// CardSignal map, and deal-class shift diffs for held + watched cards.
// Debounced 500ms, keyed on the unique product-id set so inventory
// edits that don't change coverage don't reload. Stale runs are
// dropped via the mounted flag + timer cleanup.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  openCatalogDatabase,
  getCardSignals,
  getProductMarketData,
  pickSignalForFinish,
  type CardSignal,
} from '../db/catalogDb';
import {
  diffDealClasses,
  loadDealClassMap,
  saveDealClassMap,
  type DealShift,
  type DealClassMap,
} from '../scanner/services/deal/dealShiftTracker';
import { signalForCard } from '../services/inventoryReads';
import {
  buildVelocityWindows,
  DEFAULT_VELOCITY,
  type Period,
  type VelocityWindow,
} from '../services/portfolioVelocity';
import {
  useInventoryStore,
  type InventoryCard,
} from '../store/inventoryStore';
import { useVendorStore } from '../store/vendorStore';
import {
  useWatchlistStore,
  type WatchedCard,
} from '../store/watchlistStore';

export function useInventorySignals(
  isCatalogReady: boolean,
  isExtracting: boolean
) {
  const activeInventory = useInventoryStore((s) => s.activeInventory);
  const getConditionedMarket = useVendorStore(
    (s) => s.getConditionedMarket
  );
  const watchedCards = useWatchlistStore((s) => s.cards);

  const [velocityData, setVelocityData] =
    useState<Record<Period, VelocityWindow>>(DEFAULT_VELOCITY);
  const [signalMap, setSignalMap] = useState<
    Record<number, Record<string, CardSignal>>
  >({});
  // Cards whose movement class changed since the last catalog refresh.
  const [classShifts, setClassShifts] = useState<DealShift<InventoryCard>[]>([]);
  const [watchShifts, setWatchShifts] = useState<DealShift<WatchedCard>[]>(
    []
  );

  const velocityKeyRef = useRef<string>('');
  const velocityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const ready = isCatalogReady && !isExtracting;
  const watchedList = useMemo(
    () => Object.values(watchedCards),
    [watchedCards]
  );
  const uniqueIds = useMemo(() => {
    const productIds = activeInventory
      .map((c) => c.productId)
      .filter((id): id is number => id != null);
    return [
      ...new Set([...productIds, ...watchedList.map((w) => w.productId)]),
    ].sort((a, b) => a - b);
  }, [activeInventory, watchedList]);

  // Gate transitions clear the derived surface — render-adjusted so the
  // effect body only owns the debounced catalog load.
  const gateKey = `${ready ? 1 : 0}:${uniqueIds.join(',')}`;
  const [prevGateKey, setPrevGateKey] = useState(gateKey);
  if (gateKey !== prevGateKey) {
    setPrevGateKey(gateKey);
    if (!ready || uniqueIds.length === 0) {
      setVelocityData(DEFAULT_VELOCITY);
      if (!ready) setSignalMap({});
    }
  }

  useEffect(() => {
    if (!ready || uniqueIds.length === 0) {
      velocityKeyRef.current = '';
      return;
    }

    const key = uniqueIds.join(',');
    if (key === velocityKeyRef.current) return;

    if (velocityTimerRef.current) {
      clearTimeout(velocityTimerRef.current);
    }

    let mounted = true;
    velocityTimerRef.current = setTimeout(async () => {
      // Claim the key on fire, not on schedule — a cleanup-killed timer must
      // leave the key unclaimed so the rescheduled run can actually load.
      velocityKeyRef.current = key;
      const variantMap: Record<number, string> = {};
      for (const card of activeInventory) {
        if (card.productId == null) continue;
        if (variantMap[card.productId] == null) {
          variantMap[card.productId] =
            card.productType ?? card.rarity ?? 'Normal';
        }
      }

      try {
        const db = await openCatalogDatabase();
        const [map, signals] = await Promise.all([
          getProductMarketData(db, uniqueIds, variantMap),
          getCardSignals(db, uniqueIds).catch(
            () => ({}) as Record<number, Record<string, CardSignal>>
          ),
        ]);

        if (!mounted) return;
        setSignalMap(signals);

        // Diff each held card's deal class vs the last catalog — flags
        // movement shifts (Stable→Free fall etc.) so direction changes
        // never sneak past between refreshes. Watched (unowned) cards
        // join the same diff — that's where revival alerts come from.
        const prev = await loadDealClassMap();
        const held = diffDealClasses(
          prev,
          activeInventory.map((card) => ({
            card,
            productId: card.productId,
            subType: card.productType,
            signal: signalForCard(signals, card),
          }))
        );
        const watched = diffDealClasses(
          prev,
          watchedList.map((w) => ({
            card: w,
            productId: w.productId,
            subType: w.subType,
            // Same finish fallback the held path uses — requested
            // finish, then Normal, then any loaded variant — so the
            // shift label can't classify a different finish than the
            // badge and sheet would pick for the same row.
            signal: pickSignalForFinish(signals, {
              productId: w.productId,
              productType: w.subType,
            }),
          }))
        );
        if (mounted) {
          setClassShifts(held.shifts);
          setWatchShifts(watched.shifts);
        }
        const nextMap: DealClassMap = { ...held.next, ...watched.next };
        void saveDealClassMap(nextMap);
        setVelocityData(
          buildVelocityWindows(map, activeInventory, getConditionedMarket)
        );
      } catch (err) {
        console.error('Failed to load market velocity:', err);
      }
    }, 500);

    return () => {
      mounted = false;
      if (velocityTimerRef.current) {
        clearTimeout(velocityTimerRef.current);
      }
    };
  }, [
    ready,
    uniqueIds,
    activeInventory,
    watchedList,
    getConditionedMarket,
  ]);

  const dismissShifts = () => {
    setClassShifts([]);
    setWatchShifts([]);
  };

  return {
    velocityData,
    signalMap,
    classShifts,
    watchShifts,
    dismissShifts,
  };
}
