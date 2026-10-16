import {
  getLastPush,
  getLastSync,
  getPendingInventoryCount,
  getPendingInventoryRows,
  setLastPush,
  setLastSync,
} from '../src/db/syncDb';

class FakeSQLite {
  sync_metadata: {
    user_id: string;
    last_updated: number;
    last_pushed_local_updated_at: number;
  }[] = [];

  inventory: Record<string, unknown>[] = [];

  private findSyncRow(userId: string) {
    return this.sync_metadata.find((r) => r.user_id === userId);
  }

  private ensureSyncRow(userId: string) {
    let row = this.findSyncRow(userId);
    if (!row) {
      row = { user_id: userId, last_updated: 0, last_pushed_local_updated_at: 0 };
      this.sync_metadata.push(row);
    }
    return row;
  }

  getFirstAsync = jest.fn(async (sql: string, ...args: unknown[]) => {
    const userId = String(args[0] ?? '');

    if (sql.includes('last_pushed_local_updated_at FROM sync_metadata')) {
      const row = this.findSyncRow(userId);
      return row ? { last_pushed_local_updated_at: row.last_pushed_local_updated_at } : null;
    }

    if (sql.includes('last_updated FROM sync_metadata')) {
      const row = this.findSyncRow(userId);
      return row ? { last_updated: row.last_updated } : null;
    }

    if (sql.includes('MAX(updated_at) as max_updated FROM inventory')) {
      const rows = this.inventory.filter((r) => (r.user_id ?? r.userId) === userId);
      const max = rows.reduce(
        (m, r) => (typeof r.updated_at === 'number' ? Math.max(m, r.updated_at) : m),
        0,
      );
      return { max_updated: max };
    }

    if (sql.includes('COUNT(*) as count FROM inventory')) {
      const [, watermark] = args;
      const rows = this.inventory.filter(
        (r) =>
          (r.user_id ?? r.userId) === userId &&
          typeof r.updated_at === 'number' &&
          r.updated_at > Number(watermark),
      );
      return { count: rows.length };
    }

    return null;
  });

  getAllAsync = jest.fn(async (sql: string, ...args: unknown[]) => {
    const userId = String(args[0] ?? '');
    const [, watermark] = args;

    if (sql.includes('SELECT * FROM inventory WHERE user_id = ? AND updated_at > ?')) {
      return this.inventory.filter(
        (r) =>
          (r.user_id ?? r.userId) === userId &&
          typeof r.updated_at === 'number' &&
          r.updated_at > Number(watermark),
      );
    }

    return [];
  });

  runAsync = jest.fn(async (sql: string, ...args: unknown[]) => {
    const userId = String(args[0] ?? '');

    if (sql.includes('INSERT OR REPLACE INTO sync_metadata')) {
      const row = this.ensureSyncRow(userId);

      // advanceLastPush: VALUES (?, COALESCE((SELECT last_updated ...), 0),
      //   MAX(COALESCE((SELECT last_pushed_local_updated_at ...), 0), ?))
      // args = (userId, userId, userId, timestamp) — preserves last_updated.
      // Checked first: its SQL contains both COALESCE branches below.
      if (sql.includes('MAX(')) {
        row.last_pushed_local_updated_at = Math.max(
          row.last_pushed_local_updated_at,
          Number(args[3]),
        );
      } else if (sql.includes('COALESCE((SELECT last_updated FROM sync_metadata')) {
        // setLastPush: VALUES (?, COALESCE((SELECT last_updated ...), 0), ?)
        // third arg is the new last_pushed_local_updated_at
        row.last_pushed_local_updated_at = Number(args[2]);
      } else if (sql.includes('COALESCE((SELECT last_pushed_local_updated_at FROM sync_metadata')) {
        // setLastSync: second arg is the new last_updated
        row.last_updated = Number(args[1]);
      } else {
        row.last_updated = Number(args[1]);
        row.last_pushed_local_updated_at = Number(args[2]);
      }
    }

    if (sql.includes('DELETE FROM inventory WHERE user_id = ?')) {
      this.inventory = this.inventory.filter((r) => (r.user_id ?? r.userId) !== userId);
    }

    if (
      sql.includes('UPDATE sync_metadata SET last_updated = 0, last_pushed_local_updated_at = 0')
    ) {
      const row = this.findSyncRow(userId);
      if (row) {
        row.last_updated = 0;
        row.last_pushed_local_updated_at = 0;
      }
    }

    return { lastInsertRowId: 0, changes: 1 };
  });

  withTransactionAsync = jest.fn(async <T>(scope: () => Promise<T>) => scope());
  closeAsync = jest.fn(async () => {});
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

  function mockFetchWithRemoteRow(updatedAt: number) {
    (globalThis as any).fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify(
          buildTursoResponse([
            [
              { type: 'text', value: 'remote-1' },
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
            ],
          ]),
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
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
