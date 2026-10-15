// useCatalogSearch — the search domain: filter state + vocabulary,
// debounced search with a stale-response guard, and load-more
// pagination. Filter option arrays are exported for the Dropdowns.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  searchCatalogCards,
  type CatalogCard,
  type CatalogFilters,
} from '../db/catalogDb';
import { normalizeSearch } from '../utils/search';
import { toErrorMessage } from '../utils/log';

export const RARITIES = [
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

export const PRODUCT_TYPES = ['All', 'Cards Only', 'Sealed Only'];

export const LANGUAGES = ['All', 'English', 'Japanese'];

export const SORT_OPTIONS = [
  'Newest',
  'Price: Low to High',
  'Price: High to Low',
  'Name A-Z',
];

function chunkPairs<T>(arr: T[]): [T, T?][] {
  const pairs: [T, T?][] = [];
  for (let i = 0; i < arr.length; i += 2) {
    pairs.push([arr[i], arr[i + 1]]);
  }
  return pairs;
}

export function useCatalogSearch(
  catalogDb: SQLiteDatabase | null,
  isCatalogReady: boolean
) {
  const [searchResults, setSearchResults] = useState<CatalogCard[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [rarity, setRarity] = useState('All');
  const [productType, setProductType] = useState('All');
  const [language, setLanguage] = useState('All');
  const [sortBy, setSortBy] = useState('Newest');
  const [maxPrice, setMaxPrice] = useState('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);

  const searchIdRef = useRef(0);

  // Search-input changes reset pagination and flip the spinner —
  // render-adjusted on the input key so the effect body stays async-only.
  const readyNow = isCatalogReady && catalogDb != null;
  const hasSearchText = normalizeSearch(query) !== '';
  const searchKey = JSON.stringify([
    query,
    rarity,
    productType,
    language,
    sortBy,
    maxPrice,
    readyNow,
  ]);
  const [prevSearchKey, setPrevSearchKey] = useState(searchKey);
  if (searchKey !== prevSearchKey) {
    setPrevSearchKey(searchKey);
    setOffset(0);
    setIsFetchingNextPage(false);
    setSearchError(null);
    if (hasSearchText && readyNow) {
      setHasMore(true);
      setIsSearching(true);
    } else {
      setIsSearching(false);
      if (!hasSearchText) {
        setSearchResults([]);
        setHasMore(false);
      }
    }
  }

  useEffect(() => {
    if (!catalogDb || !isCatalogReady || !normalizeSearch(query)) return;

    const thisId = ++searchIdRef.current;

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

  const pairedResults = useMemo(
    () => chunkPairs(searchResults),
    [searchResults]
  );

  const hasQuery = normalizeSearch(query).length > 0;

  return {
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
    searchResults,
    pairedResults,
    isSearching,
    searchError,
    hasQuery,
    hasMore,
    isFetchingNextPage,
    handleLoadMore,
  };
}
