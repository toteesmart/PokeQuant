import { act } from 'react';
import { File } from 'expo-file-system';
import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import { mkEventItem } from './helpers/builders';
import { flushAsync, renderHook } from './helpers/renderHook';
import { useEventSearch } from '../src/hooks/useEventSearch';
import {
  attachEventImages,
  clearEventImageMatchCache,
  closeEventCatalogDatabase,
  closeEventImageDb,
  getDistinctEventValues,
  openEventCatalogDatabase,
  searchEventInventory,
  type EventDistinctValues,
  type EventSearchResult,
} from '../src/db/eventCatalogDb';
import { ensureEventCatalogDownloaded } from '../src/services/EventCatalogDownloadService';
import {
  ensureCatalogImagesDownloaded,
  ensureJpImagesDownloaded,
  getLocalCatalogImageUri,
  warmCatalogImageIndex,
} from '../src/services/CatalogImageService';
import { useProgressStore } from '../src/store/progressStore';

// eventCatalogDb is partially real: only the four functions the hook calls
// are swapped for jest.fns. attachEventImages + the cache/close helpers stay
// real so the fuzzy image-match threshold (150) is pinned at its actual
// boundary — the catalog image lookup opens pokequant_catalog.db through the
// (already mocked) expo-sqlite seam rather than the catalogDb facade.
jest.mock('../src/db/eventCatalogDb', () => {
  const actual = jest.requireActual<typeof import('../src/db/eventCatalogDb')>(
    '../src/db/eventCatalogDb'
  );
  return {
    ...actual,
    openEventCatalogDatabase: jest.fn(),
    closeEventCatalogDatabase: jest.fn(),
    getDistinctEventValues: jest.fn(),
    searchEventInventory: jest.fn(),
  };
});

jest.mock('../src/services/EventCatalogDownloadService', () => ({
  ensureEventCatalogDownloaded: jest.fn(),
}));

// The ~1.8 GB image pack is an explicit setup/Settings choice — event
// browsing may only read the local index, never start a download.
jest.mock('../src/services/CatalogImageService', () => ({
  getCatalogImageUri: jest.fn(),
  getCatalogImageFallbackUrl: jest.fn(),
  getLocalCatalogImageUri: jest.fn(),
  catalogImagesReady: jest.fn(() => false),
  catalogJpImagesReady: jest.fn(() => false),
  warmCatalogImageIndex: jest.fn(async () => {}),
  ensureCatalogImagesDownloaded: jest.fn(async () => ({
    downloaded: false,
    extracted: 0,
  })),
  ensureJpImagesDownloaded: jest.fn(async () => ({
    downloaded: false,
    extracted: 0,
  })),
}));

const mockEnsure = jest.mocked(ensureEventCatalogDownloaded);
const mockOpenEventDb = jest.mocked(openEventCatalogDatabase);
const mockCloseEventDb = jest.mocked(closeEventCatalogDatabase);
const mockSearch = jest.mocked(searchEventInventory);
const mockDistinct = jest.mocked(getDistinctEventValues);
const mockLocalImage = jest.mocked(getLocalCatalogImageUri);
const mockOpenSqlite = jest.mocked(openDatabaseSync);

// The real searchEventInventory is pulled from the unmocked module for the
// SQL-layer pins — the jest.fn above shadows it on the mocked namespace.
const realSearchEventInventory = jest.requireActual<
  typeof import('../src/db/eventCatalogDb')
>('../src/db/eventCatalogDb').searchEventInventory;

type FakeDb = SQLiteDatabase & {
  getFirstAsync: jest.Mock;
  getAllSync: jest.Mock;
};

const mkFakeDb = (): FakeDb =>
  ({
    getFirstAsync: jest.fn(async () => null),
    getAllSync: jest.fn(async () => []),
    runSync: jest.fn(),
    execSync: jest.fn(),
    closeSync: jest.fn(),
    withTransactionSync: jest.fn((fn: () => void) => fn()),
  }) as unknown as FakeDb;

