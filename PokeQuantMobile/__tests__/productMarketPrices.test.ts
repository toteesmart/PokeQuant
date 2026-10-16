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
// grouped latest-per-subtype CTE (getLatestSubTypePrices) and the bounded
// per-pair history read (getVariantHistories — a bounds VALUES CTE of
// (product_id, sub_type, live_date, cutoff) 4-tuples feeding a windowed
// scan UNION'd with the newest row below each cutoff, all re-sorted by
// `ORDER BY product_id, sub_type, date DESC`).
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
    if (/WITH\s+bounds/i.test(sql)) {
      const rows: HistRow[] = [];
      for (let i = 0; i + 3 < args.length; i += 4) {
        const pid = Number(args[i]);
        const st = String(args[i + 1]);
        const live = String(args[i + 2]);
        const cut = String(args[i + 3]);
        let prior: HistRow | null = null;
        for (const row of history) {
          if (row.product_id !== pid || row.sub_type !== st) continue;
          if (row.date >= cut && row.date <= live) {
            rows.push(row);
          } else if (row.date < cut && (!prior || row.date > prior.date)) {
            prior = row;
          }
        }
        if (prior) rows.push(prior);
      }
      rows.sort(
        (a, b) =>
          a.product_id - b.product_id ||
          a.sub_type.localeCompare(b.sub_type) ||
          b.date.localeCompare(a.date),
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

  test('the full path emits one bounded pair scan — its windows need history', async () => {
    const { db, getAllAsync } = createCatalogDb(HISTORY);
    setCatalogDatabase(db);

    await getProductMarketData(db, IDS, VARIANTS);

    const scans = getAllAsync.mock.calls.filter(([sql]) => /WITH\s+bounds/i.test(sql));
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

// Item-18 pins — getVariantHistories bounds each pair to
// [liveDate − 95d, liveDate] plus the newest row before the cutoff.
// Every pair below resolves live at 2026-10-10, so the emitted bound is
// (id, subtype, '2026-10-10', '2026-07-07'); the 90d high/low window the
// consumer applies separately starts at 2026-07-12.
const WINDOW_HISTORY: HistRow[] = [
  // 10 — dense in-window rows resolve every target; 2026-07-01 is the
  // newest-below-cutoff row (fetched as the stale fallback, never
  // reached) and 2026-01-01 is the tail the old unbounded scan dragged.
  { product_id: 10, sub_type: 'Normal', date: '2026-10-10', market_price: 100 },
  { product_id: 10, sub_type: 'Normal', date: '2026-10-09', market_price: 90 },
  { product_id: 10, sub_type: 'Normal', date: '2026-10-06', market_price: 80 },
  { product_id: 10, sub_type: 'Normal', date: '2026-10-01', market_price: 70 },
  { product_id: 10, sub_type: 'Normal', date: '2026-09-05', market_price: 60 },
  { product_id: 10, sub_type: 'Normal', date: '2026-08-01', market_price: 150 },
  { product_id: 10, sub_type: 'Normal', date: '2026-07-15', market_price: 50 },
  { product_id: 10, sub_type: 'Normal', date: '2026-07-01', market_price: 999 },
  { product_id: 10, sub_type: 'Normal', date: '2026-01-01', market_price: 5 },
  // 11 — >95d coverage gap: the pre-cutoff row supplies every window
  // target through findPriceForDate's stale fallback.
  { product_id: 11, sub_type: 'Normal', date: '2026-10-10', market_price: 200 },
  { product_id: 11, sub_type: 'Normal', date: '2026-01-01', market_price: 7 },
  // 12 — the slack band: 2026-07-10 sits inside the 95d bound but
  // outside the 90d high/low window, so it resolves all four targets
  // while high/low still only see the live row.
  { product_id: 12, sub_type: 'Normal', date: '2026-10-10', market_price: 50 },
  { product_id: 12, sub_type: 'Normal', date: '2026-07-10', market_price: 30 },
  { product_id: 12, sub_type: 'Normal', date: '2026-07-05', market_price: 20 },
  { product_id: 12, sub_type: 'Normal', date: '2026-06-01', market_price: 10 },
  // 13 — no row ≤ live−30d inside the window: 7d/30d fall through to
  // the newest pre-cutoff row (2026-07-01), never the older 2026-06-01.
  { product_id: 13, sub_type: 'Normal', date: '2026-10-10', market_price: 40 },
  { product_id: 13, sub_type: 'Normal', date: '2026-10-05', market_price: 45 },
  { product_id: 13, sub_type: 'Normal', date: '2026-07-01', market_price: 33 },
  { product_id: 13, sub_type: 'Normal', date: '2026-06-01', market_price: 22 },
  // 16 — resolved pair bounds by the matched subtype: requesting
  // 'Reverse Holofoil' lands on Holofoil, so the stray Promo row is
  // never inside this pair's window.
  { product_id: 16, sub_type: 'Holofoil', date: '2026-10-10', market_price: 30 },
  { product_id: 16, sub_type: 'Holofoil', date: '2026-09-30', market_price: 20 },
  { product_id: 16, sub_type: 'Promo', date: '2026-10-09', market_price: 5 },
];

const WINDOW_IDS = [10, 11, 12, 13, 16];
const WINDOW_VARIANTS: Record<number, string> = { 16: 'Reverse Holofoil' };

describe('bounded getVariantHistories (item 18)', () => {
  test('window fields are identical to the unbounded read', async () => {
    const { db } = createCatalogDb(WINDOW_HISTORY);
    setCatalogDatabase(db);

    const full = await getProductMarketData(db, WINDOW_IDS, WINDOW_VARIANTS);

    expect(full[10]).toMatchObject({
      marketPrice: 100,
      matchedSubType: 'Normal',
      date: '2026-10-10',
      price1d: 90,
      price3d: 80,
      price7d: 70,
      price30d: 60,
      range90dHigh: 150,
      range90dLow: 50,
    });
    // >95d gap — the newest pre-cutoff row feeds all four windows; the
    // 90d high/low still only spans the live row.
    expect(full[11]).toMatchObject({
      price1d: 7,
      price3d: 7,
      price7d: 7,
      price30d: 7,
      range90dHigh: 200,
      range90dLow: 200,
    });
    // The 95d−90d slack band resolves targets the strict 90d window
    // would have missed; high/low stay inside 90d.
    expect(full[12]).toMatchObject({
      price1d: 30,
      price3d: 30,
      price7d: 30,
      price30d: 30,
      range90dHigh: 50,
      range90dLow: 50,
    });
    // 7d/30d resolve through the newest-below-cutoff fallback (33), not
    // the deeper 06-01 row (22) the unbounded scan also carried.
    expect(full[13]).toMatchObject({
      price1d: 45,
      price3d: 45,
      price7d: 33,
      price30d: 33,
      range90dHigh: 45,
      range90dLow: 40,
    });
    // Bounds follow the matched subtype, not the requested variant;
    // the 09-30 row post-dates the live−30d target, so 30d falls back
    // to marketPrice while the nearer targets still resolve to 20.
    expect(full[16]).toMatchObject({
      marketPrice: 30,
      matchedSubType: 'Holofoil',
      price1d: 20,
      price3d: 20,
      price7d: 20,
      price30d: 30,
      range90dHigh: 30,
      range90dLow: 20,
    });
  });

  test('the emitted SQL carries a per-pair date bound', async () => {
    const { db, getAllAsync } = createCatalogDb(WINDOW_HISTORY);
    setCatalogDatabase(db);

    await getProductMarketData(db, WINDOW_IDS, WINDOW_VARIANTS);

    const scans = getAllAsync.mock.calls.filter(([sql]) => /WITH\s+bounds/i.test(String(sql)));
    expect(scans).toHaveLength(1);
    const [sql, ...args] = scans[0];
    expect(sql).toMatch(/date <= b\.live_date/i);
    expect(sql).toMatch(/date >= b\.cutoff/i);
    expect(sql).toMatch(/MAX\(p\.date\)/i);
    expect((String(sql).match(/\(\?, \?, \?, \?\)/g) ?? []).length).toBe(WINDOW_IDS.length);
    expect(args).toEqual([
      10,
      'Normal',
      '2026-10-10',
      '2026-07-07',
      11,
      'Normal',
      '2026-10-10',
      '2026-07-07',
      12,
      'Normal',
      '2026-10-10',
      '2026-07-07',
      13,
      'Normal',
      '2026-10-10',
      '2026-07-07',
      16,
      'Holofoil',
      '2026-10-10',
      '2026-07-07',
    ]);
  });

  test('post-liveDate rows are excluded by the pair bound', async () => {
    // Injected latest map lets a history row post-date liveDate — the
    // catalog-search path passes its own getLatestSubTypePrices map.
    const history: HistRow[] = [
      { product_id: 15, sub_type: 'Normal', date: '2026-10-12', market_price: 999 },
      { product_id: 15, sub_type: 'Normal', date: '2026-10-07', market_price: 60 },
      { product_id: 15, sub_type: 'Normal', date: '2026-10-01', market_price: 70 },
    ];
    const { db, getAllAsync } = createCatalogDb(history);
    setCatalogDatabase(db);

    const full = await getProductMarketData(
      db,
      [15],
      { 15: 'Normal' },
      { 15: { Normal: { marketPrice: 55, date: '2026-10-08' } } },
    );

    expect(full[15]).toMatchObject({
      marketPrice: 55,
      date: '2026-10-08',
      price1d: 60,
      price3d: 70,
      price7d: 70,
      // No row ≤ live−30d survives the bound → marketPrice fallback.
      price30d: 55,
      // The 2026-10-12 spike never enters high/low.
      range90dHigh: 70,
      range90dLow: 55,
    });

    const scans = getAllAsync.mock.calls.filter(([sql]) => /WITH\s+bounds/i.test(String(sql)));
    expect(scans).toHaveLength(1);
    expect(scans[0].slice(1)).toEqual([15, 'Normal', '2026-10-08', '2026-07-05']);
  });
});
