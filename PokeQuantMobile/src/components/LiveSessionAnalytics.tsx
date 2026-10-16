import { useCallback, useMemo, useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { colors } from '../constants/colors';
import { useInventoryStore, type CompletedSale } from '../store/inventoryStore';
import { formatCurrency } from '../utils/format';
import { SegmentedPills } from './ui/SegmentedPills';

type LiveHorizon = 'day' | 'week' | 'month';

const HORIZON_OPTIONS: { key: LiveHorizon; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

function parseSaleDate(dateString: string): Date {
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return new Date();
  return d;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, days: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + days);
  return result;
}

function formatShortDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

type LivePage = {
  label: string;
  start: Date;
  end: Date;
  revenue: number;
  cost: number;
  profit: number;
};

function buildLivePages(horizon: LiveHorizon, now: Date, sales: CompletedSale[]): LivePage[] {
  const today = startOfDay(now);
  if (horizon === 'day') {
    return Array.from({ length: 30 }, (_, n) => {
      const start = addDays(today, -n);
      const end = addDays(start, 1);
      const filtered = sales.filter((s) => {
        const d = parseSaleDate(s.dateSold);
        return d.getTime() >= start.getTime() && d.getTime() < end.getTime();
      });
      const revenue = filtered.reduce((sum, s) => sum + s.soldPrice, 0);
      const cost = filtered.reduce((sum, s) => sum + s.acquiredCost, 0);
      return {
        label: n === 0 ? 'Today' : formatShortDate(start),
        start,
        end,
        revenue,
        cost,
        profit: revenue - cost,
      };
    });
  }

  const windowDays = horizon === 'week' ? 7 : 30;
  const count = 12;
  return Array.from({ length: count }, (_, n) => {
    const end = addDays(today, -n * windowDays + 1);
    const start = addDays(end, -windowDays);
    const filtered = sales.filter((s) => {
      const d = parseSaleDate(s.dateSold);
      return d.getTime() >= start.getTime() && d.getTime() < end.getTime();
    });
    const revenue = filtered.reduce((sum, s) => sum + s.soldPrice, 0);
    const cost = filtered.reduce((sum, s) => sum + s.acquiredCost, 0);
    const label = `${formatShortDate(start)}-${formatShortDate(addDays(end, -1))}`;
    return {
      label,
      start,
      end,
      revenue,
      cost,
      profit: revenue - cost,
    };
  });
}

export function LiveSessionAnalytics() {
  const completedSales = useInventoryStore((state) => state.completedSales);
  const { width: windowWidth } = useWindowDimensions();
  const pageWidth = windowWidth - 56;

  const [liveHorizon, setLiveHorizon] = useState<LiveHorizon>('day');
  const [liveIndex, setLiveIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const pages = useMemo(
    () => buildLivePages(liveHorizon, new Date(), completedSales),
    [liveHorizon, completedSales],
  );

  const activePage = pages[liveIndex];

  const handleHorizonChange = useCallback((h: LiveHorizon) => {
    setLiveHorizon(h);
    setLiveIndex(0);
    scrollRef.current?.scrollTo({ x: 0, animated: true });
  }, []);

  const handleScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = event.nativeEvent.contentOffset.x;
      const index = Math.round(x / pageWidth);
      setLiveIndex(Math.max(0, Math.min(pages.length - 1, index)));
    },
    [pageWidth, pages.length],
  );

  return (
    <View style={styles.card}>
      <View style={styles.liveHeader}>
        <View>
          <Text style={styles.sectionTitle}>Sales right now</Text>
          <Text style={styles.liveSubtitle}>{activePage?.label ?? ''}</Text>
        </View>
        <SegmentedPills
          tabs={HORIZON_OPTIONS}
          activeTab={liveHorizon}
          onChange={handleHorizonChange}
          style={styles.liveRail}
        />
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScrollEnd}
        snapToInterval={pageWidth}
        decelerationRate="fast"
        snapToAlignment="start"
        style={[styles.liveScrollView, { width: pageWidth }]}
        contentContainerStyle={{ width: pages.length * pageWidth }}
      >
        {pages.map((page, i) => {
          const profitColor = page.profit >= 0 ? colors.success : colors.error;
          return (
            <View key={`${liveHorizon}-${i}`} style={[styles.livePage, { width: pageWidth }]}>
              <View style={styles.analyticsGrid}>
                <View style={styles.analyticsCell}>
                  <Text style={styles.analyticsValue}>{formatCurrency(page.revenue)}</Text>
                  <Text style={styles.analyticsLabel}>Sales</Text>
                </View>

                <View style={styles.analyticsCell}>
                  <Text style={styles.analyticsValue}>{formatCurrency(page.cost)}</Text>
                  <Text style={styles.analyticsLabel}>You paid</Text>
                </View>

                <View style={styles.analyticsCell}>
                  <Text style={[styles.analyticsValue, { color: profitColor }]}>
                    {formatCurrency(page.profit)}
                  </Text>
                  <Text style={styles.analyticsLabel}>Profit</Text>
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.dotRow}>
        {(() => {
          const maxDots = 3;
          const count = Math.min(pages.length, maxDots);
          let start = 0;
          if (pages.length > maxDots) {
            if (liveIndex >= pages.length - 1) {
              start = pages.length - maxDots;
            } else if (liveIndex > 0) {
              start = liveIndex - 1;
            }
          }
          return Array.from({ length: count }).map((_, i) => {
            const pageIndex = start + i;
            const active = pageIndex === liveIndex;
            const isFaded =
              !active &&
              ((i === 0 && start > 0) || (i === count - 1 && pageIndex < pages.length - 1));
            return (
              <View
                key={`dot-${liveHorizon}-${pageIndex}`}
                style={[styles.dot, active && styles.dotActive, isFaded && styles.dotMore]}
              />
            );
          });
        })()}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.overlay2,
    borderRadius: 16,
    padding: 10,
    marginBottom: 12,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  analyticsGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  analyticsCell: {
    flex: 1,
    backgroundColor: colors.overlay3,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  analyticsValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  analyticsLabel: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
  },
  liveHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  liveSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  liveRail: {
    marginVertical: 0,
    alignSelf: 'flex-end',
  },
  liveScrollView: {
    height: 110,
  },
  livePage: {
    height: 110,
    justifyContent: 'center',
  },
  dotRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  dotActive: {
    backgroundColor: colors.primary,
  },
  dotMore: {
    opacity: 0.35,
  },
});