let eventDb: FakeDb;

const DISTINCT: EventDistinctValues = {
  vendors: ['Vendor One'],
  sets: ['SV151'],
  rarities: ['Rare'],
  conditions: ['NM'],
};

// The hook debounces searches by 250ms of real time — park inside act just
// past it so the pending runSearch settles deterministically.
const flushSearch = () =>
  act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
  });

const renderSearch = (showId = 'show-1') =>
  renderHook((id: string) => useEventSearch(id), showId);

beforeEach(() => {
  jest.clearAllMocks();
  clearEventImageMatchCache();
  closeEventImageDb();

  eventDb = mkFakeDb();
  mockEnsure.mockResolvedValue({ ready: true, downloaded: false });
  mockOpenEventDb.mockReturnValue(eventDb);
  mockSearch.mockResolvedValue({ items: [], hasMore: false, nextOffset: 0 });
  mockDistinct.mockResolvedValue(DISTINCT);
  mockLocalImage.mockReturnValue(undefined);

  act(() => {
    useProgressStore.setState({
      eventDownloadProgress: 0,
      eventDownloadLabel: '',
      eventDownloadPhase: 'download',
      imageDownloadPhase: 'download',
      isDownloadingImages: false,
      isEventExtracting: false,
    });
  });
});

test('mount downloads the catalog, opens it, then runs the empty-query search', async () => {
  const item = mkEventItem();
  mockSearch.mockResolvedValue({ items: [item], hasMore: false, nextOffset: 1 });

  const { result } = renderSearch();
  expect(result.current.isReady).toBe(false);
  expect(result.current.downloadStatus).toBe('Downloading... 0%');

  await flushAsync();
  expect(mockEnsure).toHaveBeenCalledWith('show-1');
  // The DB handle opens only after the download resolves.
  expect(mockOpenEventDb.mock.invocationCallOrder[0]).toBeGreaterThan(
    mockEnsure.mock.invocationCallOrder[0]
  );
  expect(result.current.isReady).toBe(true);
  // The debounce window claims the spinner + optimistic hasMore up front.
  expect(result.current.isSearching).toBe(true);

  await flushSearch();
  expect(mockSearch).toHaveBeenCalledTimes(1);
  expect(mockSearch).toHaveBeenCalledWith(
    eventDb,
    '',
    48,
    0,
    {},
    'name',
    'show-1'
  );
  expect(result.current.results).toEqual([item]);
  expect(result.current.isSearching).toBe(false);
  expect(result.current.filterOptions).toEqual(DISTINCT);
  expect(result.current.error).toBeNull();
  expect(result.current.notice).toBeNull();
});

test('an empty page yields empty results and no error', async () => {
  const { result } = renderSearch();
  await flushAsync();
  await flushSearch();

  expect(result.current.results).toEqual([]);
  expect(result.current.error).toBeNull();
});

test('typed text waits out the 250ms debounce, then reaches the DB verbatim', async () => {
  const { result } = renderSearch();
  await flushAsync();
  await flushSearch();
  expect(mockSearch).toHaveBeenCalledTimes(1);

  act(() => result.current.setQuery("Farfetch'd - ex"));
  expect(result.current.query).toBe("Farfetch'd - ex");
  expect(result.current.isSearching).toBe(true);

  // Inside the debounce window nothing new fires…
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  expect(mockSearch).toHaveBeenCalledTimes(1);

  // …then the raw text ships untouched — normalizeSearch lives in the DB layer.
  await flushSearch();
  expect(mockSearch).toHaveBeenCalledTimes(2);
  expect(mockSearch).toHaveBeenLastCalledWith(
    eventDb,
    "Farfetch'd - ex",
    48,
    0,
    {},
    'name',
    'show-1'
  );
});

