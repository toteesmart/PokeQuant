import { act } from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';
import { mkCatalogCard } from './helpers/builders';
import { flushAsync, renderHook } from './helpers/renderHook';
import {
  LANGUAGES,
  PRODUCT_TYPES,
  RARITIES,
  SORT_OPTIONS,
  useCatalogSearch,
} from '../src/hooks/useCatalogSearch';
import {
  searchCatalogCards,
  type SearchCatalogResult,
} from '../src/db/catalogDb';

// catalogDb is partially mocked: searchCatalogCards is the hook's only DB
// seam, so it's swapped for a jest.fn and the suite pins the call contract —
// raw query verbatim, filters passed through, limit/offset paging. The SQL
// layer it wraps (normalization, ORDER BY mapping, the lookahead hasMore) is
// pinned at the implementation by searchNormalization/catalogSearchPagination.
jest.mock('../src/db/catalogDb', () => {
  const actual = jest.requireActual<typeof import('../src/db/catalogDb')>(
    '../src/db/catalogDb'
  );
  return {
    ...actual,
    searchCatalogCards: jest.fn(),
  };
});

const mockSearch = jest.mocked(searchCatalogCards);

// The handle is only ever passed through to searchCatalogCards — a bare
// sentinel keeps the identity check honest.
const catalogDbHandle = {} as SQLiteDatabase;

// The hook debounces searches by 250ms of real time — park inside act just
// past it so the pending runSearch settles deterministically.
const flushSearch = () =>
  act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
  });

type SearchProps = { db: SQLiteDatabase | null; ready: boolean };

const renderSearch = (
  props: SearchProps = { db: catalogDbHandle, ready: true }
) => renderHook((p: SearchProps) => useCatalogSearch(p.db, p.ready), props);

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch.mockResolvedValue({ cards: [], hasMore: false, nextOffset: 0 });
});

test('starts idle — no query, no fetch, empty page state', async () => {
  const { result } = renderSearch();
  await flushSearch();

  expect(mockSearch).not.toHaveBeenCalled();
  expect(result.current.query).toBe('');
  expect(result.current.searchResults).toEqual([]);
  expect(result.current.pairedResults).toEqual([]);
  expect(result.current.isSearching).toBe(false);
  expect(result.current.searchError).toBeNull();
  expect(result.current.hasQuery).toBe(false);
  // hasMore starts optimistic; the loadMore guard needs normalized text too.
  expect(result.current.hasMore).toBe(true);
});

test('queries that normalize to empty never reach the DB', async () => {
  const { result } = renderSearch();

  for (const junk of ['   ', "'''", '-.-']) {
    act(() => result.current.setQuery(junk));
    await flushSearch();
    expect(result.current.hasQuery).toBe(false);
  }

  expect(mockSearch).not.toHaveBeenCalled();
  expect(result.current.searchResults).toEqual([]);
});

test('typed text waits out the 250ms debounce, then ships verbatim', async () => {
  const { result } = renderSearch();

  act(() => result.current.setQuery('pika'));
  // The render-phase reset claims the spinner up front.
  expect(result.current.isSearching).toBe(true);
  expect(result.current.hasQuery).toBe(true);

  // Inside the debounce window nothing fires…
  await act(async () => {
    await new Promise((r) => setTimeout(r, 100));
  });
  expect(mockSearch).not.toHaveBeenCalled();

  // …a retype restarts the clock, so the burst collapses to one fetch…
  act(() => result.current.setQuery("Farfetch'd - ex"));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 100));
  });
  expect(mockSearch).not.toHaveBeenCalled();

  // …and the raw text ships untouched — normalizeSearch lives in the DB layer.
  await flushSearch();
  expect(mockSearch).toHaveBeenCalledTimes(1);
  expect(mockSearch).toHaveBeenCalledWith(
    catalogDbHandle,
    {
      query: "Farfetch'd - ex",
      rarity: 'All',
      productType: 'All',
      language: 'All',
      sortBy: 'Newest',
      maxPrice: undefined,
    },
    50,
    0
  );
  expect(result.current.isSearching).toBe(false);
});

