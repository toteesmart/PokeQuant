import { useMemo, useRef, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type ViewToken,
} from 'react-native';
import { colors } from '../constants/colors';
import { useInventory, type CompletedSale } from '../context/InventoryContext';
import { formatCurrency, formatSignedCurrency } from '../screens/HomeScreen';

const COST_COLOR = '#1e40af';
const REVENUE_COLOR = '#60a5fa';

const GROWTH_DATA = [
  { date: '08/28', value: 0 },
  { date: '08/29', value: 1.2 },
  { date: '08/30', value: 2.5 },
  { date: '08/31', value: 3.1 },
  { date: '09/01', value: 4.46 },
];

const DAILY_DATA = [
  { date: '08/28', cost: 2.0, revenue: 3.5 },
  { date: '08/29', cost: 1.5, revenue: 2.8 },
  { date: '08/30', cost: 0.0, revenue: 0.0 },
  { date: '08/31', cost: 1.54, revenue: 4.2 },
  { date: '09/01', cost: 5.54, revenue: 10.0 },
];

type ChartSlide = {
  key: string;
  title: string;
  subtitle: string;
  Component: React.FC<{ width: number }>;
};

const CHART_SLIDES: ChartSlide[] = [
  {
    key: 'growth',
    title: 'Performance Growth & Revenue Timeline',
    subtitle: 'Cumulative Net Profit Over Time ($)',
    Component: GrowthSlide,
  },
  {
    key: 'revenue',
    title: 'Daily Revenue vs Cost Basis',
    subtitle: 'Daily Revenue vs Daily Cost Basis ($)',
    Component: RevenueCostSlide,
  },
];

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <View style={metricStyles.box}>
      <Text style={metricStyles.value}>{value}</Text>
      <Text style={metricStyles.label}>{label}</Text>
    </View>
  );
}

function AnalyticsMetrics({
  totalRevenue,
  realizedProfit,
  profitMargin,
  assetsSold,
}: {
  totalRevenue: number;
  realizedProfit: number;
  profitMargin: number;
  assetsSold: number;
}) {
  return (
    <View style={metricStyles.container}>
      <View style={metricStyles.grid}>
        <MetricBox label="Total Revenue" value={formatCurrency(totalRevenue)} />
        <MetricBox
          label="Realized Profit"
          value={formatCurrency(realizedProfit)}
        />
        <MetricBox
          label="Profit Margin"
          value={`${profitMargin.toFixed(1)}%`}
        />
        <MetricBox label="Assets Sold" value={String(assetsSold)} />
      </View>
    </View>
  );
}

