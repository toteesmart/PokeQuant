import type { SQLiteDatabase } from 'expo-sqlite';
import {
  catalogHasTable,
  closeCatalogDatabase,
  getCardDeep,
  getCardSignals,
  getPatternStats,
  setCatalogDatabase,
} from '../src/db/catalogDb';

jest.mock('drizzle-orm/expo-sqlite', () => ({
  drizzle: jest.fn(() => ({})),
}));

// catalogHasTable memoizes the sqlite_master COUNT probe per handle
// generation (item 22): the quant readers fire it on every signals/scout/
// series read and the answer is schema-stable until a catalog swap —
// assigning or closing the handle must drop the memo because a refreshed
// catalog can gain tables the old file lacked.

// A fake catalog handle whose sqlite_master probe answers from a table
// set; every other getFirstAsync resolves null.
function makeHandle(presentTables: string[] = []) {
  const tables = new Set(presentTables);
  const getFirstAsync = jest.fn(async (sql: string, name?: string) => {
    if (/sqlite_master/.test(String(sql))) {
      return { c: tables.has(String(name)) ? 1 : 0 };
    }
    return null;
  });
  const closeAsync = jest.fn(async () => {});
  const db = { getFirstAsync, closeAsync } as unknown as SQLiteDatabase;
  return { db, getFirstAsync, closeAsync };
}

const probeCount = (getFirstAsync: jest.Mock, table: string) =>
  getFirstAsync.mock.calls.filter(
    ([sql, name]) => /sqlite_master/.test(String(sql)) && name === table
  ).length;

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(async () => {
  await closeCatalogDatabase();
});

describe('catalogHasTable memoization', () => {
  it('probes sqlite_master once per table per handle', async () => {
    const { db, getFirstAsync } = makeHandle(['card_signals']);
    setCatalogDatabase(db);

    expect(await catalogHasTable('card_signals')).toBe(true);
    expect(await catalogHasTable('card_signals')).toBe(true);
    expect(await catalogHasTable('card_deep')).toBe(false);
    expect(await catalogHasTable('card_deep')).toBe(false);

    expect(probeCount(getFirstAsync, 'card_signals')).toBe(1);
    expect(probeCount(getFirstAsync, 'card_deep')).toBe(1);
  });

  it('concurrent first callers share one probe', async () => {
    const { db, getFirstAsync } = makeHandle(['card_deep']);
    setCatalogDatabase(db);

    const results = await Promise.all([
      catalogHasTable('card_deep'),
      catalogHasTable('card_deep'),
    ]);

    expect(results).toEqual([true, true]);
    expect(probeCount(getFirstAsync, 'card_deep')).toBe(1);
  });

  it('a handle swap re-probes in both directions', async () => {
    const a = makeHandle([]);
    setCatalogDatabase(a.db);
    expect(await catalogHasTable('card_deep')).toBe(false);
    expect(probeCount(a.getFirstAsync, 'card_deep')).toBe(1);

    // absent -> present: the refreshed catalog gained the table.
    const b = makeHandle(['card_deep']);
    setCatalogDatabase(b.db);
    expect(await catalogHasTable('card_deep')).toBe(true);
    expect(probeCount(b.getFirstAsync, 'card_deep')).toBe(1);

    // present -> absent: a downgrade must not inherit the stale true.
    const c = makeHandle([]);
    setCatalogDatabase(c.db);
    expect(await catalogHasTable('card_deep')).toBe(false);
    expect(probeCount(c.getFirstAsync, 'card_deep')).toBe(1);
  });

  it('closeCatalogDatabase drops the memo — the next handle re-probes', async () => {
    const a = makeHandle(['card_signals']);
    setCatalogDatabase(a.db);
    expect(await catalogHasTable('card_signals')).toBe(true);
    expect(probeCount(a.getFirstAsync, 'card_signals')).toBe(1);

    await closeCatalogDatabase();

    const b = makeHandle([]);
    setCatalogDatabase(b.db);
    expect(await catalogHasTable('card_signals')).toBe(false);
    expect(probeCount(b.getFirstAsync, 'card_signals')).toBe(1);
  });

  it('the no-handle answer never lands in the memo', async () => {
    // sqliteDb is null after the previous test's close — false with no
    // probe, and nothing may be cached under this generation.
    expect(await catalogHasTable('card_signals')).toBe(false);

    const b = makeHandle(['card_signals']);
    setCatalogDatabase(b.db);
    expect(await catalogHasTable('card_signals')).toBe(true);
    expect(probeCount(b.getFirstAsync, 'card_signals')).toBe(1);
  });

  it('a failed probe evicts — the next call retries', async () => {
    const { db, getFirstAsync } = makeHandle(['card_signals']);
    setCatalogDatabase(db);
    getFirstAsync.mockRejectedValueOnce(new Error('transient'));

    expect(await catalogHasTable('card_signals')).toBe(false);
    expect(await catalogHasTable('card_signals')).toBe(true);
    expect(probeCount(getFirstAsync, 'card_signals')).toBe(2);
  });

  it('a probe resolving after a swap cannot write the new generation', async () => {
    let resolveProbe: (row: { c: number } | null) => void = () => {};
    const aGetFirst = jest.fn(
      () =>
        new Promise<{ c: number } | null>((res) => {
          resolveProbe = res;
        })
    );
    const a = {
      getFirstAsync: aGetFirst,
      closeAsync: jest.fn(async () => {}),
    } as unknown as SQLiteDatabase;
    setCatalogDatabase(a);

    // Probe starts on handle A; the swap to B lands before it resolves.
    const inFlight = catalogHasTable('card_deep');
    const b = makeHandle([]);
    setCatalogDatabase(b.db);
    resolveProbe({ c: 1 });

    // The in-flight caller still gets A's honest answer, but B's
    // generation re-probes instead of inheriting it.
    expect(await inFlight).toBe(true);
    expect(await catalogHasTable('card_deep')).toBe(false);
    expect(probeCount(b.getFirstAsync, 'card_deep')).toBe(1);
  });
});

describe('quant reader probes', () => {
  it('repeat reads issue zero re-probes within a generation', async () => {
    const { db, getFirstAsync } = makeHandle(['card_signals', 'card_deep']);
    const withReads = db as SQLiteDatabase & { getAllAsync: jest.Mock };
    withReads.getAllAsync = jest.fn(async () => []);
    setCatalogDatabase(db);

    // First signals read probes both optional tables once.
    await getCardSignals(db, [1, 2]);
    expect(probeCount(getFirstAsync, 'card_signals')).toBe(1);
    expect(probeCount(getFirstAsync, 'card_deep')).toBe(1);

    // Every later read on this handle is probe-free: getCardSignals x2,
    // getCardDeep, getPatternStats each probe their table once at most.
    await getCardSignals(db, [3]);
    await getCardDeep(db, 1, 'Normal');
    await getPatternStats(db);

    expect(probeCount(getFirstAsync, 'card_signals')).toBe(1);
    expect(probeCount(getFirstAsync, 'card_deep')).toBe(1);
    expect(probeCount(getFirstAsync, 'pattern_stats')).toBe(1);
  });
});
