import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import {
  LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';
import { controls, layout, radius, spacing, type_, weight } from '../constants/theme';
import { InventoryCard } from '../components/InventoryCard';
import {
  buildInventoryImageUrl,
  useInventoryStore,
  type InventoryCard as InventoryCardType,
} from '../store/inventoryStore';
import { MiniMoverCard, type Mover } from '../components/MiniMoverCard';
import { formatCurrency, formatSignedCurrency } from '../utils/format';
import { RestickerRadar } from '../components/RestickerRadar';
import { LiveSessionAnalytics } from '../components/LiveSessionAnalytics';
import { SyncBadge } from '../components/SyncBadge';
import { CatalogTimestamp } from '../components/CatalogTimestamp';
import {
  openCatalogDatabase,
  getCardSignals,
  getPriceSeriesBulk,
  getProductMarketData,
  pickSignalForFinish,
  type CardSignal,
  type ProductMarketMap,
} from '../db/catalogDb';
import {
  SegmentedPills,
  TopChrome,
  TOP_CHROME_CLEARANCE,
} from '../components/ui';
import { SyncButton } from '../components/SyncButton';
import { SettingsGear } from '../components/SettingsGear';
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
import { DeltaPill, GlassSheet, ScoreRing } from '../components/ui';
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
  BUCKET_DESC,
  type StockHealth,
  type StockHealthItem,
} from '../scanner/services/deal/stockHealth';
import {
  buildSeriesFeatures,
  type SeriesFeatures,
} from '../scanner/services/deal/seriesSignals';

type Card = InventoryCardType;

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

function SearchBar({
  value,
  onChange,
  trailing,
}: {
  value: string;
  onChange: (text: string) => void;
  trailing?: ReactNode;
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
      {trailing}
    </View>
  );
}

/** Portfolio hero — the finance-app anatomy adapted to a card binder:
 *  what it's worth as the big number, the profit delta as a pill, and
 *  count folded into the label + cost basis into the pill itself.
 *  "Worth" is projected sticker value, not liquid cash — the label
 *  keeps that honest. */
