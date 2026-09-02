import type { SQLiteDatabase } from 'expo-sqlite';

export async function getMaxUpdatedAt(
  db: SQLiteDatabase,
  userId: string
): Promise<number> {
  const row = await db.getFirstAsync<{ max_updated: number | null }>(
    'SELECT MAX(updated_at) as max_updated FROM inventory WHERE user_id = ?',
    userId
  );
  return row?.max_updated ?? 0;
}

export async function clearPendingSyncs(
  db: SQLiteDatabase,
  userId: string
): Promise<number> {
  const row = await db.getFirstAsync<{ max_updated: number | null }>(
    'SELECT MAX(updated_at) as max_updated FROM inventory WHERE user_id = ?',
    userId
  );
  const newLastSync = row?.max_updated ?? Date.now();
  await setLastSync(db, userId, newLastSync);
  return newLastSync;
}

export async function getLastSync(
  db: SQLiteDatabase,
  userId: string
): Promise<number> {
  const row = await db.getFirstAsync<{ last_updated: number | null }>(
    'SELECT last_updated FROM sync_metadata WHERE user_id = ?',
    userId
  );
  return row?.last_updated ?? 0;
}

export async function setLastSync(
  db: SQLiteDatabase,
  userId: string,
  timestamp: number
): Promise<void> {
  await db.runAsync(
    'INSERT OR REPLACE INTO sync_metadata (user_id, last_updated) VALUES (?, ?)',
    userId,
    timestamp
  );
}

export async function getPendingInventoryCount(
  db: SQLiteDatabase,
  userId: string
): Promise<number> {
  const lastSync = await getLastSync(db, userId);
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM inventory WHERE user_id = ? AND updated_at > ?',
    userId,
    lastSync
  );
  return row?.count ?? 0;
}

export async function getPendingInventoryRows(
  db: SQLiteDatabase,
  userId: string
): Promise<any[]> {
  const lastSync = await getLastSync(db, userId);
  return db.getAllAsync<any>(
    'SELECT * FROM inventory WHERE user_id = ? AND updated_at > ? ORDER BY updated_at ASC',
    userId,
    lastSync
  );
}
