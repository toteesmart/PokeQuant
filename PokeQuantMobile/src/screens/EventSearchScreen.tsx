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
import { useProgressStore } from '../store/progressStore';
import { ensureEventCatalogDownloaded } from '../services/EventCatalogDownloadService';
import {
  ensureCatalogImagesDownloaded,
  catalogImagesReady,
} from '../services/CatalogImageService';
import {
  openEventCatalogDatabase,
  searchEventInventory,
  type EventInventoryItem,
} from '../db/eventCatalogDb';
import type { SQLiteDatabase } from 'expo-sqlite';

const PAGE_PADDING = 12;
const CARD_GAP = 12;

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
      {items.map((item) => (
        <EventSearchCard
          key={item.id}
          item={item}
          width={cardWidth}
          height={cardHeight}
        />
      ))}
    </View>
  );
});

type Props = {
  showId: string;
  showName: string;
  onBack: () => void;
};

export function EventSearchScreen({ showId, showName, onBack }: Props) {
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

  const runSearch = useCallback(
    async (searchQuery: string, searchOffset: number, append = false) => {
      if (!db || !isReady) return;

      setError(null);
      const thisId = ++searchIdRef.current;

      try {
        const res = await searchEventInventory(db, searchQuery, 48, searchOffset);
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
    [db, isReady]
  );

  useEffect(() => {
    if (!db || !isReady) return;

    const normalized = query
      .toLowerCase()
      .replace(/[''\-.]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalized) {
      setResults([]);
      setHasMore(false);
      setOffset(0);
      setIsSearching(false);
      return;
    }

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
  }, [db, isReady, query, runSearch]);

  useEffect(() => {
    if (
      imageDownloadPhase === 'complete' &&
      lastImagePhaseRef.current !== 'complete'
    ) {
      const normalized = query
        .toLowerCase()
        .replace(/[''\-.]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (normalized && db && isReady) {
        runSearch(query, 0, false);
      }
    }
    lastImagePhaseRef.current = imageDownloadPhase;
  }, [imageDownloadPhase, query, db, isReady, runSearch]);

  const pageWidth = wrapperSize.width;
  const pageHeight = wrapperSize.height;
  const groupedResults = useMemo(() => chunkQuads(results), [results]);

  const handleLoadMore = useCallback(() => {
    if (!db || !isReady || !hasMore || isLoadingMore || isSearching) return;

    const normalized = query
      .toLowerCase()
      .replace(/[''\-.]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) return;

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
            <Text style={styles.title} numberOfLines={1}>
              {showName}
            </Text>
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
          ) : !hasQuery ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                Enter a card name, number, or set to search.
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
                      No cards match your search.
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
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 12,
    flex: 1,
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
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'flex-start',
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
