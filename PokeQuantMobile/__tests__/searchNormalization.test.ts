import type { SQLiteDatabase } from 'expo-sqlite';
import { searchCatalogCards, setCatalogDatabase, type CatalogFilters } from '../src/db/catalogDb';
import { searchEventInventory } from '../src/db/eventCatalogDb';

jest.mock('drizzle-orm/expo-sqlite', () => ({
  drizzle: jest.fn(() => ({})),
}));

function createCatalogMockDb() {
  const getAllAsync = jest.fn((sql: string) => Promise.resolve([]));
  const execAsync = jest.fn((sql: string) => Promise.resolve());
  return {
    db: { getAllAsync, execAsync } as unknown as SQLiteDatabase,
    getAllAsync,
    execAsync,
  };
}

function createEventMockDb() {
  const getAllSync = jest.fn((sql: string, ...rest: unknown[]) => []);
  return {
    db: { getAllSync } as unknown as SQLiteDatabase,
    getAllSync,
  };
}

const priceSortFilters: CatalogFilters = {
  query: '',
  rarity: 'All',
  sortBy: 'Price: High to Low',
};

describe('price sort canonical-price materialization', () => {
  it('the price-sort query joins temp.canon_price instead of scanning price_history inline', async () => {
    const { db, getAllAsync } = createCatalogMockDb();
    setCatalogDatabase(db);

    await searchCatalogCards(db, priceSortFilters, 50, 0);

    const sql = String(getAllAsync.mock.calls[0][0]);
    expect(sql).toContain('LEFT JOIN temp.canon_price cp ON cp.product_id = c.product_id');
    expect(sql).not.toContain('price_history');
    expect(sql).toContain('COALESCE(cp.price, 0) AS live_market');
  });

  it('the materialization buckets by canonical subtype with the normalizeSubType aliases', async () => {
    const { db, execAsync } = createCatalogMockDb();
    setCatalogDatabase(db);

    await searchCatalogCards(db, priceSortFilters, 50, 0);

    const sql = String(execAsync.mock.calls[0][0]);
    // Raw subtypes sharing a canonical bucket ('Reverse Holo' vs
    // 'Reverse Holofoil', '1st Ed' vs 'First Edition') must collapse into one
    // group — grouping by raw sub_type can sort at a different price than
    // resolveVariantPrice() displays.
    expect(sql).toContain('PARTITION BY product_id, canon');
    expect(sql).toContain('GROUP BY product_id, sub_type');
    // Word-level aliases mirror normalizeSubType().
    expect(sql).toContain("' 1st ed '");
    expect(sql).toContain("' first edition '");
    expect(sql).toContain("' holo '");
    expect(sql).toContain("' regular '");
    expect(sql).toContain('CREATE TEMP TABLE canon_price');
    expect(sql).toContain('INSERT INTO temp.canon_price');
    // The build writes only the TEMP table — the catalog file is read-only.
    expect(sql).not.toMatch(/\b(UPDATE|DELETE|ALTER)\b/);
    expect(sql.match(/INSERT INTO/g)).toHaveLength(1);
    expect(sql.match(/CREATE /g)).toHaveLength(1);
  });
});

describe('event search filters', () => {
  it('normalizes vendor/set filter values the same way as the SQL column', async () => {
    const { db, getAllSync } = createEventMockDb();

    await searchEventInventory(
      db,
      '',
      50,
      0,
      { vendorName: "O'Brien ", setName: 'Base  Set.' },
      'name',
      'show1',
    );

    const args = getAllSync.mock.calls[0].slice(1);
    // Punctuation stripped and whitespace collapsed, matching
    // normalizeCatalogColumn on the SQL side.
    expect(args).toContain('obrien');
    expect(args).toContain('base set');
  });

  it('strips curly apostrophes from filter values too', async () => {
    const { db, getAllSync } = createEventMockDb();

    await searchEventInventory(db, '', 50, 0, { vendorName: 'O’Brien' }, 'name', 'show1');

    const args = getAllSync.mock.calls[0].slice(1);
    expect(args).toContain('obrien');
  });
});