test('rarity/productType/language/sort pass through verbatim', async () => {
  const { result } = renderSearch();

  act(() => result.current.setQuery('pika'));
  act(() => result.current.setRarity('Rare'));
  act(() => result.current.setProductType('Cards Only'));
  act(() => result.current.setLanguage('Japanese'));
  act(() => result.current.setSortBy('Price: High to Low'));
  act(() => result.current.setMaxPrice('25.5'));
  await flushSearch();

  // Each change reschedules the same debounce — one fetch with final state.
  expect(mockSearch).toHaveBeenCalledTimes(1);
  expect(mockSearch).toHaveBeenCalledWith(
    catalogDbHandle,
    {
      query: 'pika',
      rarity: 'Rare',
      productType: 'Cards Only',
      language: 'Japanese',
      sortBy: 'Price: High to Low',
      maxPrice: 25.5,
    },
    50,
    0
  );
});

test('maxPrice coercion: junk and blank drop out, numerics ship as numbers', async () => {
  const { result } = renderSearch();
  act(() => result.current.setQuery('pika'));

  for (const [input, expected] of [
    ['abc', undefined],
    ['   ', undefined],
    ['0', 0],
    ['10.25', 10.25],
  ] as [string, number | undefined][]) {
    act(() => result.current.setMaxPrice(input));
    await flushSearch();
    expect(mockSearch).toHaveBeenLastCalledWith(
      catalogDbHandle,
      expect.objectContaining({ maxPrice: expected }),
      50,
      0
    );
  }
});

test('loadMore appends the next page at the returned offset, then stops', async () => {
  const a = mkCatalogCard({ id: 'a', productId: 1 });
  const b = mkCatalogCard({ id: 'b', productId: 2 });
  mockSearch
    .mockResolvedValueOnce({ cards: [a], hasMore: true, nextOffset: 50 })
    .mockResolvedValueOnce({ cards: [b], hasMore: false, nextOffset: 100 });

  const { result } = renderSearch();
  act(() => result.current.setQuery('pika'));
  act(() => result.current.setRarity('Rare'));
  await flushSearch();
  expect(result.current.searchResults).toEqual([a]);
  expect(result.current.hasMore).toBe(true);

  act(() => result.current.handleLoadMore());
  // isFetchingNextPage flips synchronously — the fetch hasn't drained yet.
  expect(result.current.isFetchingNextPage).toBe(true);
  await flushAsync();

  // Page two carries the accumulated offset and the live filters.
  expect(mockSearch).toHaveBeenLastCalledWith(
    catalogDbHandle,
    expect.objectContaining({ query: 'pika', rarity: 'Rare' }),
    50,
    50
  );
  expect(result.current.searchResults).toEqual([a, b]);
  expect(result.current.hasMore).toBe(false);
  expect(result.current.isFetchingNextPage).toBe(false);

  // hasMore false → further loadMore calls do nothing.
  act(() => result.current.handleLoadMore());
  await flushAsync();
  expect(mockSearch).toHaveBeenCalledTimes(2);
});

test('loadMore is gated while a search is in flight or the query is empty', async () => {
  const { result } = renderSearch();

  // hasMore may be optimistic, but the guard still needs normalized text.
  act(() => result.current.handleLoadMore());
  await flushAsync();
  expect(mockSearch).not.toHaveBeenCalled();

  // Debounce pending — isSearching is true, so loadMore bails early.
  act(() => result.current.setQuery('pika'));
  expect(result.current.isSearching).toBe(true);
  act(() => result.current.handleLoadMore());
  await flushSearch();
  expect(mockSearch).toHaveBeenCalledTimes(1);
});

test('a second loadMore while a page is in flight is a no-op', async () => {
  mockSearch.mockResolvedValueOnce({
    cards: [mkCatalogCard()],
    hasMore: true,
    nextOffset: 50,
  });
  const { result } = renderSearch();
  act(() => result.current.setQuery('pika'));
  await flushSearch();

  // Never resolves — the second call must gate on isFetchingNextPage.
  mockSearch.mockImplementationOnce(
    () => new Promise<SearchCatalogResult>(() => {})
  );
  act(() => result.current.handleLoadMore());
  expect(result.current.isFetchingNextPage).toBe(true);

  act(() => result.current.handleLoadMore());
  await flushAsync();
  expect(mockSearch).toHaveBeenCalledTimes(2);
});

