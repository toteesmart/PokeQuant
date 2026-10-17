import {
  getLastPush,
  getLastSync,
  getPendingInventoryCount,
  getPendingInventoryRows,
  setLastPush,
  setLastSync,
} from '../src/db/syncDb';
import { FakeSQLite } from './helpers/fakeSqlite';

function buildTursoResponse(rows: { type: string; value: unknown }[][]) {
  const cols = [
    { name: 'id' },
    { name: 'user_id' },
    { name: 'product_id' },
    { name: 'card_name' },
    { name: 'card_number' },
    { name: 'set_name' },
    { name: 'variant' },
    { name: 'condition' },
    { name: 'purchase_price' },
    { name: 'sticker_price' },
    { name: 'date_bought' },
    { name: 'is_bulk_deal' },
    { name: 'is_sold' },
    { name: 'sold_price' },
    { name: 'date_sold' },
    { name: 'custom_image_data' },
    { name: 'is_deleted' },
    { name: 'updated_at' },
  ];

  return {
    results: [
      {
        type: 'ok',
        response: {
          type: 'execute',
          result: { cols, rows, affected_row_count: 0 },
        },
      },
      { type: 'ok', response: { type: 'close' } },
    ],
  };
}

// One remote inventory row as Turso wire cells, in INVENTORY_COLUMNS order.
function inventoryCells(id: string, userId: string, updatedAt: number) {
  return [
    { type: 'text', value: id },
    { type: 'text', value: userId },
    { type: 'integer', value: '12345' },
    { type: 'text', value: 'Pikachu' },
    { type: 'text', value: '25' },
    { type: 'text', value: 'Base Set' },
    { type: 'text', value: 'Normal' },
    { type: 'text', value: 'nm' },
    { type: 'float', value: 5 },
    { type: 'float', value: 10 },
    { type: 'text', value: '2026-01-01' },
    { type: 'integer', value: '0' },
    { type: 'integer', value: '0' },
    { type: 'integer', value: '0' },
    { type: 'text', value: '' },
    { type: 'text', value: '' },
    { type: 'integer', value: '1' },
    { type: 'float', value: updatedAt },
  ];
}

describe('syncDb watermark helpers', () => {
  const userId = 'user-1';
  let db: FakeSQLite;

  beforeEach(() => {
    db = new FakeSQLite();
  });

  it('counts rows newer than the push watermark as pending', async () => {
    db.inventory = [
      { user_id: userId, id: 'a', updated_at: 100, is_deleted: 0 },
      { user_id: userId, id: 'b', updated_at: 200, is_deleted: 1 },
    ];

    const count = await getPendingInventoryCount(db as any, userId);
    expect(count).toBe(2);
  });

  it('excludes rows already covered by the push watermark', async () => {
    db.inventory = [
      { user_id: userId, id: 'a', updated_at: 100, is_deleted: 0 },
      { user_id: userId, id: 'b', updated_at: 200, is_deleted: 1 },
    ];
    await setLastPush(db as any, userId, 200);

    const count = await getPendingInventoryCount(db as any, userId);
    expect(count).toBe(0);
  });

  it('returns only pending rows for getPendingInventoryRows', async () => {
    db.inventory = [
      { user_id: userId, id: 'a', updated_at: 100 },
      { user_id: userId, id: 'b', updated_at: 250 },
    ];
    await setLastPush(db as any, userId, 150);

    const rows = await getPendingInventoryRows(db as any, userId);
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('b');
  });

  it('keeps local mutations pending after a pull', async () => {
    db.inventory = [{ user_id: userId, id: 'local-1', updated_at: 150, is_deleted: 0 }];
    // Simulate the remote pull having happened in a previous sync.
    await setLastPush(db as any, userId, 100);
    await setLastSync(db as any, userId, 100);

    const pending = await getPendingInventoryCount(db as any, userId);
    expect(pending).toBe(1);
  });
});

