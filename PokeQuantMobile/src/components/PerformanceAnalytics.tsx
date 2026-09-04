import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { FlashList, ViewToken } from '@shopify/flash-list';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { colors } from '../constants/colors';
import { useInventoryStore, type CompletedSale } from '../store/inventoryStore';
import { formatCurrency, formatSignedCurrency } from '../screens/HomeScreen';

const COST_GRAY = '#6e7681';
const COST_DARK = '#30363d';
const PROFIT_GREEN = '#238636';
const REVENUE_GREEN = '#2ea043';
const ITEMS_PURPLE = '#a371f7';

type Horizon = 'today' | '7d' | '30d' | 'all';

const HORIZON_OPTIONS: { key: Horizon; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: 'all', label: 'All' },
];

type Metrics = {
  totalRevenue: number;
  totalCost: number;
  netProfit: number;
  profitMargin: number;
  count: number;
  avgTicket: number;
};

type Bucket = {
  label: string;
  start: Date;
  end: Date;
  revenue: number;
  cost: number;
  profit: number;
  units: number;
};

type TierDef = {
  key: string;
  label: string;
  min?: number;
  max?: number;
};

type Tier = TierDef & {
  revenue: number;
  count: number;
  share: number;
};

function parseSaleDate(dateString: string): Date {
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return new Date();
  return d;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

function formatHourLabel(d: Date): string {
  const h = d.getHours();
  return `${h}:00`;
}

function timeAgo(date: Date, now: Date): string {
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return 'just now';
  const minutes = Math.floor(diffMs / (60 * 1000));
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return '1d ago';
  return `${days}d ago`;
}

function getHorizonStart(
  horizon: Horizon,
  now: Date
): { start: Date; end: Date; count: number } {
  switch (horizon) {
    case 'today': {
      const start = startOfDay(now);
      return { start, end: addDays(start, 1), count: 6 };
    }
    case '7d': {
      const start = addDays(startOfDay(now), -6);
      return { start, end: addDays(start, 7), count: 7 };
    }
    case '30d': {
      const start = addDays(startOfDay(now), -30);
      const end = addDays(startOfDay(now), 1);
      return { start, end, count: 10 };
    }
    case 'all':
    default: {
      return { start: new Date(0), end: now, count: 14 };
    }
  }
}

function createTimeBuckets(start: Date, end: Date, count: number): Bucket[] {
  const rangeMs = end.getTime() - start.getTime();
  if (rangeMs <= 0) {
    return [
      {
        label: formatShortDate(start),
        start,
        end,
        revenue: 0,
        cost: 0,
        profit: 0,
        units: 0,
      },
    ];
  }
  const buckets: Bucket[] = [];
  for (let i = 0; i < count; i++) {
    const bStart = new Date(start.getTime() + (rangeMs * i) / count);
    const bEnd = new Date(start.getTime() + (rangeMs * (i + 1)) / count);
    buckets.push({
      label: formatShortDate(bStart),
      start: bStart,
      end: bEnd,
      revenue: 0,
      cost: 0,
      profit: 0,
      units: 0,
    });
  }
  return buckets;
}

function getBuckets(
  sales: CompletedSale[],
  horizon: Horizon,
  now: Date
): Bucket[] {
  if (sales.length === 0) return [];
  let { start, end, count } = getHorizonStart(horizon, now);

  if (horizon === 'all') {
    const minTime = Math.min(
      ...sales.map((s) => parseSaleDate(s.dateSold).getTime())
    );
    start = startOfDay(new Date(minTime));
    const days = Math.max(
      1,
      Math.ceil((now.getTime() - start.getTime()) / MS_PER_DAY)
    );
    count = Math.min(14, Math.max(7, days));
    end = addDays(start, Math.max(days, count));
  }

  const buckets = createTimeBuckets(start, end, count);

  if (horizon === 'today') {
    buckets.forEach((b) => {
      b.label = formatHourLabel(b.start);
    });
  }

  sales.forEach((sale) => {
    const d = parseSaleDate(sale.dateSold);
    const bucket = buckets.find((b) => d >= b.start && d < b.end);
    if (bucket) {
      bucket.revenue += sale.soldPrice;
      bucket.cost += sale.acquiredCost;
      bucket.units += 1;
    }
  });

  buckets.forEach((b) => {
    b.profit = b.revenue - b.cost;
  });

  return buckets;
}

function calculateMetrics(sales: CompletedSale[]): Metrics {
  const totalRevenue = sales.reduce((sum, s) => sum + s.soldPrice, 0);
  const totalCost = sales.reduce((sum, s) => sum + s.acquiredCost, 0);
  const netProfit = totalRevenue - totalCost;
  const profitMargin =
    totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
  const count = sales.length;
  const avgTicket = count > 0 ? totalRevenue / count : 0;
  return {
    totalRevenue,
    totalCost,
    netProfit,
    profitMargin,
    count,
    avgTicket,
  };
}

function calculateTiers(sales: CompletedSale[]): Tier[] {
  const totalRevenue = sales.reduce((sum, s) => sum + s.soldPrice, 0);
  const defs: TierDef[] = [
    { key: 'budget', label: 'Budget / Singles (< $15)', max: 15 },
    { key: 'mid', label: 'Mid-Tier ($15 – $50)', min: 15, max: 50 },
    { key: 'high', label: 'High-End ($50 – $200)', min: 50, max: 200 },
    { key: 'grail', label: 'Grails / Slab ($200+)', min: 200 },
  ];
  return defs.map((d) => {
    const filtered = sales.filter((s) => {
      if (d.max == null) return s.soldPrice >= (d.min ?? 0);
      if (d.min == null) return s.soldPrice < d.max;
      return s.soldPrice >= d.min && s.soldPrice < d.max;
    });
    const revenue = filtered.reduce((sum, s) => sum + s.soldPrice, 0);
    return {
      ...d,
      revenue,
      count: filtered.length,
      share: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0,
    };
  });
}

function filterByHorizon(
  sales: CompletedSale[],
  horizon: Horizon,
  now: Date
): CompletedSale[] {
  const { start } = getHorizonStart(horizon, now);
  return sales.filter((s) => {
    const d = parseSaleDate(s.dateSold);
    return d.getTime() >= start.getTime() && d.getTime() <= now.getTime();
  });
}

function useDisplaySales(completedSales: CompletedSale[]): CompletedSale[] {
  return useMemo(() => completedSales, [completedSales]);
}

function TimeHorizonFilter({
  horizon,
  onChange,
}: {
  horizon: Horizon;
  onChange: (h: Horizon) => void;
}) {
  return (
    <View style={filterStyles.container}>
      {HORIZON_OPTIONS.map((opt) => {
        const active = horizon === opt.key;
        return (
          <TouchableOpacity
            key={opt.key}
            style={[filterStyles.pill, active && filterStyles.pillActive]}
            activeOpacity={0.7}
            onPress={() => onChange(opt.key)}>
            <Text
              style={[
                filterStyles.pillText,
                active && filterStyles.pillTextActive,
              ]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function HeroKPIs(metrics: Metrics) {
  return (
    <View style={heroStyles.container}>
      <View style={heroStyles.grid}>
        <View style={heroStyles.cardWrapper}>
          <View style={[heroStyles.card, heroStyles.revenueCard]}>
            <Text style={heroStyles.value}>
              {formatCurrency(metrics.totalRevenue)}
            </Text>
            <Text style={heroStyles.label}>Gross Revenue</Text>
          </View>
        </View>
        <View style={heroStyles.cardWrapper}>
          <View style={[heroStyles.card, heroStyles.profitCard]}>
            <Text style={heroStyles.value}>
              {formatSignedCurrency(metrics.netProfit)}
            </Text>
            <View
              style={[
                heroStyles.badge,
                metrics.netProfit < 0 && heroStyles.badgeNegative,
              ]}>
              <Text
                style={[
                  heroStyles.badgeText,
                  metrics.netProfit >= 0
                    ? heroStyles.badgeTextPositive
                    : heroStyles.badgeTextNegative,
                ]}>
                {metrics.profitMargin >= 0 ? '+' : ''}
                {metrics.profitMargin.toFixed(1)}%
              </Text>
            </View>
            <Text style={heroStyles.label}>Net Profit</Text>
          </View>
        </View>
        <View style={heroStyles.cardWrapper}>
          <View style={[heroStyles.card, heroStyles.costCard]}>
            <Text style={heroStyles.value}>
              {formatCurrency(metrics.totalCost)}
            </Text>
            <Text style={heroStyles.label}>Total Cost Basis (COGS)</Text>
          </View>
        </View>
        <View style={heroStyles.cardWrapper}>
          <View style={[heroStyles.card, heroStyles.itemsCard]}>
            <Text style={heroStyles.value}>{metrics.count}</Text>
            <Text style={heroStyles.subValue}>
              Avg {formatCurrency(metrics.avgTicket)}
            </Text>
            <Text style={heroStyles.label}>Items Sold / Avg Ticket</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function VelocityChart({
  buckets,
  width,
}: {
  buckets: Bucket[];
  width: number;
}) {
  const [selected, setSelected] = useState<Bucket | null>(null);
  const chartHeight = 160;
  const max = Math.max(
    1,
    ...buckets.map((b) => Math.max(b.revenue, b.cost))
  );

  if (buckets.length === 0) {
    return (
      <View style={[velocityStyles.empty, { width }]}>
        <Text style={velocityStyles.emptyText}>
          No sales in this horizon
        </Text>
      </View>
    );
  }

  return (
    <View style={{ width }}>
      <View
        style={[velocityStyles.barsContainer, { height: chartHeight }]}>
        {buckets.map((b, i) => {
          const revH = Math.max(4, (b.revenue / max) * (chartHeight - 24));
          const costH = Math.max(4, (b.cost / max) * (chartHeight - 24));
          return (
            <TouchableOpacity
              key={i}
              activeOpacity={0.8}
              style={velocityStyles.barColumn}
              onPress={() => setSelected(b)}>
              <View style={velocityStyles.barPair}>
                <View
                  style={[velocityStyles.revenueBar, { height: revH }]}
                />
                <View style={[velocityStyles.costBar, { height: costH }]} />
              </View>
              <Text style={velocityStyles.xLabel}>{b.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {selected ? (
        <View style={velocityStyles.tooltip}>
          <Text style={velocityStyles.tooltipText}>
            {selected.label}: {formatCurrency(selected.revenue)} revenue,{' '}
            {formatCurrency(selected.cost)} cost, {selected.units} sold
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function MarginWaterfallChart({
  sales,
  width,
}: {
  sales: CompletedSale[];
  width: number;
}) {
  const metrics = useMemo(() => calculateMetrics(sales), [sales]);
  const costShare =
    metrics.totalRevenue > 0
      ? (metrics.totalCost / metrics.totalRevenue) * 100
      : 0;
  const profitShare =
    metrics.totalRevenue > 0
      ? (metrics.netProfit / metrics.totalRevenue) * 100
      : 0;

  if (sales.length === 0) {
    return (
      <View style={[waterfallStyles.empty, { width }]}>
        <Text style={waterfallStyles.emptyText}>
          No sales in this horizon
        </Text>
      </View>
    );
  }

  return (
    <View style={{ width }}>
      <View style={waterfallStyles.track}>
        <View
          style={[
            waterfallStyles.segment,
            {
              width: `${Math.max(0, Math.min(100, costShare))}%`,
              backgroundColor: COST_GRAY,
            },
          ]}
        />
        <View
          style={[
            waterfallStyles.segment,
            {
              width: `${Math.max(0, Math.min(100, profitShare))}%`,
              backgroundColor: PROFIT_GREEN,
            },
          ]}
        />
      </View>
      <View style={waterfallStyles.legend}>
        <View style={waterfallStyles.legendItem}>
          <View
            style={[
              waterfallStyles.legendDot,
              { backgroundColor: COST_GRAY },
            ]}
          />
          <Text style={waterfallStyles.legendText}>
            Cost {formatCurrency(metrics.totalCost)} ({costShare.toFixed(1)}%)
          </Text>
        </View>
        <View style={waterfallStyles.legendItem}>
          <View
            style={[
              waterfallStyles.legendDot,
              { backgroundColor: PROFIT_GREEN },
            ]}
          />
          <Text style={waterfallStyles.legendText}>
            Profit {formatSignedCurrency(metrics.netProfit)} (
            {profitShare.toFixed(1)}%)
          </Text>
        </View>
      </View>
    </View>
  );
}

function TierBreakdownChart({
  tiers,
  width,
}: {
  tiers: Tier[];
  width: number;
}) {
  if (tiers.every((t) => t.count === 0)) {
    return (
      <View style={[tierStyles.empty, { width }]}>
        <Text style={tierStyles.emptyText}>No sales in this horizon</Text>
      </View>
    );
  }

  return (
    <View style={{ width }}>
      {tiers.map((t) => (
        <View key={t.key} style={tierStyles.row}>
          <View style={tierStyles.headerRow}>
            <Text style={tierStyles.label}>{t.label}</Text>
            <Text style={tierStyles.value}>
              {formatCurrency(t.revenue)} · {t.count} cards
            </Text>
          </View>
          <View style={tierStyles.track}>
            <View
              style={[
                tierStyles.fill,
                { width: `${Math.min(100, t.share)}%` },
              ]}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

type ChartSlide = {
  key: string;
  title: string;
  subtitle: string;
  render: () => ReactNode;
};

const CHART_CAROUSEL_HEIGHT = 260;

const ChartSlideItem = memo(function ChartSlideItem({
  slide,
  slideWidth,
}: {
  slide: ChartSlide;
  slideWidth: number;
}) {
  return (
    <View
      style={[
        carouselStyles.slideOuter,
        { width: slideWidth, height: '100%' },
      ]}>
      <Text style={carouselStyles.slideTitle}>{slide.title}</Text>
      <Text style={carouselStyles.slideSubtitle}>{slide.subtitle}</Text>
      {slide.render()}
    </View>
  );
});

function ChartCarousel({
  slideWidth,
  buckets,
  sales,
  tiers,
}: {
  slideWidth: number;
  buckets: Bucket[];
  sales: CompletedSale[];
  tiers: Tier[];
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const contentWidth = Math.max(0, slideWidth - 32);

  const viewabilityConfig = useRef({
    viewAreaCoveragePercentThreshold: 50,
  }).current;

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<ChartSlide>[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index != null) {
        setActiveIndex(viewableItems[0].index);
      }
    }
  ).current;

  const slides: ChartSlide[] = useMemo(
    () => [
      {
        key: 'velocity',
        title: 'Revenue & Profit Velocity',
        subtitle: 'Revenue vs cost by time bucket',
        render: () => <VelocityChart buckets={buckets} width={contentWidth} />,
      },
      {
        key: 'margin',
        title: 'Margin & Acquisition Waterfall',
        subtitle: 'Revenue split between cost and profit',
        render: () => (
          <MarginWaterfallChart sales={sales} width={contentWidth} />
        ),
      },
      {
        key: 'tiers',
        title: 'Sales by Price Tier',
        subtitle: 'Revenue concentration by card tier',
        render: () => <TierBreakdownChart tiers={tiers} width={contentWidth} />,
      },
    ],
    [buckets, contentWidth, sales, tiers]
  );

  const renderItem = useCallback(
    ({ item }: { item: ChartSlide }) => (
      <ChartSlideItem slide={item} slideWidth={slideWidth} />
    ),
    [slideWidth]
  );

  return (
    <View style={carouselStyles.container}>
      <Text style={carouselStyles.heading}>Performance Charts</Text>
      <View
        style={[
          carouselStyles.carousel,
          { width: slideWidth, height: CHART_CAROUSEL_HEIGHT },
        ]}>
        <FlashList
          data={slides}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          nestedScrollEnabled
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          style={{ flex: 1 }}
        />
      </View>
      <View style={carouselStyles.dots}>
        {slides.map((_, i) => (
          <View
            key={i}
            style={[
              carouselStyles.dot,
              i === activeIndex && carouselStyles.dotActive,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const COMPLETED_SALES_LIST_HEIGHT = 420;

const CompletedSaleRow = memo(function CompletedSaleRow({
  sale,
  onUndo,
  isReal,
  now,
}: {
  sale: CompletedSale;
  onUndo: (sale: CompletedSale) => void;
  isReal: boolean;
  now: Date;
}) {
  const profit = sale.soldPrice - sale.acquiredCost;
  const margin =
    sale.acquiredCost > 0 ? (profit / sale.acquiredCost) * 100 : 0;
  const relative = timeAgo(parseSaleDate(sale.dateSold), now);
  const setPart = [sale.set?.toUpperCase(), sale.number]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={streamStyles.row}>
      <View style={streamStyles.leftCol}>
        <Text style={streamStyles.name} numberOfLines={1}>
          {sale.name}
        </Text>
        <Text style={streamStyles.meta}>{setPart || 'Unknown'}</Text>
        <Text style={streamStyles.time}>{relative}</Text>
      </View>
      <View style={streamStyles.rightCol}>
        <Text style={streamStyles.soldPrice}>
          {formatCurrency(sale.soldPrice)}
        </Text>
        <View
          style={[
            streamStyles.badge,
            profit < 0 && streamStyles.badgeNegative,
          ]}>
          <Text
            style={[
              streamStyles.badgeText,
              profit < 0 && streamStyles.badgeTextNegative,
            ]}>
            {formatSignedCurrency(profit)} ({profit >= 0 ? '+' : ''}
            {margin.toFixed(0)}%)
          </Text>
        </View>
        <TouchableOpacity
          style={[
            streamStyles.undoButton,
            !isReal && streamStyles.undoButtonDisabled,
          ]}
          activeOpacity={isReal ? 0.7 : 1}
          onPress={() => isReal && onUndo(sale)}
          disabled={!isReal}>
          <Text
            style={[
              streamStyles.undoText,
              !isReal && streamStyles.undoTextDisabled,
            ]}>
            Undo
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

function CompletedSalesStream({
  sales,
  onUndo,
  realSaleIds,
  now,
}: {
  sales: CompletedSale[];
  onUndo: (sale: CompletedSale) => void;
  realSaleIds: Set<string>;
  now: Date;
}) {
  const renderItem = useCallback(
    ({ item }: { item: CompletedSale }) => (
      <CompletedSaleRow
        sale={item}
        onUndo={onUndo}
        isReal={realSaleIds.has(item.id)}
        now={now}
      />
    ),
    [onUndo, realSaleIds, now]
  );

  return (
    <View style={[streamStyles.card, { height: COMPLETED_SALES_LIST_HEIGHT }]}>
      <Text style={streamStyles.title}>Completed Sales</Text>
      {sales.length === 0 ? (
        <View style={streamStyles.emptyState}>
          <Text style={streamStyles.emptyText}>
            No completed sales in this horizon.
          </Text>
        </View>
      ) : (
        <FlashList
          data={sales}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          nestedScrollEnabled
          contentContainerStyle={streamStyles.listContent}
          ListEmptyComponent={
            <View style={streamStyles.emptyState}>
              <Text style={streamStyles.emptyText}>
                No completed sales in this horizon.
              </Text>
            </View>
          }
          style={{ flex: 1 }}
        />
      )}
    </View>
  );
}

export function PerformanceAnalytics() {
  const { width } = useWindowDimensions();
  const completedSales = useInventoryStore((state) => state.completedSales);
  const undoCompletedSale = useInventoryStore(
    (state) => state.undoCompletedSale
  );
  const [horizon, setHorizon] = useState<Horizon>('7d');
  const [now] = useState(() => new Date());

  const displaySales = useDisplaySales(completedSales);
  const filteredSales = useMemo(
    () => filterByHorizon(displaySales, horizon, now),
    [displaySales, horizon, now]
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
      <TimeHorizonFilter horizon={horizon} onChange={setHorizon} />
      <HeroKPIs {...metrics} />
      <ChartCarousel
        slideWidth={slideWidth}
        buckets={buckets}
        sales={filteredSales}
        tiers={tiers}
      />
      <CompletedSalesStream
        sales={sortedSales}
        onUndo={handleUndo}
        realSaleIds={realSaleIds}
        now={now}
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

const filterStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 16,
  },
  pill: {
    backgroundColor: colors.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 6,
    paddingHorizontal: 14,
    marginHorizontal: 4,
  },
  pillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  pillText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  pillTextActive: {
    color: colors.text,
  },
});

const heroStyles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 16,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cardWrapper: {
    width: '50%',
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  card: {
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    minHeight: 96,
    justifyContent: 'center',
    borderTopWidth: 3,
  },
  revenueCard: {
    borderTopColor: colors.primary,
  },
  profitCard: {
    borderTopColor: REVENUE_GREEN,
  },
  costCard: {
    borderTopColor: COST_GRAY,
  },
  itemsCard: {
    borderTopColor: ITEMS_PURPLE,
  },
  value: {
    color: colors.text,
    fontSize: 20,
    fontWeight: 'bold',
  },
  subValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  label: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 4,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(46, 160, 67, 0.12)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: REVENUE_GREEN,
    paddingVertical: 2,
    paddingHorizontal: 6,
    marginTop: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  badgeTextPositive: {
    color: REVENUE_GREEN,
  },
  badgeTextNegative: {
    color: colors.error,
  },
  badgeNegative: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: colors.error,
  },
});

const carouselStyles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 16,
  },
  heading: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  carousel: {
    alignSelf: 'center',
    overflow: 'hidden',
    borderRadius: 12,
  },
  slideOuter: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  slideTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  slideSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 12,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
    marginHorizontal: 4,
  },
  dotActive: {
    backgroundColor: colors.primary,
  },
});

const velocityStyles = StyleSheet.create({
  barsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  barPair: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  revenueBar: {
    width: 8,
    backgroundColor: REVENUE_GREEN,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    marginRight: 1,
  },
  costBar: {
    width: 8,
    backgroundColor: COST_GRAY,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    marginLeft: 1,
  },
  xLabel: {
    color: colors.textMuted,
    fontSize: 8,
    marginTop: 4,
    textAlign: 'center',
  },
  tooltip: {
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 8,
    marginTop: 12,
  },
  tooltipText: {
    color: colors.text,
    fontSize: 11,
    textAlign: 'center',
  },
  empty: {
    minHeight: 160,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 12,
  },
});

const waterfallStyles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    height: 28,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segment: {
    height: '100%',
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
  },
  legendText: {
    color: colors.textMuted,
    fontSize: 11,
  },
  empty: {
    minHeight: 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 12,
  },
});

const tierStyles = StyleSheet.create({
  row: {
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  label: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  value: {
    color: colors.textMuted,
    fontSize: 11,
  },
  track: {
    height: 10,
    backgroundColor: colors.background,
    borderRadius: 5,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  fill: {
    height: '100%',
    backgroundColor: colors.success,
  },
  empty: {
    minHeight: 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 12,
  },
});

const streamStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    marginBottom: 8,
  },
  leftCol: {
    flex: 1,
    paddingRight: 8,
  },
  rightCol: {
    alignItems: 'flex-end',
  },
  name: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  meta: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  time: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 2,
  },
  soldPrice: {
    color: colors.text,
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  badge: {
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.success,
    paddingVertical: 2,
    paddingHorizontal: 6,
    marginBottom: 6,
  },
  badgeNegative: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: colors.error,
  },
  badgeText: {
    color: colors.success,
    fontSize: 10,
    fontWeight: '600',
  },
  badgeTextNegative: {
    color: colors.error,
  },
  undoButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  undoButtonDisabled: {
    borderColor: colors.border,
  },
  undoText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '600',
  },
  undoTextDisabled: {
    color: colors.textMuted,
  },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  pageButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pageButtonDisabled: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  pageButtonText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  pageButtonTextDisabled: {
    color: colors.textMuted,
  },
  pageText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  listContent: {
    paddingBottom: 8,
  },
  emptyState: {
    minHeight: 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 12,
  },
});
