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
  type ScoutCandidate,
} from '../scanner/services/deal/buyScout';
import { buildStockHealth } from '../scanner/services/deal/stockHealth';
import { getCatalogImageUri } from '../services/CatalogImageService';
import { ensureCatalogDownloaded } from '../services/CatalogDownloadService';
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

/** Compact entry point — one card-button that opens the full scout
 *  page instead of stuffing the empty-search view with rows. */
function ScoutButton({
  count,
  onOpen,
}: {
  count: number;
  onOpen: () => void;
}) {
  return (
    <TouchableOpacity style={scoutStyles.container} onPress={onOpen}>
      <Text style={scoutStyles.title}>Buy scout</Text>
      <View style={scoutStyles.buttonMain} />
      <Text style={scoutStyles.count}>{count}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

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
            <Text style={scoutStyles.ownedTag}> · owned</Text>
          ) : null}
        </Text>
        <Text style={scoutStyles.set} numberOfLines={1}>
          {c.set ?? '—'}
        </Text>
        <Text style={scoutStyles.why} numberOfLines={2}>
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
  redeployValue,
  onSelect,
  onClose,
}: {
  candidates: ScoutCandidate[];
  redeployValue: number;
  onSelect: (c: ScoutCandidate) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={scoutStyles.page}>
      <View style={[scoutStyles.pageHeader, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={onClose} style={scoutStyles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={scoutStyles.pageTitle}>Buy scout</Text>
          <Text style={scoutStyles.sub}>
            {redeployValue >= 25
              ? `~$${Math.round(redeployValue)} parked in bleeders or dead money — better homes for it`
              : 'Cards reading as buys right now — revivals, dip buys, floors.'}
          </Text>
        </View>
      </View>
      <FlashList
        data={candidates}
        keyExtractor={(c) => `${c.productId}-${c.subType}`}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item: c }) => (
          <ScoutRow c={c} onSelect={onSelect} />
        )}
        ListEmptyComponent={
          <Text style={scoutStyles.empty}>
            Nothing scoring right now — check back after the next catalog.
          </Text>
        }
      />
    </View>
  );
}