test('a late-resolving stale search is dropped, results and errors alike', async () => {
  const pending: {
    resolve: (r: SearchCatalogResult) => void;
    reject: (e: unknown) => void;
  }[] = [];
  mockSearch.mockImplementation(
    () =>
      new Promise<SearchCatalogResult>((resolve, reject) =>
        pending.push({ resolve, reject })
      )
  );

  const { result } = renderSearch();
  act(() => result.current.setQuery('a'));
  await flushSearch(); // search #1 pending
  act(() => result.current.setQuery('b'));
  await flushSearch(); // search #2 pending, #1 stale
  expect(pending).toHaveLength(2);
  expect(result.current.isSearching).toBe(true);

  const fresh = mkCatalogCard({ id: 'fresh' });
  act(() =>
    pending[1].resolve({ cards: [fresh], hasMore: false, nextOffset: 1 })
  );
  await flushAsync();
  expect(result.current.searchResults).toEqual([fresh]);
  expect(result.current.isSearching).toBe(false);

  // #1 is stale now — its resolve must not overwrite the newer page…
  const stale = mkCatalogCard({ id: 'stale' });
  act(() =>
    pending[0].resolve({ cards: [stale], hasMore: false, nextOffset: 1 })
  );
  await flushAsync();
  expect(result.current.searchResults).toEqual([fresh]);

  // …and neither can a stale rejection flash an error banner.
  act(() => result.current.setQuery('c'));
  await flushSearch(); // #3 pending
  act(() => result.current.setQuery('d'));
  await flushSearch(); // #4 pending, #3 stale
  act(() => pending[3].resolve({ cards: [], hasMore: false, nextOffset: 0 }));
  await flushAsync();
  act(() => pending[2].reject(new Error('stale boom')));
  await flushAsync();
  expect(result.current.searchError).toBeNull();
});

test('a live search failure sets the error and clears it on the next query', async () => {
  const { result } = renderSearch();
  act(() => result.current.setQuery('zap'));
  await flushSearch();
  expect(mockSearch).toHaveBeenCalledTimes(1);

  mockSearch.mockRejectedValueOnce(new Error('Request quota hit'));
  act(() => result.current.setQuery('zapd'));
  await flushSearch();
  expect(result.current.searchError).toContain('Request quota hit');
  expect(result.current.hasMore).toBe(false);
  expect(result.current.isSearching).toBe(false);

  // The render-phase reset clears the banner before the next search lands.
  act(() => result.current.setQuery('zapdo'));
  expect(result.current.searchError).toBeNull();
});

test('a loadMore failure sets the error and drops the next-page flag', async () => {
  mockSearch.mockResolvedValueOnce({
    cards: [mkCatalogCard()],
    hasMore: true,
    nextOffset: 50,
  });
  const { result } = renderSearch();
  act(() => result.current.setQuery('pika'));
  await flushSearch();

  mockSearch.mockRejectedValueOnce(new Error('disk i/o'));
  act(() => result.current.handleLoadMore());
  await flushAsync();

  expect(result.current.searchError).toContain('disk i/o');
  expect(result.current.hasMore).toBe(false);
  expect(result.current.isFetchingNextPage).toBe(false);
});

test('a pending query waits for catalog readiness, then fires once', async () => {
  const { result, rerender } = renderSearch({
    db: catalogDbHandle,
    ready: false,
  });
  act(() => result.current.setQuery('pika'));
  await flushSearch();
  expect(mockSearch).not.toHaveBeenCalled();
  expect(result.current.isSearching).toBe(false);
  expect(result.current.hasQuery).toBe(true);

  // readyNow is part of the search key — the flip claims the spinner and
  // the effect fires the queued fetch.
  rerender({ db: catalogDbHandle, ready: true });
  expect(result.current.isSearching).toBe(true);
  await flushSearch();
  expect(mockSearch).toHaveBeenCalledTimes(1);
});

test('a null db handle keeps searches parked even when ready', async () => {
  const { result } = renderSearch({ db: null, ready: true });
  act(() => result.current.setQuery('pika'));
  await flushSearch();

  expect(mockSearch).not.toHaveBeenCalled();
  expect(result.current.isSearching).toBe(false);
  // The input still reads as a query — only the fetch is gated.
  expect(result.current.hasQuery).toBe(true);
});

