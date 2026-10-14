import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import {
  Disclosure,
  GlassBackButton,
  SegmentedPills,
  TopChrome,
  TOP_CHROME_CLEARANCE,
} from '../components/ui';
import { SyncButton } from '../components/SyncButton';
import { SettingsGear } from '../components/SettingsGear';
import { ScoutDeck } from '../components/ScoutDeck';
import { Dropdown } from '../components/Dropdown';
import { SearchCard, type SearchLogPayload } from '../components/SearchCard';
import { useAuth } from '../hooks/useAuth';
import {
  useInventoryStore,
  type InventoryInput,
} from '../store/inventoryStore';
import { useProgressStore } from '../store/progressStore';
import {
  openCatalogDatabase,
  searchCatalogCards,
  getCardSignals,
  getScoutRows,
  pickSignalForFinish,
  type CatalogCard,
  type CatalogFilters,
} from '../db/catalogDb';
import {
  scoutCandidates,
  scoutFloorBuys,
  type ScoutCandidate,
} from '../scanner/services/deal/buyScout';
import { buildStockHealth } from '../scanner/services/deal/stockHealth';
import { getCatalogImageUri } from '../services/CatalogImageService';
import { ensureCatalogDownloaded } from '../services/CatalogDownloadService';
import { toErrorMessage } from '../utils/log';
import { ScannerScreen } from './ScannerScreen';
import { DealAnalysisSheet } from '../scanner/molecules/DealAnalysisSheet';
import { matchForCardRef } from '../scanner/services/catalog/ScannerCatalogProvider';
import type { CatalogMatch } from '../scanner/services/catalog/catalogMatcher';
import type { SQLiteDatabase } from 'expo-sqlite';

const RARITIES = [
  'All',
  'Common',
  'Uncommon',
  'Rare',
  'Holo Rare',
  'Double Rare',
  'Ultra Rare',
  'Illustration Rare',
  'Special Illustration Rare',
  'Mega Attack Rare',
  'Mega Hyper Rare',
  'Shiny Rare',
  'Hyper Rare',
  'Secret Rare',
  'Promo',
];

const PRODUCT_TYPES = ['All', 'Cards Only', 'Sealed Only'];

const LANGUAGES = ['All', 'English', 'Japanese'];

const SORT_OPTIONS = [
  'Newest',
  'Price: Low to High',
  'Price: High to Low',
  'Name A-Z',
];

type CatalogCardPair = [CatalogCard, CatalogCard?];

function chunkPairs<T>(arr: T[]): Array<[T, T?]> {
  const pairs: Array<[T, T?]> = [];
  for (let i = 0; i < arr.length; i += 2) {
    pairs.push([arr[i], arr[i + 1]]);
  }
  return pairs;
}