describe('pullRemoteChanges advances push watermark', () => {
  const userId = 'user-1';
  let db: FakeSQLite;
  let pullRemoteChanges: (db: any, userId: string) => Promise<number>;
  const originalFetch = (globalThis as any).fetch;

  function mockFetchWithRemoteRow(updatedAt: number) {
    (globalThis as any).fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify(buildTursoResponse([inventoryCells('remote-1', userId, updatedAt)])),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
  }

  beforeEach(() => {
    db = new FakeSQLite();
    jest.resetModules();

    jest.doMock('../src/api/supabaseClient', () => ({
      supabase: {
        auth: {
          getSession: jest.fn().mockResolvedValue({
            data: { session: { access_token: 'test-token' } },
            error: null,
          }),
        },
      },
    }));

    jest.doMock('../src/db/inventoryDb', () => ({
      applyRemoteInventoryChunk: jest.fn().mockResolvedValue(0),
      coerceInventoryRow: jest.fn((row: Record<string, unknown>) => row),
    }));

    mockFetchWithRemoteRow(12345);

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules needs a fresh CJS require to get an unmocked module instance
      pullRemoteChanges = require('../src/api/cloudSync').pullRemoteChanges;
    });
  });

  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  it('advances last_pushed_local_updated_at after pulling a remote row', async () => {
    const pulled = await pullRemoteChanges(db as any, userId);
    expect(pulled).toBe(1);

    const lastSync = await getLastSync(db as any, userId);
    const lastPush = await getLastPush(db as any, userId);

    expect(lastSync).toBe(12345);
    expect(lastPush).toBe(12345);

    const pending = await getPendingInventoryCount(db as any, userId);
    expect(pending).toBe(0);
  });

  it('does not lower last_pushed_local_updated_at when pulled rows are older', async () => {
    mockFetchWithRemoteRow(150);
    await setLastPush(db as any, userId, 200);

    await pullRemoteChanges(db as any, userId);

    const lastPush = await getLastPush(db as any, userId);
    expect(lastPush).toBe(200);
  });

  it('writes each watermark once with no watermark reads', async () => {
    await pullRemoteChanges(db as any, userId);

    const writes = db.runAsync.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT OR REPLACE INTO sync_metadata'),
    );
    expect(writes).toHaveLength(2);
    // setLastSync (preserves last_pushed) then advanceLastPush (MAX-absorbing).
    expect(String(writes[0][0])).toContain(
      'COALESCE((SELECT last_pushed_local_updated_at FROM sync_metadata',
    );
    expect(String(writes[1][0])).toContain('MAX(');

    // The old getLastPush read is gone; only getLastSync's upfront read stays.
    const reads = db.getFirstAsync.mock.calls.filter(([sql]) =>
      String(sql).includes('last_pushed_local_updated_at FROM sync_metadata'),
    );
    expect(reads).toHaveLength(0);
  });
});

