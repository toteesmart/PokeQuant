import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
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
import { SearchResultCard } from '../components/SearchResultCard';
import { useCart } from '../context/CartContext';
import { useInventory } from '../context/InventoryContext';
import {
  openCatalogDatabase,
  searchCatalogCards,
  type CatalogCard,
  type CatalogFilters,
} from '../db/catalogDb';
import type { CartItemInput } from '../context/CartContext';
import type { SQLiteDatabase } from 'expo-sqlite';

const RARITIES = [
  'All',
  'Common',
  'Uncommon',
  'Rare',
  'Holo Rare',
  'Ultra Rare',
  'Secret Rare',
];

const PRODUCT_TYPES = ['All', 'Holo', 'Normal', 'Reverse', '1st Edition'];
const PRODUCT_TYPE_LABELS: Record<string, string> = {
  All: 'All',
  Holo: 'Holo',
  Normal: 'Normal',
  Reverse: 'Reverse',
  '1st Edition': '1st Edition',
};

const SORT_OPTIONS = [
  'Newest',
  'Price: Low to High',
  'Price: High to Low',
  'Name A-Z',
];

const PAGE_SIZE = 20;

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

export function SearchBuyScreen() {
  const { width } = useWindowDimensions();
  const { addToCart, openDrawer, itemCount, totalOffer } = useCart();
  const { addInventoryCard } = useInventory();

  // Keep stable refs to context callbacks so memoized list items do not
  // re-render when the cart or inventory context value changes.
  const addToCartRef = useRef(addToCart);
  const openDrawerRef = useRef(openDrawer);
  const addInventoryCardRef = useRef(addInventoryCard);

  useEffect(() => {
    addToCartRef.current = addToCart;
  }, [addToCart]);

  useEffect(() => {
    openDrawerRef.current = openDrawer;
  }, [openDrawer]);

  useEffect(() => {
    addInventoryCardRef.current = addInventoryCard;
  }, [addInventoryCard]);

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
  const [page, setPage] = useState(0);

  const searchIdRef = useRef(0);

  useEffect(() => {
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
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!catalogDb || !isCatalogReady) return;

    const normalized = normalizeSearch(query);
    if (!normalized) {
      setSearchResults([]);
      setIsSearching(false);
      setPage(0);
      return;
    }

    setPage(0);
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

      searchCatalogCards(catalogDb, filters, 50)
        .then((cards) => {
          if (thisId !== searchIdRef.current) return;
          setSearchResults(cards);
        })
        .catch((err) => {
          if (thisId !== searchIdRef.current) return;
          setSearchError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (thisId !== searchIdRef.current) return;
          setIsSearching(false);
        });
    }, 250);

    return () => clearTimeout(timeout);
  }, [catalogDb, isCatalogReady, query, rarity, productType, sortBy, maxPrice]);

  const totalPages = useMemo(
    () => Math.ceil(searchResults.length / PAGE_SIZE),
    [searchResults.length]
  );

  const pagedResults = useMemo(
    () => searchResults.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [searchResults, page]
  );

  const handleAddToLot = useCallback((item: CartItemInput) => {
    addToCartRef.current(item, false);
  }, []);

  const handleLogToInventory = useCallback(
    (card: CatalogCard, variant: string, condition: string) => {
      addInventoryCardRef.current({
        name: card.name,
        number: card.number,
        set: card.set,
        condition,
        productType: variant,
        productId: card.productId,
        liveMarket: 0,
        imageUrl: card.imageUrl,
      });
    },
    []
  );

  const cardWidth = width - 32;

  const renderItem = useCallback(
    ({ item }: { item: CatalogCard }) => (
      <SearchResultCard
        card={item}
        width={cardWidth}
        marginHorizontal={0}
        onAddToLot={handleAddToLot}
        onLogToInventory={handleLogToInventory}
      />
    ),
    [cardWidth, handleAddToLot, handleLogToInventory]
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
            <View style={styles.filters}>
              <View style={styles.filterRow}>
                <View style={styles.filterCell}>
                  <Dropdown
                    label="Rarity"
                    options={RARITIES}
                    value={rarity}
                    onChange={setRarity}
                  />
                </View>
                <View style={styles.filterCell}>
                  <Dropdown
                    label="Product Type"
                    options={PRODUCT_TYPES}
                    value={productType}
                    onChange={setProductType}
                    labels={PRODUCT_TYPE_LABELS}
                  />
                </View>
              </View>
              <View style={styles.filterRow}>
                <View style={styles.filterCell}>
                  <Text style={styles.filterLabel}>Max Market Price</Text>
                  <TextInput
                    style={styles.numberInput}
                    placeholder="e.g. 50"
                    placeholderTextColor="#8b949e"
                    keyboardType="decimal-pad"
                    value={maxPrice}
                    onChangeText={setMaxPrice}
                  />
                </View>
                <View style={styles.filterCell}>
                  <Dropdown
                    label="Sort By"
                    options={SORT_OPTIONS}
                    value={sortBy}
                    onChange={setSortBy}
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
              <Text style={styles.emptyText}>Downloading market catalog...</Text>
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
            <FlatList
              data={pagedResults}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              contentContainerStyle={styles.listContent}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              initialNumToRender={10}
              maxToRenderPerBatch={10}
              windowSize={5}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>
                    No cards match your filters.
                  </Text>
                </View>
              }
            />
          )}
        </View>

        {totalPages > 1 && hasQuery && (
          <View style={styles.pageFooter}>
            <TouchableOpacity
              style={[
                styles.pageButton,
                page === 0 && styles.pageButtonDisabled,
              ]}
              activeOpacity={0.7}
              disabled={page === 0}
              onPress={() => setPage((p) => Math.max(0, p - 1))}>
              <Text style={styles.pageButtonText}>Prev</Text>
            </TouchableOpacity>
            <Text style={styles.pageText}>
              {page + 1} / {totalPages}
            </Text>
            <TouchableOpacity
              style={[
                styles.pageButton,
                page >= totalPages - 1 && styles.pageButtonDisabled,
              ]}
              activeOpacity={0.7}
              disabled={page >= totalPages - 1}
              onPress={() => setPage((p) => Math.min(totalPages - 1, p + 1))}>
              <Text style={styles.pageButtonText}>Next</Text>
            </TouchableOpacity>
          </View>
        )}

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
  filters: {
    marginBottom: 10,
  },
  filterRow: {
    flexDirection: 'row',
    marginBottom: 12,
    gap: 12,
  },
  filterCell: {
    flex: 1,
  },
  filterLabel: {
    color: '#c9d1d9',
    fontSize: 12,
    marginBottom: 4,
    fontWeight: '600',
  },
  numberInput: {
    backgroundColor: colors.surface,
    color: '#c9d1d9',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 44,
    fontSize: 13,
  },
  resultsCount: {
    color: colors.textMuted,
    fontSize: 13,
  },
  listWrapper: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 8,
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
  pageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  pageButton: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pageButtonDisabled: {
    opacity: 0.4,
  },
  pageButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  pageText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
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
