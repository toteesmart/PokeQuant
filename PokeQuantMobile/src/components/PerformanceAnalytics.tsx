import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { FlashList, ViewToken } from '@shopify/flash-list';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { colors } from '../constants/colors';
import { layout, radius, spacing, type_, weight } from '../constants/theme';
import { SegmentedPills } from './ui/SegmentedPills';
import { useInventoryStore, type CompletedSale } from '../store/inventoryStore';
import { formatCurrency, formatSignedCurrency } from '../utils/format';
import { getDatabase } from '../db/database';
import {
  getTradeLogByInventoryIds,
  type TradeLogSummary,
} from '../scanner/services/deal/tradeLogDb';
import {
  getClassTrackRecord,
  type ClassTrackRecord,
} from '../scanner/services/deal/dealGradeDb';
import {
  classLabel,
  type DealClassId,
} from '../scanner/services/deal/dealClassify';
import { SetBadge } from './SetBadge';
import { displayCardName } from '../scanner/services/catalog/catalogMatcher';

const COST_GRAY = colors.textMuted;
const COST_DARK = colors.border;
const PROFIT_GREEN = colors.success;
const REVENUE_GREEN = colors.chartGreen;
const ITEMS_PURPLE = colors.accentPurple;

type Horizon = 'today' | '7d' | '30d' | 'all';

const HORIZON_OPTIONS: { key: Horizon; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'all', label: 'All time' },
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
  if (minutes < 60) return `${minutes} min ago`;
  if (hours < 24) return `${hours} hr ago`;
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
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

