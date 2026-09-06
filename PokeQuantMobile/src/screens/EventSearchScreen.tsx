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
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import { EventSearchCard } from '../components/EventSearchCard';
import { useProgressStore } from '../store/progressStore';
import { ensureEventCatalogDownloaded } from '../services/EventCatalogDownloadService';
import {
  openEventCatalogDatabase,
  searchEventInventory,
  type EventInventoryItem,
} from '../db/eventCatalogDb';
import type { SQLiteDatabase } from 'expo-sqlite';

type EventItemPair = [EventInventoryItem, EventInventoryItem?];

function chunkPairs<T>(arr: T[]): Array<[T, T?]> {
  const pairs: Array<[T, T?]> = [];
  for (let i = 0; i < arr.length; i += 2) {
    pairs.push([arr[i], arr[i + 1]]);
  }
  return pairs;
}

type EventSearchRowProps = {
  pair: EventItemPair;
  rowWidth: number;
  cardWidth: number;
};

const EventSearchRow = memo(function EventSearchRow({
  pair,
  rowWidth,
  cardWidth,
}: EventSearchRowProps) {
  const justifyContent = pair[1] ? 'space-between' : 'center';
  return (
    <View style={[styles.cardRow, { width: rowWidth, minHeight: 452, justifyContent }]}>
      <EventSearchCard item={pair[0]} width={cardWidth} />
      {pair[1] && <EventSearchCard item={pair[1]} width={cardWidth} />}
    </View>
  );
});

type Props = {
  showId: string;
  showName: string;
  onBack: () => void;
};

export function EventSearchScreen({ showId, showName, onBack }: Props) {
  const { width } = useWindowDimensions();

  const [db, setDb] = useState<SQLiteDatabase | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EventInventoryItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchIdRef = useRef(0);

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

    return () => {
      mounted = false;
    };
  }, [showId]);

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
    const thisId = ++searchIdRef.current;

    const timeout = setTimeout(() => {
      searchEventInventory(db, query, 50, 0)
        .then((res) => {
          if (thisId !== searchIdRef.current) return;
          setResults(res.items);
          setOffset(res.nextOffset);
          setHasMore(res.hasMore);
        })
        .catch((err) => {
          if (thisId !== searchIdRef.current) return;
          setError(err instanceof Error ? err.message : String(err));
          setHasMore(false);
        })
        .finally(() => {
          if (thisId !== searchIdRef.current) return;
          setIsSearching(false);
        });
    }, 250);

    return () => clearTimeout(timeout);
  }, [db, isReady, query]);

  const cardWidth = useMemo(() => Math.max(1, (width - 34) / 2), [width]);
  const pairedResults = useMemo(() => chunkPairs(results), [results]);

  const handleLoadMore = useCallback(() => {
    if (!db || !isReady || !hasMore || isLoadingMore || isSearching) return;

    const normalized = query
      .toLowerCase()
      .replace(/[''\-.]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) return;

    const thisId = searchIdRef.current;
    setIsLoadingMore(true);
    setError(null);

    searchEventInventory(db, query, 50, offset)
      .then((res) => {
        if (thisId !== searchIdRef.current) return;
        setResults((prev) => [...prev, ...res.items]);
        setOffset(res.nextOffset);
        setHasMore(res.hasMore);
      })
      .catch((err) => {
        if (thisId !== searchIdRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
        setHasMore(false);
      })
      .finally(() => {
        if (thisId !== searchIdRef.current) return;
        setIsLoadingMore(false);
      });
  }, [db, isReady, hasMore, isLoadingMore, isSearching, query, offset]);

  const renderItem = useCallback(
    ({ item }: { item: EventItemPair }) => (
      <EventSearchRow
        pair={item}
        rowWidth={width}
        cardWidth={cardWidth}
      />
    ),
    [width, cardWidth]
  );

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

        <View style={styles.listWrapper}>
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
    paddingBottom: 8,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingBottom: 8,
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
