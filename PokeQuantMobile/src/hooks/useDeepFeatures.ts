// useDeepFeatures — hydrates the held cards' price_series in the
// background so stock-health buckets refine to the deep read (floors,
// failed bounces, bounce memory). Scalar reads stand if the load
// fails — refinement, not a gate.
import { useEffect, useState } from 'react';
import { getPriceSeriesBulk, openCatalogDatabase } from '../db/catalogDb';
import {
  buildSeriesFeatures,
  type SeriesFeatures,
} from '../scanner/services/deal/seriesSignals';
import type { InventoryCard } from '../store/inventoryStore';

export function useDeepFeatures(activeInventory: InventoryCard[]) {
  const [deepFeatures, setDeepFeatures] = useState<
    Record<number, Record<string, SeriesFeatures>>
  >({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ids = [
        ...new Set(
          activeInventory
            .map((c) => c.productId)
            .filter((x): x is number => x != null)
        ),
      ];
      if (ids.length === 0) {
        setDeepFeatures({});
        return;
      }
      try {
        const db = await openCatalogDatabase();
        const raw = await getPriceSeriesBulk(db, ids);
        if (cancelled) return;
        const feats: Record<number, Record<string, SeriesFeatures>> = {};
        for (const [pidStr, byFinish] of Object.entries(raw)) {
          for (const [finish, pts] of Object.entries(byFinish)) {
            if (pts.length < 15) continue;
            (feats[Number(pidStr)] ??= {})[finish] =
              buildSeriesFeatures(pts);
          }
        }
        setDeepFeatures(feats);
      } catch {
        // Scalar reads stand — the deep pass is a refinement, not a gate.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeInventory]);

  return deepFeatures;
}
