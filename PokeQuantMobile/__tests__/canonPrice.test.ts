import type { SQLiteDatabase } from 'expo-sqlite';
import {
  searchCatalogCards,
  setCatalogDatabase,
  type CatalogFilters,
  type CatalogSortBy,
} from '../src/db/catalogDb';

// Real-engine equivalence: the canon_price materialization and the page
// queries run against a real in-memory SQLite (node:sqlite) through an
// expo-sqlite-shaped bridge, so the equivalence assertions compare actual
// engine output — the old correlated expression is kept below as a frozen
// oracle, independent of production code.

// node:sqlite isn't in the @types/node version pinned for RN — the runtime
// is Node ≥22.5, so load it untyped (same pattern as liveCatalog.test.ts).
/* eslint-disable @typescript-eslint/no-require-imports */
const { DatabaseSync } = require('node:sqlite');
/* eslint-enable @typescript-eslint/no-require-imports */

jest.mock('drizzle-orm/expo-sqlite', () => ({
  drizzle: jest.fn(() => ({})),
}));

type PriceRow = [subType: string | null, date: string, marketPrice: number | null];

// product_id -> price_history rows. Every product also gets a cards row.
const FIXTURES: Record<number, PriceRow[]> = {
  // normal wins over newer holofoil/reverse
  101: [
    ['Normal', '2026-01-01', 3],
    ['Normal', '2026-01-10', 4],
    ['Holofoil', '2026-02-01', 9],
    ['Reverse Holofoil', '2026-03-01', 2],
  ],
  // holofoil when no normal
  102: [
    ['Holofoil', '2026-01-05', 6],
    ['Holofoil', '2026-01-09', 7],
    ['Reverse Holofoil', '2026-02-01', 1],
  ],
  // lowest positive other; 0/-1 lose
  103: [
    ['Reverse Holofoil', '2026-01-01', 5],
    ['1st Edition', '2026-01-02', 12],
    ['Unlimited', '2026-01-03', 0],
    ['Unlimited Holofoil', '2026-01-04', -1],
  ],
  // no positive: price asc before date desc — oracle-defined, reproduce not "fix"
  104: [
    ['Reverse Holofoil', '2026-01-01', -2],
    ['Unlimited', '2026-01-05', 0],
  ],
  // alias collapse: one '1st edition' bucket, max date 01-03; without collapse 20 would win
  105: [
    ['1st Ed', '2026-01-01', 20],
    ['First Edition', '2026-01-03', 30],
    ['1st Edition', '2026-01-02', 25],
    ['Reverse Holofoil', '2026-01-09', 40],
  ],
  // 'holo' -> holofoil bucket, newer than 'Holofoil'
  106: [
    ['Holo', '2026-01-05', 8],
    ['Holofoil', '2026-01-02', 11],
    ['Reverse Holofoil', '2026-01-07', 1],
  ],
  // 'rev holo' collapses into reverse holofoil (latest 9); lowest positive of {9,3}
  107: [
    ['Rev Holo', '2026-01-01', 2],
    ['Reverse Holofoil', '2026-01-06', 9],
    ['Unlimited', '2026-01-01', 3],
  ],
  // regular/uncommon -> normal bucket
  108: [
    ['Regular', '2026-01-01', 1.5],
    ['Uncommon', '2026-01-03', 1.75],
    ['Holofoil', '2026-01-09', 10],
  ],
  // punctuation normalization: '-' -> space; without it 5 would win
  109: [
    ['Reverse-Holo', '2026-01-04', 7],
    ['Reverse Holofoil', '2026-01-01', 5],
    ['Unlimited', '2026-01-01', 8],
  ],
  // no price rows -> COALESCE 0, no canon_price row
  110: [],
  // normal wins with NULL price -> COALESCE 0; canon_price row present with NULL price
  111: [
    ['Normal', '2026-01-01', null],
    ['Holofoil', '2026-01-01', 5],
  ],
  // NULL sub_type: the holofoil row wins
  112: [
    [null, '2026-01-09', 99],
    ['Holofoil', '2026-01-01', 2],
  ],
  // two raw sub_types in the normal bucket; bucket max date wins
  113: [
    ['Normal', '2026-01-01', 5],
    ['Regular', '2026-01-05', 6],
  ],
  // only NULL sub_types: dropped by the raw-subtype join in both forms -> 0, no canon_price row
  114: [
    [null, '2026-01-01', 50],
    [null, '2026-01-03', 60],
  ],
};

