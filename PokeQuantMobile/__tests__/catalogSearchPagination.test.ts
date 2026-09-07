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
  const db = { getAllAsync } as unknown as SQLiteDatabase;
  return { db, getAllAsync };
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
    const { db, getAllAsync } = createMockDb(makeRows(50));
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
    // Non-price sort: fetchLimit = limit * 4 = 200; exactly 200 rows means the
    // DB is exhausted despite filling the buffer.
    const { db } = createMockDb(makeRows(200));
    setCatalogDatabase(db);

    const result = await searchCatalogCards(
      db,
      { ...baseFilters, sortBy: 'Newest' },
      50,
      0
    );

    expect(result.hasMore).toBe(false);
  });

  it('short-circuits the sealed-only price sort without querying the DB', async () => {
    const { db, getAllAsync } = createMockDb(makeRows(0));
    setCatalogDatabase(db);

    const result = await searchCatalogCards(
      db,
      { ...baseFilters, productType: 'Sealed Only' },
      50,
      0
    );

    expect(getAllAsync).not.toHaveBeenCalled();
    expect(result).toEqual({ cards: [], hasMore: false, nextOffset: 0 });
  });
});
