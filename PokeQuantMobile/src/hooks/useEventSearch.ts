// EventSearchScreen's brain: event-catalog download + open (with offline
// fallback to existing local data), debounced search with stale-response
// protection, pagination, filter options, and refresh/reload handling.
//
// Boundary: owns the event_catalog.db handle lifecycle and all async work;
// the screen keeps only layout (wrapper size) and JSX.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useProgressStore } from '../store/progressStore';
import { isOfflineError, toErrorMessage } from '../utils/log';
import { ensureEventCatalogDownloaded } from '../services/EventCatalogDownloadService';
import {
  closeEventCatalogDatabase,
  getDistinctEventValues,
  openEventCatalogDatabase,
  searchEventInventory,
  type EventDistinctValues,
  type EventInventoryItem,
  type EventSearchFilters,
  type EventSearchSort,
} from '../db/eventCatalogDb';

const PAGE_SIZE = 48;

function formatDownloadError(err: unknown, hasLocalData: boolean): string {
  if (isOfflineError(err)) {
    return hasLocalData
      ? "No internet — using this show's downloaded listings."
      : 'No internet — connect to download the listings.';
  }
  return toErrorMessage(err);
}

type LocalFallback = { database: SQLiteDatabase; hasLocalData: boolean };

// If the show's rows are already hydrated locally, the catalog stays
// browsable offline — reopen the shared handle and count rows.
async function openLocalFallback(showId: string): Promise<LocalFallback> {
  const database = openEventCatalogDatabase();
  const row = await database.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM show_inventory WHERE show_id = ?',
    showId,
  );
  return { database, hasLocalData: (row?.count ?? 0) > 0 };
}

