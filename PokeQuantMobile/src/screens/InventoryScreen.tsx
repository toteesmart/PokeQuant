import {
  useCallback,
  useMemo,
  useState,
} from 'react';
import { FlashList } from '@shopify/flash-list';
import { BlurView } from 'expo-blur';
import {
  LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { layout } from '../constants/theme';
import {
  buildInventoryImageUrl,
  useInventoryStore,
  type InventoryCard as InventoryCardType,
} from '../store/inventoryStore';
import { normalizeSearchTerm } from '../utils/search';
import { RestickerRadar } from '../components/RestickerRadar';
import { LiveSessionAnalytics } from '../components/LiveSessionAnalytics';
import { SyncBadge } from '../components/SyncBadge';
import { CatalogTimestamp } from '../components/CatalogTimestamp';
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
import { useProgressStore } from '../store/progressStore';
import type { WatchedCard } from '../store/watchlistStore';
import { DealAnalysisSheet } from '../scanner/molecules/DealAnalysisSheet';
import { matchForCardRef } from '../scanner/services/catalog/ScannerCatalogProvider';
import type { CatalogMatch } from '../scanner/services/catalog/catalogMatcher';
import { buildStockHealth } from '../scanner/services/deal/stockHealth';
import { buildSearchIndex } from '../services/inventorySearch';
import {
  featuresForCard,
  signalForCard,
} from '../services/inventoryReads';
import { useBulkSelection } from '../hooks/useBulkSelection';
import { useDeepFeatures } from '../hooks/useDeepFeatures';
import { useInventorySignals } from '../hooks/useInventorySignals';
import { SearchBar } from '../components/SearchBar';
import { PortfolioHero } from '../components/PortfolioHero';
import { VelocityBreakdown } from '../components/VelocityBreakdown';
import { StockHealthPanel } from '../components/StockHealthPanel';
import { RotationSheet } from '../components/RotationSheet';
import { ShiftBanner } from '../components/ShiftBanner';
import { GRID_GAP, InventoryCell } from '../components/InventoryCell';
import { styles } from './inventoryStyles';

type Card = InventoryCardType;

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

export function InventoryScreen() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const activeInventory = useInventoryStore((state) => state.activeInventory);
  const isSyncing = useInventoryStore((state) => state.isSyncing);
  const pendingSyncCount = useInventoryStore(
    (state) => state.pendingSyncCount
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
  const {
    selecting,
    selectedIds,
    confirmBulkDelete,
    handleStartSelect,
    handleToggleSelect,
    clearSelection,
    toggleSelectionMode,
    handleBulkSell,
    handleBulkDelete,
  } = useBulkSelection();

  const [searchQuery, setSearchQuery] = useState('');

  const [viewport, setViewport] = useState({ width, height });

  const {
    velocityData,
    signalMap,
    classShifts,
    watchShifts,
    dismissShifts,
  } = useInventorySignals(isCatalogReady, isExtracting);

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
  const deepFeatures = useDeepFeatures(activeInventory);
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
    Math.floor((width - layout.screenPadding * 2 - GRID_GAP) / 2)
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
      <ShiftBanner
        classShifts={classShifts}
        watchShifts={watchShifts}
        onAnalyze={handleAnalyze}
        onWatchAnalyze={handleWatchAnalyze}
        onDismiss={dismissShifts}
      />

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