test('patchFilters merges and filters+sort reach the next search', async () => {
  const { result } = renderSearch();
  await flushAsync();
  await flushSearch();

  act(() => result.current.patchFilters({ rarity: 'Rare' }));
  act(() => result.current.patchFilters({ maxPrice: 20 }));
  act(() => result.current.setSort('price-high'));
  await flushSearch();

  expect(result.current.filters).toEqual({ rarity: 'Rare', maxPrice: 20 });
  expect(result.current.sort).toBe('price-high');
  expect(mockSearch).toHaveBeenLastCalledWith(
    eventDb,
    '',
    48,
    0,
    { rarity: 'Rare', maxPrice: 20 },
    'price-high',
    'show-1'
  );
});

test('loadMore appends the next page at the returned offset, then stops', async () => {
  const a = mkEventItem({ id: 'a' });
  const b = mkEventItem({ id: 'b' });
  mockSearch
    .mockResolvedValueOnce({ items: [a], hasMore: true, nextOffset: 1 })
    .mockResolvedValueOnce({ items: [b], hasMore: false, nextOffset: 2 });

  const { result } = renderSearch();
  await flushAsync();
  await flushSearch();
  expect(result.current.results).toEqual([a]);

  act(() => result.current.loadMore());
  await flushAsync();
  // Second call carries the accumulated offset and appends.
  expect(mockSearch).toHaveBeenLastCalledWith(
    eventDb,
    '',
    48,
    1,
    {},
    'name',
    'show-1'
  );
  expect(result.current.results).toEqual([a, b]);
  expect(result.current.isLoadingMore).toBe(false);

  // hasMore false → further loadMore calls do nothing.
  act(() => result.current.loadMore());
  await flushAsync();
  expect(mockSearch).toHaveBeenCalledTimes(2);
});

test('loadMore is gated while a search is already in flight', async () => {
  const { result } = renderSearch();
  await flushAsync();

  // Debounce still pending — isSearching is true, so loadMore bails early.
  expect(result.current.isSearching).toBe(true);
  act(() => result.current.loadMore());
  await flushAsync();
  expect(mockSearch).not.toHaveBeenCalled();

  await flushSearch();
  expect(mockSearch).toHaveBeenCalledTimes(1);
});

test('a late-resolving stale search is dropped, results and errors alike', async () => {
  const pending: {
    resolve: (r: EventSearchResult) => void;
    reject: (e: unknown) => void;
  }[] = [];
  mockSearch.mockImplementation(
    () =>
      new Promise<EventSearchResult>((resolve, reject) =>
        pending.push({ resolve, reject })
      )
  );

  const { result } = renderSearch();
  await flushAsync();
  await flushSearch(); // search #1 pending
  act(() => result.current.setQuery('pika'));
  await flushSearch(); // search #2 pending, #1 still in flight
  expect(pending).toHaveLength(2);

  const stale = mkEventItem({ id: 'stale' });
  const fresh = mkEventItem({ id: 'fresh' });
  act(() => pending[1].resolve({ items: [fresh], hasMore: false, nextOffset: 1 }));
  await flushAsync();
  expect(result.current.results).toEqual([fresh]);

  // #1 is stale now — its resolve must not overwrite the newer page…
  act(() => pending[0].resolve({ items: [stale], hasMore: false, nextOffset: 1 }));
  await flushAsync();
  expect(result.current.results).toEqual([fresh]);

  // …and neither can a stale rejection flash an error banner.
  act(() => result.current.setQuery('x'));
  await flushSearch(); // #3 pending
  act(() => result.current.setQuery('y'));
  await flushSearch(); // #4 pending, #3 stale
  act(() => pending[3].resolve({ items: [], hasMore: false, nextOffset: 0 }));
  await flushAsync();
  act(() => pending[2].reject(new Error('stale boom')));
  await flushAsync();
  expect(result.current.error).toBeNull();
});

