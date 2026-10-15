// useBuyScout — one funnel query + a classify pass when the catalog
// opens. Owned cards get flagged, and the stock-health pass yields the
// value parked in bleeders worth redeploying.
import { useEffect, useRef, useState } from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  getCardSignals,
  getScoutRows,
  pickSignalForFinish,
} from '../db/catalogDb';
import {
  scoutCandidates,
  scoutFloorBuys,
  type ScoutCandidate,
} from '../scanner/services/deal/buyScout';
import { buildStockHealth } from '../scanner/services/deal/stockHealth';
import type { InventoryCard } from '../store/inventoryStore';

export function useBuyScout(
  catalogDb: SQLiteDatabase | null,
  isCatalogReady: boolean,
  activeInventory: InventoryCard[]
) {
  const [scout, setScout] = useState<ScoutCandidate[]>([]);
  const [floorBuys, setFloorBuys] = useState<ScoutCandidate[]>([]);
  const [redeployValue, setRedeployValue] = useState(0);
  const scoutLoadedRef = useRef(false);

  useEffect(() => {
    if (!catalogDb || !isCatalogReady || scoutLoadedRef.current) return;
    scoutLoadedRef.current = true;
    let mounted = true;
    const ownedIds = new Set(
      activeInventory
        .map((c) => c.productId)
        .filter((id): id is number => id != null)
    );
    (async () => {
      try {
        const rows = await getScoutRows(catalogDb);
        const candidates = scoutCandidates(rows, ownedIds, 40);
        const floors = scoutFloorBuys(rows, ownedIds, 15);
        const ownedArr = [...ownedIds];
        const signals = ownedArr.length
          ? await getCardSignals(catalogDb, ownedArr)
          : {};
        const health = buildStockHealth(activeInventory, (c) =>
          pickSignalForFinish(signals, c)
        );
        const parked =
          health.buckets.rotate.value + health.buckets.dead.value;
        if (mounted) {
          setScout(candidates);
          setFloorBuys(floors);
          setRedeployValue(parked);
        }
      } catch {
        if (mounted) {
          setScout([]);
          setFloorBuys([]);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [catalogDb, isCatalogReady, activeInventory]);

  return { scout, floorBuys, redeployValue };
}
