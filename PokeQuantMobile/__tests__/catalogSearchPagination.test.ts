import type { SQLiteDatabase } from 'expo-sqlite';
import {
  searchCatalogCards,
  setCatalogDatabase,
  type CatalogFilters,
} from '../src/db/catalogDb';

jest.mock('drizzle-orm/expo-sqlite', () => ({
  drizzle: jest.fn(() => ({})),
}));

type CardRow = {
  product_id: number;
  name: string;
  number: string;
  set_name: string;
  rarity: string;
  live_market?: number;
};

function makeCardRow(productId: number): CardRow {
  return {
    product_id: productId,
    name: `Card ${productId}`,
    number: `${productId}`,
    set_name: 'Base Set',
    rarity: 'Common',
    live_market: productId,
  };
}

function makeRows(count: number): CardRow[] {
  return Array.from({ length: count }, (_, i) => makeCardRow(i + 1));
}

// Returns a mock catalog DB whose main `FROM cards` query resolves to `rows`
// and whose price_history lookups resolve to no rows.
function createMockDb(rows: CardRow[]) {
  const getAllAsync = jest.fn((sql: string) => {
    if (typeof sql === 'string' && /FROM\s+cards\b/i.test(sql)) {
      return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  });
  const execAsync = jest.fn((sql: string) => Promise.resolve());
  const db = { getAllAsync, execAsync } as unknown as SQLiteDatabase;
  return { db, getAllAsync, execAsync };
}

const baseFilters: CatalogFilters = {
  query: 'pikachu',
  rarity: 'All',
  sortBy: 'Price: High to Low',
};

describe('searchCatalogCards pagination', () => {
  it('reports hasMore=false when the result set ends exactly at the fetch boundary', async () => {
    // Price sort: fetchLimit = limit = 50; the query asks for 51 rows and the
    // DB returns exactly 50 — the boundary case that previously returned
    // hasMore=true and triggered a wasted fetch.
    const { db } = createMockDb(makeRows(50));
    setCatalogDatabase(db);

    const result = await searchCatalogCards(db, baseFilters, 50, 0);

    expect(result.cards).toHaveLength(50);
    expect(result.hasMore).toBe(false);
    expect(result.nextOffset).toBe(50);
  });

  it('requests fetchLimit + 1 rows to detect the boundary', async () => {
    const { db, getAllAsync } = createMockDb(makeRows(0));
    setCatalogDatabase(db);

    await searchCatalogCards(db, baseFilters, 50, 0);

    const args = getAllAsync.mock.calls[0];
    expect(args[args.length - 2]).toBe(51); // LIMIT fetchLimit + 1
    expect(args[args.length - 1]).toBe(0); // OFFSET
  });

  it('reports hasMore=true when a lookahead row exists beyond the page', async () => {
    const { db } = createMockDb(makeRows(51));
    setCatalogDatabase(db);

    const result = await searchCatalogCards(db, baseFilters, 50, 0);

    expect(result.cards).toHaveLength(50);
    expect(result.hasMore).toBe(true);
    expect(result.nextOffset).toBe(50);
  });

  it('reports hasMore=false for a partial tail page', async () => {
    const { db } = createMockDb(makeRows(20));
    setCatalogDatabase(db);

    const result = await searchCatalogCards(db, baseFilters, 50, 0);

    expect(result.cards).toHaveLength(20);
    expect(result.hasMore).toBe(false);
  });

  it('applies the lookahead to the non-price-sort over-fetch buffer', async () => {
    // The buffer is active because maxPrice is a JS post-filter on a
    // non-price sort: fetchLimit = limit * 4 = 200; exactly 200 rows means
    // the DB is exhausted despite filling the buffer. Every fixture row's
    // live market resolves to 0 (empty price mock) <= 1000, so none drop.
    const { db } = createMockDb(makeRows(200));
    setCatalogDatabase(db);

    const result = await searchCatalogCards(
      db,
      { ...baseFilters, sortBy: 'Newest', maxPrice: 1000 },
      50,
      0
    );

    expect(result.hasMore).toBe(false);
  });

  it.each(['Price: High to Low', 'Price: Low to High', 'Newest', 'Name A-Z'] as const)(
    'short-circuits the sealed-only %s sort without querying the DB',
    async (sortBy) => {
      // Zero queries at all — hydration also goes through getAllAsync.
      const { db, getAllAsync } = createMockDb(makeRows(0));
      setCatalogDatabase(db);

      const result = await searchCatalogCards(
        db,
        { ...baseFilters, sortBy, productType: 'Sealed Only' },
        50,
        0
      );

      expect(getAllAsync).not.toHaveBeenCalled();
      expect(result).toEqual({ cards: [], hasMore: false, nextOffset: 0 });
    }
  );

  it('short-circuits sealed-only at a nonzero offset without advancing it', async () => {
    const { db, getAllAsync } = createMockDb(makeRows(0));
    setCatalogDatabase(db);

    const result = await searchCatalogCards(
      db,
      { ...baseFilters, sortBy: 'Newest', productType: 'Sealed Only' },
      50,
      120
    );

    expect(getAllAsync).not.toHaveBeenCalled();
    expect(result).toEqual({ cards: [], hasMore: false, nextOffset: 120 });
  });
});

describe('searchCatalogCards fetchLimit discipline', () => {
  // The FROM cards query is the first getAllAsync call; its second-to-last
  // arg is the LIMIT (fetchLimit + 1 lookahead), the last is OFFSET.
  const limitArgOf = (getAllAsync: jest.Mock): number => {
    const args = getAllAsync.mock.calls[0];
    return args[args.length - 2];
  };

  it.each([
    { name: 'Newest', filters: { ...baseFilters, sortBy: 'Newest' } as CatalogFilters, limit: 50, expected: 51 },
    { name: 'Name A-Z', filters: { ...baseFilters, sortBy: 'Name A-Z' } as CatalogFilters, limit: 50, expected: 51 },
    { name: 'Newest + productType All', filters: { ...baseFilters, sortBy: 'Newest', productType: 'All' } as CatalogFilters, limit: 50, expected: 51 },
    { name: 'Newest + Cards Only', filters: { ...baseFilters, sortBy: 'Newest', productType: 'Cards Only' } as CatalogFilters, limit: 50, expected: 51 },
    { name: 'Newest + Holofoil (variant post-filter)', filters: { ...baseFilters, sortBy: 'Newest', productType: 'Holofoil' } as CatalogFilters, limit: 50, expected: 201 },
    { name: 'Newest + maxPrice (JS post-filter)', filters: { ...baseFilters, sortBy: 'Newest', maxPrice: 10 } as CatalogFilters, limit: 50, expected: 201 },
    { name: 'Name A-Z + maxPrice', filters: { ...baseFilters, sortBy: 'Name A-Z', maxPrice: 10 } as CatalogFilters, limit: 50, expected: 201 },
    { name: 'Price High + maxPrice (SQL-side, no buffer)', filters: { ...baseFilters, sortBy: 'Price: High to Low', maxPrice: 10 } as CatalogFilters, limit: 50, expected: 51 },
    { name: 'Price Low + Holofoil (price sorts never buffer)', filters: { ...baseFilters, sortBy: 'Price: Low to High', productType: 'Holofoil' } as CatalogFilters, limit: 50, expected: 51 },
    { name: 'Newest + maxPrice, limit 10 (200 floor)', filters: { ...baseFilters, sortBy: 'Newest', maxPrice: 10 } as CatalogFilters, limit: 10, expected: 201 },
    { name: 'Newest, limit 10', filters: { ...baseFilters, sortBy: 'Newest' } as CatalogFilters, limit: 10, expected: 11 },
  ])('$name -> LIMIT $expected', async ({ filters, limit, expected }) => {
    const { db, getAllAsync } = createMockDb(makeRows(0));
    setCatalogDatabase(db);

    await searchCatalogCards(db, filters, limit, 0);

    expect(limitArgOf(getAllAsync)).toBe(expected);
  });

  it('hydrates only the fetched page on the non-buffer path', async () => {
    const { db, getAllAsync } = createMockDb(makeRows(50));
    setCatalogDatabase(db);

    await searchCatalogCards(db, { ...baseFilters, sortBy: 'Newest' }, 50, 0);

    const fromCardsCalls = getAllAsync.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && /FROM\s+cards\b/i.test(sql)
    );
    expect(fromCardsCalls).toHaveLength(1);
    expect(getAllAsync.mock.calls.length).toBeGreaterThan(1);
    // Hydration queries bind one `?` per product id — never more than a page.
    for (const call of getAllAsync.mock.calls.slice(1)) {
      expect(call.slice(1).length).toBeLessThanOrEqual(50);
    }
  });
});

