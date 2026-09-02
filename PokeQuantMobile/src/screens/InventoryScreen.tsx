import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  FlatList,
  Image,
  LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors } from '../constants/colors';
import { useAuth } from '../context/AuthContext';
import { useInventory, type InventoryCard } from '../context/InventoryContext';
import {
  METRICS,
  MiniMoverCard,
  formatCurrency,
  formatSignedCurrency,
  type Period,
  type Mover,
  type VelocityWindow,
} from './HomeScreen';
import { openCatalogDatabase, getMarketVelocity, type MarketMover } from '../db/catalogDb';
import {
  SegmentedTabBar,
  type InventoryTab,
} from '../components/SegmentedTabBar';
import { InventoryActionTrays } from '../components/InventoryActionTrays';
import { PerformanceAnalytics } from '../components/PerformanceAnalytics';
import { EditAssetModal } from '../components/EditAssetModal';

type Card = InventoryCard;

function MetricRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text
        style={[
          styles.metricValue,
          valueColor ? { color: valueColor } : undefined,
        ]}>
        {value}
      </Text>
    </View>
  );
}

const BASE_IMAGE_WIDTH = 120;
const BASE_IMAGE_HEIGHT = 168;

function CardImage({ imageUrl, width }: { imageUrl?: string; width: number }) {
  const [failed, setFailed] = useState(false);
  const imageWidth = Math.min(BASE_IMAGE_WIDTH, Math.max(60, width - 16));
  const imageHeight = Math.round(imageWidth * (BASE_IMAGE_HEIGHT / BASE_IMAGE_WIDTH));
  if (imageUrl && !failed) {
    return (
      <Image
        source={{ uri: imageUrl }}
        style={{ width: imageWidth, height: imageHeight }}
        resizeMode="contain"
        onError={() => setFailed(true)}
      />
    );
  }
  return <Text style={styles.thumbText}>IMG</Text>;
}