test('a live search failure sets the error and clears it on the next query', async () => {
  const { result } = renderSearch();
  await flushAsync();
  await flushSearch();

  mockSearch.mockRejectedValueOnce(new Error('Request quota hit'));
  act(() => result.current.setQuery('zap'));
  await flushSearch();
  expect(result.current.error).toContain('Request quota hit');
  expect(result.current.results).toEqual([]);

  // The render-phase reset clears the banner before the next search lands.
  act(() => result.current.setQuery('zapdos'));
  expect(result.current.error).toBeNull();
});

test('offline download failure with local rows stays browsable via notice', async () => {
  mockEnsure.mockRejectedValue(new TypeError('fetch failed'));
  eventDb.getFirstAsync.mockResolvedValue({ count: 4 });

  const { result } = renderSearch();
  await flushAsync();

  expect(result.current.isReady).toBe(true);
  expect(result.current.notice).toBe(
    "No internet — using this show's downloaded listings."
  );
  expect(result.current.error).toBeNull();

  await flushSearch();
  expect(mockSearch).toHaveBeenCalledTimes(1);
});

test('offline download failure with no local rows lands a connect notice', async () => {
  mockEnsure.mockRejectedValue(new TypeError('fetch failed'));
  eventDb.getFirstAsync.mockResolvedValue({ count: 0 });

  const { result } = renderSearch();
  await flushAsync();

  expect(result.current.isReady).toBe(false);
  expect(result.current.notice).toBe(
    'No internet — connect to download the listings.'
  );
  expect(result.current.error).toBeNull();
});

test('a non-offline download failure is an error, never a notice', async () => {
  mockEnsure.mockRejectedValue(new Error('Request quota hit'));

  const { result } = renderSearch();
  await flushAsync();

  expect(result.current.isReady).toBe(false);
  expect(result.current.error).toContain('Request quota hit');
  expect(result.current.notice).toBeNull();
});

test('a dead local handle still surfaces the friendly offline notice', async () => {
  mockEnsure.mockRejectedValue(new TypeError('fetch failed'));
  mockOpenEventDb.mockImplementation(() => {
    throw new Error('handle gone');
  });

  const { result } = renderSearch();
  await flushAsync();

  expect(result.current.isReady).toBe(false);
  expect(result.current.notice).toBe(
    'No internet — connect to download the listings.'
  );
  expect(result.current.error).toBeNull();
});

test('refresh closes the handle, force-redownloads, and searches fresh', async () => {
  const { result } = renderSearch();
  await flushAsync();
  await flushSearch();
  mockSearch.mockResolvedValue({
    items: [mkEventItem({ id: 'refreshed' })],
    hasMore: false,
    nextOffset: 1,
  });

  act(() => {
    void result.current.refresh();
  });
  // isRefreshing flips synchronously — the download's first await hasn't
  // drained yet.
  expect(result.current.isRefreshing).toBe(true);
  await flushAsync();

  expect(mockCloseEventDb).toHaveBeenCalledTimes(1);
  expect(mockEnsure).toHaveBeenLastCalledWith('show-1', true);
  expect(result.current.isRefreshing).toBe(false);
  expect(result.current.isReady).toBe(true);

  await flushSearch();
  expect(result.current.results).toEqual([mkEventItem({ id: 'refreshed' })]);
});

test('a failed refresh reopens the local rows and keeps browsing', async () => {
  const { result } = renderSearch();
  await flushAsync();
  await flushSearch();

  mockEnsure.mockRejectedValueOnce(new TypeError('fetch failed'));
  eventDb.getFirstAsync.mockResolvedValue({ count: 2 });

  act(() => {
    void result.current.refresh();
  });
  await flushAsync();

  expect(result.current.isReady).toBe(true);
  expect(result.current.isRefreshing).toBe(false);
  expect(result.current.notice).toBe(
    "No internet — using this show's downloaded listings."
  );
  expect(result.current.error).toBeNull();
});