describe('pushLocalChanges multi-row upserts', () => {
  const userId = 'user-1';
  let db: FakeSQLite;
  let pushLocalChanges: (db: any, userId: string) => Promise<number>;
  let fetchMock: jest.Mock;
  const originalFetch = (globalThis as any).fetch;
  const mockGetSession = jest.fn();

  const UPSERT_PREFIX =
    'INSERT INTO inventory (id, user_id, product_id, card_name, card_number, set_name, variant, condition, purchase_price, sticker_price, date_bought, is_bulk_deal, is_sold, sold_price, date_sold, custom_image_data, is_deleted, updated_at) VALUES ';
  const ROW_GROUP = `(${Array(18).fill('?').join(', ')})`;
  const UPSERT_SUFFIX =
    ' ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, product_id = excluded.product_id, card_name = excluded.card_name, card_number = excluded.card_number, set_name = excluded.set_name, variant = excluded.variant, condition = excluded.condition, purchase_price = excluded.purchase_price, sticker_price = excluded.sticker_price, date_bought = excluded.date_bought, is_bulk_deal = excluded.is_bulk_deal, is_sold = excluded.is_sold, sold_price = excluded.sold_price, date_sold = excluded.date_sold, custom_image_data = excluded.custom_image_data, is_deleted = excluded.is_deleted, updated_at = excluded.updated_at WHERE excluded.updated_at > inventory.updated_at';

  const mkRow = (i: number): Record<string, unknown> => ({
    user_id: userId,
    id: `row-${i}`,
    product_id: 1000 + i,
    card_name: `Card ${i}`,
    card_number: `${i}`,
    set_name: 'Base Set',
    variant: 'Normal',
    condition: 'nm',
    purchase_price: i + 0.5,
    sticker_price: i + 1,
    date_bought: '2026-01-01',
    is_bulk_deal: 0,
    is_sold: 0,
    sold_price: 0,
    date_sold: '',
    custom_image_data: null,
    is_deleted: 0,
    updated_at: 1000 + i,
  });

  const requestsOf = (call: any[]): any[] => JSON.parse(call[1].body).requests;
  const executesOf = (call: any[]): any[] => requestsOf(call).filter((r) => r.type === 'execute');

  beforeEach(() => {
    db = new FakeSQLite();
    jest.resetModules();

    mockGetSession.mockReset().mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
      error: null,
    });

    jest.doMock('../src/api/supabaseClient', () => ({
      supabase: {
        auth: { getSession: mockGetSession },
      },
    }));

    jest.doMock('../src/db/inventoryDb', () => ({
      applyRemoteInventoryChunk: jest.fn().mockResolvedValue(0),
      coerceInventoryRow: jest.fn((row: Record<string, unknown>) => row),
    }));

    fetchMock = jest.fn(async (_url: any, init: any) => {
      const requests = JSON.parse(init.body).requests;
      return new Response(
        JSON.stringify({
          results: requests.map((r: any) =>
            r.type === 'execute'
              ? {
                  type: 'ok',
                  response: {
                    type: 'execute',
                    result: { cols: [], rows: [], affected_row_count: 0 },
                  },
                }
              : { type: 'ok', response: { type: 'close' } },
          ),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    (globalThis as any).fetch = fetchMock;

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules needs a fresh CJS require to get an unmocked module instance
      pushLocalChanges = require('../src/api/cloudSync').pushLocalChanges;
    });
  });

  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  it('returns 0 without contacting the worker when nothing is pending', async () => {
    const pushed = await pushLocalChanges(db as any, userId);

    expect(pushed).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it('emits one execute + close for a single pending row', async () => {
    db.inventory = [mkRow(0)];

    const pushed = await pushLocalChanges(db as any, userId);

    expect(pushed).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const reqs = requestsOf(fetchMock.mock.calls[0]);
    expect(reqs.map((r) => r.type)).toEqual(['execute', 'close']);
    expect(reqs[0].stmt.sql).toBe(UPSERT_PREFIX + ROW_GROUP + UPSERT_SUFFIX);
    expect(reqs[0].stmt.args).toHaveLength(18);
  });

  it('orders each row-group by the 18-column list', async () => {
    db.inventory = [
      {
        user_id: userId,
        id: 'card-uuid-1',
        product_id: 4242,
        card_name: "Farfetch'd",
        card_number: '107',
        set_name: 'Base Set',
        variant: '1st Edition',
        condition: 'lp',
        purchase_price: 12.5,
        sticker_price: 20,
        date_bought: '2026-01-15',
        is_bulk_deal: true,
        is_sold: false,
        sold_price: 0,
        date_sold: '',
        custom_image_data: null,
        is_deleted: 0,
        updated_at: 555,
      },
      mkRow(1),
    ];

    await pushLocalChanges(db as any, userId);

    const args = executesOf(fetchMock.mock.calls[0])[0].stmt.args;
    expect(args.slice(0, 18)).toEqual([
      { type: 'text', value: 'card-uuid-1' },
      { type: 'text', value: userId },
      { type: 'integer', value: '4242' },
      { type: 'text', value: "Farfetch'd" },
      { type: 'text', value: '107' },
      { type: 'text', value: 'Base Set' },
      { type: 'text', value: '1st Edition' },
      { type: 'text', value: 'lp' },
      { type: 'float', value: 12.5 },
      { type: 'integer', value: '20' },
      { type: 'text', value: '2026-01-15' },
      { type: 'integer', value: '1' },
      { type: 'integer', value: '0' },
      { type: 'integer', value: '0' },
      { type: 'text', value: '' },
      { type: 'null' },
      { type: 'integer', value: '0' },
      { type: 'integer', value: '555' },
    ]);
    // Second row group starts at arg 18; user_id is forced to the auth user.
    expect(args[18]).toEqual({ type: 'text', value: 'row-1' });
    expect(args[19]).toEqual({ type: 'text', value: userId });
    expect(args).toHaveLength(36);
  });

  it.each([
    [45, 1],
    [46, 2],
    [500, 12],
  ])('%i pending rows pack into %i execute statements', async (n, stmts) => {
    db.inventory = Array.from({ length: n }, (_, i) => mkRow(i));

    const pushed = await pushLocalChanges(db as any, userId);

    expect(pushed).toBe(n);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const executes = executesOf(fetchMock.mock.calls[0]);
    expect(executes).toHaveLength(stmts);
    for (const [i, stmt] of executes.entries()) {
      const rowsInStmt = Math.min(45, n - i * 45);
      expect(stmt.stmt.args).toHaveLength(rowsInStmt * 18);
      expect(stmt.stmt.sql.startsWith(UPSERT_PREFIX)).toBe(true);
      expect(stmt.stmt.sql.endsWith(UPSERT_SUFFIX)).toBe(true);
      expect(stmt.stmt.sql.split('?').length - 1).toBe(rowsInStmt * 18);
    }
  });

  it('fetches the auth token once across multiple batches', async () => {
    db.inventory = Array.from({ length: 501 }, (_, i) => mkRow(i));

    await pushLocalChanges(db as any, userId);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mockGetSession).toHaveBeenCalledTimes(1);
    // Second batch carries the one leftover row as a single statement.
    const executes = executesOf(fetchMock.mock.calls[1]);
    expect(executes).toHaveLength(1);
    expect(executes[0].stmt.args).toHaveLength(18);
  });

  it('advances the push watermark after a successful push', async () => {
    db.inventory = [mkRow(3), mkRow(7)];

    await pushLocalChanges(db as any, userId);

    const writes = db.runAsync.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT OR REPLACE INTO sync_metadata'),
    );
    expect(writes).toHaveLength(1);
    const lastPush = await getLastPush(db as any, userId);
    expect(lastPush).toBe(1007);
  });
});

describe('pullRemoteChanges keyset pagination', () => {
  const userId = 'user-1';
  const PULL_SQL =
    'SELECT * FROM inventory WHERE user_id = ? AND updated_at >= ? AND NOT (updated_at = ? AND id <= ?) ORDER BY updated_at ASC, id ASC LIMIT 500';
  let db: FakeSQLite;
  let pullRemoteChanges: (db: any, userId: string) => Promise<number>;
  let applySpy: jest.Mock;
  let fetchMock: jest.Mock;
  let remoteRows: { id: string; user_id: string; updated_at: number }[];
  const mockGetSession = jest.fn();
  const originalFetch = (globalThis as any).fetch;

  const mkRemote = (id: string, updatedAt: number) => ({
    id,
    user_id: userId,
    updated_at: updatedAt,
  });

  // Replays the server-side keyset predicate the emitted SQL encodes:
  // user_id = ? AND updated_at >= ? AND NOT (updated_at = ? AND id <= ?),
  // ordered by (updated_at, id), capped at the 500-row page.
  function remotePage(args: { type: string; value: unknown }[]) {
    const uid = String(args[0].value);
    const tsGe = Number(args[1].value);
    const tsEq = Number(args[2].value);
    const idCursor = String(args[3].value);
    return remoteRows
      .filter(
        (r) =>
          r.user_id === uid && r.updated_at >= tsGe && !(r.updated_at === tsEq && r.id <= idCursor),
      )
      .sort((a, b) => a.updated_at - b.updated_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, 500);
  }

  const stmtOf = (call: any[]) =>
    (JSON.parse(call[1].body).requests as any[]).find((r) => r.type === 'execute').stmt;
  const appliedIds = () =>
    applySpy.mock.calls.flatMap((c) => (c[1] as { id: string }[]).map((r) => r.id));
  const serveRemote = async (_url: any, init: any) => {
    const stmt = (JSON.parse(init.body).requests as any[]).find((r) => r.type === 'execute').stmt;
    const page = remotePage(stmt.args);
    return new Response(
      JSON.stringify(
        buildTursoResponse(page.map((r) => inventoryCells(r.id, r.user_id, r.updated_at))),
      ),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  beforeEach(() => {
    db = new FakeSQLite();
    remoteRows = [];
    jest.resetModules();

    mockGetSession.mockReset().mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
      error: null,
    });

    jest.doMock('../src/api/supabaseClient', () => ({
      supabase: {
        auth: { getSession: mockGetSession },
      },
    }));

    applySpy = jest.fn().mockResolvedValue(0);
    jest.doMock('../src/db/inventoryDb', () => ({
      applyRemoteInventoryChunk: applySpy,
      coerceInventoryRow: jest.fn((row: Record<string, unknown>) => row),
    }));

    fetchMock = jest.fn(serveRemote);
    (globalThis as any).fetch = fetchMock;

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules needs a fresh CJS require to get an unmocked module instance
      pullRemoteChanges = require('../src/api/cloudSync').pullRemoteChanges;
    });
  });

  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  it('emits the OR-free keyset SELECT bound to the watermark cursor', async () => {
    await setLastSync(db as any, userId, 777);

    await pullRemoteChanges(db as any, userId);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const stmt = stmtOf(fetchMock.mock.calls[0]);
    expect(stmt.sql).toBe(PULL_SQL);
    // [user_id, updated_at >=, updated_at =, id <=] — initial cursor is
    // (lastSync, ''), so rows at exactly the watermark are re-requested.
    expect(stmt.args).toEqual([
      { type: 'text', value: userId },
      { type: 'integer', value: '777' },
      { type: 'integer', value: '777' },
      { type: 'text', value: '' },
    ]);
  });

  it.each([
    [0, 1],
    [3, 1],
    [500, 2],
    [501, 2],
    [1000, 3],
  ])('%i remote rows take %i worker requests', async (n, requests) => {
    remoteRows = Array.from({ length: n }, (_, i) =>
      mkRemote(`id-${String(i).padStart(4, '0')}`, 1000 + i),
    );

    const pulled = await pullRemoteChanges(db as any, userId);

    expect(pulled).toBe(n);
    expect(fetchMock).toHaveBeenCalledTimes(requests);
    expect(applySpy).toHaveBeenCalledTimes(Math.ceil(n / 500));
    expect(new Set(appliedIds()).size).toBe(n);
  });

  it('advances the cursor to the last row of a full page', async () => {
    remoteRows = Array.from({ length: 501 }, (_, i) =>
      mkRemote(`id-${String(i).padStart(4, '0')}`, 1000 + i),
    );

    await pullRemoteChanges(db as any, userId);

    // Page 1 ends at (1499, 'id-0499'); page 2 resumes strictly after it.
    expect(stmtOf(fetchMock.mock.calls[1]).args).toEqual([
      { type: 'text', value: userId },
      { type: 'integer', value: '1499' },
      { type: 'integer', value: '1499' },
      { type: 'text', value: 'id-0499' },
    ]);
  });

  it('neither skips nor double-applies same-millisecond boundary rows', async () => {
    // 600 rows; the page-1 boundary lands inside the updated_at = 2000 cluster.
    remoteRows = [
      ...Array.from({ length: 497 }, (_, i) =>
        mkRemote(`id-${String(i).padStart(4, '0')}`, 1000 + i),
      ),
      ...Array.from({ length: 34 }, (_, i) =>
        mkRemote(`id-${String(497 + i).padStart(4, '0')}`, 2000),
      ),
      ...Array.from({ length: 69 }, (_, i) =>
        mkRemote(`id-${String(531 + i).padStart(4, '0')}`, 3000 + i),
      ),
    ];

    const pulled = await pullRemoteChanges(db as any, userId);

    expect(pulled).toBe(600);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Page 1 = 497 distinct-ts rows + cluster rows id-0497..id-0499 (id order
    // within the cluster); page 2 resumes mid-cluster at (2000, 'id-0499').
    expect(stmtOf(fetchMock.mock.calls[1]).args).toEqual([
      { type: 'text', value: userId },
      { type: 'integer', value: '2000' },
      { type: 'integer', value: '2000' },
      { type: 'text', value: 'id-0499' },
    ]);

    const page1Ids = applySpy.mock.calls[0][1].map((r: { id: string }) => r.id);
    const page2Ids = applySpy.mock.calls[1][1].map((r: { id: string }) => r.id);
    expect(page1Ids).toHaveLength(500);
    expect(page2Ids).toHaveLength(100);
    expect(page1Ids.filter((id: string) => page2Ids.includes(id))).toHaveLength(0);
    expect(new Set([...page1Ids, ...page2Ids])).toEqual(new Set(remoteRows.map((r) => r.id)));
  });

  it('re-requests rows at exactly the watermark so a mid-cluster resume cannot skip them', async () => {
    await setLastSync(db as any, userId, 2000);
    remoteRows = [mkRemote('id-0001', 2000), mkRemote('id-0002', 2000), mkRemote('id-0003', 3000)];

    const pulled = await pullRemoteChanges(db as any, userId);

    // Rows at exactly lastSync are re-fetched (deduped downstream by the LWW
    // upsert) — under the old strict-> read they would be skipped forever.
    expect(pulled).toBe(3);
    expect(new Set(appliedIds())).toEqual(new Set(['id-0001', 'id-0002', 'id-0003']));
  });

  it('advances both watermarks to the true max across pages', async () => {
    remoteRows = Array.from({ length: 501 }, (_, i) =>
      mkRemote(`id-${String(i).padStart(4, '0')}`, 1000 + i),
    );

    await pullRemoteChanges(db as any, userId);

    expect(await getLastSync(db as any, userId)).toBe(1500);
    expect(await getLastPush(db as any, userId)).toBe(1500);
    // Per-page advance: setLastSync + advanceLastPush for each of 2 pages.
    const writes = db.runAsync.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT OR REPLACE INTO sync_metadata'),
    );
    expect(writes).toHaveLength(4);
  });

  it('applies each page before advancing the watermarks for that page', async () => {
    remoteRows = Array.from({ length: 501 }, (_, i) =>
      mkRemote(`id-${String(i).padStart(4, '0')}`, 1000 + i),
    );

    await pullRemoteChanges(db as any, userId);

    const writes = db.runAsync.mock.calls
      .map(([sql], i) => ({ sql: String(sql), i }))
      .filter(({ sql }) => sql.includes('INSERT OR REPLACE INTO sync_metadata'));
    const apply1 = applySpy.mock.invocationCallOrder[0];
    const apply2 = applySpy.mock.invocationCallOrder[1];
    const syncWrite1 = db.runAsync.mock.invocationCallOrder[writes[0].i];
    const syncWrite3 = db.runAsync.mock.invocationCallOrder[writes[2].i];
    // setLastSync + advanceLastPush for page 1 land between the two applies.
    expect(apply1).toBeLessThan(syncWrite1);
    expect(syncWrite1).toBeLessThan(apply2);
    expect(apply2).toBeLessThan(syncWrite3);
  });

  it('fetches the auth token once across multiple pages', async () => {
    remoteRows = Array.from({ length: 501 }, (_, i) =>
      mkRemote(`id-${String(i).padStart(4, '0')}`, 1000 + i),
    );

    await pullRemoteChanges(db as any, userId);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mockGetSession).toHaveBeenCalledTimes(1);
  });

  it('resumes from the last applied page after a mid-loop failure', async () => {
    remoteRows = Array.from({ length: 501 }, (_, i) =>
      mkRemote(`id-${String(i).padStart(4, '0')}`, 1000 + i),
    );
    let failSecondCall = true;
    let calls = 0;
    fetchMock.mockImplementation(async (url: any, init: any) => {
      calls++;
      if (failSecondCall && calls === 2) {
        return new Response('boom', { status: 500 });
      }
      return serveRemote(url, init);
    });

    await expect(pullRemoteChanges(db as any, userId)).rejects.toThrow('HTTP 500');
    // Page 1 fully applied and its watermark persisted; page 2 never landed.
    expect(applySpy).toHaveBeenCalledTimes(1);
    expect(await getLastSync(db as any, userId)).toBe(1499);

    // Retry against a healthy worker: resumes at (1499, ''), re-fetches the
    // page-1 boundary row (deduped by LWW) and completes the delta.
    failSecondCall = false;
    calls = 0;
    const pulled = await pullRemoteChanges(db as any, userId);
    expect(pulled).toBe(2);
    expect(new Set(appliedIds())).toEqual(new Set(remoteRows.map((r) => r.id)));
  });
});