function PortfolioHero({
  metrics,
  artUri,
}: {
  metrics: typeof METRICS;
  artUri?: string;
}) {
  const profit = metrics.projectedProfit;
  const profitColor =
    profit > 0
      ? colors.velocityPositive
      : profit < 0
        ? colors.velocityNegative
        : colors.textMuted;
  return (
    <View style={heroStyles.wrap}>
      {artUri ? (
        <>
          <Image
            source={{ uri: artUri }}
            style={StyleSheet.absoluteFill}
            blurRadius={60}
            contentFit="cover"
            cachePolicy="memory-disk"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
          <LinearGradient
            colors={[colors.background, 'transparent', colors.background]}
            locations={[0, 0.45, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </>
      ) : null}
      <Text style={heroStyles.label} numberOfLines={1}>
        Total sticker value · {metrics.activeAssets}{' '}
        {metrics.activeAssets === 1 ? 'card' : 'cards'}
      </Text>
      <Text style={heroStyles.value}>
        {formatCurrency(metrics.projectedSticker)}
      </Text>
      <DeltaPill
        text={
          metrics.totalCostBasis > 0
            ? `${formatSignedCurrency(profit)} vs ${formatCurrency(
                metrics.totalCostBasis,
              )} paid`
            : `${formatSignedCurrency(profit)} vs what you paid`
        }
        color={profitColor}
        icon={
          profit > 0 ? 'caret-up' : profit < 0 ? 'caret-down' : undefined
        }
        style={heroStyles.pill}
      />
    </View>
  );
}

type Period = '1d' | '3d' | '1w';

type VelocityWindow = {
  label: string;
  change: number;
  movers: Mover[];
};

type InventoryTab = 'cards' | 'radar' | 'analytics';

const INVENTORY_TABS: readonly {
  key: InventoryTab;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: 'cards', label: 'Cards', icon: 'albums-outline' },
  { key: 'radar', label: 'Resticker', icon: 'pricetag-outline' },
  { key: 'analytics', label: 'Stats', icon: 'stats-chart-outline' },
];

const DEFAULT_VELOCITY: Record<Period, VelocityWindow> = {
  '1d': { label: 'Today', change: 0, movers: [] },
  '3d': { label: '3 days', change: 0, movers: [] },
  '1w': { label: 'This week', change: 0, movers: [] },
};

const VELOCITY_PERIODS: Period[] = ['1d', '3d', '1w'];

const VELOCITY_PILL_TABS: readonly {
  key: Period;
  label: string;
}[] = [
  { key: '1d', label: 'Today' },
  { key: '3d', label: '3 days' },
  { key: '1w', label: 'This week' },
];

const VELOCITY_DELTA_KEY: Record<Period, keyof ProductVelocity> = {
  '1d': 'price1d',
  '3d': 'price3d',
  '1w': 'price7d',
};

const VELOCITY_LABEL: Record<Period, string> = {
  '1d': 'Today',
  '3d': '3 days',
  '1w': 'This week',
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

type InventoryCellProps = {
  card: Card;
  cellWidth: number;
  isLeftColumn: boolean;
  selected: boolean;
  onEdit: (card: Card) => void;
  onAnalyze: (card: Card) => void;
  selecting: boolean;
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

// Same finish fallback as the signal map — the held finish first,
// then Normal, then whatever's loaded.
function featuresForCard(
  featureMap: Record<number, Record<string, SeriesFeatures>>,
  card: { productId?: number | null; productType?: string }
): SeriesFeatures | undefined {
  if (card.productId == null) return undefined;
  const byFinish = featureMap[card.productId];
  if (!byFinish) return undefined;
  const finish = card.productType;
  return (
    (finish ? byFinish[finish] : undefined) ??
    byFinish.Normal ??
    Object.values(byFinish)[0]
  );
}

/** One grid cell — the FlashList renders two per row via numColumns.
 *  The wrapper carries the gaps (v2 dropped columnWrapperStyle):
 *  marginRight on the left column, marginBottom on every row. */
const InventoryCell = memo(function InventoryCell({
  card,
  cellWidth,
  isLeftColumn,
  selected,
  onEdit,
  onAnalyze,
  selecting,
  onToggleSelect,
  onStartSelect,
  signalMap,
}: InventoryCellProps) {
  return (
    <View
      style={[
        styles.gridCell,
        isLeftColumn ? styles.gridCellLeft : styles.gridCellRight,
      ]}>
      <InventoryCard
        card={card}
        width={cellWidth}
        onEdit={onEdit}
        onAnalyze={onAnalyze}
        signal={signalForCard(signalMap, card)}
        selecting={selecting}
        selected={selected}
        onToggleSelect={() => onToggleSelect(card)}
        onStartSelect={() => onStartSelect(card)}
      />
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
      {/* Gloss sheen — the module-family highlight. */}
      <LinearGradient
        colors={[colors.overlay4, 'transparent']}
        locations={[0, 0.55]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <TouchableOpacity
        style={velocityStyles.header}
        onPress={() => setVelocityExpanded((v) => !v)}>
        <Text style={velocityStyles.title}>Price moves since last update</Text>
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
                      ? colors.successTint
                      : colors.errorTint,
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
          <SegmentedPills
            tabs={VELOCITY_PILL_TABS}
            activeTab={selectedPeriod}
            onChange={setSelectedPeriod}
            style={velocityStyles.periodRail}
          />

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
  const rotateCount = health.rotateOut.length;
  const hasData = health.items.length > 0;
  const unreadPct = Math.round((1 - health.coverage) * 100);
  // Segments cover the signaled share only — the unfilled track IS the
  // "no price data" portion, named in the legend so it isn't a silent gap.
  const segments = active.map((b) => ({
    fraction: health.buckets[b].value / health.totalValue,
    color: BUCKET_COLOR[b],
  }));
  const goodPct = Math.round(
    ((health.buckets.grow.value + health.buckets.keep.value) /
      health.totalValue) *
      100
  );
  return (
    <TouchableOpacity
      style={healthStyles.container}
      activeOpacity={0.85}
      disabled={!hasData}
      onPress={onOpenRotation}
      accessibilityRole="button"
      accessibilityLabel="Stock health details"
      accessibilityState={{ disabled: !hasData }}>
      {/* Gloss sheen — same finance-app highlight as AppButton/pills. */}
      <LinearGradient
        colors={[colors.overlay4, 'transparent']}
        locations={[0, 0.55]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <Text style={healthStyles.title}>How your stock is doing</Text>
      <View style={healthStyles.accent} />
      {hasData ? (
        <View style={healthStyles.ringRow}>
          <ScoreRing
            size={76}
            strokeWidth={7}
            segments={segments}
            label={`${goodPct}%`}
            sublabel="healthy"
          />
          <View style={healthStyles.legend}>
            {active.map((b) => (
              <View key={b} style={healthStyles.legendRow}>
                <View
                  style={[
                    healthStyles.legendBar,
                    { backgroundColor: BUCKET_COLOR[b] },
                  ]}
                />
                <Text
                  style={healthStyles.legendItem}
                  numberOfLines={1}>
                  {`${BUCKET_LABEL[b]} — ${BUCKET_DESC[b]}`}
                </Text>
                <Text
                  style={[
                    healthStyles.legendPct,
                    { color: BUCKET_COLOR[b] },
                  ]}>
                  {Math.round(
                    (health.buckets[b].value / health.totalValue) * 100
                  )}
                  %
                </Text>
              </View>
            ))}
            {unreadPct > 0 ? (
              <View style={healthStyles.legendRow}>
                <View
                  style={[
                    healthStyles.legendBar,
                    { backgroundColor: colors.border },
                  ]}
                />
                <Text
                  style={healthStyles.legendItem}
                  numberOfLines={1}>
                  No price data
                </Text>
                <Text style={healthStyles.legendPct}>{unreadPct}%</Text>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
      {/* Read + action share one line — headline flows left, badge
          pill anchors right. The wrapping View guarantees the text
          shrinks instead of pushing the pill off-edge (flex row +
          Text shrink quirk). The whole module is the touch target. */}
      <View style={healthStyles.footer}>
        <View style={healthStyles.headlineWrap}>
          <Text style={healthStyles.headline}>{health.headline}</Text>
        </View>
        {hasData ? (
          <View style={healthStyles.footerPill}>
            <Text style={healthStyles.link}>
              {rotateCount > 0
                ? `Sell first — ${rotateCount} card${rotateCount === 1 ? '' : 's'}`
                : 'Review your stock'}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={12}
              color={colors.primary}
            />
          </View>
        ) : null}
      </View>
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
          <Text style={rotationStyles.trigger} numberOfLines={1}>
            {item.trigger
              ? `${item.read.label} · ${item.trigger}`
              : item.read.label}
          </Text>
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
              {formatCurrency(vs)} vs paid
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

  if (!visible) return null;

  return (
    <GlassSheet title="Sell these first" onClose={onClose}>
      <>
        <Text style={rotationStyles.sub}>
          Sorted by money tied up — selling the top cards frees the most cash.
        </Text>
        {items.map(renderItem)}
        {watchItems.length > 0 ? (
          <>
            <Text style={rotationStyles.section}>
              Almost a sell — holding, but one price drop away
            </Text>
            {watchItems.map(renderItem)}
          </>
        ) : null}
        {items.length === 0 && watchItems.length === 0 ? (
          <Text style={rotationStyles.empty}>
            Nothing flagged — your stock is working.
          </Text>
        ) : null}
      </>
    </GlassSheet>
  );
}

export function InventoryScreen() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const activeInventory = useInventoryStore((state) => state.activeInventory);
  const isSyncing = useInventoryStore((state) => state.isSyncing);
  const pendingSyncCount = useInventoryStore(
    (state) => state.pendingSyncCount
  );
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

  // Bulk-select mode: long-press a card OR the header "Select" button
  // to enter, tap cards to toggle. Entered via long-press, deselecting
  // the last card exits; entered via the button it stays until Cancel.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const bulkDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selecting = selectionMode || selectedIds.size > 0;

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
    setSelectionMode(false);
    setConfirmBulkDelete(false);
  }, []);

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((m) => {
      if (m) {
        setSelectedIds(new Set());
        setConfirmBulkDelete(false);
        return false;
      }
      return true;
    });
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
            // Same finish fallback the held path uses — requested
            // finish, then Normal, then any loaded variant — so the
            // shift label can't classify a different finish than the
            // badge and sheet would pick for the same row.
            signal: pickSignalForFinish(signals, {
              productId: w.productId,
              productType: w.subType,
            }),
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

  const metrics = useMemo(
    () => ({
      activeAssets: activeInventory.length,
      totalCostBasis: activeInventory.reduce((sum, c) => sum + c.amountPaid, 0),
      projectedSticker: activeInventory.reduce((sum, c) => sum + c.stickerPrice, 0),
      projectedProfit: activeInventory.reduce((sum, c) => sum + c.projProfit, 0),
    }),
    [activeInventory]
  );

  // The hero bleeds the top-value card's art — same resolution the card
  // itself uses, so the wash always matches what's on screen.
  const heroArtUri = useMemo(() => {
    const top = activeInventory.reduce<InventoryCardType | null>(
      (t, c) => (c.stickerPrice > (t?.stickerPrice ?? 0) ? c : t),
      null
    );
    return top
      ? buildInventoryImageUrl(top.imageUrl, top.productId)
      : undefined;
  }, [activeInventory]);

  // Portfolio triage — first a synchronous scalar pass over the stamped
  // signals, then the held cards' price_series hydrates in the
  // background and the buckets refine to the same deep read the
  // analysis sheet uses (floors, failed bounces, bounce memory).
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
  const health = useMemo(
    () =>
      buildStockHealth(
        activeInventory,
        (c) => signalForCard(signalMap, c as Card),
        (c) => featuresForCard(deepFeatures, c)
      ),
    [activeInventory, signalMap, deepFeatures]
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

  const [activeTab, setActiveTab] = useState<InventoryTab>('cards');

  // Two-up grid cells — the card receives the exact column width so
  // FlashList can lay out flat rows without pre-chunking pairs.
  const cellWidth = Math.max(
    0,
    Math.floor((width - layout.screenPadding * 2 - GAP) / 2)
  );

  const analyticsContentStyle = {
    flexGrow: 1,
    minHeight: Math.max(0, viewport.height - 24),
    paddingHorizontal: 16,
    paddingTop: insets.top + TOP_CHROME_CLEARANCE,
    paddingBottom: 40,
  };

  const renderCell = useCallback(
    ({ item, index }: { item: Card; index: number }) => (
      <InventoryCell
        card={item}
        cellWidth={cellWidth}
        isLeftColumn={index % 2 === 0}
        selected={selectedIds.has(item.id)}
        onEdit={handleEdit}
        onAnalyze={handleAnalyze}
        selecting={selecting}
        onToggleSelect={handleToggleSelect}
        onStartSelect={handleStartSelect}
        signalMap={signalMap}
      />
    ),
    [cellWidth, handleEdit, handleAnalyze, selecting, selectedIds, handleToggleSelect, handleStartSelect, signalMap]
  );

  const emptyComponent = (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyText}>
        {searchQuery.trim()
          ? 'No cards match your search.'
          : 'No active inventory.'}
      </Text>
    </View>
  );

  // The cards tab's own scroller — hero, stock health, movement shifts and
  // the filter bar scroll away above the grid; trays and velocity sit below.
  const cardsHeader = (
    <>
      <View style={styles.statusRow}>
        <View style={styles.statusLeft}>
          <SyncBadge
            isSyncing={isSyncing}
            pendingSyncCount={pendingSyncCount}
          />
          <CatalogTimestamp />
        </View>
      </View>

      <PortfolioHero metrics={metrics} artUri={heroArtUri} />

      {/* Render whenever stock has value — under thin signal coverage the
          panel degrades to its "rough reads" state instead of vanishing
          when by-hand (unsignaled) cards dilute coverage. */}
      {health.totalValue > 0 ? (
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
            <View>
              <Text style={shiftStyles.title}>Movement shifts</Text>
              <View style={shiftStyles.accent} />
            </View>
            <TouchableOpacity
              onPress={() => {
                setClassShifts([]);
                setWatchShifts([]);
              }}
              hitSlop={8}
              accessibilityLabel="Dismiss movement shifts"
              accessibilityRole="button">
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
                    {s.kind === 'revival' ? ' · starting to rise' : ' · floor broke'}
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
                <Text style={shiftStyles.watchTag}> · on your watchlist</Text>
                {s.kind !== 'move' ? (
                  <Text style={shiftStyles.kindTag}>
                    {s.kind === 'revival' ? ' · starting to rise' : ' · floor broke'}
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

      {/* Select rides inside the search bar — one unified list toolbar,
          the universal inline-button chrome (filter-trigger recipe:
          surface + hairline + control radius). */}
      <View style={styles.listToolbar}>
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          trailing={
            <TouchableOpacity
              style={styles.selectBtn}
              activeOpacity={0.7}
              onPress={selecting ? clearSelection : toggleSelectionMode}
              hitSlop={8}
              accessibilityLabel={
                selecting ? 'Done selecting' : 'Select cards'
              }
              accessibilityRole="button">
              <Text style={styles.selectBtnText}>
                {selecting ? 'Done' : 'Select'}
              </Text>
            </TouchableOpacity>
          }
        />
      </View>
    </>
  );

  const cardsFooter = (
    <>
      <InventoryActionTrays />

      <VelocityBreakdown data={velocityData} />
    </>
  );

  return (
    <View style={styles.container}>
      {activeTab === 'radar' ? (
        // Radar owns a bounded flex host — its FlashList never nests inside
        // the outer ScrollView.
        <View
          style={[
            styles.radarHost,
            { paddingTop: insets.top + TOP_CHROME_CLEARANCE },
          ]}>
          <RestickerRadar />
        </View>
      ) : activeTab === 'analytics' ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={analyticsContentStyle}
          onLayout={handleScrollLayout}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled>
          <LiveSessionAnalytics />
          <PerformanceAnalytics />
        </ScrollView>
      ) : (
        // The grid IS the root scroller — header modules ride the top,
        // trays + velocity ride the bottom. Vertical browsing, no pager.
        <FlashList<Card>
          data={filteredInventory}
          numColumns={2}
          contentContainerStyle={
            // Bulk-select bar overlays ~64pt at the bottom — lift the
            // last row clear of it while selecting.
            selecting
              ? [
                  styles.listContent,
                  styles.listContentSelecting,
                  { paddingTop: insets.top + TOP_CHROME_CLEARANCE },
                ]
              : [
                  styles.listContent,
                  { paddingTop: insets.top + TOP_CHROME_CLEARANCE },
                ]
          }
          keyExtractor={(item) => item.id}
          renderItem={renderCell}
          ListHeaderComponent={cardsHeader}
          ListFooterComponent={cardsFooter}
          ListEmptyComponent={emptyComponent}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Floating glass chrome — sync pill left, segmented rail centered,
          settings pill right. Sheets/modals mount after it so they still
          draw on top. */}
      <TopChrome
        left={<SyncButton variant="glass" />}
        center={
          <SegmentedPills
            glass
            style={styles.railInChrome}
            tabs={INVENTORY_TABS}
            activeTab={activeTab}
            onChange={setActiveTab}
          />
        }
        right={<SettingsGear variant="glass" />}
      />

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
          <BlurView
            intensity={30}
            tint="dark"
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <Text style={styles.bulkCount}>
            {selectedIds.size} selected
          </Text>
          <TouchableOpacity
            style={[
              styles.bulkBtn,
              styles.bulkSell,
              selectedIds.size === 0 && styles.bulkBtnDisabled,
            ]}
            activeOpacity={0.8}
            disabled={selectedIds.size === 0}
            onPress={handleBulkSell}>
            <Text style={styles.bulkSellText}>Sell</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.bulkBtn,
              confirmBulkDelete ? styles.bulkDelConfirm : styles.bulkDel,
              selectedIds.size === 0 && styles.bulkBtnDisabled,
            ]}
            activeOpacity={0.8}
            disabled={selectedIds.size === 0}
            onPress={handleBulkDelete}>
            <Text
              style={[
                styles.bulkDelText,
                confirmBulkDelete && styles.bulkDelTextConfirm,
              ]}>
              {confirmBulkDelete ? 'Sure?' : 'Delete'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.bulkBtn, styles.bulkCancel]}
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
  radarHost: {
    flex: 1,
    paddingHorizontal: 16,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    flexGrow: 1,
  },
  railInChrome: {
    marginVertical: 0,
  },
  listContentSelecting: {
    paddingBottom: 88,
  },
  gridCell: {
    marginBottom: GAP,
  },
  // Half-gap on each column edge — a full GAP marginRight on the left
  // cell alone left ~6pt of dead space at the right screen edge.
  gridCellLeft: {
    marginRight: GAP / 2,
  },
  gridCellRight: {
    marginLeft: GAP / 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  listToolbar: {
    marginBottom: spacing['2xl'],
  },
  // Badge-pill toggle — same verdict-badge recipe as the module action:
  // tint fill + primary hairline + primary label.
  selectBtn: {
    height: controls.chipHeight + spacing.sm,
    justifyContent: 'center',
    paddingHorizontal: spacing['2xl'],
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  selectBtnText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  bulkBtnDisabled: {
    opacity: 0.4,
  },
  emptyContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    minHeight: 320,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
  },
  // Floating bulk bar — frosted-chrome family (BlurView + overlay3 +
  // hairline + lift), actions inside are badge pills.
  bulkBar: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.overlay3,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.cardLg,
    overflow: 'hidden',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing['3xl'],
    elevation: 8,
    shadowColor: colors.black,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  bulkCount: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  bulkBtn: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing['3xl'],
    borderRadius: radius.pill,
  },
  bulkCancel: {
    backgroundColor: colors.overlay4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bulkSell: {
    backgroundColor: colors.successTintStrong,
    borderWidth: 1,
    borderColor: colors.success,
  },
  bulkSellText: {
    color: colors.success,
    fontSize: 13,
    fontWeight: '700',
  },
  bulkDel: {
    backgroundColor: colors.errorTintStrong,
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
  // Soft tile + warning accent — the box border retired; the warning
  // accent bar carries the "pay attention" signal instead.
  banner: {
    backgroundColor: colors.overlay2,
    borderRadius: radius.cardLg,
    padding: layout.cardPadding,
    marginBottom: layout.gridGap,
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
  accent: {
    width: 24,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.warning,
    marginTop: spacing.xs,
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
  // Glossy module surface — same recipe as the glass rail/circles
  // (overlay3 + hairline + lift) plus the button sheen above.
  container: {
    backgroundColor: colors.overlay3,
    borderRadius: radius.cardLg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: layout.cardPadding,
    marginBottom: layout.gridGap,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: colors.black,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  title: {
    color: colors.text,
    fontSize: type_.body,
    fontWeight: weight.bold,
  },
  accent: {
    width: 24,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  link: {
    color: colors.primary,
    fontSize: type_.label,
    fontWeight: weight.bold,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  // Badge-pill action — verdict-badge recipe (tint fill + colored
  // hairline + colored label), primary being the app's action color.
  footerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primaryTint,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.md,
  },
  ringRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['3xl'],
    marginBottom: spacing.lg,
  },
  legend: {
    flex: 1,
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  legendBar: {
    width: 3,
    height: 14,
    borderRadius: radius.pill,
  },
  legendItem: {
    flex: 1,
    color: colors.textMuted,
    fontSize: type_.caption,
    fontWeight: weight.semibold,
  },
  legendPct: {
    color: colors.text,
    fontSize: type_.label,
    fontWeight: weight.bold,
  },
  headlineWrap: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  headline: {
    color: colors.text,
    fontSize: type_.label,
    lineHeight: 17,
  },
});

const rotationStyles = StyleSheet.create({
  sub: {
    color: colors.textMuted,
    fontSize: 11,
    marginBottom: 10,
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
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.overlay3,
    borderRadius: radius.controlLg,
    paddingHorizontal: spacing['2xl'],
    minHeight: controls.minTouchTarget,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    marginLeft: 8,
  },
});

const heroStyles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 16,
  },
  label: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  value: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '800',
    marginTop: 4,
  },
  pill: {
    marginTop: 8,
  },
});

const velocityStyles = StyleSheet.create({
  // Glossy lifted module — same recipe as StockHealthPanel (overlay3 +
  // hairline + lift); the sheen renders inside as first child.
  container: {
    backgroundColor: colors.overlay3,
    borderRadius: radius.cardLg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginTop: layout.gridGap,
    elevation: 8,
    shadowColor: colors.black,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  header: {
    padding: layout.cardPadding,
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
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginRight: spacing.sm,
    marginBottom: spacing.xs,
  },
  summaryPillText: {
    fontSize: 9,
    fontWeight: '600',
  },
  body: {
    padding: 8,
    paddingTop: 0,
  },
  periodRail: {
    marginVertical: 0,
    marginBottom: spacing.lg,
    alignSelf: 'stretch',
  },
  moverScroll: {
    paddingVertical: 2,
  },
});