test('retry bumps the reload nonce and re-runs init', async () => {
  mockEnsure.mockRejectedValueOnce(new Error('Request quota hit'));
  const { result } = renderSearch();
  await flushAsync();
  expect(result.current.error).toContain('Request quota hit');
  expect(result.current.isReady).toBe(false);

  act(() => result.current.retry());
  await flushAsync();
  expect(mockEnsure).toHaveBeenCalledTimes(2);
  expect(result.current.error).toBeNull();
  expect(result.current.isReady).toBe(true);
});

test('switching shows re-initializes against the new show id', async () => {
  const { result, rerender } = renderSearch('show-1');
  await flushAsync();
  await flushSearch();

  rerender('show-2');
  await flushAsync();
  expect(mockEnsure).toHaveBeenLastCalledWith('show-2');
  expect(result.current.isReady).toBe(true);

  await flushSearch();
  expect(mockSearch).toHaveBeenLastCalledWith(
    eventDb,
    '',
    48,
    0,
    {},
    'name',
    'show-2'
  );
});

test('image-pack completion re-searches once, then the guard suppresses repeats', async () => {
  const { result } = renderSearch();
  await flushAsync();
  await flushSearch();
  expect(mockSearch).toHaveBeenCalledTimes(1);

  // The transition fires an immediate search — no 250ms debounce.
  act(() => {
    useProgressStore.setState({ imageDownloadPhase: 'complete' });
  });
  await flushAsync();
  expect(mockSearch).toHaveBeenCalledTimes(2);

  // A query change re-runs the effect but lastImagePhaseRef blocks the
  // second fire — only the debounced search adds a call.
  act(() => result.current.setQuery('z'));
  await flushAsync();
  expect(mockSearch).toHaveBeenCalledTimes(2);
  await flushSearch();
  expect(mockSearch).toHaveBeenCalledTimes(3);
});

test('downloadStatus renders the event phases', async () => {
  const { result } = renderSearch();

  act(() => {
    useProgressStore.setState({
      eventDownloadPhase: 'download',
      eventDownloadProgress: 0.42,
      eventDownloadLabel: 'Fetching listings',
    });
  });
  expect(result.current.downloadStatus).toBe('Fetching listings 42%');
  expect(result.current.downloadProgress).toBe(0.42);

  act(() => {
    useProgressStore.setState({
      eventDownloadPhase: 'extract',
      eventDownloadProgress: 0.5,
      eventDownloadLabel: '',
    });
  });
  expect(result.current.downloadStatus).toBe('Extracting... 50%');

  act(() => {
    useProgressStore.setState({
      eventDownloadPhase: 'complete',
      eventDownloadProgress: 1,
    });
  });
  expect(result.current.downloadStatus).toBe('Show listings ready.');

  await flushAsync();
});

test('a filter-options failure warns and keeps the empty defaults', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockDistinct.mockRejectedValue(new Error('disk i/o error'));

  const { result } = renderSearch();
  await flushAsync();

  expect(result.current.filterOptions).toEqual({
    vendors: [],
    sets: [],
    rarities: [],
    conditions: [],
  });
  warn.mockRestore();
});