export function SearchBuyScreen() {
  const { width } = useWindowDimensions();
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
        downloadStatus: `Downloading catalog: ${pct}%`,
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
            ? `Extracting catalog: ${pct}%`
            : `Downloading catalog: ${pct}%`,
      };
    }

    if (catalogDownloadPhase === 'complete' || imageDownloadPhase === 'complete') {
      return { downloadProgress: 1, downloadStatus: 'Catalog ready.' };
    }

    if (isExtracting) {
      return { downloadProgress: 0, downloadStatus: 'Extracting database...' };
    }

    return { downloadProgress: 0, downloadStatus: 'Opening catalog...' };
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
          setSearchError(err instanceof Error ? err.message : String(err));
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
          setSearchError(err instanceof Error ? err.message : String(err));
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
          setRedeployValue(parked);
        }
      } catch {
        if (mounted) setScout([]);
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
        Alert.alert('Not logged in', 'Log in to save inventory entries.');
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
        Alert.alert('Logged', `${payload.cardName} added to inventory.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('Log to inventory failed:', err);
        Alert.alert('Log Failed', message);
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
        setSearchError(err instanceof Error ? err.message : String(err));
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
        <View style={styles.header}>
          <View style={styles.searchRow}>
            <TextInput
              style={[styles.searchInput, styles.searchInputInRow]}
              placeholder="e.g. Pikachu & Zekrom GX, Lugia V, or Pitch Black variants..."
              placeholderTextColor={colors.textMuted}
              value={query}
              onChangeText={setQuery}
            />
            <TouchableOpacity
              style={styles.scanButton}
              activeOpacity={0.7}
              onPress={() => setScannerVisible(true)}>
              <Ionicons
                name="scan-outline"
                size={20}
                color={colors.textMuted}
              />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.filterToggle}
            activeOpacity={0.7}
            onPress={() => setExpanded((v) => !v)}>
            <Text style={styles.filterToggleText}>Filters & Sorting</Text>
            <Text style={styles.filterToggleChevron}>
              {expanded ? '▲' : '▼'}
            </Text>
          </TouchableOpacity>

          {expanded && (
            <View style={{ width: '100%', minHeight: 235, paddingTop: 12 }}>

              <View style={{ height: 75, flexDirection: 'row', width: '100%', zIndex: 3 }}>
                <View style={{ flex: 1, paddingRight: 6 }}>
                  <Text style={{ color: '#c9d1d9', fontSize: 12, marginBottom: 4, fontWeight: '600' }}>Rarity</Text>
                  <Dropdown options={RARITIES} value={rarity} onSelect={setRarity} />
                </View>
                <View style={{ flex: 1, paddingLeft: 6 }}>
                  <Text style={{ color: '#c9d1d9', fontSize: 12, marginBottom: 4, fontWeight: '600' }}>Product Type</Text>
                  <Dropdown options={PRODUCT_TYPES} value={productType} onSelect={setProductType} />
                </View>
              </View>

              <View style={{ height: 75, flexDirection: 'row', width: '100%', zIndex: 2 }}>
                <View style={{ flex: 1, paddingRight: 6 }}>
                  <Text style={{ color: '#c9d1d9', fontSize: 12, marginBottom: 4, fontWeight: '600' }}>Language</Text>
                  <Dropdown options={LANGUAGES} value={language} onSelect={setLanguage} />
                </View>
                <View style={{ flex: 1, paddingLeft: 6 }}>
                  <Text style={{ color: '#c9d1d9', fontSize: 12, marginBottom: 4, fontWeight: '600' }}>Sort By</Text>
                  <Dropdown options={SORT_OPTIONS} value={sortBy} onSelect={setSortBy} />
                </View>
              </View>

              <View style={{ height: 75, flexDirection: 'row', width: '100%', zIndex: 1 }}>
                <View style={{ flex: 1, paddingRight: 6 }}>
                  <Text style={{ color: '#c9d1d9', fontSize: 12, marginBottom: 4, fontWeight: '600' }}>Max Market Price</Text>
                  <TextInput
                    style={{ height: 44, backgroundColor: '#161b22', borderColor: '#30363d', borderWidth: 1, borderRadius: 8, color: '#c9d1d9', paddingHorizontal: 12 }}
                    placeholder="e.g. 50"
                    placeholderTextColor="#8b949e"
                    keyboardType="numeric"
                    value={maxPrice}
                    onChangeText={setMaxPrice}
                  />
                </View>
              </View>

            </View>
          )}

          <Text style={styles.resultsCount}>
            {isSearching
              ? 'Searching...'
              : `${searchResults.length} result${
                  searchResults.length !== 1 ? 's' : ''
                }`}
          </Text>
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
            <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
              <ScoutButton
                count={scout.length}
                onOpen={() => setScoutVisible(true)}
              />
              <Text style={[styles.emptyText, { marginTop: 18 }]}>
                …or search a card name, number, or set.
              </Text>
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
                    <ActivityIndicator color="#c9d1d9" />
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
          redeployValue={redeployValue}
          onSelect={(c) => {
            // The analysis sheet is an absolute overlay, not a Modal —
            // it can't stack over this page, so scout must exit first.
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
  searchInput: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 10,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  searchInputInRow: {
    flex: 1,
    marginBottom: 0,
  },
  scanButton: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  filterToggleText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  filterToggleChevron: {
    color: colors.textMuted,
    fontSize: 12,
  },
  filterGroup: {
    width: '100%',
    paddingVertical: 12,
  },
  filterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    width: '100%',
  },
  filterRowLast: {
    flexDirection: 'row',
    justifyContent: 'space-between',
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
  label: {
    color: '#c9d1d9',
    fontSize: 12,
    marginBottom: 6,
    fontWeight: '600',
  },
  numberInput: {
    height: 44,
    backgroundColor: '#161b22',
    borderColor: '#30363d',
    borderWidth: 1,
    borderRadius: 8,
    color: '#c9d1d9',
    paddingHorizontal: 12,
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
    borderRadius: 3,
    marginTop: 16,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
  },
});

const scoutStyles = StyleSheet.create({
  container: {
    marginHorizontal: 12,
    marginTop: 10,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 11,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  buttonMain: {
    flex: 1,
  },
  count: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
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
  backBtn: {
    padding: 8,
  },
  pageTitle: {
    color: colors.text,
    fontSize: 17,
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
  title: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 2,
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
});