const FloatingCard = memo(function FloatingCard({
  card,
  width,
  onEdit,
}: {
  card: Card;
  width: number;
  onEdit: (card: Card) => void;
}) {
  const { removeInventoryCard, sellInventoryCard } = useInventory();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFocusEffect(
    useCallback(() => {
      return () => {
        setConfirmDelete(false);
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
      };
    }, [])
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  const profitColor = card.projProfit >= 0 ? colors.success : colors.error;

  const handleDelete = () => {
    if (confirmDelete) {
      removeInventoryCard(card.id);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
      timeoutRef.current = setTimeout(() => {
        setConfirmDelete(false);
        timeoutRef.current = null;
      }, 3500);
    }
  };

  const handleSell = () => {
    sellInventoryCard(card.id);
  };

  const handleEdit = () => {
    onEdit(card);
  };

  return (
    <View style={[styles.card, { width }]}>
      <View style={styles.body}>
        <View style={styles.thumb}>
          <CardImage imageUrl={card.imageUrl} width={width} />
        </View>

        <Text style={styles.cardName} numberOfLines={1}>
          {card.name}
        </Text>
        <Text style={styles.sticker}>{formatCurrency(card.stickerPrice)}</Text>

        <View style={styles.metrics}>
          <MetricRow label="Live Market" value={formatCurrency(card.liveMarket)} />
          <MetricRow label="Amount Paid" value={formatCurrency(card.amountPaid)} />
          <MetricRow
            label="Proj. Profit"
            value={formatCurrency(card.projProfit)}
            valueColor={profitColor}
          />
          <MetricRow label="Stock" value={String(card.stock)} />
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionButton, styles.actionMain]}
          activeOpacity={0.7}
          onPress={handleSell}>
          <Text style={styles.actionText}>Sell</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.actionMain]}
          activeOpacity={0.7}
          onPress={handleEdit}>
          <Text style={styles.actionText}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.actionButton,
            styles.actionDelete,
            confirmDelete && styles.actionDeleteConfirm,
          ]}
          activeOpacity={0.7}
          onPress={handleDelete}>
          <Text
            style={[
              styles.deleteText,
              confirmDelete && styles.deleteTextConfirm,
            ]}
            numberOfLines={1}>
            {confirmDelete ? 'Are you sure?' : 'Delete'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

function InventoryPage({
  page,
  pageWidth,
  pageHeight,
  onEdit,
}: {
  page: Card[];
  pageWidth: number;
  pageHeight: number;
  onEdit: (card: Card) => void;
}) {
  // Two cards per row with 12pt page padding and 8pt inter-card gap.
  const cardWidth = Math.max(0, Math.floor((pageWidth - 32) / 2));
  const top = page.slice(0, 2);
  const bottom = page.slice(2, 4);

  return (
    <View style={[styles.page, { width: pageWidth, height: pageHeight }]}>
      <View style={styles.row}>
        {top.map((card) => (
          <FloatingCard key={card.id} card={card} width={cardWidth} onEdit={onEdit} />
        ))}
      </View>
      <View style={styles.row}>
        {bottom.map((card) => (
          <FloatingCard key={card.id} card={card} width={cardWidth} onEdit={onEdit} />
        ))}
      </View>
    </View>
  );
}

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

function VelocityBreakdown() {
  const { userId } = useAuth();
  const [velocityExpanded, setVelocityExpanded] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<Period>('1d');
  const [velocityData, setVelocityData] =
    useState<Record<Period, VelocityWindow>>(DEFAULT_VELOCITY);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const db = await openCatalogDatabase();
        const [oneDay, threeDay, oneWeek] = await Promise.all([
          getMarketVelocity(db, '1d', userId ?? ''),
          getMarketVelocity(db, '3d', userId ?? ''),
          getMarketVelocity(db, '1w', userId ?? ''),
        ]);
        if (!mounted) return;
        setVelocityData({
          '1d': oneDay,
          '3d': threeDay,
          '1w': oneWeek,
        });
      } catch (err) {
        console.error('Failed to load market velocity:', err);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [userId]);

  const current = velocityData[selectedPeriod];

  return (
    <View style={velocityStyles.container}>
      <TouchableOpacity
        style={velocityStyles.header}
        onPress={() => setVelocityExpanded((v) => !v)}>
        <Text style={velocityStyles.title}>Live Market Shifts</Text>
        <View style={velocityStyles.summaryPills}>
          {VELOCITY_PERIODS.map((p) => {
            const data = velocityData[p];
            const isPositive = data.change >= 0;
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
                  {data.label}: {formatSignedCurrency(data.change)}
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
                    {velocityData[p].label}
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
              <MiniMoverCard key={index} mover={mover as Mover} />
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

export function InventoryScreen() {
  const { width, height } = useWindowDimensions();
  const { inventory } = useInventory();

  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const handleEdit = useCallback((card: Card) => setEditingCard(card), []);

  // The scroll view's content is stretched to at least the visible viewport so
  // Quick View, carousel and the Live Market Shifts header can be seen without
  // scrolling. When the accordion expands the content grows and scrolling is
  // allowed.
  const [viewport, setViewport] = useState({ width, height });
  const [layout, setLayout] = useState({
    width: Math.max(0, width - 32),
    height: 406,
  });

  const metrics = useMemo(
    () => ({
      activeAssets: inventory.length,
      totalCostBasis: inventory.reduce((sum, c) => sum + c.amountPaid, 0),
      projectedSticker: inventory.reduce((sum, c) => sum + c.stickerPrice, 0),
      projectedProfit: inventory.reduce((sum, c) => sum + c.projProfit, 0),
      profit24h: METRICS.profit24h,
    }),
    [inventory]
  );

  const pages = useMemo<Card[][]>(() => {
    const chunks: Card[][] = [];
    for (let i = 0; i < inventory.length; i += 4) {
      chunks.push(inventory.slice(i, i + 4));
    }
    return chunks;
  }, [inventory]);

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
                data={pages}
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
                keyExtractor={(_, index) => String(index)}
                renderItem={({ item }) => (
                  <InventoryPage
                    page={item}
                    pageWidth={layout.width}
                    pageHeight={layout.height}
                    onEdit={handleEdit}
                  />
                )}
              />
            </View>

            <VelocityBreakdown />
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
    minHeight: 406,
  },
  carousel: {
    flex: 1,
  },
  page: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 6,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'stretch',
    marginBottom: 6,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 8,
    minHeight: 195,
    alignSelf: 'stretch',
    justifyContent: 'space-between',
  },
  body: {
    flex: 1,
  },
  thumb: {
    flex: 1,
    minHeight: 60,
    backgroundColor: colors.surfaceLight,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  thumbText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  cardName: {
    color: colors.text,
    fontSize: 12,
    fontWeight: 'bold',
    lineHeight: 14,
    marginBottom: 2,
  },
  sticker: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 20,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  metrics: {
    marginBottom: 0,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 0,
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 11,
  },
  metricValue: {
    color: colors.text,
    fontSize: 10,
    lineHeight: 11,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    marginTop: 4,
  },
  actionButton: {
    flex: 1,
    borderRadius: 6,
    paddingVertical: 7,
    alignItems: 'center',
    marginHorizontal: 3,
  },
  actionMain: {
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionDelete: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: colors.error,
  },
  actionDeleteConfirm: {
    backgroundColor: '#ff7b72',
    borderColor: '#ff7b72',
  },
  actionText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
  },
  deleteText: {
    color: colors.error,
    fontSize: 11,
    fontWeight: '600',
  },
  deleteTextConfirm: {
    color: colors.background,
    fontWeight: 'bold',
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
