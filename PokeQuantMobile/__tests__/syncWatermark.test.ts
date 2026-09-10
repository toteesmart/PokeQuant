import {
  getLastPush,
  getLastSync,
  getPendingInventoryCount,
  getPendingInventoryRows,
  setLastPush,
  setLastSync,
} from '../src/db/syncDb';

class FakeSQLite {
  sync_metadata: Array<{
    user_id: string;
    last_updated: number;
    last_pushed_local_updated_at: number;
  }> = [];

  inventory: Array<Record<string, unknown>> = [];

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
      return row
        ? { last_pushed_local_updated_at: row.last_pushed_local_updated_at }
        : null;
    }

    if (sql.includes('last_updated FROM sync_metadata')) {
      const row = this.findSyncRow(userId);
      return row ? { last_updated: row.last_updated } : null;
    }

    if (sql.includes('MAX(updated_at) as max_updated FROM inventory')) {
      const rows = this.inventory.filter(
        (r) => (r.user_id ?? r.userId) === userId
      );
      const max = rows.reduce(
        (m, r) => (typeof r.updated_at === 'number' ? Math.max(m, r.updated_at) : m),
        0
      );
      return { max_updated: max };
    }

    if (sql.includes('COUNT(*) as count FROM inventory')) {
      const [, watermark] = args;
      const rows = this.inventory.filter(
        (r) =>
          (r.user_id ?? r.userId) === userId &&
          typeof r.updated_at === 'number' &&
          r.updated_at > Number(watermark)
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
          r.updated_at > Number(watermark)
      );
    }

    return [];
  });

  runAsync = jest.fn(async (sql: string, ...args: unknown[]) => {
    const userId = String(args[0] ?? '');

    if (sql.includes('INSERT OR REPLACE INTO sync_metadata')) {
      const row = this.ensureSyncRow(userId);

      // setLastPush: VALUES (?, COALESCE((SELECT last_updated ...), 0), ?)
      // setLastSync: VALUES (?, ?, COALESCE((SELECT last_pushed_local_updated_at ...), 0))
      if (sql.includes('COALESCE((SELECT last_updated FROM sync_metadata')) {
        // third arg is the new last_pushed_local_updated_at
        row.last_pushed_local_updated_at = Number(args[2]);
      } else if (sql.includes('COALESCE((SELECT last_pushed_local_updated_at FROM sync_metadata')) {
        // second arg is the new last_updated
        row.last_updated = Number(args[1]);
      } else {
        row.last_updated = Number(args[1]);
        row.last_pushed_local_updated_at = Number(args[2]);
      }
    }

    if (sql.includes('DELETE FROM inventory WHERE user_id = ?')) {
      this.inventory = this.inventory.filter(
        (r) => (r.user_id ?? r.userId) !== userId
      );
    }

    if (sql.includes('UPDATE sync_metadata SET last_updated = 0, last_pushed_local_updated_at = 0')) {
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
    db.inventory = [
      { user_id: userId, id: 'local-1', updated_at: 150, is_deleted: 0 },
    ];
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

  function buildTursoResponse(rows: Array<Array<{ type: string; value: unknown }>>) {
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
      new Response(JSON.stringify(buildTursoResponse([
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
      ])), { status: 200, headers: { 'Content-Type': 'application/json' } })
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
});