export function useEventSearch(showId: string) {
  const [db, setDb] = useState<SQLiteDatabase | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EventInventoryItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filters, setFilters] = useState<EventSearchFilters>({});
  const [sort, setSort] = useState<EventSearchSort>('name');
  const [filterOptions, setFilterOptions] = useState<EventDistinctValues>({
    vendors: [],
    sets: [],
    rarities: [],
    conditions: [],
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  const searchIdRef = useRef(0);
  const lastImagePhaseRef = useRef<string | null>(null);

  const eventDownloadProgress = useProgressStore((state) => state.eventDownloadProgress);
  const eventDownloadPhase = useProgressStore((state) => state.eventDownloadPhase);
  const eventDownloadLabel = useProgressStore((state) => state.eventDownloadLabel);
  const imageDownloadPhase = useProgressStore((state) => state.imageDownloadPhase);

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
      return { downloadProgress: 1, downloadStatus: 'Show listings ready.' };
    }
    return { downloadProgress: 0, downloadStatus: 'Opening show listings...' };
  }, [eventDownloadPhase, eventDownloadProgress, eventDownloadLabel]);

  // Switching shows or a manual retry resets all catalog/search state.
  const initKey = `${showId}:${reloadNonce}`;
  const [prevInitKey, setPrevInitKey] = useState(initKey);
  if (initKey !== prevInitKey) {
    setPrevInitKey(initKey);
    setError(null);
    setNotice(null);
    setDb(null);
    setIsReady(false);
  }

  useEffect(() => {
    let mounted = true;

    ensureEventCatalogDownloaded(showId)
      .then(() => openEventCatalogDatabase())
      .then((database) => {
        if (!mounted) return;
        setDb(database);
        setIsReady(true);
        setError(null);
        setNotice(null);
      })
      .catch(async (err) => {
        if (!mounted) return;

        // If the download failed, try to open an existing catalog. Offline
        // browsing of already-downloaded show data is an intentional feature.
        let hasLocalData = false;
        try {
          const local = await openLocalFallback(showId);
          hasLocalData = local.hasLocalData;
          if (hasLocalData) {
            setDb(local.database);
            setIsReady(true);
          }
        } catch {
          // Could not open or query the local database; fall through to the
          // friendly message below.
        }

        const friendlyMessage = formatDownloadError(err, hasLocalData);
        if (isOfflineError(err)) {
          setNotice(friendlyMessage);
          setError(null);
        } else {
          setError(friendlyMessage);
          setNotice(null);
        }
      });

    // Card images resolve from the extracted archive when present — browsing
    // a show must never trigger the image archive download itself (that is an
    // explicit choice in the setup gate / Settings).
    return () => {
      mounted = false;
    };
  }, [showId, reloadNonce]);

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
          PAGE_SIZE,
          searchOffset,
          filters,
          sort,
          showId,
        );
        if (thisId !== searchIdRef.current) return;
        setResults((prev) => (append ? [...prev, ...res.items] : res.items));
        setOffset(res.nextOffset);
        setHasMore(res.hasMore);
      } catch (err) {
        if (thisId !== searchIdRef.current) return;
        setError(toErrorMessage(err));
        setHasMore(false);
      }
    },
    [db, isReady, filters, sort, showId],
  );

  // New search input resets pagination and shows the spinner immediately —
  // render-adjusted on the query triple rather than inside the debounce.
  // Spinner only claims itself when the effect will actually run.
  const readyNow = db != null && isReady;
  const searchKey = JSON.stringify([query, filters, sort, readyNow]);
  const [prevSearchKey, setPrevSearchKey] = useState(searchKey);
  if (searchKey !== prevSearchKey) {
    setPrevSearchKey(searchKey);
    setOffset(0);
    setError(null);
    if (readyNow) {
      setHasMore(true);
      setIsSearching(true);
    } else {
      setIsSearching(false);
    }
  }

  useEffect(() => {
    if (!db || !isReady) return;

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

  const loadMore = useCallback(() => {
    if (!db || !isReady || !hasMore || isLoadingMore || isSearching) return;

    setIsLoadingMore(true);
    setError(null);

    runSearch(query, offset, true).finally(() => {
      setIsLoadingMore(false);
    });
  }, [db, isReady, hasMore, isLoadingMore, isSearching, query, offset, runSearch]);

  const refresh = useCallback(async () => {
    if (isRefreshing || !isReady) return;
    // Invalidate any in-flight search — its error/result would otherwise
    // surface after refresh clears state, flashing a stale banner.
    searchIdRef.current += 1;
    setIsRefreshing(true);
    setIsReady(false);
    setDb(null);
    setError(null);
    setNotice(null);
    try {
      closeEventCatalogDatabase();
      await ensureEventCatalogDownloaded(showId, true);
      const database = await openEventCatalogDatabase();
      setDb(database);
      setIsReady(true);
      setError(null);
      setNotice(null);
    } catch (err) {
      // The old handle may have been closed by the failed download — reopen
      // it so the existing data stays browsable instead of stranding the
      // screen on a spinner. If the download failed because the device is
      // offline, only treat it as an error if no local data is available.
      let hasLocalData = false;
      try {
        const local = await openLocalFallback(showId);
        hasLocalData = local.hasLocalData;
        if (hasLocalData) {
          setDb(local.database);
          setIsReady(true);
        }
      } catch {
        // Leave the stale handle; the error below is still surfaced.
      }

      const friendlyMessage = formatDownloadError(err, hasLocalData);
      if (isOfflineError(err)) {
        setNotice(friendlyMessage);
        setError(null);
      } else {
        setError(friendlyMessage);
        setNotice(null);
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, isReady, showId]);

  const retry = useCallback(() => setReloadNonce((n) => n + 1), []);

  const patchFilters = useCallback((patch: Partial<EventSearchFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  return {
    isReady,
    query,
    setQuery,
    results,
    isSearching,
    isLoadingMore,
    error,
    notice,
    filters,
    patchFilters,
    sort,
    setSort,
    filterOptions,
    isRefreshing,
    downloadProgress,
    downloadStatus,
    loadMore,
    refresh,
    retry,
  };
}