describe('searchEventInventory SQL layer (real implementation)', () => {
  test('the normalized query becomes the LIKE pattern; filters bind in order', async () => {
    const db = mkFakeDb();
    await realSearchEventInventory(
      db,
      "Farfetch'd-ex",
      48,
      0,
      {
        vendorName: "Bob's",
        setName: 'SV-151',
        rarity: 'Rare',
        condition: 'NM',
        minPrice: 1,
        maxPrice: 10,
      },
      'price-high',
      'show-1'
    );

    const [sql, ...args] = db.getAllSync.mock.calls[0] as [string, ...(string | number)[]];
    expect(sql).toContain('FROM show_inventory');
    expect(sql).toContain('show_id = ?');
    expect(sql).toContain('LIKE ? ESCAPE');
    expect(sql).toContain('ORDER BY sticker_price DESC');
    // Punctuation-stripped pattern ×3 (name/number/set), then filters in
    // buildWhereClause order, then the limit+1 lookahead and the offset.
    expect(args).toEqual([
      'show-1',
      '%farfetchdex%',
      '%farfetchdex%',
      '%farfetchdex%',
      'bobs',
      'sv151',
      'rare',
      'nm',
      1,
      10,
      49,
      0,
    ]);
  });

  test('rows map to EventInventoryItem and the lookahead row sets hasMore', async () => {
    const db = mkFakeDb();
    const row = (id: string) => ({
      id,
      product_id: 42,
      name: 'Pika',
      set_name: 'SV',
      number: '1',
      rarity: 'R',
      condition: 'NM',
      sticker_price: 3.5,
      quantity: 2,
      vendor_name: 'V',
      vendor_table: 'T',
    });
    db.getAllSync.mockResolvedValue([row('r1'), row('r2')]);

    const res = await realSearchEventInventory(db, '', 1, 0, {}, 'name');
    expect(res.items).toEqual([
      {
        id: 'r1',
        productId: 42,
        name: 'Pika',
        set: 'SV',
        number: '1',
        rarity: 'R',
        condition: 'NM',
        stickerPrice: 3.5,
        quantity: 2,
        vendorName: 'V',
        vendorTable: 'T',
      },
    ]);
    expect(res.hasMore).toBe(true);
    expect(res.nextOffset).toBe(1);
  });
});

