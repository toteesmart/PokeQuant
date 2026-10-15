import { useCallback, useMemo, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import {
  Disclosure,
  TopChrome,
  TOP_CHROME_CLEARANCE,
} from '../components/ui';
import { SyncButton } from '../components/SyncButton';
import { SettingsGear } from '../components/SettingsGear';
import { ScoutDeck } from '../components/ScoutDeck';
import { ScoutPage } from '../components/ScoutPage';
import {
  SearchCatalogRow,
  type CatalogCardPair,
} from '../components/SearchCatalogRow';
import { Dropdown } from '../components/Dropdown';
import type { SearchLogPayload } from '../components/SearchCard';
import { useAuth } from '../hooks/useAuth';
import {
  useInventoryStore,
  type InventoryInput,
} from '../store/inventoryStore';
import type { CatalogCard } from '../db/catalogDb';
import type { ScoutCandidate } from '../scanner/services/deal/buyScout';
import { getCatalogImageUri } from '../services/CatalogImageService';
import { toErrorMessage } from '../utils/log';
import { styles } from './searchBuyStyles';
import { useCatalogDb } from '../hooks/useCatalogDb';
import {
  LANGUAGES,
  PRODUCT_TYPES,
  RARITIES,
  SORT_OPTIONS,
  useCatalogSearch,
} from '../hooks/useCatalogSearch';
import { useBuyScout } from '../hooks/useBuyScout';
import { ScannerScreen } from './ScannerScreen';
import { DealAnalysisSheet } from '../scanner/molecules/DealAnalysisSheet';
import { matchForCardRef } from '../scanner/services/catalog/ScannerCatalogProvider';
import type { CatalogMatch } from '../scanner/services/catalog/catalogMatcher';



export function SearchBuyScreen() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { userId } = useAuth();
  const addInventoryCard = useInventoryStore((state) => state.addInventoryCard);
  const activeInventory = useInventoryStore((state) => state.activeInventory);
  const refreshInventoryState = useInventoryStore(
    (state) => state.refreshInventoryState
  );


  const {
    catalogDb,
    isCatalogReady,
    catalogError,
    downloadProgress,
    downloadStatus,
  } = useCatalogDb();
  const { scout, floorBuys, redeployValue } = useBuyScout(
    catalogDb,
    isCatalogReady,
    activeInventory
  );
  const {
    query,
    setQuery,
    rarity,
    setRarity,
    productType,
    setProductType,
    language,
    setLanguage,
    sortBy,
    setSortBy,
    maxPrice,
    setMaxPrice,
    pairedResults,
    searchResults,
    isSearching,
    searchError,
    hasQuery,
    isFetchingNextPage,
    handleLoadMore,
  } = useCatalogSearch(catalogDb, isCatalogReady);
  const loadError = catalogError ?? searchError;

  const [expanded, setExpanded] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scoutVisible, setScoutVisible] = useState(false);
  const [analysisFor, setAnalysisFor] = useState<{
    match: CatalogMatch;
    subType?: string;
  } | null>(null);

  const handleScoutSelect = useCallback((c: ScoutCandidate) => {
    void matchForCardRef({
      productId: c.productId,
      name: c.name,
      number: c.number,
      set: c.set,
      rarity: c.rarity,
      imageUrl: getCatalogImageUri(c.productId),
      subType: c.subType,
      marketPrice: c.price,
    })
      .then((m) => setAnalysisFor({ match: m, subType: c.subType }))
      .catch(() => {});
  }, []);

  // Name tap → deal analysis in general market language (no cost basis —
  // this is a card you're evaluating, not one you own).
  const handleAnalyze = useCallback((card: CatalogCard, variant: string) => {
    const market =
      card.variants.find((v) => v.subType === variant)?.marketPrice ??
      card.liveMarket;
    void matchForCardRef({
      productId: card.productId,
      name: card.name,
      number: card.number,
      set: card.set,
      rarity: card.rarity,
      imageUrl: card.imageUrl,
      subType: variant,
      marketPrice: market,
    })
      .then((m) => setAnalysisFor({ match: m, subType: variant }))
      .catch(() => {});
  }, []);

  const handleLogToInventory = useCallback(
    async (payload: SearchLogPayload) => {
      if (!userId) {
        Alert.alert('Not signed in', 'Sign in to save cards to your inventory.');
        return;
      }

      try {
        const input: InventoryInput = {
          name: payload.cardName,
          number: payload.cardNumber,
          set: payload.setName,
          rarity: payload.variant,
          productType: payload.variant,
          condition: payload.condition,
          liveMarket: payload.liveMarket,
          amountPaid: payload.cashOffer,
          stickerPrice: payload.stickerPrice,
          imageUrl: payload.imageUrl,
          productId: payload.productId,
        };
        await addInventoryCard(input);
        await refreshInventoryState();
        Alert.alert('Added', `${payload.cardName} is in your inventory.`);
      } catch (err) {
        console.error('Log to inventory failed:', err);
        Alert.alert("Couldn't add card", toErrorMessage(err));
      }
    },
    [userId, addInventoryCard, refreshInventoryState]
  );

  const cardWidth = useMemo(
    () => Math.max(1, (width - 34) / 2),
    [width]
  );

  const renderItem = useCallback(
    ({ item }: { item: CatalogCardPair }) => (
      <SearchCatalogRow
        pair={item}
        rowWidth={width}
        cardWidth={cardWidth}
        catalogDb={catalogDb}
        onAnalyze={handleAnalyze}
        onLogToInventory={handleLogToInventory}
      />
    ),
    [width, cardWidth, catalogDb, handleAnalyze, handleLogToInventory]
  );


  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}>
      <View style={styles.inner}>
        <View
          style={[
            styles.header,
            { paddingTop: insets.top + TOP_CHROME_CLEARANCE },
          ]}>
          <View style={styles.searchRow}>
            <View style={styles.searchField}>
              <Ionicons
                name="search"
                size={15}
                color={colors.textMuted}
              />
              <TextInput
                style={styles.searchInput}
                placeholder="Card name, number, or set"
                placeholderTextColor={colors.textMuted}
                value={query}
                onChangeText={setQuery}
              />
            </View>
            <TouchableOpacity
              style={styles.scanButton}
              activeOpacity={0.7}
              onPress={() => setScannerVisible(true)}
              accessibilityLabel="Scan a card"
              accessibilityRole="button">
              <Ionicons
                name="scan-outline"
                size={20}
                color={colors.textMuted}
              />
            </TouchableOpacity>
          </View>

          <Disclosure
            label="Filters & sorting"
            expanded={expanded}
            onToggle={() => setExpanded((v) => !v)}>
            <View style={styles.filterCard}>
              <View style={[styles.filterRow, { zIndex: 3 }]}>
                <View style={styles.filterHalfLeft}>
                  <Text style={styles.filterLabel}>Rarity</Text>
                  <Dropdown options={RARITIES} value={rarity} onSelect={setRarity} />
                </View>
                <View style={styles.filterHalfRight}>
                  <Text style={styles.filterLabel}>Product type</Text>
                  <Dropdown options={PRODUCT_TYPES} value={productType} onSelect={setProductType} />
                </View>
              </View>

              <View style={[styles.filterRow, { zIndex: 2 }]}>
                <View style={styles.filterHalfLeft}>
                  <Text style={styles.filterLabel}>Language</Text>
                  <Dropdown options={LANGUAGES} value={language} onSelect={setLanguage} />
                </View>
                <View style={styles.filterHalfRight}>
                  <Text style={styles.filterLabel}>Sort by</Text>
                  <Dropdown options={SORT_OPTIONS} value={sortBy} onSelect={setSortBy} />
                </View>
              </View>

              <View style={[styles.filterRow, { zIndex: 1, marginBottom: 0 }]}>
                <View style={styles.filterHalfLeft}>
                  <Text style={styles.filterLabel}>Max price ($)</Text>
                  <TextInput
                    style={styles.numberInput}
                    placeholder="e.g. 50"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="numeric"
                    value={maxPrice}
                    onChangeText={setMaxPrice}
                  />
                </View>
              </View>
            </View>
          </Disclosure>

          {hasQuery ? (
            <Text style={styles.resultsCount}>
              {isSearching
                ? 'Searching...'
                : `${searchResults.length} result${
                    searchResults.length !== 1 ? 's' : ''
                  }`}
            </Text>
          ) : null}
        </View>

        <View style={styles.listWrapper}>
          {!isCatalogReady ? (
            <View style={styles.empty}>
              <ActivityIndicator color={colors.primary} size="large" />
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${Math.round(downloadProgress * 100)}%` },
                  ]}
                />
              </View>
              <Text style={[styles.emptyText, { marginTop: 16 }]}>
                {downloadStatus}
              </Text>
            </View>
          ) : loadError ? (
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: colors.error }]}>
                {loadError}
              </Text>
            </View>
          ) : !hasQuery ? (
            <ScrollView contentContainerStyle={styles.emptyScroll}>
              {scout.length > 0 ? (
                <TouchableOpacity
                  style={styles.scoutHead}
                  activeOpacity={0.7}
                  onPress={() => setScoutVisible(true)}
                  accessibilityRole="button"
                  accessibilityLabel={`See all ${scout.length} buy-scout cards`}>
                  <Ionicons
                    name="compass-outline"
                    size={15}
                    color={colors.accentPurple}
                  />
                  <Text style={styles.scoutTitle}>Buy scout</Text>
                  <View style={styles.scoutCount}>
                    <Text style={styles.scoutCountText}>{scout.length}</Text>
                  </View>
                  <Text style={styles.scoutSwipe}>See all</Text>
                  <Ionicons
                    name="chevron-forward"
                    size={12}
                    color={colors.accentPurple}
                  />
                </TouchableOpacity>
              ) : null}
              <ScoutDeck
                candidates={scout.slice(0, 10)}
                totalCount={scout.length}
                redeployValue={redeployValue}
                onSelect={handleScoutSelect}
                onSeeAll={() => setScoutVisible(true)}
              />
            </ScrollView>
          ) : (
            <FlashList
              data={pairedResults}
              keyExtractor={(item) => `${item[0].id}-${item[1]?.id ?? 'solo'}`}
              renderItem={renderItem}
              contentContainerStyle={styles.listContent}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              onEndReached={handleLoadMore}
              onEndReachedThreshold={0.5}
              style={{ flex: 1 }}
              ListFooterComponent={
                isFetchingNextPage ? (
                  <View style={styles.footerSpinner}>
                    <ActivityIndicator color={colors.text}/>
                  </View>
                ) : null
              }
              ListEmptyComponent={
                isSearching ? (
                  <View style={styles.empty}>
                    <Text style={styles.emptyText}>Searching...</Text>
                  </View>
                ) : (
                  <View style={styles.empty}>
                    <Text style={styles.emptyText}>
                      No cards match your filters.
                    </Text>
                  </View>
                )
              }
            />
          )}
        </View>

      </View>

      {/* Floating glass chrome — sync pill left, settings pill right,
          and a centered caption telling you what this screen is for. */}
      <TopChrome
        left={<SyncButton variant="glass" />}
        center={
          <Text style={styles.chromeHint}>
            Search the price list — or scan the card in your hand
          </Text>
        }
        right={<SettingsGear variant="glass" />}
      />

      <Modal
        visible={scannerVisible}
        presentationStyle="fullScreen"
        animationType="slide"
        onRequestClose={() => setScannerVisible(false)}>
        <ScannerScreen
          onClose={() => setScannerVisible(false)}
          onDone={() => setScannerVisible(false)}
        />
      </Modal>

      <Modal
        visible={scoutVisible}
        presentationStyle="fullScreen"
        animationType="slide"
        onRequestClose={() => setScoutVisible(false)}>
        <ScoutPage
          candidates={scout}
          floorBuys={floorBuys}
          redeployValue={redeployValue}
          onSelect={(c) => {
            // The analysis sheet renders its own Modal — it can't stack
            // over this page's Modal, so scout must exit first.
            setScoutVisible(false);
            handleScoutSelect(c);
          }}
          onClose={() => setScoutVisible(false)}
        />
      </Modal>

      {analysisFor ? (
        <DealAnalysisSheet
          match={analysisFor.match}
          subType={analysisFor.subType}
          onClose={() => setAnalysisFor(null)}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}