const EXPECTED_PRICE: Record<number, number> = {
  101: 4,
  102: 7,
  103: 5,
  104: -2,
  105: 30,
  106: 8,
  107: 3,
  108: 1.75,
  109: 7,
  110: 0,
  111: 0,
  112: 2,
  113: 6,
  114: 0,
};

const EXPECTED_PAIRS: [number, number][] = Object.entries(EXPECTED_PRICE)
  .map(([pid, price]): [number, number] => [Number(pid), price])
  .sort((a, b) => a[0] - b[0]);

const HIGH_TO_LOW = [105, 106, 102, 109, 113, 103, 101, 107, 112, 108, 110, 111, 114, 104];
const LOW_TO_HIGH = [104, 108, 112, 107, 101, 103, 113, 102, 109, 106, 105, 110, 111, 114];
const HIGH_TO_LOW_MAX5 = [103, 101, 107, 112, 108, 110, 111, 114, 104];

// Frozen oracle — the old per-row correlated live-price expression, kept
// verbatim as the equivalence reference for the materialization.
const oracleNorm = (column: string) =>
  `TRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(${column}), '-', ' '), '.', ' '), '''', ' '), '/', ' '), '  ', ' '), '  ', ' '))`;
const oracleCanon = (column: string) =>
  `TRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(' ' || ${oracleNorm(column)} || ' ', ' 1st ed ', ' 1st edition '), ' first edition ', ' 1st edition '), ' holo ', ' holofoil '), ' rev ', ' reverse '), ' regular ', ' normal '), ' common ', ' normal '), ' uncommon ', ' normal '))`;
function oracleExpr(productIdColumn: string = 'c.product_id'): string {
  const isNormal = `${oracleCanon('p.sub_type')} = 'normal'`;
  const isHolo = `${oracleCanon('p.sub_type')} = 'holofoil'`;
  const isOther = `NOT (${isNormal} OR ${isHolo})`;
  const price = 'CAST(p.market_price AS REAL)';
  return `
    COALESCE((
      SELECT ${price}
      FROM (
        SELECT ${oracleCanon('sub_type')} AS canon, MAX(date) AS max_date
        FROM price_history
        WHERE product_id = ${productIdColumn}
        GROUP BY canon
      ) grouped
      JOIN price_history p
        ON p.product_id = ${productIdColumn}
        AND ${oracleCanon('p.sub_type')} = grouped.canon
        AND p.date = grouped.max_date
      ORDER BY
        CASE WHEN ${isNormal} THEN 0 WHEN ${isHolo} THEN 1 ELSE 2 END,
        CASE WHEN ${isOther} AND ${price} > 0 THEN 0 ELSE 1 END,
        CASE WHEN ${isOther} THEN ${price} END,
        p.date DESC
      LIMIT 1
    ), 0)
  `
    .replace(/\s+/g, ' ')
    .trim();
}
const ORACLE = oracleExpr();

// An expo-sqlite-shaped handle that executes against a real in-memory
// DatabaseSync, so production SQL (the execAsync build script and the
// getAllAsync queries, including the hydration CTEs) runs for real.
const openNodes: { close(): void }[] = [];
function openFixtureDb() {
  const node = new DatabaseSync(':memory:');
  openNodes.push(node);
  node.exec(`
    CREATE TABLE cards (product_id INTEGER PRIMARY KEY, card_name TEXT, card_number TEXT, set_name TEXT, rarity TEXT);
    CREATE TABLE price_history (product_id INTEGER, sub_type TEXT, date TEXT, market_price REAL, PRIMARY KEY (product_id, sub_type, date));
    CREATE INDEX idx_price_history_lookup ON price_history(product_id, date DESC);
  `);
  const insCard = node.prepare('INSERT INTO cards VALUES (?, ?, ?, ?, ?)');
  const insPh = node.prepare('INSERT INTO price_history VALUES (?, ?, ?, ?)');
  for (const [pid, rows] of Object.entries(FIXTURES)) {
    insCard.run(Number(pid), `Card ${pid}`, `${pid}`, 'Base Set', 'Common');
    for (const [sub, date, price] of rows) insPh.run(Number(pid), sub, date, price);
  }
  const execAsync = jest.fn(async (sql: string) => {
    node.exec(sql);
  });
  const getAllAsync = jest.fn(async (sql: string, ...args: unknown[]) =>
    node.prepare(sql).all(...args),
  );
  const db = { execAsync, getAllAsync } as unknown as SQLiteDatabase;
  return { node, db, execAsync, getAllAsync };
}

