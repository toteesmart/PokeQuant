import type { SQLiteDatabase } from 'expo-sqlite';
import {
  getProductMarketData,
  getProductMarketPrices,
  setCatalogDatabase,
} from '../src/db/catalogDb';
import { lookupMarketData } from '../src/store/inventory/pricing';
import { CATALOG_IMAGE_BASE } from '../src/constants/api';

jest.mock('drizzle-orm/expo-sqlite', () => ({
  drizzle: jest.fn(() => ({})),
}));

// Item-17 pins — getProductMarketPrices is the latest-only twin the
// inventory hydration paths resolve through: identical
// marketPrice/matchedSubType/date output to getProductMarketData, but no
// per-pair price_history scan for windows its callers never read.

type HistRow = {
  product_id: number;
  sub_type: string;
  date: string;
  market_price: number;
};

// Emulates the two price_history query shapes catalogPrices issues: the
// grouped latest-per-subtype CTE (getLatestSubTypePrices) and the OR'd
// per-pair full-history scan (getVariantHistories — signature
// `(product_id = ? AND sub_type = ?)` args + `ORDER BY ... date DESC`).
function createCatalogDb(history: HistRow[]) {
  const getAllAsync = jest.fn((sql: string, ...args: (string | number)[]) => {
    if (/WITH\s+latest\s+AS/i.test(sql)) {
      const ids = new Set(args.map((a) => Number(a)));
      const latest = new Map<string, HistRow>();
      for (const row of history) {
        if (!ids.has(row.product_id)) continue;
        const key = `${row.product_id}|${row.sub_type}`;
        const cur = latest.get(key);
        if (!cur || row.date > cur.date) latest.set(key, row);
      }
      return Promise.resolve([...latest.values()]);
    }
    if (/sub_type = \?/i.test(sql)) {
      const rows = history.filter((row) => {
        for (let i = 0; i + 1 < args.length; i += 2) {
          if (
            row.product_id === Number(args[i]) &&
            row.sub_type === args[i + 1]
          ) {
            return true;
          }
        }
        return false;
      });
      rows.sort(
        (a, b) =>
          a.product_id - b.product_id ||
          a.sub_type.localeCompare(b.sub_type) ||
          b.date.localeCompare(a.date)
      );
      return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  });
  const db = { getAllAsync } as unknown as SQLiteDatabase;
  return { db, getAllAsync };
}

// One product per step of the resolveVariantPrice fallback chain, with
// extra dated rows so the full path's windows provably diverge from the
// latest row (the fixture proves getVariantHistories ran, not just CTE).
const HISTORY: HistRow[] = [
  // 1 — requested finish hits exactly; the older Holofoil row feeds the
  // full path's price1d (22) while the latest stays 25.
  { product_id: 1, sub_type: 'Holofoil', date: '2026-10-10', market_price: 25 },
  { product_id: 1, sub_type: 'Holofoil', date: '2026-10-09', market_price: 22 },
  { product_id: 1, sub_type: 'Normal', date: '2026-10-10', market_price: 10 },
  { product_id: 1, sub_type: 'Normal', date: '2026-10-03', market_price: 8 },
  // 2 — requested finish absent → Normal wins over Holofoil.
  { product_id: 2, sub_type: 'Normal', date: '2026-10-08', market_price: 4 },
  { product_id: 2, sub_type: 'Normal', date: '2026-09-15', market_price: 5 },
  { product_id: 2, sub_type: 'Holofoil', date: '2026-10-08', market_price: 9 },
  // 3 — requested + Normal both absent → holofoil step beats the cheaper
  // reverse row lowest-positive would have picked.
  { product_id: 3, sub_type: 'Holofoil', date: '2026-10-07', market_price: 12 },
  { product_id: 3, sub_type: 'Reverse Holofoil', date: '2026-10-06', market_price: 6 },
  // 4 — neither canonical bucket → lowest positive across the rest.
  { product_id: 4, sub_type: 'Promo', date: '2026-10-05', market_price: 5 },
  { product_id: 4, sub_type: 'Special Edition', date: '2026-10-04', market_price: 3 },
  // 5 — nothing positive → first-row fallback resolves to 0 and the
  // marketPrice > 0 gate drops the product from both maps.
  { product_id: 5, sub_type: 'Promo', date: '2026-10-01', market_price: 0 },
  // 6 — requested '1st Edition Holofoil' lands on the plain '1st Edition'
  // base bucket before lowest-positive would reach Reverse Holofoil.
  { product_id: 6, sub_type: '1st Edition', date: '2026-10-08', market_price: 40 },
  { product_id: 6, sub_type: '1st Edition', date: '2026-10-01', market_price: 38 },
  { product_id: 6, sub_type: 'Reverse Holofoil', date: '2026-10-07', market_price: 15 },
  // 7 — no rows at all: absent from both maps.
];

const IDS = [1, 2, 3, 4, 5, 6, 7];
const VARIANTS: Record<number, string> = {
  1: 'Holofoil',
  2: 'Reverse Holofoil',
  3: '1st Edition',
  4: 'Normal',
  5: 'Normal',
  6: '1st Edition Holofoil',
  // 7 omitted — the variantMap ?? 'Normal' default.
};

const EXPECTED_LITE = {
  1: { marketPrice: 25, matchedSubType: 'Holofoil', date: '2026-10-10' },
  2: { marketPrice: 4, matchedSubType: 'Normal', date: '2026-10-08' },
  3: { marketPrice: 12, matchedSubType: 'Holofoil', date: '2026-10-07' },
  4: { marketPrice: 3, matchedSubType: 'Special Edition', date: '2026-10-04' },
  6: { marketPrice: 40, matchedSubType: '1st Edition', date: '2026-10-08' },
};

describe('getProductMarketPrices — latest-only twin', () => {
  test('resolves the fallback chain identically to getProductMarketData', async () => {
    const { db } = createCatalogDb(HISTORY);
    setCatalogDatabase(db);

    const lite = await getProductMarketPrices(db, IDS, VARIANTS);
    const full = await getProductMarketData(db, IDS, VARIANTS);

    expect(lite).toEqual(EXPECTED_LITE);
    // Same key set — the marketPrice > 0 gate drops 5 and 7 has no rows.
    expect(Object.keys(full).sort()).toEqual(Object.keys(lite).sort());
    for (const [id, row] of Object.entries(lite)) {
      expect(full[Number(id)]).toMatchObject(row);
    }
    // The fixture's dated rows prove the full path ran its window branch —
    // the lite map omits those fields entirely.
    expect(full[1].price1d).toBe(22);
    expect(full[2].price1d).toBe(5);
  });

  test('issues only the grouped latest-rows query — no per-pair history scan', async () => {
    const { db, getAllAsync } = createCatalogDb(HISTORY);
    setCatalogDatabase(db);

    await getProductMarketPrices(db, IDS, VARIANTS);

    // One CTE-scoped read for the whole batch — the OR'd pair scan never
    // runs, so no unbounded `FROM price_history ... date DESC` scan.
    expect(getAllAsync).toHaveBeenCalledTimes(1);
    const [sql, ...args] = getAllAsync.mock.calls[0];
    expect(sql).toMatch(/WITH\s+latest\s+AS/i);
    expect(sql).not.toMatch(/sub_type = \?/i);
    expect(args).toEqual(IDS);
  });

  test('the full path still emits the pair scan — its windows need history', async () => {
    const { db, getAllAsync } = createCatalogDb(HISTORY);
    setCatalogDatabase(db);

    await getProductMarketData(db, IDS, VARIANTS);

    const scans = getAllAsync.mock.calls.filter(([sql]) =>
      /sub_type = \?/i.test(sql)
    );
    expect(scans).toHaveLength(1);
    expect(scans[0][0]).toMatch(/ORDER BY product_id, sub_type, date DESC/i);
  });

  test('empty id set resolves {} without touching the DB', async () => {
    const { db, getAllAsync } = createCatalogDb(HISTORY);
    setCatalogDatabase(db);

    expect(await getProductMarketPrices(db, [])).toEqual({});
    expect(getAllAsync).not.toHaveBeenCalled();
  });
});

describe('lookupMarketData wiring', () => {
  test('hydrates via the lite path — one grouped query, zero pair scans', async () => {
    const { db, getAllAsync } = createCatalogDb(HISTORY);
    setCatalogDatabase(db);

    const { marketMap, imageUrlMap } = await lookupMarketData([1, 5, 7], {
      1: 'Holofoil',
    });

    expect(getAllAsync).toHaveBeenCalledTimes(1);
    expect(getAllAsync.mock.calls[0][0]).toMatch(/WITH\s+latest\s+AS/i);
    expect(marketMap[1]).toEqual(EXPECTED_LITE[1]);
    expect(marketMap[5]).toBeUndefined();
    expect(marketMap[7]).toBeUndefined();
    // Image URLs still resolve per product — CDN fallback under mocks.
    expect(imageUrlMap[1]).toBe(`${CATALOG_IMAGE_BASE}/1_400w.jpg`);
    expect(imageUrlMap[5]).toBe(`${CATALOG_IMAGE_BASE}/5_400w.jpg`);
  });
});