test('clearing the query wipes results and blocks loadMore', async () => {
  mockSearch.mockResolvedValueOnce({
    cards: [mkCatalogCard()],
    hasMore: true,
    nextOffset: 50,
  });
  const { result } = renderSearch();
  act(() => result.current.setQuery('pika'));
  await flushSearch();
  expect(result.current.searchResults).toHaveLength(1);

  // The render-phase reset clears the page before any new fetch could run.
  act(() => result.current.setQuery(''));
  expect(result.current.searchResults).toEqual([]);
  expect(result.current.hasMore).toBe(false);
  expect(result.current.isSearching).toBe(false);
  await flushSearch();
  expect(mockSearch).toHaveBeenCalledTimes(1);

  act(() => result.current.handleLoadMore());
  await flushAsync();
  expect(mockSearch).toHaveBeenCalledTimes(1);
});

test('a new query restarts pagination at offset 0', async () => {
  mockSearch.mockResolvedValue({
    cards: [mkCatalogCard()],
    hasMore: true,
    nextOffset: 50,
  });
  const { result } = renderSearch();
  act(() => result.current.setQuery('a'));
  await flushSearch();
  act(() => result.current.handleLoadMore());
  await flushAsync();
  expect(mockSearch).toHaveBeenLastCalledWith(
    catalogDbHandle,
    expect.anything(),
    50,
    50
  );

  act(() => result.current.setQuery('b'));
  await flushSearch();
  expect(mockSearch).toHaveBeenLastCalledWith(
    catalogDbHandle,
    expect.objectContaining({ query: 'b' }),
    50,
    0
  );
});

test('a page fetch resolving after a newer search started is dropped', async () => {
  const page1 = mkCatalogCard({ id: 'p1' });
  mockSearch.mockResolvedValueOnce({
    cards: [page1],
    hasMore: true,
    nextOffset: 50,
  });

  const pending: { resolve: (r: SearchCatalogResult) => void }[] = [];
  const { result } = renderSearch();
  act(() => result.current.setQuery('a'));
  await flushSearch();

  mockSearch
    .mockImplementationOnce(
      () => new Promise<SearchCatalogResult>((resolve) => pending.push({ resolve }))
    )
    .mockResolvedValueOnce({
      cards: [mkCatalogCard({ id: 'fresh' })],
      hasMore: false,
      nextOffset: 1,
    });

  // loadMore captures the current search id without bumping it…
  act(() => result.current.handleLoadMore());
  expect(result.current.isFetchingNextPage).toBe(true);

  // …so the new query's effect bump marks the in-flight page stale.
  act(() => result.current.setQuery('b'));
  expect(result.current.isFetchingNextPage).toBe(false);
  act(() =>
    pending[0].resolve({
      cards: [mkCatalogCard({ id: 'stale' })],
      hasMore: false,
      nextOffset: 100,
    })
  );
  await flushSearch();

  expect(result.current.searchResults).toEqual([mkCatalogCard({ id: 'fresh' })]);
});

test('pairedResults chunks the page into [a, b] tuples with a ragged tail', async () => {
  const cards = [1, 2, 3, 4, 5].map((i) =>
    mkCatalogCard({ id: `c${i}`, productId: i })
  );
  mockSearch.mockResolvedValueOnce({ cards, hasMore: false, nextOffset: 5 });

  const { result } = renderSearch();
  act(() => result.current.setQuery('pika'));
  await flushSearch();

  expect(result.current.pairedResults).toEqual([
    [cards[0], cards[1]],
    [cards[2], cards[3]],
    [cards[4], undefined],
  ]);
});

test('filter vocabularies stay stable for the dropdowns', () => {
  // sortBy ships verbatim to the DB layer — every option must be a valid
  // CatalogSortBy, in display order.
  expect(SORT_OPTIONS).toEqual([
    'Newest',
    'Price: Low to High',
    'Price: High to Low',
    'Name A-Z',
  ]);
  expect(PRODUCT_TYPES).toEqual(['All', 'Cards Only', 'Sealed Only']);
  expect(LANGUAGES).toEqual(['All', 'English', 'Japanese']);
  expect(RARITIES[0]).toBe('All');
  expect(RARITIES).toContain('Illustration Rare');
});