const filters = (sortBy: CatalogSortBy, over: Partial<CatalogFilters> = {}): CatalogFilters => ({
  query: '',
  rarity: 'All',
  sortBy,
  ...over,
});

type PidPrice = { pid: number; price: number | null };
type PidOnly = { p: number };
type CanonRow = { product_id: number; price: number | null };
type CountRow = { c: number };

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  while (openNodes.length) openNodes.pop()!.close();
});

describe('canon_price materialization', () => {
  it('materialized price equals the correlated oracle for every product', async () => {
    const { node, db } = openFixtureDb();
    setCatalogDatabase(db);

    // One price sort builds temp.canon_price through the bridge.
    await searchCatalogCards(db, filters('Price: High to Low'), 50, 0);

    const oracleRows = node
      .prepare(
        `SELECT c.product_id AS pid, (${ORACLE}) AS price FROM cards c ORDER BY c.product_id`,
      )
      .all() as PidPrice[];
    const materialized = node
      .prepare(
        `SELECT c.product_id AS pid, COALESCE(cp.price, 0) AS price FROM cards c LEFT JOIN temp.canon_price cp ON cp.product_id = c.product_id ORDER BY c.product_id`,
      )
      .all() as PidPrice[];

    const pairs = (rows: PidPrice[]) => rows.map((r) => [r.pid, r.price]);
    expect(pairs(materialized)).toEqual(pairs(oracleRows));
    expect(pairs(materialized)).toEqual(EXPECTED_PAIRS);

    // Raw table: no row for the price-less product or the NULL-only-subtype
    // product (the raw-subtype join drops NULL = NULL in both forms); the
    // NULL-price winner keeps a real row holding NULL (still COALESCE'd to
    // 0 at read time).
    const raw = node.prepare('SELECT product_id, price FROM temp.canon_price').all() as CanonRow[];
    const byPid = new Map(raw.map((r) => [r.product_id, r.price]));
    expect(byPid.has(110)).toBe(false);
    expect(byPid.has(114)).toBe(false);
    expect(byPid.get(111)).toBeNull();
  });

  it('High to Low page order and liveMarket match the oracle', async () => {
    const { node, db } = openFixtureDb();
    setCatalogDatabase(db);

    const result = await searchCatalogCards(db, filters('Price: High to Low'), 50, 0);

    expect(result.cards.map((c) => c.productId)).toEqual(HIGH_TO_LOW);
    const oracleOrder = node
      .prepare(`SELECT c.product_id AS p FROM cards c ORDER BY (${ORACLE}) DESC, c.product_id ASC`)
      .all() as PidOnly[];
    expect(result.cards.map((c) => c.productId)).toEqual(oracleOrder.map((r) => r.p));
    for (const card of result.cards) {
      expect(card.liveMarket).toBe(EXPECTED_PRICE[card.productId]);
    }
  });

  it('Low to High sorts zero-priced cards last', async () => {
    const { node, db } = openFixtureDb();
    setCatalogDatabase(db);

    const result = await searchCatalogCards(db, filters('Price: Low to High'), 50, 0);

    expect(result.cards.map((c) => c.productId)).toEqual(LOW_TO_HIGH);
    const oracleOrder = node
      .prepare(
        `SELECT c.product_id AS p FROM cards c ORDER BY ((${ORACLE}) = 0) ASC, (${ORACLE}) ASC, c.product_id ASC`,
      )
      .all() as PidOnly[];
    expect(result.cards.map((c) => c.productId)).toEqual(oracleOrder.map((r) => r.p));
  });

  it('maxPrice filters on the materialized price', async () => {
    const { db } = openFixtureDb();
    setCatalogDatabase(db);

    const result = await searchCatalogCards(
      db,
      filters('Price: High to Low', { maxPrice: 5 }),
      50,
      0,
    );

    expect(result.cards.map((c) => c.productId)).toEqual(HIGH_TO_LOW_MAX5);
  });

  it('the TEMP table never touches the main schema', async () => {
    const { node, db } = openFixtureDb();
    setCatalogDatabase(db);

    await searchCatalogCards(db, filters('Price: High to Low'), 50, 0);

    const main = node
      .prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name = 'canon_price'")
      .get() as CountRow;
    const temp = node
      .prepare("SELECT COUNT(*) AS c FROM sqlite_temp_master WHERE name = 'canon_price'")
      .get() as CountRow;
    expect(main.c).toBe(0);
    expect(temp.c).toBe(1);
  });

  it('builds once per handle', async () => {
    const { db, execAsync } = openFixtureDb();
    setCatalogDatabase(db);

    await searchCatalogCards(db, filters('Price: High to Low'), 50, 0);
    await searchCatalogCards(db, filters('Price: Low to High'), 50, 0);
    await searchCatalogCards(db, filters('Newest'), 50, 0);
    expect(execAsync).toHaveBeenCalledTimes(1);

    const fresh = openFixtureDb();
    setCatalogDatabase(fresh.db);
    await searchCatalogCards(fresh.db, filters('Newest'), 50, 0);
    expect(fresh.execAsync).not.toHaveBeenCalled();
  });

  it('concurrent price sorts share one build', async () => {
    const { db, execAsync } = openFixtureDb();
    setCatalogDatabase(db);

    const [first, second] = await Promise.all([
      searchCatalogCards(db, filters('Price: High to Low'), 50, 0),
      searchCatalogCards(db, filters('Price: High to Low'), 50, 0),
    ]);

    expect(execAsync).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('a handle swap rebuilds on the new handle, not the old', async () => {
    const a = openFixtureDb();
    setCatalogDatabase(a.db);
    await searchCatalogCards(a.db, filters('Price: High to Low'), 50, 0);
    expect(a.execAsync).toHaveBeenCalledTimes(1);

    const b = openFixtureDb();
    setCatalogDatabase(b.db);
    await searchCatalogCards(b.db, filters('Price: High to Low'), 50, 0);

    expect(b.execAsync).toHaveBeenCalledTimes(1);
    expect(a.execAsync).toHaveBeenCalledTimes(1);
  });

  it('a failed build is retried on the next price sort', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const execAsync = jest.fn(() => Promise.resolve());
    execAsync.mockRejectedValueOnce('boom');
    const getAllAsync = jest.fn(() => Promise.resolve([]));
    const db = { getAllAsync, execAsync } as unknown as SQLiteDatabase;
    setCatalogDatabase(db);

    const first = await searchCatalogCards(db, filters('Price: High to Low'), 50, 0);
    expect(first).toEqual({ cards: [], hasMore: false, nextOffset: 0 });

    const second = await searchCatalogCards(db, filters('Price: High to Low'), 50, 0);
    expect(execAsync).toHaveBeenCalledTimes(2);
    expect(getAllAsync).toHaveBeenCalled();
    expect(second).toEqual({ cards: [], hasMore: false, nextOffset: 0 });

    consoleSpy.mockRestore();
  });

  it('non-price sorts emit no join and no build', async () => {
    const { db, execAsync, getAllAsync } = openFixtureDb();
    setCatalogDatabase(db);

    await searchCatalogCards(db, filters('Newest'), 50, 0);

    const sql = String(getAllAsync.mock.calls[0][0]);
    expect(sql).not.toContain('canon_price');
    expect(sql).not.toContain('live_market');
    expect(execAsync).not.toHaveBeenCalled();
  });
});
