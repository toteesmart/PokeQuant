import { useCallback, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { InventoryCard as InventoryCardType } from '../store/inventoryStore';
import { RestickerRadar } from '../components/RestickerRadar';
import { LiveSessionAnalytics } from '../components/LiveSessionAnalytics';
import { SyncBadge } from '../components/SyncBadge';
import { CatalogTimestamp } from '../components/CatalogTimestamp';
import { SegmentedPills, TopChrome, TOP_CHROME_CLEARANCE } from '../components/ui';
import { SyncButton } from '../components/SyncButton';
import { SettingsGear } from '../components/SettingsGear';
import { InventoryActionTrays } from '../components/InventoryActionTrays';
import { PerformanceAnalytics } from '../components/PerformanceAnalytics';
import { EditAssetModal } from '../components/EditAssetModal';
import { DealAnalysisSheet } from '../scanner/molecules/DealAnalysisSheet';
import { useInventoryScreen } from '../hooks/useInventoryScreen';
import { SearchBar } from '../components/SearchBar';
import { PortfolioHero } from '../components/PortfolioHero';
import { VelocityBreakdown } from '../components/VelocityBreakdown';
import { StockHealthPanel } from '../components/StockHealthPanel';
import { RotationSheet } from '../components/RotationSheet';
import { ShiftBanner } from '../components/ShiftBanner';
import { InventoryCell } from '../components/InventoryCell';
import { BulkActionBar } from '../components/BulkActionBar';
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
  const insets = useSafeAreaInsets();
  const v = useInventoryScreen();
  const [activeTab, setActiveTab] = useState<InventoryTab>('cards');
  const { bulk } = v;

  const renderCell = useCallback(
    ({ item, index }: { item: Card; index: number }) => (
      <InventoryCell
        card={item}
        cellWidth={v.cellWidth}
        isLeftColumn={index % 2 === 0}
        selected={bulk.selectedIds.has(item.id)}
        onEdit={v.handleEdit}
        onAnalyze={v.handleAnalyze}
        selecting={bulk.selecting}
        onToggleSelect={bulk.handleToggleSelect}
        onStartSelect={bulk.handleStartSelect}
        signalMap={v.signals.signalMap}
      />
    ),
    [
      v.cellWidth,
      v.handleEdit,
      v.handleAnalyze,
      bulk.selecting,
      bulk.selectedIds,
      bulk.handleToggleSelect,
      bulk.handleStartSelect,
      v.signals.signalMap,
    ],
  );

  const emptyComponent = (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyText}>
        {v.searchQuery.trim() ? 'No cards match your search.' : 'No active inventory.'}
      </Text>
    </View>
  );

  // The cards tab's own scroller — hero, stock health, movement shifts and
  // the filter bar scroll away above the grid; trays and velocity sit below.
  const cardsHeader = (
    <>
      <View style={styles.statusRow}>
        <View style={styles.statusLeft}>
          <SyncBadge isSyncing={v.isSyncing} pendingSyncCount={v.pendingSyncCount} />
          <CatalogTimestamp />
        </View>
      </View>

      <PortfolioHero metrics={v.metrics} artUri={v.heroArtUri} />

      {/* Render whenever stock has value — under thin signal coverage the
          panel degrades to its "rough reads" state instead of vanishing
          when by-hand (unsignaled) cards dilute coverage. */}
      {v.health.totalValue > 0 ? (
        <StockHealthPanel health={v.health} onOpenRotation={() => v.setRotationOpen(true)} />
      ) : null}

      {/* Deal-class shifts since the last catalog refresh — each row
          taps through to that card's analysis. Watched cards are
          tagged so an unowned revival doesn't read as inventory. */}
      <ShiftBanner
        classShifts={v.signals.classShifts}
        watchShifts={v.signals.watchShifts}
        onAnalyze={v.handleAnalyze}
        onWatchAnalyze={v.handleWatchAnalyze}
        onDismiss={v.signals.dismissShifts}
      />

      {/* Select rides inside the search bar — one unified list toolbar,
          the universal inline-button chrome (filter-trigger recipe:
          surface + hairline + control radius). */}
      <View style={styles.listToolbar}>
        <SearchBar
          value={v.searchQuery}
          onChange={v.setSearchQuery}
          trailing={
            <TouchableOpacity
              style={styles.selectBtn}
              activeOpacity={0.7}
              onPress={bulk.selecting ? bulk.clearSelection : bulk.toggleSelectionMode}
              hitSlop={8}
              accessibilityLabel={bulk.selecting ? 'Done selecting' : 'Select cards'}
              accessibilityRole="button"
            >
              <Text style={styles.selectBtnText}>{bulk.selecting ? 'Done' : 'Select'}</Text>
            </TouchableOpacity>
          }
        />
      </View>
    </>
  );

  const cardsFooter = (
    <>
      <InventoryActionTrays />

      <VelocityBreakdown data={v.signals.velocityData} />
    </>
  );

  const analyticsContentStyle = {
    flexGrow: 1,
    minHeight: Math.max(0, v.viewport.height - 24),
    paddingHorizontal: 16,
    paddingTop: insets.top + TOP_CHROME_CLEARANCE,
    paddingBottom: 40,
  };

  return (
    <View style={styles.container}>
      {activeTab === 'radar' ? (
        // Radar owns a bounded flex host — its FlashList never nests inside
        // the outer ScrollView.
        <View style={[styles.radarHost, { paddingTop: insets.top + TOP_CHROME_CLEARANCE }]}>
          <RestickerRadar />
        </View>
      ) : activeTab === 'analytics' ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={analyticsContentStyle}
          onLayout={v.handleScrollLayout}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
        >
          <LiveSessionAnalytics />
          <PerformanceAnalytics />
        </ScrollView>
      ) : (
        // The grid IS the root scroller — header modules ride the top,
        // trays + velocity ride the bottom. Vertical browsing, no pager.
        <FlashList<Card>
          data={v.filteredInventory}
          numColumns={2}
          contentContainerStyle={
            // Bulk-select bar overlays ~64pt at the bottom — lift the
            // last row clear of it while selecting.
            bulk.selecting
              ? [
                  styles.listContent,
                  styles.listContentSelecting,
                  { paddingTop: insets.top + TOP_CHROME_CLEARANCE },
                ]
              : [styles.listContent, { paddingTop: insets.top + TOP_CHROME_CLEARANCE }]
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
        visible={v.editingCard !== null}
        card={v.editingCard}
        onClose={() => v.setEditingCard(null)}
      />

      {/* Name tap → the same deal analysis the scanner uses, in
          "you own it" language. */}
      {v.analysisFor ? (
        <DealAnalysisSheet
          match={v.analysisFor.match}
          subType={v.analysisFor.subType}
          ownership={v.analysisFor.ownership}
          onClose={v.closeAnalysis}
        />
      ) : null}

      <RotationSheet
        visible={v.rotationOpen}
        items={v.health.rotateOut}
        watchItems={v.watchItems}
        onSelect={(item) => {
          v.setRotationOpen(false);
          v.handleAnalyze(item.card as Card);
        }}
        onClose={() => v.setRotationOpen(false)}
      />

      {bulk.selecting && (
        <BulkActionBar
          selectedCount={bulk.selectedIds.size}
          confirmBulkDelete={bulk.confirmBulkDelete}
          onBulkSell={bulk.handleBulkSell}
          onBulkDelete={bulk.handleBulkDelete}
          onCancel={bulk.clearSelection}
        />
      )}
    </View>
  );
}