describe('searchCatalogCards offset advance', () => {
  const newestFilters: CatalogFilters = { ...baseFilters, sortBy: 'Newest' };

  it.each([
    { rows: 51, offset: 0, cards: 50, hasMore: true, nextOffset: 50 },
    { rows: 51, offset: 100, cards: 50, hasMore: true, nextOffset: 150 },
    { rows: 50, offset: 100, cards: 50, hasMore: false, nextOffset: 150 },
    { rows: 20, offset: 100, cards: 20, hasMore: false, nextOffset: 120 },
  ])(
    'non-buffer Newest: $rows rows @ $offset -> cards=$cards hasMore=$hasMore nextOffset=$nextOffset',
    async ({ rows, offset, cards, hasMore, nextOffset }) => {
      const { db } = createMockDb(makeRows(rows));
      setCatalogDatabase(db);

      const result = await searchCatalogCards(db, newestFilters, 50, offset);

      expect(result.cards).toHaveLength(cards);
      expect(result.hasMore).toBe(hasMore);
      expect(result.nextOffset).toBe(nextOffset);
    }
  );

  it('buffer path advances by pageLimit when the buffer still fills a page', async () => {
    // maxPrice 1000 keeps every row (live market 0), so the 4x buffer is
    // active but nothing drops: the lookahead row sets hasMore and the page
    // advances by pageLimit, not the buffer size.
    const { db } = createMockDb(makeRows(201));
    setCatalogDatabase(db);

    const result = await searchCatalogCards(db, { ...newestFilters, maxPrice: 1000 }, 50, 0);

    expect(result.cards).toHaveLength(50);
    expect(result.hasMore).toBe(true);
    expect(result.nextOffset).toBe(50);
  });

  it('buffer path advances past the whole buffer when post-filters empty it', async () => {
    // maxPrice -1 drops every card (live market 0 > -1 fails the <= filter),
    // so the page is empty even though the lookahead row says the DB has
    // more: the next page must continue past all 200 fetched rows.
    const { db } = createMockDb(makeRows(201));
    setCatalogDatabase(db);

    const result = await searchCatalogCards(db, { ...newestFilters, maxPrice: -1 }, 50, 0);

    expect(result.cards).toHaveLength(0);
    expect(result.hasMore).toBe(true);
    expect(result.nextOffset).toBe(200);
  });

  it('buffer path reports hasMore=false when the buffer exhausts the DB', async () => {
    const { db } = createMockDb(makeRows(200));
    setCatalogDatabase(db);

    const result = await searchCatalogCards(db, { ...newestFilters, maxPrice: -1 }, 50, 0);

    expect(result.cards).toHaveLength(0);
    expect(result.hasMore).toBe(false);
    expect(result.nextOffset).toBe(200);
  });
});