describe('attachEventImages fuzzy match (real implementation)', () => {
  let catalogDb: FakeDb;
  let existsSpy: jest.SpyInstance;

  beforeEach(() => {
    catalogDb = mkFakeDb();
    mockOpenSqlite.mockReturnValue(catalogDb);
    mockLocalImage.mockImplementation(
      (id) => `file:///catalog_images/${id}.jpg`
    );
    // The catalog-file gate stats pokequant_catalog.db via the File mock.
    existsSpy = jest
      .spyOn(File.prototype, 'exists', 'get')
      .mockReturnValue(true);
  });

  afterEach(() => {
    existsSpy.mockRestore();
  });

  test('exact name + number scores exactly 150 and binds the image', async () => {
    catalogDb.getAllSync.mockResolvedValue([
      {
        product_id: 7,
        card_name: 'Pikachu',
        set_name: 'Unrelated',
        card_number: '025',
      },
    ]);
    const item = mkEventItem({ name: 'Pikachu', number: '025', set: '' });

    await attachEventImages([item]);

    // Names hit the SQL pre-filter normalized.
    expect(catalogDb.getAllSync).toHaveBeenCalledWith(
      expect.stringContaining('FROM cards'),
      'pikachu'
    );
    expect(mockOpenSqlite).toHaveBeenCalledWith('pokequant_catalog.db');
    expect(mockLocalImage).toHaveBeenCalledWith(7);
    expect(item.imageUrl).toBe('file:///catalog_images/7.jpg');
  });

  test('name + a loose set substring (130) stays below the threshold', async () => {
    catalogDb.getAllSync.mockResolvedValue([
      {
        product_id: 9,
        card_name: 'Pikachu',
        set_name: 'Journey Together',
        card_number: '999',
      },
    ]);
    const item = mkEventItem({
      name: 'Pikachu',
      number: '025',
      set: 'Journey',
    });

    await attachEventImages([item]);

    expect(mockLocalImage).not.toHaveBeenCalled();
    expect(item.imageUrl).toBeUndefined();
  });

  test('a different card name caps below 150 even with number + set', async () => {
    catalogDb.getAllSync.mockResolvedValue([
      {
        product_id: 11,
        card_name: 'Pikachu VMAX',
        set_name: 'SV151',
        card_number: '025',
      },
    ]);
    const item = mkEventItem({ name: 'Pikachu', number: '025', set: 'SV151' });

    await attachEventImages([item]);

    expect(mockLocalImage).not.toHaveBeenCalled();
    expect(item.imageUrl).toBeUndefined();
  });

  test('the highest-scoring candidate wins when rows compete', async () => {
    catalogDb.getAllSync.mockResolvedValue([
      {
        product_id: 9,
        card_name: 'Pikachu',
        set_name: 'Journey Together',
        card_number: '999',
      },
      {
        product_id: 7,
        card_name: 'Pikachu',
        set_name: 'SV151',
        card_number: '025',
      },
    ]);
    const item = mkEventItem({ name: 'Pikachu', number: '025', set: 'SV151' });

    await attachEventImages([item]);

    expect(mockLocalImage).toHaveBeenCalledWith(7);
    expect(item.imageUrl).toBe('file:///catalog_images/7.jpg');
  });

  test('resolved matches are cached — repeat attaches skip the catalog query', async () => {
    catalogDb.getAllSync.mockResolvedValue([
      {
        product_id: 7,
        card_name: 'Pikachu',
        set_name: 'SV151',
        card_number: '025',
      },
    ]);
    const first = mkEventItem({ id: 'a' });
    const second = mkEventItem({ id: 'b' });

    await attachEventImages([first]);
    await attachEventImages([second]);

    expect(catalogDb.getAllSync).toHaveBeenCalledTimes(1);
    // The cache stores product_ids — each attach re-resolves the URI so
    // images extracted after the first pass still bind.
    expect(mockLocalImage).toHaveBeenCalledTimes(2);
    expect(second.imageUrl).toBe('file:///catalog_images/7.jpg');
  });

  test('a sub-threshold verdict is cached too — no re-query, no re-resolve', async () => {
    catalogDb.getAllSync.mockResolvedValue([
      {
        product_id: 9,
        card_name: 'Pikachu',
        set_name: 'Journey Together',
        card_number: '999',
      },
    ]);
    const weak = { name: 'Pikachu', number: '025', set: 'Journey' };
    const first = mkEventItem({ id: 'a', ...weak });
    const second = mkEventItem({ id: 'b', ...weak });

    await attachEventImages([first]);
    await attachEventImages([second]);

    expect(catalogDb.getAllSync).toHaveBeenCalledTimes(1);
    expect(mockLocalImage).not.toHaveBeenCalled();
    expect(second.imageUrl).toBeUndefined();
  });

  test('items that already carry an image never reach the catalog', async () => {
    const item = mkEventItem({ imageUrl: 'file:///already.jpg' });

    await attachEventImages([item]);

    expect(catalogDb.getAllSync).not.toHaveBeenCalled();
    expect(mockOpenSqlite).not.toHaveBeenCalled();
  });

  test('a missing pokequant_catalog.db is an early no-op', async () => {
    existsSpy.mockReturnValue(false);
    const item = mkEventItem();

    await attachEventImages([item]);

    expect(mockOpenSqlite).not.toHaveBeenCalled();
    expect(item.imageUrl).toBeUndefined();
  });

  test('catalog lookup failures warn instead of throwing', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    catalogDb.getAllSync.mockRejectedValue(new Error('disk i/o error'));
    const item = mkEventItem();

    await expect(attachEventImages([item])).resolves.toBeUndefined();
    expect(item.imageUrl).toBeUndefined();
    warn.mockRestore();
  });

  test('the whole attach path never touches the image-pack download', async () => {
    catalogDb.getAllSync.mockResolvedValue([
      {
        product_id: 7,
        card_name: 'Pikachu',
        set_name: 'SV151',
        card_number: '025',
      },
    ]);
    await attachEventImages([mkEventItem()]);

    expect(ensureCatalogImagesDownloaded).not.toHaveBeenCalled();
    expect(ensureJpImagesDownloaded).not.toHaveBeenCalled();
    expect(warmCatalogImageIndex).not.toHaveBeenCalled();
  });
});
