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
  ActivityIndicator,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Platform,
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
import { EventSearchCard } from '../components/EventSearchCard';
import { Dropdown } from '../components/Dropdown';
import { useProgressStore } from '../store/progressStore';
import { ensureEventCatalogDownloaded } from '../services/EventCatalogDownloadService';
import {
  ensureCatalogImagesDownloaded,
  catalogImagesReady,
} from '../services/CatalogImageService';
import {
  closeEventCatalogDatabase,
  getDistinctEventValues,
  openEventCatalogDatabase,
  searchEventInventory,
  type EventInventoryItem,
  type EventSearchFilters,
  type EventSearchSort,
} from '../db/eventCatalogDb';
import type { SQLiteDatabase } from 'expo-sqlite';

const PAGE_PADDING = 12;
const CARD_GAP = 12;

const SORT_OPTIONS: { value: EventSearchSort; label: string }[] = [
  { value: 'name', label: 'Name A-Z' },
  { value: 'price-low', label: 'Price: Low' },
  { value: 'price-high', label: 'Price: High' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'set', label: 'Set' },
];

const SORT_LABELS: Record<string, string> = Object.fromEntries(
  SORT_OPTIONS.map((o) => [o.value, o.label])
);
const SORT_VALUES = SORT_OPTIONS.map((o) => o.value);

const PRICE_OPTIONS: { value: string; label: string; min?: number; max?: number }[] = [
  { value: '', label: 'All Prices' },
  { value: 'under10', label: '< $10', min: 0, max: 9.99 },
  { value: '10to50', label: '$10 - $50', min: 10, max: 50 },
  { value: '50to100', label: '$50 - $100', min: 50, max: 100 },
  { value: 'over100', label: '> $100', min: 100 },
];

const PRICE_LABELS: Record<string, string> = Object.fromEntries(
  PRICE_OPTIONS.map((o) => [o.value, o.label])
);
const PRICE_VALUES = PRICE_OPTIONS.map((o) => o.value);

function chunkQuads<T>(arr: T[]): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < arr.length; i += 4) {
    groups.push(arr.slice(i, i + 4));
  }
  return groups;
}

type EventSearchPageProps = {
  items: EventInventoryItem[];
  pageWidth: number;
  pageHeight: number;
};

const EventSearchPage = memo(function EventSearchPage({
  items,
  pageWidth,
  pageHeight,
}: EventSearchPageProps) {
  const cardWidth = Math.max(1, (pageWidth - PAGE_PADDING * 2 - CARD_GAP) / 2);
  const cardHeight = Math.max(1, (pageHeight - PAGE_PADDING * 2 - CARD_GAP) / 2);

  return (
    <View
      style={[
        styles.page,
        { width: pageWidth, height: pageHeight, padding: PAGE_PADDING, gap: CARD_GAP },
      ]}>
      <View style={[styles.pageRow, { gap: CARD_GAP }]}>
        {items[0] ? (
          <EventSearchCard
            item={items[0]}
            width={cardWidth}
            height={cardHeight}
          />
        ) : null}
        {items[1] ? (
          <EventSearchCard
            item={items[1]}
            width={cardWidth}
            height={cardHeight}
          />
        ) : null}
      </View>
      <View style={[styles.pageRow, { gap: CARD_GAP }]}>
        {items[2] ? (
          <EventSearchCard
            item={items[2]}
            width={cardWidth}
            height={cardHeight}
          />
        ) : null}
        {items[3] ? (
          <EventSearchCard
            item={items[3]}
            width={cardWidth}
            height={cardHeight}
          />
        ) : null}
      </View>
    </View>
  );
});

type Props = {
  showId: string;
  showName: string;
  showStartDate?: string;
  showLocation?: string;
  onBack: () => void;
};

