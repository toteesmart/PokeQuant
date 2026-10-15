// useAnalyticsLookups — the two DB reads behind PerformanceAnalytics:
// trade-evaluator tags for sold rows (getTradeLogByInventoryIds) and
// the per-class read track record (getClassTrackRecord). Both keyed on
// the completedSales set; cancelled guards drop stale loads.
import { useEffect, useState } from 'react';
import { getDatabase } from '../db/database';
import {
  getTradeLogByInventoryIds,
  type TradeLogSummary,
} from '../scanner/services/deal/tradeLogDb';
import {
  getClassTrackRecord,
  type ClassTrackRecord,
} from '../scanner/services/deal/dealGradeDb';
import type { CompletedSale } from '../store/inventoryStore';

export function useAnalyticsLookups(completedSales: CompletedSale[]) {
  // Trade context for sold rows — outgoing cards sold via the trade
  // evaluator get a "Traded · WIN/NEUTRAL/RISKY" tag.
  const [tradeByInvId, setTradeByInvId] = useState<
    Map<string, TradeLogSummary>
  >(new Map());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = getDatabase();
      if (!db || completedSales.length === 0) return;
      const map = await getTradeLogByInventoryIds(
        db,
        completedSales.map((s) => s.id)
      );
      if (!cancelled) setTradeByInvId(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [completedSales]);

  // Read track record — what each deal class (stamped when the card hit
  // inventory) actually did once sold. Local-only honesty, not a promise.
  const [trackRecord, setTrackRecord] = useState<ClassTrackRecord[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = getDatabase();
      if (!db) return;
      const rows = await getClassTrackRecord(db);
      if (!cancelled) setTrackRecord(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [completedSales]);

  return { tradeByInvId, trackRecord };
}
