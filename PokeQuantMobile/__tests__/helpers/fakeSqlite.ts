// Shared in-memory expo-sqlite handle covering the statement shapes the
// sync layer emits (syncDb watermarks, pending-row reads, wipe/reset).
// Moved out of syncWatermark.test.ts verbatim so store-action suites can
// run the real syncDb bookkeeping against it.

export class FakeSQLite {
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
