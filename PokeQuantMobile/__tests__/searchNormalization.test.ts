import type { SQLiteDatabase } from 'expo-sqlite';
import {
  searchCatalogCards,
  setCatalogDatabase,
  type CatalogFilters,
} from '../src/db/catalogDb';
import { searchEventInventory } from '../src/db/eventCatalogDb';

jest.mock('drizzle-orm/expo-sqlite', () => ({
  drizzle: jest.fn(() => ({})),
}));

function createCatalogMockDb() {
  const getAllAsync = jest.fn((sql: string) => Promise.resolve([]));
  return {
    db: { getAllAsync } as unknown as SQLiteDatabase,
    getAllAsync,
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

describe('price sort live-market expression', () => {
  it('groups price_history by the canonical subtype bucket, not raw sub_type', async () => {
    const { db, getAllAsync } = createCatalogMockDb();
    setCatalogDatabase(db);

    await searchCatalogCards(db, priceSortFilters, 50, 0);

    const sql = String(getAllAsync.mock.calls[0][0]);
    // Raw subtypes sharing a canonical bucket ('Reverse Holo' vs
    // 'Reverse Holofoil', '1st Ed' vs 'First Edition') must collapse into one
    // group — grouping by raw sub_type can sort at a different price than
    // resolveVariantPrice() displays.
    expect(sql).toContain('GROUP BY canon');
    expect(sql).not.toContain('GROUP BY sub_type');
    // Word-level aliases mirror normalizeSubType().
    expect(sql).toContain("' 1st ed '");
    expect(sql).toContain("' first edition '");
    expect(sql).toContain("' holo '");
    expect(sql).toContain("' regular '");
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
      'show1'
    );

    const args = getAllSync.mock.calls[0].slice(1);
    // Punctuation stripped and whitespace collapsed, matching
    // normalizeCatalogColumn on the SQL side.
    expect(args).toContain('obrien');
    expect(args).toContain('base set');
  });

  it('strips curly apostrophes from filter values too', async () => {
    const { db, getAllSync } = createEventMockDb();

    await searchEventInventory(
      db,
      '',
      50,
      0,
      { vendorName: 'O’Brien' },
      'name',
      'show1'
    );

    const args = getAllSync.mock.calls[0].slice(1);
    expect(args).toContain('obrien');
  });
});