function GrowthSlide({ width }: { width: number }) {
  const chartHeight = 180;
  const max = Math.max(...GROWTH_DATA.map((d) => d.value), 1);

  return (
    <View style={[chartStyles.slide, { width }]}>
      <View style={chartStyles.yAxis}>
        <Text style={chartStyles.yLabel}>{max.toFixed(2)}</Text>
        <Text style={chartStyles.yLabel}>0</Text>
      </View>
      <View style={[chartStyles.barsContainer, { height: chartHeight }]}>
        {GROWTH_DATA.map((d, i) => {
          const pct = d.value / max;
          const barHeight = Math.max(4, pct * (chartHeight - 24));
          return (
            <View key={i} style={chartStyles.barColumn}>
              <View style={[chartStyles.growthBar, { height: barHeight }]}>
                <View style={chartStyles.growthDot} />
              </View>
              <Text style={chartStyles.xLabel}>{d.date}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function RevenueCostSlide({ width }: { width: number }) {
  const chartHeight = 160;
  const max = Math.max(
    ...DAILY_DATA.map((d) => Math.max(d.cost, d.revenue)),
    1
  );

  return (
    <View style={[chartStyles.slide, { width }]}>
      <View style={chartStyles.barsContainer}>
        {DAILY_DATA.map((d, i) => {
          const costHeight = Math.max(4, (d.cost / max) * chartHeight);
          const revenueHeight = Math.max(4, (d.revenue / max) * chartHeight);
          return (
            <View key={i} style={chartStyles.dailyColumn}>
              <View
                style={[
                  chartStyles.dailyBarPair,
                  { height: chartHeight },
                ]}>
                <View
                  style={[
                    chartStyles.costBar,
                    { height: costHeight },
                  ]}
                />
                <View
                  style={[
                    chartStyles.revenueBar,
                    { height: revenueHeight },
                  ]}
                />
              </View>
              <Text style={chartStyles.xLabel}>{d.date}</Text>
            </View>
          );
        })}
      </View>
      <View style={chartStyles.legend}>
        <View style={chartStyles.legendItem}>
          <Text style={[chartStyles.legendDot, { color: COST_COLOR }]}>■</Text>
          <Text style={chartStyles.legendText}>Daily Cost</Text>
        </View>
        <View style={chartStyles.legendItem}>
          <Text style={[chartStyles.legendDot, { color: REVENUE_COLOR }]}>
            ■
          </Text>
          <Text style={chartStyles.legendText}>Daily Revenue</Text>
        </View>
      </View>
    </View>
  );
}

function ChartCarousel({ slideWidth }: { slideWidth: number }) {
  const [activeIndex, setActiveIndex] = useState(0);

  const viewabilityConfig = useRef({
    viewAreaCoveragePercentThreshold: 50,
  }).current;

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index != null) {
        setActiveIndex(viewableItems[0].index);
      }
    }
  ).current;

  return (
    <View style={carouselStyles.container}>
      <Text style={carouselStyles.heading}>Performance Charts</Text>
      <View style={[carouselStyles.carousel, { width: slideWidth }]}>
        <FlatList
          data={CHART_SLIDES}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          nestedScrollEnabled
          getItemLayout={(_, index) => ({
            length: slideWidth,
            offset: slideWidth * index,
            index,
          })}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) => {
            const Slide = item.Component;
            return (
              <View style={[carouselStyles.slideOuter, { width: slideWidth }]}>
                <Text style={carouselStyles.slideTitle}>{item.title}</Text>
                <Text style={carouselStyles.slideSubtitle}>
                  {item.subtitle}
                </Text>
                <Slide width={slideWidth - 32} />
              </View>
            );
          }}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
        />
      </View>
      <View style={carouselStyles.dots}>
        {CHART_SLIDES.map((_, i) => (
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

function CompletedLogRow({
  sale,
  onUndo,
}: {
  sale: CompletedSale;
  onUndo: (sale: CompletedSale) => void;
}) {
  const profit = sale.soldPrice - sale.acquiredCost;
  const margin =
    sale.acquiredCost > 0 ? (profit / sale.acquiredCost) * 100 : 0;
  const numberPart = sale.number ? `(${sale.number})` : '';
  const line = `${sale.name} ${sale.set || ''} ${numberPart} - ${
    sale.condition || 'Unknown'
  } | Sold on: ${sale.dateSold}`;

  return (
    <View style={logStyles.row}>
      <View style={logStyles.col}>
        <Text style={logStyles.name} numberOfLines={2}>
          {line}
        </Text>
      </View>
      <View style={logStyles.col}>
        <Text style={logStyles.label}>
          Acquired:{' '}
          <Text style={logStyles.value}>
            {formatCurrency(sale.acquiredCost)}
          </Text>
        </Text>
        <Text style={logStyles.label}>
          Value:{' '}
          <Text style={logStyles.value}>
            {formatCurrency(sale.soldPrice)}
          </Text>
        </Text>
      </View>
      <View style={logStyles.rightCol}>
        <Text style={logStyles.profit}>
          Profit: {formatSignedCurrency(profit)} ({profit >= 0 ? '+' : ''}
          {margin.toFixed(1)}%)
        </Text>
        <TouchableOpacity
          style={logStyles.undoButton}
          activeOpacity={0.7}
          onPress={() => onUndo(sale)}>
          <Text style={logStyles.undoText}>Undo</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const ITEMS_PER_PAGE = 3;

function CompletedLog() {
  const { completedSales, undoCompletedSale } = useInventory();
  const [page, setPage] = useState(0);

  const totalPages = Math.max(
    1,
    Math.ceil(completedSales.length / ITEMS_PER_PAGE)
  );
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = completedSales.slice(
    safePage * ITEMS_PER_PAGE,
    (safePage + 1) * ITEMS_PER_PAGE
  );

  const goPrev = () => setPage((p) => Math.max(0, p - 1));
  const goNext = () =>
    setPage((p) => Math.min(totalPages - 1, p + 1));

  return (
    <View style={logStyles.card}>
      <View style={logStyles.header}>
        <Text style={logStyles.title}>Completed Log</Text>
        <Text style={logStyles.subtitle}>
          Review individual transactions or undo accidental actions.
        </Text>
      </View>

      {pageItems.map((sale) => (
        <CompletedLogRow
          key={sale.id}
          sale={sale}
          onUndo={undoCompletedSale}
        />
      ))}

      <View style={logStyles.pagination}>
        <TouchableOpacity
          style={[
            logStyles.pageButton,
            safePage === 0 && logStyles.pageButtonDisabled,
          ]}
          activeOpacity={safePage === 0 ? 1 : 0.7}
          onPress={goPrev}
          disabled={safePage === 0}>
          <Text
            style={[
              logStyles.pageButtonText,
              safePage === 0 && logStyles.pageButtonTextDisabled,
            ]}>
            ← Previous
          </Text>
        </TouchableOpacity>

        <Text style={logStyles.pageText}>
          Page {safePage + 1} of {totalPages}
        </Text>

        <TouchableOpacity
          style={[
            logStyles.pageButton,
            safePage === totalPages - 1 && logStyles.pageButtonDisabled,
          ]}
          activeOpacity={safePage === totalPages - 1 ? 1 : 0.7}
          onPress={goNext}
          disabled={safePage === totalPages - 1}>
          <Text
            style={[
              logStyles.pageButtonText,
              safePage === totalPages - 1 &&
                logStyles.pageButtonTextDisabled,
            ]}>
            Next →
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function PerformanceAnalytics() {
  const { width } = useWindowDimensions();
  const { completedSales } = useInventory();

  const metrics = useMemo(() => {
    const totalRevenue = completedSales.reduce(
      (sum, s) => sum + s.soldPrice,
      0
    );
    const totalCost = completedSales.reduce(
      (sum, s) => sum + s.acquiredCost,
      0
    );
    const realizedProfit = totalRevenue - totalCost;
    const profitMargin =
      totalRevenue > 0 ? (realizedProfit / totalRevenue) * 100 : 0;
    return {
      totalRevenue,
      realizedProfit,
      profitMargin,
      assetsSold: completedSales.length,
    };
  }, [completedSales]);

  const slideWidth = Math.max(0, width - 32);

  return (
    <View style={styles.container}>
      <AnalyticsMetrics {...metrics} />
      <ChartCarousel slideWidth={slideWidth} />
      <CompletedLog />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 12,
    paddingBottom: 24,
  },
});

const metricStyles = StyleSheet.create({
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
  box: {
    width: '50%',
    alignItems: 'center',
    paddingVertical: 8,
  },
  value: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  label: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
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

const chartStyles = StyleSheet.create({
  slide: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  yAxis: {
    justifyContent: 'space-between',
    height: 180,
    marginRight: 6,
  },
  yLabel: {
    color: colors.textMuted,
    fontSize: 10,
  },
  barsContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
  },
  growthBar: {
    width: 28,
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    borderTopWidth: 2,
    borderTopColor: colors.primary,
    borderRadius: 4,
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  growthDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginTop: -5,
  },
  xLabel: {
    color: colors.textMuted,
    fontSize: 9,
    marginTop: 6,
  },
  dailyColumn: {
    flex: 1,
    alignItems: 'center',
  },
  dailyBarPair: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  costBar: {
    width: 14,
    backgroundColor: COST_COLOR,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    marginRight: 4,
  },
  revenueBar: {
    width: 14,
    backgroundColor: REVENUE_COLOR,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  legend: {
    flexDirection: 'row',
    marginTop: 16,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
  },
  legendDot: {
    fontSize: 12,
    marginRight: 4,
  },
  legendText: {
    color: colors.textMuted,
    fontSize: 11,
  },
});

const logStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  header: {
    marginBottom: 12,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  row: {
    flexDirection: 'row',
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    marginBottom: 10,
    alignItems: 'center',
  },
  col: {
    flex: 1,
    paddingHorizontal: 2,
  },
  rightCol: {
    flex: 1,
    alignItems: 'flex-end',
    paddingHorizontal: 2,
  },
  name: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
  },
  label: {
    color: colors.textMuted,
    fontSize: 10,
    marginBottom: 2,
  },
  value: {
    color: colors.text,
    fontSize: 10,
    fontWeight: 'bold',
  },
  profit: {
    color: colors.success,
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 4,
    textAlign: 'right',
  },
  undoButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  undoText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '600',
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
    backgroundColor: colors.surfaceLight,
  },
  pageButtonDisabled: {
    backgroundColor: 'transparent',
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
});