function TimeHorizonFilter({
  horizon,
  onChange,
}: {
  horizon: Horizon;
  onChange: (h: Horizon) => void;
}) {
  return (
    <SegmentedPills
      tabs={HORIZON_OPTIONS}
      activeTab={horizon}
      onChange={onChange}
      style={filterStyles.rail}
    />
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
            <Text style={heroStyles.label}>Total sales</Text>
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
            <Text style={heroStyles.label}>Profit</Text>
          </View>
        </View>
        <View style={heroStyles.cardWrapper}>
          <View style={[heroStyles.card, heroStyles.costCard]}>
            <Text style={heroStyles.value}>
              {formatCurrency(metrics.totalCost)}
            </Text>
            <Text style={heroStyles.label}>What you paid</Text>
          </View>
        </View>
        <View style={heroStyles.cardWrapper}>
          <View style={[heroStyles.card, heroStyles.itemsCard]}>
            <Text style={heroStyles.value}>{metrics.count}</Text>
            <Text style={heroStyles.subValue}>
              Avg {formatCurrency(metrics.avgTicket)}
            </Text>
            <Text style={heroStyles.label}>Sold / avg sale</Text>
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
  const chartHeight = 120;
  const max = Math.max(
    1,
    ...buckets.map((b) => Math.max(b.revenue, b.cost))
  );

  if (buckets.length === 0) {
    return (
      <View style={[velocityStyles.empty, { width }]}>
        <Text style={velocityStyles.emptyText}>
          No sales in this period
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
            {selected.label}: {formatCurrency(selected.revenue)} in sales,{' '}
            {formatCurrency(selected.cost)} paid, {selected.units} sold
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
          No sales in this period
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
        <Text style={tierStyles.emptyText}>No sales in this period</Text>
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

const CHART_CAROUSEL_HEIGHT = 220;

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
        title: 'Sales pace',
        subtitle: 'Total sales vs what you paid, over time',
        render: () => <VelocityChart buckets={buckets} width={contentWidth} />,
      },
      {
        key: 'margin',
        title: 'Cost vs profit',
        subtitle: 'Where each sale dollar goes',
        render: () => (
          <MarginWaterfallChart sales={sales} width={contentWidth} />
        ),
      },
      {
        key: 'tiers',
        title: 'Sales by price band',
        subtitle: 'Where your sales money comes from',
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
      <Text style={carouselStyles.heading}>Sales charts</Text>
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

const COMPLETED_SALES_PAGE_SIZE = 5;
const COMPLETED_SALES_ROW_HEIGHT = 74;
const COMPLETED_SALES_HEADER_HEIGHT = 50;

const CompletedSaleRow = memo(function CompletedSaleRow({
  sale,
  onUndo,
  isReal,
  now,
  trade,
}: {
  sale: CompletedSale;
  onUndo: (sale: CompletedSale) => void;
  isReal: boolean;
  now: Date;
  trade?: TradeLogSummary;
}) {
  const profit = sale.soldPrice - sale.acquiredCost;
  const margin =
    sale.acquiredCost > 0 ? (profit / sale.acquiredCost) * 100 : 0;
  const relative = timeAgo(parseSaleDate(sale.dateSold), now);
  const tradeColor =
    trade?.verdict === 'win'
      ? PROFIT_GREEN
      : trade?.verdict === 'lose'
        ? colors.warning
        : COST_GRAY;

  return (
    <View style={streamStyles.row}>
      <View style={streamStyles.leftCol}>
        <Text style={streamStyles.name} numberOfLines={1}>
          {displayCardName(sale.name)}
        </Text>
        {sale.set ? (
          <SetBadge set={sale.set} style={streamStyles.setBadge} />
        ) : null}
        <Text style={streamStyles.meta}>{sale.number || 'Unknown'}</Text>
        {trade ? (
          <Text
            style={[streamStyles.tradeTag, { color: tradeColor }]}
            numberOfLines={1}
          >
            {trade.reason || 'Traded'}
          </Text>
        ) : null}
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
  tradeByInvId,
}: {
  sales: CompletedSale[];
  onUndo: (sale: CompletedSale) => void;
  realSaleIds: Set<string>;
  now: Date;
  tradeByInvId: Map<string, TradeLogSummary>;
}) {
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [activePage, setActivePage] = useState(0);
  const pageWidth = Math.max(0, width - 32);

  const pages = useMemo(() => {
    const result: CompletedSale[][] = [];
    for (let i = 0; i < sales.length; i += COMPLETED_SALES_PAGE_SIZE) {
      result.push(sales.slice(i, i + COMPLETED_SALES_PAGE_SIZE));
    }
    return result;
  }, [sales]);

  const maxItemsOnFirstPage = Math.min(
    COMPLETED_SALES_PAGE_SIZE,
    sales.length
  );
  const cardHeight =
    COMPLETED_SALES_HEADER_HEIGHT +
    maxItemsOnFirstPage * COMPLETED_SALES_ROW_HEIGHT;

  useEffect(() => {
    setActivePage(0);
    scrollRef.current?.scrollTo({ x: 0, animated: false });
  }, [sales]);

  if (sales.length === 0) {
    return (
      <View style={[streamStyles.card, { minHeight: cardHeight }]}>
        <Text style={streamStyles.title}>Your sales</Text>
        <View style={streamStyles.emptyState}>
          <Text style={streamStyles.emptyText}>
            No sales in this period yet.
          </Text>
        </View>
      </View>
    );
  }

  if (sales.length <= COMPLETED_SALES_PAGE_SIZE) {
    return (
      <View style={[streamStyles.card, { minHeight: cardHeight }]}>
        <Text style={streamStyles.title}>Your sales</Text>
        {sales.map((sale) => (
          <CompletedSaleRow
            key={sale.id}
            sale={sale}
            onUndo={onUndo}
            isReal={realSaleIds.has(sale.id)}
            now={now}
            trade={tradeByInvId.get(sale.id)}
          />
        ))}
      </View>
    );
  }

  return (
    <View style={[streamStyles.card, { minHeight: cardHeight }]}>
      <Text style={streamStyles.title}>Your sales</Text>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        nestedScrollEnabled
        onMomentumScrollEnd={(e) => {
          const page = Math.round(
            e.nativeEvent.contentOffset.x / pageWidth
          );
          setActivePage(Math.max(0, Math.min(page, pages.length - 1)));
        }}
        contentContainerStyle={{ width: pageWidth * pages.length }}
        style={{
          alignSelf: 'center',
          width: pageWidth,
          height: COMPLETED_SALES_PAGE_SIZE * COMPLETED_SALES_ROW_HEIGHT,
        }}
      >
        {pages.map((page, pageIndex) => (
          <View key={pageIndex} style={{ width: pageWidth, height: '100%' }}>
            {page.map((sale) => (
              <CompletedSaleRow
                key={sale.id}
                sale={sale}
                onUndo={onUndo}
                isReal={realSaleIds.has(sale.id)}
                now={now}
                trade={tradeByInvId.get(sale.id)}
              />
            ))}
          </View>
        ))}
      </ScrollView>
      <View style={carouselStyles.dots}>
        {pages.map((_, i) => (
          <View
            key={i}
            style={[
              carouselStyles.dot,
              i === activePage && carouselStyles.dotActive,
            ]}
          />
        ))}
      </View>
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

  const handleUndo = useCallback(
    (sale: CompletedSale) => {
      if (realSaleIds.has(sale.id)) {
        undoCompletedSale(sale);
      }
    },
    [realSaleIds, undoCompletedSale]
  );

  const slideWidth = Math.max(0, width - 32);

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

/** Per-class outcome record — "when the read said X at add-time, what
 *  did the card actually do?" Honest counts only; small samples flagged. */
function ReadTrackRecord({ rows }: { rows: ClassTrackRecord[] }) {
  const graded = rows.reduce((n, r) => n + r.graded, 0);
  const open = rows.reduce((n, r) => n + (r.graded - r.sold), 0);
  if (graded === 0) return null;
  return (
    <View style={trackStyles.card}>
      <Text style={trackStyles.title}>Read track record</Text>
      <Text style={trackStyles.sub}>
        What the price read said when you stocked it vs how the sale went.
      </Text>
      {rows.map((r) => {
        const label = classLabel(r.dealClass as DealClassId) ?? r.dealClass;
        const hitRate = r.sold > 0 ? Math.round((r.wins / r.sold) * 100) : null;
        return (
          <View key={r.dealClass} style={trackStyles.row}>
            <Text style={trackStyles.cls} numberOfLines={1}>
              {label}
            </Text>
            <Text style={trackStyles.stat} numberOfLines={1}>
              {r.sold > 0
                ? `${r.sold}/${r.graded} sold · ${hitRate}% over cost` +
                  (r.avgMargin != null
                    ? ` · avg ${r.avgMargin >= 0 ? '+' : '−'}$${Math.abs(r.avgMargin).toFixed(0)}`
                    : '')
                : `${r.graded} in stock — none sold yet`}
              {r.sold > 0 && r.sold < 5 ? ' · small sample' : ''}
            </Text>
          </View>
        );
      })}
      {open > 0 ? (
        <Text style={trackStyles.foot}>
          {open} rated card{open === 1 ? '' : 's'} still in stock — no sale yet.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 12,
    paddingBottom: 24,
  },
});

const trackStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.overlay2,
    borderRadius: radius.cardLg,
    padding: layout.cardPadding,
    marginBottom: layout.gridGap,
  },
  title: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  sub: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 2,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    gap: 10,
  },
  cls: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
    width: 110,
    flexShrink: 0,
  },
  stat: {
    color: colors.textMuted,
    fontSize: 11,
    flex: 1,
  },
  foot: {
    color: colors.textMuted,
    fontSize: 10,
    fontStyle: 'italic',
    marginTop: 6,
  },
});

const filterStyles = StyleSheet.create({
  rail: {
    marginTop: 0,
    marginBottom: spacing['4xl'],
  },
});

const heroStyles = StyleSheet.create({
  container: {
    backgroundColor: colors.overlay2,
    borderRadius: radius.cardLg,
    padding: layout.cardPadding,
    marginBottom: spacing['4xl'],
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
  // KPI cell — inset tile, the colored top edge IS the accent bar.
  card: {
    backgroundColor: colors.overlay3,
    borderRadius: radius.card,
    padding: spacing.xl,
    minHeight: 76,
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
    fontSize: 18,
    fontWeight: '700',
  },
  subValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  label: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.chartGreenTint,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: REVENUE_GREEN,
    paddingVertical: 2,
    paddingHorizontal: 6,
    marginTop: 2,
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
    backgroundColor: colors.errorTint,
    borderColor: colors.error,
  },
});

const carouselStyles = StyleSheet.create({
  container: {
    backgroundColor: colors.overlay2,
    borderRadius: radius.cardLg,
    padding: spacing.xl,
    marginBottom: spacing['4xl'],
  },
  heading: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  carousel: {
    alignSelf: 'center',
    overflow: 'hidden',
    borderRadius: radius.card,
  },
  slideOuter: {
    paddingHorizontal: 16,
    paddingTop: 4,
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
    paddingTop: 4,
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
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    marginRight: 1,
  },
  costBar: {
    width: 8,
    backgroundColor: COST_GRAY,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    marginLeft: 1,
  },
  xLabel: {
    color: colors.textMuted,
    fontSize: 9,
    marginTop: 4,
    textAlign: 'center',
  },
  tooltip: {
    backgroundColor: colors.overlay3,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginTop: spacing['3xl'],
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
    height: 24,
    borderRadius: radius.control,
    overflow: 'hidden',
    backgroundColor: colors.overlay4,
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
    borderRadius: 6,
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
    marginBottom: 10,
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
    height: 8,
    backgroundColor: colors.overlay4,
    borderRadius: radius.badge,
    overflow: 'hidden',
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
    backgroundColor: colors.overlay2,
    borderRadius: radius.cardLg,
    padding: layout.cardPadding,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.overlay3,
    borderRadius: radius.card,
    padding: spacing.xl,
    marginBottom: spacing.lg,
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
  setBadge: {
    marginTop: 3,
  },
  time: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 2,
  },
  tradeTag: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  soldPrice: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  badge: {
    backgroundColor: colors.successTint,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.success,
    paddingVertical: 2,
    paddingHorizontal: 6,
    marginBottom: 6,
  },
  badgeNegative: {
    backgroundColor: colors.errorTint,
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
    backgroundColor: colors.primaryTint,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing['3xl'],
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