function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[''\-.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

type SearchCatalogRowProps = {
  pair: CatalogCardPair;
  rowWidth: number;
  cardWidth: number;
  catalogDb: SQLiteDatabase | null;
  onAnalyze: (card: CatalogCard, variant: string) => void;
  onLogToInventory: (payload: SearchLogPayload) => void;
};

const SearchCatalogRow = memo(function SearchCatalogRow({
  pair,
  rowWidth,
  cardWidth,
  catalogDb,
  onAnalyze,
  onLogToInventory,
}: SearchCatalogRowProps) {
  const justifyContent = pair[1] ? 'space-between' : 'center';
  return (
    <View style={[styles.cardRow, { width: rowWidth, justifyContent }]}>
      <SearchCard
        card={pair[0]}
        width={cardWidth}
        catalogDb={catalogDb}
        onAnalyze={onAnalyze}
        onLogToInventory={onLogToInventory}
      />
      {pair[1] && (
        <SearchCard
          card={pair[1]}
          width={cardWidth}
          catalogDb={catalogDb}
          onAnalyze={onAnalyze}
          onLogToInventory={onLogToInventory}
        />
      )}
    </View>
  );
});

const ScoutRow = memo(function ScoutRow({
  c,
  onSelect,
}: {
  c: ScoutCandidate;
  onSelect: (c: ScoutCandidate) => void;
}) {
  return (
    <TouchableOpacity style={scoutStyles.row} onPress={() => onSelect(c)}>
      <Image
        source={{ uri: getCatalogImageUri(c.productId) }}
        style={scoutStyles.thumb}
        contentFit="contain"
        cachePolicy="memory-disk"
      />
      <View style={scoutStyles.main}>
        <Text style={scoutStyles.name} numberOfLines={1}>
          {c.name}
          {c.owned ? (
            <Text style={scoutStyles.ownedTag}> · you own this</Text>
          ) : null}
        </Text>
        <Text style={scoutStyles.set} numberOfLines={1}>
          {c.set ?? '—'}
        </Text>
        {c.stat ? (
          <Text
            style={[scoutStyles.stat, { color: c.read.color }]}
            numberOfLines={1}>
            {c.stat}
          </Text>
        ) : null}
        <Text style={scoutStyles.why} numberOfLines={1}>
          {c.why}
        </Text>
      </View>
      <View style={scoutStyles.numbers}>
        <Text style={scoutStyles.price}>${c.price.toFixed(2)}</Text>
        <Text style={[scoutStyles.chip, { color: c.read.color }]}>
          {c.read.label}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

/** Full-page scout — card images + verdict chips for every candidate
 *  the engine flags as a buy. */
function ScoutPage({
  candidates,
  floorBuys,
  redeployValue,
  onSelect,
  onClose,
}: {
  candidates: ScoutCandidate[];
  floorBuys: ScoutCandidate[];
  redeployValue: number;
  onSelect: (c: ScoutCandidate) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  // Two lanes, two questions: turns/growers = "what's going up",
  // floor = "what do I buy at the floor today". Cyclers only live in
  // the floor lane — they lost the score fight in the mixed list.
  const mains = useMemo(
    () => candidates.filter((c) => c.read.cls !== 'RANGE_PLAY'),
    [candidates]
  );
  const [tab, setTab] = useState<'turns' | 'floor'>('turns');
  const shown = tab === 'floor' ? floorBuys : mains;
  const SCOUT_TABS: { key: 'turns' | 'floor'; label: string }[] = [
    { key: 'turns', label: `Going up (${mains.length})` },
    { key: 'floor', label: `At a low price (${floorBuys.length})` },
  ];
  return (
    <View style={scoutStyles.page}>
      <View style={[scoutStyles.pageHeader, { paddingTop: insets.top + 8 }]}>
        <GlassBackButton onPress={onClose} label="Close buy scout" />
        <View style={{ flex: 1 }}>
          <Text style={scoutStyles.pageTitle}>Buy scout</Text>
          {redeployValue >= 25 ? (
            <View style={scoutStyles.redeploy}>
              <Text style={scoutStyles.redeployAmount}>
                ~${Math.round(redeployValue)}
              </Text>
              <Text style={scoutStyles.redeployText}>
                {' '}
                of your stock could move into better cards
              </Text>
            </View>
          ) : (
            <Text style={scoutStyles.sub}>
              Cards worth buying right now.
            </Text>
          )}
        </View>
      </View>
      <SegmentedPills tabs={SCOUT_TABS} activeTab={tab} onChange={setTab} />
      <FlashList
        data={shown}
        keyExtractor={(c) => `${c.productId}-${c.subType}`}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item: c }) => (
          <ScoutRow c={c} onSelect={onSelect} />
        )}
        ListEmptyComponent={
          <Text style={scoutStyles.empty}>
            {tab === 'floor'
              ? 'No cards at their low price right now — check after the next price update.'
              : 'No deals right now — check after the next price update.'}
          </Text>
        }
      />
    </View>
  );
}

export function SearchBuyScreen() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { userId } = useAuth();
  const addInventoryCard = useInventoryStore((state) => state.addInventoryCard);
  const activeInventory = useInventoryStore((state) => state.activeInventory);
  const refreshInventoryState = useInventoryStore(
    (state) => state.refreshInventoryState
  );

  const [catalogDb, setCatalogDb] = useState<SQLiteDatabase | null>(null);
  const [isCatalogReady, setIsCatalogReady] = useState(false);
  const [searchResults, setSearchResults] = useState<CatalogCard[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [rarity, setRarity] = useState('All');
  const [productType, setProductType] = useState('All');
  const [language, setLanguage] = useState('All');
  const [sortBy, setSortBy] = useState('Newest');
  const [maxPrice, setMaxPrice] = useState('');
  const [scannerVisible, setScannerVisible] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);

  const searchIdRef = useRef(0);
  const catalogOpenedRef = useRef(false);

  const progressIsCatalogReady = useProgressStore(
    (state) => state.isCatalogReady
  );
  const isExtracting = useProgressStore((state) => state.isExtracting);
  const catalogDownloadProgress = useProgressStore(
    (state) => state.catalogDownloadProgress
  );
  const catalogDownloadPhase = useProgressStore(
    (state) => state.catalogDownloadPhase
  );
  const imageDownloadProgress = useProgressStore(
    (state) => state.imageDownloadProgress
  );
  const imageDownloadPhase = useProgressStore(
    (state) => state.imageDownloadPhase
  );
  const isDownloadingImages = useProgressStore(
    (state) => state.isDownloadingImages
  );

  const { downloadProgress, downloadStatus } = useMemo(() => {
    if (
      catalogDownloadPhase === 'download' &&
      (isExtracting || catalogDownloadProgress > 0)
    ) {
      const pct = Math.round(catalogDownloadProgress * 100);
      return {
        downloadProgress: catalogDownloadProgress,
        downloadStatus: `Downloading price list: ${pct}%`,
      };
    }

    if (
      isDownloadingImages &&
      (imageDownloadPhase === 'download' || imageDownloadPhase === 'extract')
    ) {
      const pct = Math.round(imageDownloadProgress * 100);
      return {
        downloadProgress: imageDownloadProgress,
        downloadStatus:
          imageDownloadPhase === 'extract'
            ? `Unpacking card photos: ${pct}%`
            : `Downloading card photos: ${pct}%`,
      };
    }

    if (catalogDownloadPhase === 'complete' || imageDownloadPhase === 'complete') {
      return { downloadProgress: 1, downloadStatus: 'Price list ready.' };
    }

    if (isExtracting) {
      return { downloadProgress: 0, downloadStatus: 'Unpacking price list...' };
    }

    return { downloadProgress: 0, downloadStatus: 'Opening price list...' };
  }, [
    catalogDownloadPhase,
    catalogDownloadProgress,
    imageDownloadPhase,
    imageDownloadProgress,
    isDownloadingImages,
    isExtracting,
  ]);

  useEffect(() => {
    // If the catalog is missing and we aren't already fetching it, start the download automatically
    if (!progressIsCatalogReady && !isExtracting) {
      ensureCatalogDownloaded().catch((err) => {
        console.error('Auto-download failed:', err);
      });
    }
  }, [progressIsCatalogReady, isExtracting]);

  useEffect(() => {
    // If extracting or not globally ready, reset the guard so it can trigger later
    if (isExtracting || !progressIsCatalogReady) {
      catalogOpenedRef.current = false;
      return;
    }

    if (catalogOpenedRef.current) return;
    catalogOpenedRef.current = true;

    let mounted = true;

    openCatalogDatabase()
      .then((db) => {
        if (!mounted) return;
        setCatalogDb(db);
        setIsCatalogReady(true);
      })
      .catch((err) => {
        if (mounted) {
          setSearchError(toErrorMessage(err));
        }
        catalogOpenedRef.current = false;
      });
    return () => {
      mounted = false;
    };
  }, [isExtracting, progressIsCatalogReady]);

  useEffect(() => {
    if (!catalogDb || !isCatalogReady) return;

    const normalized = normalizeSearch(query);
    if (!normalized) {
      setSearchResults([]);
      setIsSearching(false);
      setOffset(0);
      setHasMore(false);
      setIsFetchingNextPage(false);
      return;
    }

    setOffset(0);
    setHasMore(true);
    setIsFetchingNextPage(false);
    const thisId = ++searchIdRef.current;
    setIsSearching(true);
    setSearchError(null);

    const timeout = setTimeout(() => {
      const max = Number.parseFloat(maxPrice);
      const filters: CatalogFilters = {
        query,
        rarity,
        productType,
        language,
        sortBy: sortBy as CatalogFilters['sortBy'],
        maxPrice:
          maxPrice.trim() !== '' && !Number.isNaN(max) ? max : undefined,
      };

      searchCatalogCards(catalogDb, filters, 50, 0)
        .then((result) => {
          if (thisId !== searchIdRef.current) return;
          setSearchResults(result.cards);
          setOffset(result.nextOffset);
          setHasMore(result.hasMore);
        })
        .catch((err) => {
          if (thisId !== searchIdRef.current) return;
          setSearchError(toErrorMessage(err));
          setHasMore(false);
        })
        .finally(() => {
          if (thisId !== searchIdRef.current) return;
          setIsSearching(false);
        });
    }, 250);

    return () => clearTimeout(timeout);
  }, [catalogDb, isCatalogReady, query, rarity, productType, language, sortBy, maxPrice]);

  // Buy scout — one funnel query + a classify pass when the catalog
  // opens. Owned cards get flagged, and the stock-health pass tells the
  // header how much is parked in bleeders worth redeploying.
  const [scout, setScout] = useState<ScoutCandidate[]>([]);
  const [floorBuys, setFloorBuys] = useState<ScoutCandidate[]>([]);
  const [redeployValue, setRedeployValue] = useState(0);
  const [scoutVisible, setScoutVisible] = useState(false);
  const scoutLoadedRef = useRef(false);
  useEffect(() => {
    if (!catalogDb || !isCatalogReady || scoutLoadedRef.current) return;
    scoutLoadedRef.current = true;
    let mounted = true;
    const ownedIds = new Set(
      activeInventory
        .map((c) => c.productId)
        .filter((id): id is number => id != null)
    );
    (async () => {
      try {
        const rows = await getScoutRows(catalogDb);
        const candidates = scoutCandidates(rows, ownedIds, 40);
        const floors = scoutFloorBuys(rows, ownedIds, 15);
        const ownedArr = [...ownedIds];
        const signals = ownedArr.length
          ? await getCardSignals(catalogDb, ownedArr)
          : {};
        const health = buildStockHealth(activeInventory, (c) =>
          pickSignalForFinish(signals, c)
        );
        const parked =
          health.buckets.rotate.value + health.buckets.dead.value;
        if (mounted) {
          setScout(candidates);
          setFloorBuys(floors);
          setRedeployValue(parked);
        }
      } catch {
        if (mounted) {
          setScout([]);
          setFloorBuys([]);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [catalogDb, isCatalogReady, activeInventory]);

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
  const [analysisFor, setAnalysisFor] = useState<{
    match: CatalogMatch;
    subType?: string;
  } | null>(null);
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

  const pairedSearchResults = useMemo(
    () => chunkPairs(searchResults),
    [searchResults]
  );

  const handleLoadMore = useCallback(() => {
    if (!catalogDb || !isCatalogReady || !hasMore || isFetchingNextPage || isSearching) {
      return;
    }

    const normalized = normalizeSearch(query);
    if (!normalized) return;

    const thisId = searchIdRef.current;
    setIsFetchingNextPage(true);
    setSearchError(null);

    const max = Number.parseFloat(maxPrice);
    const filters: CatalogFilters = {
      query,
      rarity,
      productType,
      language,
      sortBy: sortBy as CatalogFilters['sortBy'],
      maxPrice:
        maxPrice.trim() !== '' && !Number.isNaN(max) ? max : undefined,
    };

    searchCatalogCards(catalogDb, filters, 50, offset)
      .then((result) => {
        if (thisId !== searchIdRef.current) return;
        setSearchResults((prev) => [...prev, ...result.cards]);
        setOffset(result.nextOffset);
        setHasMore(result.hasMore);
      })
      .catch((err) => {
        if (thisId !== searchIdRef.current) return;
        setSearchError(toErrorMessage(err));
        setHasMore(false);
      })
      .finally(() => {
        if (thisId !== searchIdRef.current) return;
        setIsFetchingNextPage(false);
      });
  }, [
    catalogDb,
    isCatalogReady,
    hasMore,
    isFetchingNextPage,
    isSearching,
    query,
    maxPrice,
    rarity,
    productType,
    language,
    sortBy,
    offset,
  ]);

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

  const hasQuery = normalizeSearch(query).length > 0;

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
          ) : searchError ? (
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: colors.error }]}>
                {searchError}
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
              data={pairedSearchResults}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  inner: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.overlay3,
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 46,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    paddingVertical: 9,
  },
  scanButton: {
    width: 46,
    height: 46,
    borderRadius: 10,
    backgroundColor: colors.overlay3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterCard: {
    backgroundColor: colors.overlay2,
    borderRadius: 12,
    padding: 12,
    marginBottom: 4,
  },
  filterRow: {
    flexDirection: 'row',
    marginBottom: 14,
    width: '100%',
  },
  filterHalfLeft: {
    flex: 1,
    paddingRight: 6,
  },
  filterHalfRight: {
    flex: 1,
    paddingLeft: 6,
  },
  filterLabel: {
    color: colors.text,
    fontSize: 12,
    marginBottom: 4,
    fontWeight: '600',
  },
  numberInput: {
    minHeight: 44,
    backgroundColor: colors.overlay3,
    borderRadius: 8,
    color: colors.text,
    paddingHorizontal: 12,
  },
  emptyScroll: {
    paddingTop: 20,
    paddingBottom: 24,
  },
  scoutHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  scoutTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  scoutCount: {
    backgroundColor: colors.accentPurple,
    borderRadius: 999,
    minWidth: 24,
    height: 24,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoutCountText: {
    color: colors.onAccent,
    fontSize: 12,
    fontWeight: '800',
  },
  scoutSwipe: {
    color: colors.accentPurple,
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 'auto',
  },
  chromeHint: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 13,
    maxWidth: 240,
  },
  resultsCount: {
    color: colors.textMuted,
    fontSize: 13,
  },
  listWrapper: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 8,
  },
  cardRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    gap: 10,
    minHeight: 362,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
  },
  footerSpinner: {
    paddingVertical: 20,
  },
  progressTrack: {
    width: '80%',
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 4,
    marginTop: 16,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
  },
});

const scoutStyles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.background,
  },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pageTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  thumb: {
    width: 44,
    height: 62,
    borderRadius: 6,
    backgroundColor: colors.surfaceLight,
  },
  set: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 1,
  },
  sub: {
    color: colors.textMuted,
    fontSize: 11,
    marginBottom: 8,
    lineHeight: 15,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
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
  ownedTag: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
  },
  stat: {
    fontSize: 11,
    fontWeight: '800',
    marginTop: 2,
  },
  why: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 1,
  },
  numbers: {
    alignItems: 'flex-end',
  },
  price: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  chip: {
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginTop: 1,
  },
  empty: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 20,
  },
  redeploy: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    alignSelf: 'flex-start',
    backgroundColor: colors.warningTint,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 2,
  },
  redeployAmount: {
    color: colors.warning,
    fontSize: 14,
    fontWeight: '800',
  },
  redeployText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
  },
});
