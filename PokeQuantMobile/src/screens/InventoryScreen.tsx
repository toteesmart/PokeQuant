import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { FlashList } from '@shopify/flash-list';
import {
  LayoutChangeEvent,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import { InventoryCard } from '../components/InventoryCard';
import {
  useInventoryStore,
  type InventoryCard as InventoryCardType,
} from '../store/inventoryStore';
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
  getCardSignals,
  getProductMarketData,
  pickSignalForFinish,
  type CardSignal,
  type ProductMarketMap,
} from '../db/catalogDb';
import {
  SegmentedTabBar,
  type InventoryTab,
} from '../components/SegmentedTabBar';
import { InventoryActionTrays } from '../components/InventoryActionTrays';
import { PerformanceAnalytics } from '../components/PerformanceAnalytics';
import { EditAssetModal } from '../components/EditAssetModal';
import { useVendorStore } from '../store/vendorStore';
import { useProgressStore } from '../store/progressStore';
import {
  useWatchlistStore,
  type WatchedCard,
} from '../store/watchlistStore';
import { DealAnalysisSheet } from '../scanner/molecules/DealAnalysisSheet';
import { matchForCardRef } from '../scanner/services/catalog/ScannerCatalogProvider';
import {
  diffDealClasses,
  loadDealClassMap,
  saveDealClassMap,
  type DealShift,
  type DealClassMap,
} from '../scanner/services/deal/dealShiftTracker';
import type { CatalogMatch } from '../scanner/services/catalog/catalogMatcher';
import { displayCardName } from '../scanner/services/catalog/catalogMatcher';
import {
  buildStockHealth,
  BUCKET_ORDER,
  BUCKET_LABEL,
  type StockHealth,
  type StockHealthItem,
} from '../scanner/services/deal/stockHealth';

type Card = InventoryCardType;
type CardPair = [Card, Card?];

const GAP = 12;

const METRICS = {
  activeAssets: 0,
  totalCostBasis: 0,
  projectedSticker: 0,
  projectedProfit: 0,
};

function normalizeSearchTerm(term: string): string {
  return term.toLowerCase().replace(/['.\-]/g, '').trim();
}

function getSearchableText(card: Card): string {
  return [
    card.name,
    card.number,
    card.set,
    card.productType,
    card.rarity,
    card.condition,
  ]
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .join(' ');
}

type SearchEntry = { card: Card; haystack: string };

function buildSearchIndex(cards: Card[]): SearchEntry[] {
  return cards.map((card) => ({
    card,
    haystack: normalizeSearchTerm(getSearchableText(card)),
  }));
}

function chunkPairs<T>(arr: T[]): Array<[T, T?]> {
  const pairs: Array<[T, T?]> = [];
  for (let i = 0; i < arr.length; i += 2) {
    pairs.push([arr[i], arr[i + 1]]);
  }
  return pairs;
}

function SearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (text: string) => void;
}) {
  return (
    <View style={searchStyles.container}>
      <Ionicons name="search-outline" size={16} color={colors.textMuted} />
      <TextInput
        style={searchStyles.input}
        value={value}
        onChangeText={onChange}
        placeholder="Search active inventory..."
        placeholderTextColor={colors.textMuted}
        autoCorrect={false}
        autoCapitalize="none"
      />
    </View>
  );
}

