import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { colors } from '../constants/colors';
import { Dropdown } from '../components/Dropdown';
import { CartDrawer } from '../components/CartDrawer';
import { SearchCard, type SearchLogPayload } from '../components/SearchCard';
import { useAuth } from '../context/AuthContext';
import { useCartStore } from '../store/cartStore';
import {
  useInventoryStore,
  type InventoryInput,
} from '../store/inventoryStore';
import { useProgressStore } from '../store/progressStore';
import {
  openCatalogDatabase,
  searchCatalogCards,
  type CatalogCard,
  type CatalogFilters,
} from '../db/catalogDb';
import { ensureCatalogDownloaded } from '../services/CatalogDownloadService';
import type { CartItemInput } from '../store/cartStore';
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

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
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
  onAddToLot: (item: CartItemInput) => void;
  onLogToInventory: (payload: SearchLogPayload) => void;
};

const SearchCatalogRow = memo(function SearchCatalogRow({
  pair,
  rowWidth,
  cardWidth,
  catalogDb,
  onAddToLot,
  onLogToInventory,
}: SearchCatalogRowProps) {
  const justifyContent = pair[1] ? 'space-between' : 'center';
  return (
    <View style={[styles.cardRow, { width: rowWidth, justifyContent }]}>
      <SearchCard
        card={pair[0]}
        width={cardWidth}
        catalogDb={catalogDb}
        onAddToLot={onAddToLot}
        onLogToInventory={onLogToInventory}
      />
      {pair[1] && (
        <SearchCard
          card={pair[1]}
          width={cardWidth}
          catalogDb={catalogDb}
          onAddToLot={onAddToLot}
          onLogToInventory={onLogToInventory}
        />
      )}
    </View>
  );
});

export function SearchBuyScreen() {
  const { width } = useWindowDimensions();
  const addToCart = useCartStore((state) => state.addToCart);
  const openDrawer = useCartStore((state) => state.openDrawer);
  const itemCount = useCartStore((state) => state.itemCount);
  const totalOffer = useCartStore((state) => state.totalOffer);
  const { userId } = useAuth();
  const addInventoryCard = useInventoryStore((state) => state.addInventoryCard);
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
  const [sortBy, setSortBy] = useState('Newest');
  const [maxPrice, setMaxPrice] = useState('');
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
  }, [catalogDb, isCatalogReady, query, rarity, productType, sortBy, maxPrice]);

  const handleAddToLot = useCallback(
    (item: CartItemInput) => {
      addToCart(item, false);
    },
    [addToCart]
  );

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
        onAddToLot={handleAddToLot}
        onLogToInventory={handleLogToInventory}
      />
    ),
    [width, cardWidth, catalogDb, handleAddToLot, handleLogToInventory]
  );

  const hasQuery = normalizeSearch(query).length > 0;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}>
      <View style={styles.inner}>
        <View style={styles.header}>
          <TextInput
            style={styles.searchInput}
            placeholder="e.g. Pikachu & Zekrom GX, Lugia V, or Pitch Black variants..."
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={setQuery}
          />

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
            <View style={{ width: '100%', minHeight: 160, paddingTop: 12 }}>

              <View style={{ height: 75, flexDirection: 'row', width: '100%', zIndex: 2 }}>
                <View style={{ flex: 1, paddingRight: 6 }}>
                  <Text style={{ color: '#c9d1d9', fontSize: 12, marginBottom: 4, fontWeight: '600' }}>Rarity</Text>
                  <Dropdown options={RARITIES} value={rarity} onSelect={setRarity} />
                </View>
                <View style={{ flex: 1, paddingLeft: 6 }}>
                  <Text style={{ color: '#c9d1d9', fontSize: 12, marginBottom: 4, fontWeight: '600' }}>Product Type</Text>
                  <Dropdown options={PRODUCT_TYPES} value={productType} onSelect={setProductType} />
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
                <View style={{ flex: 1, paddingLeft: 6 }}>
                  <Text style={{ color: '#c9d1d9', fontSize: 12, marginBottom: 4, fontWeight: '600' }}>Sort By</Text>
                  <Dropdown options={SORT_OPTIONS} value={sortBy} onSelect={setSortBy} />
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
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                Enter a card name, number, or set to search.
              </Text>
            </View>
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

        <View style={styles.cartBar}>
          <TouchableOpacity
            style={styles.cartBarInner}
            activeOpacity={0.7}
            onPress={openDrawer}>
            <View style={styles.cartBarLeft}>
              <Text style={styles.cartBarCount}>
                {itemCount} item{itemCount !== 1 ? 's' : ''}
              </Text>
              <Text style={styles.cartBarHint}>Tap to review lot</Text>
            </View>
            <Text style={styles.cartBarOffer}>
              {formatCurrency(totalOffer)}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <CartDrawer />
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
    minHeight: 452,
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
  cartBar: {
    height: 64,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cartBarInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cartBarLeft: {
    flex: 1,
  },
  cartBarCount: {
    color: colors.text,
    fontSize: 14,
    fontWeight: 'bold',
  },
  cartBarHint: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  cartBarOffer: {
    color: colors.success,
    fontSize: 18,
    fontWeight: 'bold',
  },
});
