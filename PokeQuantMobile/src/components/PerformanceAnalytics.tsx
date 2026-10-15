// PerformanceAnalytics — composition shell. The math lives in
// services/salesAnalytics, the DB lookups in useAnalyticsLookups, and
// the charts/rows in components/analytics/* (each owning its
// namespaced stylesheet; palette.ts owns the semantic colors).
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useInventoryStore, type CompletedSale } from '../store/inventoryStore';
import { TimeHorizonFilter } from './analytics/TimeHorizonFilter';
import { HeroKPIs } from './analytics/HeroKPIs';
import { ChartCarousel } from './analytics/ChartCarousel';
import { CompletedSalesStream } from './analytics/CompletedSalesStream';
import { ReadTrackRecord } from './analytics/ReadTrackRecord';
import { useAnalyticsLookups } from '../hooks/useAnalyticsLookups';
import {
  calculateMetrics,
  calculateTiers,
  filterByHorizon,
  getBuckets,
  parseSaleDate,
  type Horizon,
} from '../services/salesAnalytics';

export function PerformanceAnalytics() {
  const { width } = useWindowDimensions();
  const completedSales = useInventoryStore((state) => state.completedSales);
  const undoCompletedSale = useInventoryStore(
    (state) => state.undoCompletedSale
  );
  const [horizon, setHorizon] = useState<Horizon>('7d');
  const [now] = useState(() => new Date());

  const filteredSales = useMemo(
    () => filterByHorizon(completedSales, horizon, now),
    [completedSales, horizon, now]
  );
  const sortedSales = useMemo(
    () =>
      [...filteredSales].sort(
        (a, b) =>
          parseSaleDate(b.dateSold).getTime() -
          parseSaleDate(a.dateSold).getTime()
      ),
    [filteredSales]
  );

  const metrics = useMemo(
    () => calculateMetrics(filteredSales),
    [filteredSales]
  );
  const buckets = useMemo(
    () => getBuckets(filteredSales, horizon, now),
    [filteredSales, horizon, now]
  );
  const tiers = useMemo(
    () => calculateTiers(filteredSales),
    [filteredSales]
  );
  const realSaleIds = useMemo(
    () => new Set(completedSales.map((s) => s.id)),
    [completedSales]
  );

  const { tradeByInvId, trackRecord } = useAnalyticsLookups(completedSales);

  const handleUndo = useCallback(
    (sale: CompletedSale) => {
      if (realSaleIds.has(sale.id)) {
        undoCompletedSale(sale);
      }
    },
    [realSaleIds, undoCompletedSale]
  );

  const slideWidth = Math.max(0, width - 32);

  return (
    <View style={styles.container}>
      <HeroKPIs {...metrics} />
      <TimeHorizonFilter horizon={horizon} onChange={setHorizon} />
      <ChartCarousel
        slideWidth={slideWidth}
        buckets={buckets}
        sales={filteredSales}
        tiers={tiers}
      />
      <ReadTrackRecord rows={trackRecord} />
      <CompletedSalesStream
        sales={sortedSales}
        onUndo={handleUndo}
        realSaleIds={realSaleIds}
        now={now}
        tradeByInvId={tradeByInvId}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  container: {
    paddingTop: 12,
    paddingBottom: 24,
  },
});