function QuickViewPanel({
  metrics,
}: {
  metrics: typeof METRICS;
}) {
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
        <View style={quickViewStyles.stat}>
          <Text style={quickViewStyles.statValue}>
            {formatCurrency(metrics.projectedProfit)}
          </Text>
          <Text style={quickViewStyles.statLabel}>Profit</Text>
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
        productId: representative.productId ?? undefined,
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

type InventoryRowProps = {
  pair: CardPair;
  layoutWidth: number;
  layoutHeight: number;
  onEdit: (card: Card) => void;
  onAnalyze: (card: Card) => void;
  selecting: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (card: Card) => void;
  onStartSelect: (card: Card) => void;
  signalMap: Record<number, Record<string, CardSignal>>;
};

// Signals are keyed by product finish; inventory rows store the scanned
// finish in productType. Shared finish-fallback lives in catalogDb.
function signalForCard(
  signalMap: Record<number, Record<string, CardSignal>>,
  card: Card
): CardSignal | undefined {
  return pickSignalForFinish(signalMap, card);
}

const InventoryRow = memo(function InventoryRow({
  pair,
  layoutWidth,
  layoutHeight,
  onEdit,
  onAnalyze,
  selecting,
  selectedIds,
  onToggleSelect,
  onStartSelect,
  signalMap,
}: InventoryRowProps) {
  const rowHeight = Math.max(460, layoutHeight);
  const cardWidth = Math.max(0, (layoutWidth - GAP) / 2);
  const justifyContent = pair[1] ? 'space-between' : 'center';

  const renderCard = (card: Card) => (
    <InventoryCard
      card={card}
      width={cardWidth}
      height={rowHeight}
      onEdit={onEdit}
      onAnalyze={onAnalyze}
      signal={signalForCard(signalMap, card)}
      selecting={selecting}
      selected={selectedIds.has(card.id)}
      onToggleSelect={() => onToggleSelect(card)}
      onStartSelect={() => onStartSelect(card)}
    />
  );

  return (
    <View
      style={[
        styles.pageRow,
        {
          width: layoutWidth,
          minHeight: rowHeight,
          justifyContent,
        },
      ]}>
      {renderCard(pair[0])}
      {pair[1] && renderCard(pair[1])}
    </View>
  );
});

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

/** Where the money sits across the five rotation buckets — the
 *  portfolio answer to "is my stock getting better". Dollar-weighted:
 *  a $2 bulk card counts less than a $200 chase card. */
const BUCKET_COLOR: Record<string, string> = {
  grow: colors.velocityPositive,
  keep: colors.primary,
  watch: colors.warning,
  rotate: colors.velocityNegative,
  dead: colors.textMuted,
};

function StockHealthPanel({
  health,
  onOpenRotation,
}: {
  health: StockHealth;
  onOpenRotation: () => void;
}) {
  const active = BUCKET_ORDER.filter((b) => health.buckets[b].count > 0);
  return (
    <TouchableOpacity
      style={healthStyles.container}
      activeOpacity={0.85}
      onPress={onOpenRotation}>
      <View style={healthStyles.head}>
        <Text style={healthStyles.title}>Stock health</Text>
        <Text style={healthStyles.link}>
          {health.rotateOut.length > 0
            ? `Rotate out ·${health.rotateOut.length} ›`
            : 'Details ›'}
        </Text>
      </View>
      <View style={healthStyles.bar}>
        {active.map((b) => (
          <View
            key={b}
            style={[
              healthStyles.seg,
              {
                flex: health.buckets[b].value / health.totalValue,
                backgroundColor: BUCKET_COLOR[b],
              },
            ]}
          />
        ))}
      </View>
      <View style={healthStyles.legend}>
        {active.map((b) => (
          <Text key={b} style={healthStyles.legendItem}>
            <Text style={{ color: BUCKET_COLOR[b] }}>●</Text>
            {` ${BUCKET_LABEL[b]} `}
            {Math.round((health.buckets[b].value / health.totalValue) * 100)}%
          </Text>
        ))}
      </View>
      <Text style={healthStyles.headline}>{health.headline}</Text>
    </TouchableOpacity>
  );
}

/** The rotate-out shortlist — cards sorted by dollars locked, each
 *  carrying the concrete exit trigger. Tap through to the full owner
 *  analysis for that card. */
function RotationSheet({
  visible,
  items,
  watchItems,
  onSelect,
  onClose,
}: {
  visible: boolean;
  items: StockHealthItem[];
  watchItems: StockHealthItem[];
  onSelect: (item: StockHealthItem) => void;
  onClose: () => void;
}) {
  const renderItem = (item: StockHealthItem, rank: number) => {
    const vs = item.value - item.cost;
    return (
      <TouchableOpacity
        key={item.card.id}
        style={rotationStyles.row}
        onPress={() => onSelect(item)}>
        <Text style={rotationStyles.rank}>{rank + 1}</Text>
        <View style={rotationStyles.main}>
          <Text style={rotationStyles.name} numberOfLines={1}>
            {displayCardName(item.card.name)}
          </Text>
          {item.trigger ? (
            <Text style={rotationStyles.trigger} numberOfLines={1}>
              {item.trigger}
            </Text>
          ) : null}
        </View>
        <View style={rotationStyles.numbers}>
          <Text style={rotationStyles.value}>
            {formatCurrency(item.value)}
          </Text>
          {item.cost > 0 ? (
            <Text
              style={[
                rotationStyles.vs,
                { color: vs >= 0 ? colors.velocityPositive : colors.velocityNegative },
              ]}>
              {vs >= 0 ? '+' : ''}
              {formatCurrency(vs)} vs cost
            </Text>
          ) : null}
        </View>
        <Text
          style={[
            rotationStyles.tag,
            { color: BUCKET_COLOR[item.bucket] },
          ]}>
          {BUCKET_LABEL[item.bucket]}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}>
      <View style={rotationStyles.backdrop}>
        <View style={rotationStyles.sheet}>
          <View style={rotationStyles.head}>
            <Text style={rotationStyles.title}>Rotate out first</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          <Text style={rotationStyles.sub}>
            Sorted by dollars locked — the top rows free the most capital.
          </Text>
          <ScrollView style={rotationStyles.list} nestedScrollEnabled>
            {items.map(renderItem)}
            {watchItems.length > 0 ? (
              <>
                <Text style={rotationStyles.section}>
                  On the trigger — holding, but one crack from rotate
                </Text>
                {watchItems.map(renderItem)}
              </>
            ) : null}
            {items.length === 0 && watchItems.length === 0 ? (
              <Text style={rotationStyles.empty}>
                Nothing flagged — your stock is working.
              </Text>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function InventoryScreen() {
  const { width, height } = useWindowDimensions();
  const activeInventory = useInventoryStore((state) => state.activeInventory);
  const getConditionedMarket = useVendorStore(
    (state) => state.getConditionedMarket
  );
  const isCatalogReady = useProgressStore((state) => state.isCatalogReady);
  const isExtracting = useProgressStore((state) => state.isExtracting);

  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const handleEdit = useCallback((card: Card) => setEditingCard(card), []);

  // Name tap → deal analysis in owner language (cost basis, days held).
  const [analysisFor, setAnalysisFor] = useState<{
    match: CatalogMatch;
    subType?: string;
    ownership?: { paid: number; since?: string; sticker?: number };
  } | null>(null);
  const handleAnalyze = useCallback((card: Card) => {
    void matchForCardRef({
      productId: card.productId,
      name: card.name,
      number: card.number,
      set: card.set,
      rarity: card.rarity,
      imageUrl: card.imageUrl,
      subType: card.productType,
      marketPrice: card.liveMarket,
    })
      .then((m) =>
        setAnalysisFor({
          match: m,
          subType: card.productType,
          ownership: {
            paid: card.amountPaid,
            since: card.dateBought,
            sticker: card.stickerPrice,
          },
        })
      )
      .catch(() => {});
  }, []);

  // Watched-card shift rows open the same sheet, minus the owner frame.
  const handleWatchAnalyze = useCallback((w: WatchedCard) => {
    void matchForCardRef({
      productId: w.productId,
      name: w.name,
      number: w.number,
      set: w.set,
      imageUrl: w.imageUrl,
      subType: w.subType,
    })
      .then((m) => setAnalysisFor({ match: m, subType: w.subType }))
      .catch(() => {});
  }, []);

  // Bulk-select mode: long-press a card to enter, tap cards to toggle,
  // deselecting the last card exits automatically.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const bulkDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selecting = selectedIds.size > 0;

  const handleStartSelect = useCallback((card: Card) => {
    setSelectedIds((prev) => {
      if (prev.has(card.id)) return prev;
      const next = new Set(prev);
      next.add(card.id);
      return next;
    });
  }, []);

  const handleToggleSelect = useCallback((card: Card) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(card.id)) {
        next.delete(card.id);
      } else {
        next.add(card.id);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setConfirmBulkDelete(false);
  }, []);

  const handleBulkSell = useCallback(() => {
    const store = useInventoryStore.getState();
    selectedIds.forEach((id) => store.sellInventoryCard(id));
    clearSelection();
  }, [selectedIds, clearSelection]);

  const handleBulkDelete = useCallback(() => {
    if (!confirmBulkDelete) {
      setConfirmBulkDelete(true);
      if (bulkDeleteTimerRef.current) {
        clearTimeout(bulkDeleteTimerRef.current);
      }
      bulkDeleteTimerRef.current = setTimeout(
        () => setConfirmBulkDelete(false),
        3500
      );
      return;
    }
    const store = useInventoryStore.getState();
    selectedIds.forEach((id) => store.removeInventoryCard(id));
    clearSelection();
  }, [confirmBulkDelete, selectedIds, clearSelection]);

  useEffect(() => {
    return () => {
      if (bulkDeleteTimerRef.current) {
        clearTimeout(bulkDeleteTimerRef.current);
      }
    };
  }, []);

  const [searchQuery, setSearchQuery] = useState('');

  const [viewport, setViewport] = useState({ width, height });
  const [layout, setLayout] = useState({
    width: Math.max(0, width - 32),
    height: 460,
  });

  const [velocityData, setVelocityData] =
    useState<Record<Period, VelocityWindow>>(DEFAULT_VELOCITY);
  const [signalMap, setSignalMap] = useState<
    Record<number, Record<string, CardSignal>>
  >({});
  // Cards whose movement class changed since the last catalog refresh.
  const [classShifts, setClassShifts] = useState<DealShift<Card>[]>([]);
  const [watchShifts, setWatchShifts] = useState<DealShift<WatchedCard>[]>([]);
  const watchedCards = useWatchlistStore((s) => s.cards);

  const velocityKeyRef = useRef<string>('');
  const velocityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isCatalogReady || isExtracting) {
      setVelocityData(DEFAULT_VELOCITY);
      setSignalMap({});
      velocityKeyRef.current = '';
      return;
    }

    const productIds = activeInventory
      .map((c) => c.productId)
      .filter((id): id is number => id != null);
    const watchedList = Object.values(watchedCards);
    const uniqueIds = [
      ...new Set([...productIds, ...watchedList.map((w) => w.productId)]),
    ].sort((a, b) => a - b);

    if (uniqueIds.length === 0) {
      setVelocityData(DEFAULT_VELOCITY);
      velocityKeyRef.current = '';
      return;
    }

    const key = uniqueIds.join(',');
    if (key === velocityKeyRef.current) return;
    velocityKeyRef.current = key;

    if (velocityTimerRef.current) {
      clearTimeout(velocityTimerRef.current);
    }

    let mounted = true;
    velocityTimerRef.current = setTimeout(async () => {
      const variantMap: Record<number, string> = {};
      for (const card of activeInventory) {
        if (card.productId == null) continue;
        if (variantMap[card.productId] == null) {
          variantMap[card.productId] = card.productType ?? card.rarity ?? 'Normal';
        }
      }

      try {
        const db = await openCatalogDatabase();
        const [map, signals] = await Promise.all([
          getProductMarketData(db, uniqueIds, variantMap),
          getCardSignals(db, uniqueIds).catch(() => ({}) as Record<number, Record<string, CardSignal>>),
        ]);

        if (!mounted) return;
        setSignalMap(signals);

        // Diff each held card's deal class vs the last catalog — flags
        // movement shifts (Stable→Free fall etc.) so direction changes
        // never sneak past between refreshes. Watched (unowned) cards
        // join the same diff — that's where revival alerts come from.
        const prev = await loadDealClassMap();
        const held = diffDealClasses(
          prev,
          activeInventory.map((card) => ({
            card,
            productId: card.productId,
            subType: card.productType,
            signal: signalForCard(signals, card),
          }))
        );
        const watched = diffDealClasses(
          prev,
          watchedList.map((w) => ({
            card: w,
            productId: w.productId,
            subType: w.subType,
            signal:
              signals[w.productId]?.[w.subType] ??
              Object.values(signals[w.productId] ?? {})[0],
          }))
        );
        if (mounted) {
          setClassShifts(held.shifts);
          setWatchShifts(watched.shifts);
        }
        const nextMap: DealClassMap = { ...held.next, ...watched.next };
        void saveDealClassMap(nextMap);
        setVelocityData(buildVelocityWindows(map, activeInventory, getConditionedMarket));
      } catch (err) {
        console.error('Failed to load market velocity:', err);
      }
    }, 500);

    return () => {
      mounted = false;
      if (velocityTimerRef.current) {
        clearTimeout(velocityTimerRef.current);
      }
    };
  }, [activeInventory, watchedCards, getConditionedMarket, isCatalogReady, isExtracting]);

  const searchIndex = useMemo(
    () => buildSearchIndex(activeInventory),
    [activeInventory]
  );

  const filteredInventory = useMemo(() => {
    const raw = searchQuery.trim();
    if (!raw) return activeInventory;
    const needle = normalizeSearchTerm(raw);
    if (!needle) return activeInventory;
    return searchIndex
      .filter((entry) => entry.haystack.includes(needle))
      .map((entry) => entry.card);
  }, [activeInventory, searchIndex, searchQuery]);

  const pairedInventory = useMemo(
    () => chunkPairs(filteredInventory),
    [filteredInventory]
  );

  const metrics = useMemo(
    () => ({
      activeAssets: activeInventory.length,
      totalCostBasis: activeInventory.reduce((sum, c) => sum + c.amountPaid, 0),
      projectedSticker: activeInventory.reduce((sum, c) => sum + c.stickerPrice, 0),
      projectedProfit: activeInventory.reduce((sum, c) => sum + c.projProfit, 0),
    }),
    [activeInventory]
  );

  // Portfolio triage — one synchronous classify pass over the stamped
  // signals the list rows already fetched. Recomputes when the map or
  // the inventory changes.
  const health = useMemo(
    () =>
      buildStockHealth(activeInventory, (c) =>
        signalForCard(signalMap, c as Card)
      ),
    [activeInventory, signalMap]
  );
  const [rotationOpen, setRotationOpen] = useState(false);
  const watchItems = useMemo(
    () =>
      health.items
        .filter((i) => i.bucket === 'watch')
        .sort((a, b) => b.value - a.value),
    [health]
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
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
  };

  const analyticsContentStyle = {
    flexGrow: 1,
    minHeight: Math.max(0, viewport.height - 24),
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
  };

  const renderItem = useCallback(
    ({ item }: { item: CardPair }) => (
      <InventoryRow
        pair={item}
        layoutWidth={layout.width}
        layoutHeight={layout.height}
        onEdit={handleEdit}
        onAnalyze={handleAnalyze}
        selecting={selecting}
        selectedIds={selectedIds}
        onToggleSelect={handleToggleSelect}
        onStartSelect={handleStartSelect}
        signalMap={signalMap}
      />
    ),
    [layout, handleEdit, handleAnalyze, selecting, selectedIds, handleToggleSelect, handleStartSelect, signalMap]
  );

  const emptyComponent = pairedInventory.length === 0 ? (
    <View
      style={[
        styles.emptyContainer,
        {
          width: Math.max(0, layout.width),
          minHeight: Math.max(360, layout.height),
        },
      ]}>
      <Text style={styles.emptyText}>
        {searchQuery.trim()
          ? 'No cards match your search.'
          : 'No active inventory.'}
      </Text>
    </View>
  ) : null;

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
            <QuickViewPanel metrics={metrics} />

            {health.totalValue > 0 && health.coverage >= 0.25 ? (
              <StockHealthPanel
                health={health}
                onOpenRotation={() => setRotationOpen(true)}
              />
            ) : null}

            {/* Deal-class shifts since the last catalog refresh — each row
                taps through to that card's analysis. Watched cards are
                tagged so an unowned revival doesn't read as inventory. */}
            {classShifts.length + watchShifts.length > 0 ? (
              <View style={shiftStyles.banner}>
                <View style={shiftStyles.head}>
                  <Text style={shiftStyles.title}>Movement shifts</Text>
                  <TouchableOpacity
                    onPress={() => {
                      setClassShifts([]);
                      setWatchShifts([]);
                    }}
                    hitSlop={8}>
                    <Ionicons
                      name="close"
                      size={16}
                      color={colors.textMuted}
                    />
                  </TouchableOpacity>
                </View>
                {classShifts.slice(0, 4).map((s) => (
                  <TouchableOpacity
                    key={s.card.id}
                    style={shiftStyles.row}
                    onPress={() => handleAnalyze(s.card)}>
                    <Text style={shiftStyles.name} numberOfLines={1}>
                      {displayCardName(s.card.name)}
                      {s.kind !== 'move' ? (
                        <Text style={shiftStyles.kindTag}>
                          {s.kind === 'revival' ? ' · waking up' : ' · cracked floor'}
                        </Text>
                      ) : null}
                    </Text>
                    <Text style={shiftStyles.move} numberOfLines={1}>
                      {s.from.label} →{' '}
                      <Text style={{ color: s.color }}>{s.to.label}</Text>
                    </Text>
                  </TouchableOpacity>
                ))}
                {watchShifts.slice(0, Math.max(0, 4 - classShifts.length)).map((s) => (
                  <TouchableOpacity
                    key={`w${s.card.productId}${s.card.subType}`}
                    style={shiftStyles.row}
                    onPress={() => handleWatchAnalyze(s.card)}>
                    <Text style={shiftStyles.name} numberOfLines={1}>
                      {s.card.name}
                      <Text style={shiftStyles.watchTag}> · watching</Text>
                      {s.kind !== 'move' ? (
                        <Text style={shiftStyles.kindTag}>
                          {s.kind === 'revival' ? ' · waking up' : ' · cracked floor'}
                        </Text>
                      ) : null}
                    </Text>
                    <Text style={shiftStyles.move} numberOfLines={1}>
                      {s.from.label} →{' '}
                      <Text style={{ color: s.color }}>{s.to.label}</Text>
                    </Text>
                  </TouchableOpacity>
                ))}
                {classShifts.length + watchShifts.length > 4 ? (
                  <Text style={shiftStyles.more}>
                    +{classShifts.length + watchShifts.length - 4} more
                  </Text>
                ) : null}
              </View>
            ) : null}

            <SearchBar value={searchQuery} onChange={setSearchQuery} />

            <View
              style={styles.carouselWrapper}
              onLayout={handleCarouselLayout}>
              <FlashList<CardPair>
                data={pairedInventory}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                nestedScrollEnabled
                style={styles.carousel}
                keyExtractor={(item) => `${item[0].id}-${item[1]?.id ?? 'solo'}`}
                renderItem={renderItem}
                ListEmptyComponent={emptyComponent}
              />
            </View>

            <InventoryActionTrays />

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

      {/* Name tap → the same deal analysis the scanner uses, in
          "you own it" language. */}
      {analysisFor ? (
        <DealAnalysisSheet
          match={analysisFor.match}
          subType={analysisFor.subType}
          ownership={analysisFor.ownership}
          onClose={() => setAnalysisFor(null)}
        />
      ) : null}

      <RotationSheet
        visible={rotationOpen}
        items={health.rotateOut}
        watchItems={watchItems}
        onSelect={(item) => {
          setRotationOpen(false);
          handleAnalyze(item.card as Card);
        }}
        onClose={() => setRotationOpen(false)}
      />

      {selecting && (
        <View style={styles.bulkBar}>
          <Text style={styles.bulkCount}>
            {selectedIds.size} selected
          </Text>
          <TouchableOpacity
            style={[styles.bulkBtn, styles.bulkSell]}
            activeOpacity={0.8}
            onPress={handleBulkSell}>
            <Text style={styles.bulkSellText}>Sell</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.bulkBtn,
              confirmBulkDelete ? styles.bulkDelConfirm : styles.bulkDel,
            ]}
            activeOpacity={0.8}
            onPress={handleBulkDelete}>
            <Text
              style={[
                styles.bulkDelText,
                confirmBulkDelete && styles.bulkDelTextConfirm,
              ]}>
              {confirmBulkDelete ? 'Sure?' : 'Del'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.bulkBtn}
            activeOpacity={0.8}
            onPress={clearSelection}>
            <Text style={styles.bulkCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}
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
    height: 460,
    marginBottom: 12,
  },
  carousel: {
    flex: 1,
  },
  pageRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  emptyContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
  },
  bulkBar: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  bulkCount: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  bulkBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  bulkSell: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    borderWidth: 1,
    borderColor: colors.success,
  },
  bulkSellText: {
    color: colors.success,
    fontSize: 13,
    fontWeight: '700',
  },
  bulkDel: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: colors.error,
  },
  bulkDelConfirm: {
    backgroundColor: colors.velocityNegative,
    borderWidth: 1,
    borderColor: colors.velocityNegative,
  },
  bulkDelText: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '700',
  },
  bulkDelTextConfirm: {
    color: colors.background,
  },
  bulkCancelText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
});

