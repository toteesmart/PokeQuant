import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  FlatList,
  LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { colors } from '../constants/colors';
import { InventoryCard } from '../components/InventoryCard';
import {
  useInventory,
  type InventoryCard as InventoryCardType,
} from '../context/InventoryContext';
import {
  MiniMoverCard,
  formatCurrency,
  formatSignedCurrency,
  type Period,
  type Mover,
  type VelocityWindow,
} from './HomeScreen';
import {
  openCatalogDatabase,
  getProductMarketData,
  type ProductMarketMap,
} from '../db/catalogDb';
import {
  SegmentedTabBar,
  type InventoryTab,
} from '../components/SegmentedTabBar';
import { InventoryActionTrays } from '../components/InventoryActionTrays';
import { PerformanceAnalytics } from '../components/PerformanceAnalytics';
import { EditAssetModal } from '../components/EditAssetModal';
import { useVendorSettings } from '../context/VendorSettingsContext';

type Card = InventoryCardType;

const METRICS = {
  activeAssets: 0,
  totalCostBasis: 0,
  projectedSticker: 0,
  projectedProfit: 0,
  profit24h: 0,
};

function QuickViewPanel({
  metrics,
}: {
  metrics: typeof METRICS;
}) {
  const profitColor = metrics.profit24h >= 0 ? colors.success : colors.error;
  const profitBg =
    metrics.profit24h >= 0
      ? 'rgba(34, 197, 94, 0.15)'
      : 'rgba(239, 68, 68, 0.15)';

  return (
    <View style={quickViewStyles.container}>
      <View style={quickViewStyles.header}>
        <Text style={quickViewStyles.title}>Active Inventory</Text>
      </View>

      <View style={quickViewStyles.stats}>
        <View style={quickViewStyles.stat}>
          <Text style={quickViewStyles.statValue}>{metrics.activeAssets}</Text>
          <Text style={quickViewStyles.statLabel}>Active</Text>
        </View>
        <View style={quickViewStyles.stat}>
          <Text style={quickViewStyles.statValue}>
            {formatCurrency(metrics.totalCostBasis)}
          </Text>
          <Text style={quickViewStyles.statLabel}>Cost Basis</Text>
        </View>
        <View style={quickViewStyles.stat}>
          <Text style={quickViewStyles.statValue}>
            {formatCurrency(metrics.projectedSticker)}
          </Text>
          <Text style={quickViewStyles.statLabel}>Sticker Price</Text>
        </View>
        <View style={[quickViewStyles.stat, quickViewStyles.profitStat]}>
          <View style={quickViewStyles.statText}>
            <Text style={quickViewStyles.statValue}>
              {formatCurrency(metrics.projectedProfit)}
            </Text>
            <Text style={quickViewStyles.statLabel}>Profit</Text>
          </View>
          <View style={quickViewStyles.pillWrapper}>
            <View
              style={[
                quickViewStyles.changePill,
                { backgroundColor: profitBg, borderColor: profitColor },
              ]}>
              <Text
                style={[
                  quickViewStyles.changePillText,
                  { color: profitColor },
                ]}>
                {metrics.profit24h >= 0 ? '↑' : '↓'} {formatSignedCurrency(metrics.profit24h)}
              </Text>
              <Text
                style={[
                  quickViewStyles.changePillSubText,
                  { color: profitColor },
                ]}>
                (24h)
              </Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const DEFAULT_VELOCITY: Record<Period, VelocityWindow> = {
  '1d': { label: '1-Day', change: 0, movers: [] },
  '3d': { label: '3-Day', change: 0, movers: [] },
  '1w': { label: '1-Week', change: 0, movers: [] },
};

const VELOCITY_PERIODS: Period[] = ['1d', '3d', '1w'];

const VELOCITY_DELTA_KEY: Record<Period, keyof ProductVelocity> = {
  '1d': 'price1d',
  '3d': 'price3d',
  '1w': 'price7d',
};

const VELOCITY_LABEL: Record<Period, string> = {
  '1d': '1-Day',
  '3d': '3-Day',
  '1w': '1-Week',
};

type ProductVelocity = {
  price1d: number;
  price3d: number;
  price7d: number;
};

function buildVelocityWindows(
  map: ProductMarketMap,
  activeInventory: InventoryCardType[],
  getConditionedMarket: (price: number, condition?: string) => number
): Record<Period, VelocityWindow> {
  type Aggregate = {
    stock: number;
    liveSum: number;
    count: number;
    representative: InventoryCardType;
  };

  const productMap = new Map<number, Aggregate>();
  for (const card of activeInventory) {
    if (card.productId == null) continue;
    const existing = productMap.get(card.productId);
    if (existing) {
      existing.stock += card.stock;
      existing.liveSum += card.liveMarket;
      existing.count += 1;
    } else {
      productMap.set(card.productId, {
        stock: card.stock,
        liveSum: card.liveMarket,
        count: 1,
        representative: card,
      });
    }
  }

  const windows = { ...DEFAULT_VELOCITY } as Record<Period, VelocityWindow>;

  for (const period of VELOCITY_PERIODS) {
    const key = VELOCITY_DELTA_KEY[period];
    let totalChange = 0;
    const movers: Mover[] = [];

    for (const [productId, aggregate] of productMap) {
      const productData = map[productId];
      if (!productData) continue;

      const condition = aggregate.representative.condition ?? 'NM';
      const liveMarket = getConditionedMarket(productData.marketPrice, condition);
      const pastPrice = getConditionedMarket(productData[key], condition);
      const delta = liveMarket - pastPrice;
      totalChange += delta * aggregate.stock;

      const { representative } = aggregate;
      movers.push({
        name: representative.name,
        number: representative.number ?? '',
        set: representative.set ?? '',
        rarity: representative.productType ?? representative.rarity ?? '',
        condition: representative.condition ?? 'NM',
        oldPrice: pastPrice,
        newPrice: liveMarket,
      });
    }

    movers.sort(
      (a, b) =>
        Math.abs(b.newPrice - b.oldPrice) - Math.abs(a.newPrice - a.oldPrice)
    );

    windows[period] = {
      label: VELOCITY_LABEL[period],
      change: totalChange,
      movers: movers.slice(0, 20),
    };
  }

  return windows;
}

function VelocityBreakdown({
  data,
}: {
  data: Record<Period, VelocityWindow>;
}) {
  const [velocityExpanded, setVelocityExpanded] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<Period>('1d');
  const current = data[selectedPeriod];

  return (
    <View style={velocityStyles.container}>
      <TouchableOpacity
        style={velocityStyles.header}
        onPress={() => setVelocityExpanded((v) => !v)}>
        <Text style={velocityStyles.title}>Live Market Shifts</Text>
        <View style={velocityStyles.summaryPills}>
          {VELOCITY_PERIODS.map((p) => {
            const window = data[p];
            const isPositive = window.change >= 0;
            return (
              <View
                key={p}
                style={[
                  velocityStyles.summaryPill,
                  {
                    backgroundColor: isPositive
                      ? 'rgba(34, 197, 94, 0.12)'
                      : 'rgba(239, 68, 68, 0.12)',
                    borderColor: isPositive ? colors.success : colors.error,
                  },
                ]}>
                <Text
                  style={[
                    velocityStyles.summaryPillText,
                    { color: isPositive ? colors.success : colors.error },
                  ]}>
                  {window.label}: {formatSignedCurrency(window.change)}
                </Text>
              </View>
            );
          })}
        </View>
      </TouchableOpacity>

      {velocityExpanded && (
        <View style={velocityStyles.body}>
          <View style={velocityStyles.tabRow}>
            {VELOCITY_PERIODS.map((p) => {
              const isActive = p === selectedPeriod;
              return (
                <TouchableOpacity
                  key={p}
                  style={[velocityStyles.tab, isActive && velocityStyles.tabActive]}
                  onPress={() => setSelectedPeriod(p)}>
                  <Text
                    style={[
                      velocityStyles.tabText,
                      isActive && velocityStyles.tabTextActive,
                    ]}>
                    {data[p].label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            nestedScrollEnabled
            contentContainerStyle={velocityStyles.moverScroll}>
            {current.movers.map((mover, index) => (
              <MiniMoverCard key={index} mover={mover} />
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

export function InventoryScreen() {
  const { width, height } = useWindowDimensions();
  const { activeInventory } = useInventory();
  const { getConditionedMarket } = useVendorSettings();

  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const handleEdit = useCallback((card: Card) => setEditingCard(card), []);

  const [viewport, setViewport] = useState({ width, height });
  const [layout, setLayout] = useState({
    width: Math.max(0, width - 32),
    height: 420,
  });

  const [velocityData, setVelocityData] =
    useState<Record<Period, VelocityWindow>>(DEFAULT_VELOCITY);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const productIds = [
          ...new Set(
            activeInventory
              .map((c) => c.productId)
              .filter((id): id is number => id != null)
          ),
        ];

        if (productIds.length === 0) {
          if (mounted) setVelocityData(DEFAULT_VELOCITY);
          return;
        }

        const variantMap: Record<number, string> = {};
        for (const card of activeInventory) {
          if (card.productId == null) continue;
          if (variantMap[card.productId] == null) {
            variantMap[card.productId] = card.productType ?? card.rarity ?? 'Normal';
          }
        }

        const db = await openCatalogDatabase();
        const map = await getProductMarketData(db, productIds, variantMap);

        if (!mounted) return;
        setVelocityData(buildVelocityWindows(map, activeInventory, getConditionedMarket));
      } catch (err) {
        console.error('Failed to load market velocity:', err);
      }
    };

    load();

    return () => {
      mounted = false;
    };
  }, [activeInventory, getConditionedMarket]);

  const metrics = useMemo(
    () => ({
      activeAssets: activeInventory.length,
      totalCostBasis: activeInventory.reduce((sum, c) => sum + c.amountPaid, 0),
      projectedSticker: activeInventory.reduce((sum, c) => sum + c.stickerPrice, 0),
      projectedProfit: activeInventory.reduce((sum, c) => sum + c.projProfit, 0),
      profit24h: velocityData['1d'].change,
    }),
    [activeInventory, velocityData]
  );

  const handleScrollLayout = (e: LayoutChangeEvent) => {
    setViewport(e.nativeEvent.layout);
  };

  const handleCarouselLayout = (e: LayoutChangeEvent) => {
    setLayout(e.nativeEvent.layout);
  };

  const [activeTab, setActiveTab] = useState<InventoryTab>('active');

  const activeContentStyle = {
    flexGrow: 1,
    minHeight: Math.max(0, viewport.height - 24),
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  };

  const analyticsContentStyle = {
    flexGrow: 1,
    minHeight: Math.max(0, viewport.height - 24),
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
  };

  return (
    <View style={styles.container}>
      <SegmentedTabBar activeTab={activeTab} onChange={setActiveTab} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={
          activeTab === 'active' ? activeContentStyle : analyticsContentStyle
        }
        onLayout={handleScrollLayout}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled>
        {activeTab === 'active' ? (
          <>
            <InventoryActionTrays />
            <QuickViewPanel metrics={metrics} />

            <View
              style={styles.carouselWrapper}
              onLayout={handleCarouselLayout}>
              <FlatList
                data={activeInventory}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                nestedScrollEnabled
                maxToRenderPerBatch={4}
                windowSize={5}
                style={styles.carousel}
                extraData={layout}
                getItemLayout={(_, index) => ({
                  length: layout.width,
                  offset: layout.width * index,
                  index,
                })}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <InventoryCard
                    card={item}
                    width={layout.width}
                    height={layout.height}
                    onEdit={handleEdit}
                  />
                )}
              />
            </View>

            <VelocityBreakdown data={velocityData} />
          </>
        ) : (
          <PerformanceAnalytics />
        )}
      </ScrollView>

      <EditAssetModal
        visible={editingCard !== null}
        card={editingCard}
        onClose={() => setEditingCard(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  carouselWrapper: {
    flex: 1,
    minHeight: 420,
  },
  carousel: {
    flex: 1,
  },
});

const quickViewStyles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    flex: 1,
  },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  stat: {
    width: '50%',
    paddingVertical: 2,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  statText: {
    alignItems: 'center',
  },
  profitStat: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  statValue: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 18,
    fontWeight: 'bold',
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 13,
    marginTop: 1,
  },
  pillWrapper: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 4,
    justifyContent: 'center',
  },
  changePill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 2,
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  changePillText: {
    fontSize: 9,
    fontWeight: '600',
  },
  changePillSubText: {
    fontSize: 7,
    fontWeight: '600',
  },
});

const velocityStyles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  header: {
    padding: 8,
  },
  title: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 4,
  },
  summaryPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 4,
  },
  summaryPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 2,
    paddingHorizontal: 5,
    marginRight: 4,
    marginBottom: 2,
  },
  summaryPillText: {
    fontSize: 9,
    fontWeight: '600',
  },
  body: {
    padding: 8,
    paddingTop: 0,
  },
  tabRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
  },
  tabActive: {
    borderBottomColor: colors.primary,
  },
  tabText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '500',
  },
  tabTextActive: {
    color: colors.text,
    fontWeight: 'bold',
  },
  moverScroll: {
    paddingVertical: 2,
  },
});