export function EventSearchScreen({
  showId,
  showName,
  showStartDate,
  showLocation,
  onBack,
}: Props) {
  const { width, height } = useWindowDimensions();

  const [db, setDb] = useState<SQLiteDatabase | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EventInventoryItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<EventSearchFilters>({});
  const [sort, setSort] = useState<EventSearchSort>('name');
  const [filterOptions, setFilterOptions] = useState({
    vendors: [] as string[],
    sets: [] as string[],
    rarities: [] as string[],
    conditions: [] as string[],
  });
  const [showFilters, setShowFilters] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [wrapperSize, setWrapperSize] = useState({
    width,
    height: Math.max(400, height - 220),
  });

  const searchIdRef = useRef(0);
  const lastImagePhaseRef = useRef<string | null>(null);

  const isEventExtracting = useProgressStore((state) => state.isEventExtracting);
  const eventDownloadProgress = useProgressStore(
    (state) => state.eventDownloadProgress
  );
  const eventDownloadPhase = useProgressStore(
    (state) => state.eventDownloadPhase
  );
  const eventDownloadLabel = useProgressStore(
    (state) => state.eventDownloadLabel
  );
  const imageDownloadPhase = useProgressStore(
    (state) => state.imageDownloadPhase
  );

  const { downloadProgress, downloadStatus } = useMemo(() => {
    if (eventDownloadPhase === 'download') {
      const pct = Math.round(eventDownloadProgress * 100);
      return {
        downloadProgress: eventDownloadProgress,
        downloadStatus: `${eventDownloadLabel || 'Downloading...'} ${pct}%`,
      };
    }
    if (eventDownloadPhase === 'extract') {
      const pct = Math.round(eventDownloadProgress * 100);
      return {
        downloadProgress: eventDownloadProgress,
        downloadStatus: `${eventDownloadLabel || 'Extracting...'} ${pct}%`,
      };
    }
    if (eventDownloadPhase === 'complete') {
      return { downloadProgress: 1, downloadStatus: 'Show catalog ready.' };
    }
    return { downloadProgress: 0, downloadStatus: 'Opening show catalog...' };
  }, [eventDownloadPhase, eventDownloadProgress, eventDownloadLabel]);

  useEffect(() => {
    let mounted = true;
    setError(null);

    ensureEventCatalogDownloaded(showId)
      .then(() => openEventCatalogDatabase())
      .then((database) => {
        if (!mounted) return;
        setDb(database);
        setIsReady(true);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : String(err));
      });

    if (!catalogImagesReady()) {
      ensureCatalogImagesDownloaded().catch((err) =>
        console.warn('Background catalog image download failed:', err)
      );
    }

    return () => {
      mounted = false;
    };
  }, [showId]);

  useEffect(() => {
    if (!db || !isReady) return;

    getDistinctEventValues(db, showId)
      .then((values) => {
        setFilterOptions(values);
      })
      .catch((err) => {
        console.warn('Failed to load event filter options:', err);
      });
  }, [db, isReady, showId]);

  const runSearch = useCallback(
    async (searchQuery: string, searchOffset: number, append = false) => {
      if (!db || !isReady) return;

      setError(null);
      const thisId = ++searchIdRef.current;

      try {
        const res = await searchEventInventory(
          db,
          searchQuery,
          48,
          searchOffset,
          filters,
          sort,
          showId
        );
        if (thisId !== searchIdRef.current) return;
        setResults((prev) => (append ? [...prev, ...res.items] : res.items));
        setOffset(res.nextOffset);
        setHasMore(res.hasMore);
      } catch (err) {
        if (thisId !== searchIdRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
        setHasMore(false);
      }
    },
    [db, isReady, filters, sort, showId]
  );

  useEffect(() => {
    if (!db || !isReady) return;

    setOffset(0);
    setHasMore(true);
    setIsSearching(true);
    setError(null);

    const timeout = setTimeout(() => {
      runSearch(query, 0, false).finally(() => {
        setIsSearching(false);
      });
    }, 250);

    return () => clearTimeout(timeout);
  }, [db, isReady, query, filters, sort, runSearch]);

  useEffect(() => {
    if (
      imageDownloadPhase === 'complete' &&
      lastImagePhaseRef.current !== 'complete' &&
      db &&
      isReady
    ) {
      runSearch(query, 0, false);
    }
    lastImagePhaseRef.current = imageDownloadPhase;
  }, [imageDownloadPhase, query, db, isReady, runSearch]);

  const pageWidth = wrapperSize.width;
  const pageHeight = wrapperSize.height;
  const groupedResults = useMemo(() => chunkQuads(results), [results]);

  const handleLoadMore = useCallback(() => {
    if (!db || !isReady || !hasMore || isLoadingMore || isSearching) return;

    setIsLoadingMore(true);
    setError(null);

    runSearch(query, offset, true).finally(() => {
      setIsLoadingMore(false);
    });
  }, [db, isReady, hasMore, isLoadingMore, isSearching, query, offset, runSearch]);

  const renderItem = useCallback(
    ({ item }: { item: EventInventoryItem[] }) => (
      <EventSearchPage
        items={item}
        pageWidth={pageWidth}
        pageHeight={pageHeight}
      />
    ),
    [pageWidth, pageHeight]
  );

  const handleWrapperLayout = useCallback((e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    setWrapperSize({ width: w, height: h });
  }, []);

  const filterOptionsWithAll = (values: string[]) => ['', ...values];

  const handlePriceChange = useCallback((value: string) => {
    const option = PRICE_OPTIONS.find((o) => o.value === value);
    setFilters((prev) => ({
      ...prev,
      minPrice: option?.min,
      maxPrice: option?.max,
    }));
  }, []);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing || !isReady) return;
    setIsRefreshing(true);
    setIsReady(false);
    setError(null);
    try {
      closeEventCatalogDatabase();
      await ensureEventCatalogDownloaded(showId, true);
      const database = await openEventCatalogDatabase();
      setDb(database);
      setIsReady(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, isReady, showId]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.vendorName) count++;
    if (filters.setName) count++;
    if (filters.rarity) count++;
    if (filters.condition) count++;
    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) count++;
    return count;
  }, [filters]);

  const hasQuery = query
    .toLowerCase()
    .replace(/[''\-.]/g, '')
    .replace(/\s+/g, ' ')
    .trim().length > 0;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}>
      <View style={styles.inner}>
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <TouchableOpacity onPress={onBack} activeOpacity={0.7}>
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
            <View style={styles.headerTitle}>
              <Text style={styles.title} numberOfLines={1}>
                {showName}
              </Text>
              {(showStartDate || showLocation) && (
                <Text style={styles.showMeta} numberOfLines={2}>
                  {showStartDate}
                  {showStartDate && showLocation ? '\n' : ''}
                  {showLocation}
                </Text>
              )}
            </View>
            <TouchableOpacity
              onPress={handleRefresh}
              disabled={isRefreshing}
              activeOpacity={0.7}
              style={styles.refreshButton}>
              {isRefreshing ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <Ionicons name="refresh-outline" size={22} color={colors.primary} />
              )}
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.searchInput}
            placeholder="Search show inventory..."
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={setQuery}
          />
          <Text style={styles.resultsCount}>
            {isSearching && results.length === 0
              ? 'Searching...'
              : `${results.length} result${results.length !== 1 ? 's' : ''}`}
          </Text>

          <View style={styles.filterBar}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterScroll}
              keyboardShouldPersistTaps="handled">
              <View style={styles.filterItem}>
                <Dropdown
                  label="Sort"
                  options={SORT_VALUES}
                  value={sort}
                  onChange={(value) => setSort(value as EventSearchSort)}
                  labels={SORT_LABELS}
                />
              </View>
              <View style={styles.filterItem}>
                <Dropdown
                  label="Vendor"
                  options={filterOptionsWithAll(filterOptions.vendors)}
                  value={filters.vendorName ?? ''}
                  onChange={(value) =>
                    setFilters((prev) => ({
                      ...prev,
                      vendorName: value || undefined,
                    }))
                  }
                  labels={{ '': 'All Vendors' }}
                />
              </View>
              <View style={styles.filterItem}>
                <Dropdown
                  label="Set"
                  options={filterOptionsWithAll(filterOptions.sets)}
                  value={filters.setName ?? ''}
                  onChange={(value) =>
                    setFilters((prev) => ({
                      ...prev,
                      setName: value || undefined,
                    }))
                  }
                  labels={{ '': 'All Sets' }}
                />
              </View>
              <View style={styles.filterItem}>
                <Dropdown
                  label="Rarity"
                  options={filterOptionsWithAll(filterOptions.rarities)}
                  value={filters.rarity ?? ''}
                  onChange={(value) =>
                    setFilters((prev) => ({
                      ...prev,
                      rarity: value || undefined,
                    }))
                  }
                  labels={{ '': 'All Rarities' }}
                />
              </View>
              <View style={styles.filterItem}>
                <Dropdown
                  label="Condition"
                  options={filterOptionsWithAll(filterOptions.conditions)}
                  value={filters.condition ?? ''}
                  onChange={(value) =>
                    setFilters((prev) => ({
                      ...prev,
                      condition: value || undefined,
                    }))
                  }
                  labels={{ '': 'All Conditions' }}
                />
              </View>
              <View style={styles.filterItem}>
                <Dropdown
                  label="Price"
                  options={PRICE_VALUES}
                  value={
                    filters.minPrice === 0 && filters.maxPrice === 9.99
                      ? 'under10'
                      : filters.minPrice === 10 && filters.maxPrice === 50
                      ? '10to50'
                      : filters.minPrice === 50 && filters.maxPrice === 100
                      ? '50to100'
                      : filters.minPrice === 100 && filters.maxPrice === undefined
                      ? 'over100'
                      : ''
                  }
                  onChange={handlePriceChange}
                  labels={PRICE_LABELS}
                />
              </View>
            </ScrollView>
          </View>
        </View>

        <View style={styles.listWrapper} onLayout={handleWrapperLayout}>
          {!isReady ? (
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
          ) : error ? (
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: colors.error }]}>
                {error}
              </Text>
            </View>
          ) : (
            <FlashList
              data={groupedResults}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              nestedScrollEnabled
              style={{ width: pageWidth, height: pageHeight }}
              contentContainerStyle={styles.listContent}
              keyExtractor={(item) =>
                item.map((i) => i.id).join('-')
              }
              renderItem={renderItem}
              onEndReached={handleLoadMore}
              onEndReachedThreshold={0.5}
              ListFooterComponent={
                isLoadingMore ? (
                  <View style={styles.footerSpinner}>
                    <ActivityIndicator color={colors.text} />
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
                      {hasQuery
                        ? 'No cards match your search.'
                        : 'No cards in this show.'}
                    </Text>
                  </View>
                )
              }
            />
          )}
        </View>
      </View>
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
  filterBar: {
    marginTop: 8,
    height: 88,
  },
  filterScroll: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingRight: 16,
    gap: 8,
  },
  filterItem: {
    width: 140,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  headerTitle: {
    flex: 1,
    marginLeft: 12,
  },
  refreshButton: {
    padding: 4,
    marginLeft: 8,
    minWidth: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  showMeta: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
    lineHeight: 15,
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
  resultsCount: {
    color: colors.textMuted,
    fontSize: 13,
  },
  listWrapper: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 0,
  },
  page: {
    flexDirection: 'column',
    alignContent: 'flex-start',
    justifyContent: 'flex-start',
  },
  pageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
  },
  progressTrack: {
    width: 200,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    marginTop: 16,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
  },
  footerSpinner: {
    paddingVertical: 16,
    alignItems: 'center',
  },
});