const shiftStyles = StyleSheet.create({
  banner: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.warning,
    padding: 10,
    marginBottom: 12,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  title: {
    color: colors.warning,
    fontSize: 12,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    gap: 8,
  },
  name: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
  },
  move: {
    color: colors.textMuted,
    fontSize: 11,
    marginLeft: 'auto',
    flexShrink: 1,
  },
  kindTag: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '700',
  },
  watchTag: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
  },
  more: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 4,
    textAlign: 'right',
  },
});

const healthStyles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 12,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  link: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  bar: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 6,
    gap: 1,
  },
  seg: {
    height: '100%',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 6,
  },
  legendItem: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  headline: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 17,
  },
});

const rotationStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    maxHeight: '78%',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  title: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  sub: {
    color: colors.textMuted,
    fontSize: 11,
    marginBottom: 10,
  },
  list: {
    flexGrow: 0,
  },
  section: {
    color: colors.warning,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rank: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    width: 16,
  },
  main: {
    flex: 1,
    flexShrink: 1,
  },
  name: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  trigger: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 1,
  },
  numbers: {
    alignItems: 'flex-end',
  },
  value: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  vs: {
    fontSize: 10,
    marginTop: 1,
  },
  tag: {
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    width: 58,
    textAlign: 'right',
  },
  empty: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 24,
  },
});

const searchStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    marginLeft: 8,
  },
});

const quickViewStyles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 6,
    marginBottom: 12,
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
  statValue: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 17,
    fontWeight: 'bold',
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 13,
    marginTop: 1,
  },
});

const velocityStyles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginTop: 12,
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