describe('vendorSettings sync wire shape', () => {
  const userId = 'user-1';
  // The LWW-guarded upsert — accepted by the worker allowlist rev that pins
  // ON CONFLICT(user_id); the prior INSERT OR REPLACE form was unguarded.
  const UPSERT_SQL =
    'INSERT INTO vendor_settings (user_id, settings_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at WHERE excluded.updated_at > vendor_settings.updated_at';
  const PULL_SQL =
    'SELECT settings_json, updated_at FROM vendor_settings WHERE user_id = ? ORDER BY updated_at DESC';
  let db: FakeSQLite;
  let cloudSync: typeof import('../src/api/cloudSync');
  let fetchMock: jest.Mock;
  const mockGetSession = jest.fn();
  const originalFetch = (globalThis as any).fetch;

  function vendorSettingsResponse(rows: { type: string; value: unknown }[][]) {
    return {
      results: [
        {
          type: 'ok',
          response: {
            type: 'execute',
            result: {
              cols: [{ name: 'settings_json' }, { name: 'updated_at' }],
              rows,
              affected_row_count: 0,
            },
          },
        },
        { type: 'ok', response: { type: 'close' } },
      ],
    };
  }

  const stmtOf = (call: any[]) =>
    (JSON.parse(call[1].body).requests as any[]).find((r) => r.type === 'execute').stmt;

  beforeEach(() => {
    db = new FakeSQLite();
    jest.resetModules();

    mockGetSession.mockReset().mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
      error: null,
    });

    jest.doMock('../src/api/supabaseClient', () => ({
      supabase: {
        auth: { getSession: mockGetSession },
      },
    }));

    fetchMock = jest.fn(
      async () =>
        new Response(JSON.stringify(vendorSettingsResponse([])), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    (globalThis as any).fetch = fetchMock;

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules needs a fresh CJS require to get an unmocked module instance
      cloudSync = require('../src/api/cloudSync');
    });
  });

  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  it('pushVendorSettings emits the LWW-guarded upsert bound to the user', async () => {
    await cloudSync.pushVendorSettings(db as any, userId, '{"tiers":[]}', 1791918923);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requests = JSON.parse(fetchMock.mock.calls[0][1].body).requests;
    expect(requests.map((r: any) => r.type)).toEqual(['execute', 'close']);
    expect(requests[0].stmt.sql).toBe(UPSERT_SQL);
    expect(requests[0].stmt.args).toEqual([
      { type: 'text', value: userId },
      { type: 'text', value: '{"tiers":[]}' },
      { type: 'integer', value: '1791918923' },
    ]);
  });

  it('pullVendorSettings reads newest-first and maps the row', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          vendorSettingsResponse([
            [
              { type: 'text', value: '{"tiers":[{"minDollar":0}]}' },
              { type: 'float', value: 1791918923 },
            ],
          ]),
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await cloudSync.pullVendorSettings(db as any, userId);

    const stmt = stmtOf(fetchMock.mock.calls[0]);
    expect(stmt.sql).toBe(PULL_SQL);
    expect(stmt.args).toEqual([{ type: 'text', value: userId }]);
    expect(result).toEqual({
      settingsJson: '{"tiers":[{"minDollar":0}]}',
      updatedAt: 1791918923,
    });
  });

  it('pullVendorSettings takes the first row — the newest under DESC order', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          vendorSettingsResponse([
            [
              { type: 'text', value: '{"updatedAt":200}' },
              { type: 'float', value: 200 },
            ],
            [
              { type: 'text', value: '{"updatedAt":100}' },
              { type: 'float', value: 100 },
            ],
          ]),
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await cloudSync.pullVendorSettings(db as any, userId);

    expect(result).toEqual({ settingsJson: '{"updatedAt":200}', updatedAt: 200 });
  });

  it('pullVendorSettings returns null when the remote has no row', async () => {
    const result = await cloudSync.pullVendorSettings(db as any, userId);
    expect(result).toBeNull();
  });
});
