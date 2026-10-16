// inventory/session — the runtime context every action module shares:
// the tenant-DB handle, the signed-in user, the serialized sync queue,
// and the auto-sync debounce timer. One mutable object (not `let`
// exports, which can't be assigned across modules) so all actions read
// and write the same slots. Internal to store/inventory/.
import type { SQLiteDatabase } from 'expo-sqlite';
import { initializeDatabase } from '../../db/database';
import { logError } from '../../utils/log';

export const inventorySession = {
  db: null as SQLiteDatabase | null,
  userId: null as string | null,
  syncQueueTail: Promise.resolve() as Promise<void>,
  syncDebounceTimer: null as ReturnType<typeof setTimeout> | null,
};

export const AUTO_SYNC_DEBOUNCE_MS = 1500;

export async function getDb(): Promise<SQLiteDatabase | null> {
  if (inventorySession.db) return inventorySession.db;
  try {
    const { db } = await initializeDatabase();
    inventorySession.db = db;
    return db;
  } catch (err) {
    logError('Failed to initialize SQLite for inventory:', err);
    return null;
  }
}
