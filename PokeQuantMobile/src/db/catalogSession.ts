// catalogSession — the catalog SQLite handle + open/close lifecycle.
// Everything that reads the handle does so through the live bindings
// below (sqliteDb/db) and the withCatalogGuard wrapper, which turns a
// missing/failed catalog into the declared fallback instead of a crash.
import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import { drizzle, type ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { ensureCatalogDownloaded, CATALOG_FILE_NAME } from '../services/CatalogDownloadService';
import { useProgressStore } from '../store/progressStore';


export let sqliteDb: SQLiteDatabase | null = null;
export let db: ExpoSQLiteDatabase | null = null;
export let catalogOpenPromise: Promise<SQLiteDatabase> | null = null;

export function withCatalogGuard<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  fallback: Awaited<ReturnType<T>>
): T {
  return (async (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
    try {
      if (!db || !sqliteDb) return fallback;
      return await fn(...args);
    } catch (err) {
      console.error(`Catalog query ${fn.name} failed:`, err);
      return fallback;
    }
  }) as T;
}


export function isCatalogDatabaseOpen(): boolean {
  return sqliteDb != null;
}

/** Table-presence probe for the optional quant tables — readers must
 *  degrade silently on older catalogs that lack them. */
export async function catalogHasTable(name: string): Promise<boolean> {
  if (!sqliteDb) return false;
  try {
    const row = await sqliteDb.getFirstAsync<{ c: number }>(
      "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name=?",
      name
    );
    return (row?.c ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Assign the raw handle + drizzle wrapper and flag the store. The
 *  caller-facing setCatalogDatabase() in catalogDb.ts wraps this with
 *  per-domain cache resets — keep handle assignment single-owner here. */
export function assignCatalogDb(rawDb: SQLiteDatabase): void {
  sqliteDb = rawDb;
  db = drizzle(rawDb);
  useProgressStore.getState().setCatalogReady(true);
}

export async function closeCatalogDatabase(): Promise<void> {
  if (!sqliteDb) return;

  try {
    await sqliteDb.closeAsync();
  } catch (err) {
    console.warn('Failed to close catalog database:', err);
  }

  sqliteDb = null;
  db = null;
  useProgressStore.getState().setCatalogReady(false);
}

const CATALOG_REQUIRED_TABLES = ['cards', 'price_history'];

async function validateCatalogTables(rawDb: SQLiteDatabase): Promise<boolean> {
  try {
    const rows = await rawDb.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${CATALOG_REQUIRED_TABLES.map(() => '?').join(',')})`,
      ...CATALOG_REQUIRED_TABLES
    );
    const names = new Set(rows.map((r) => r.name));
    return CATALOG_REQUIRED_TABLES.every((t) => names.has(t));
  } catch {
    return false;
  }
}

function trackCatalogOpen(
  run: () => Promise<SQLiteDatabase>
): Promise<SQLiteDatabase> {
  const tracked = run().finally(() => {
    if (catalogOpenPromise === tracked) {
      catalogOpenPromise = null;
    }
  });
  catalogOpenPromise = tracked;
  return tracked;
}

export async function openCatalogDatabase(): Promise<SQLiteDatabase> {
  if (sqliteDb) {
    return sqliteDb;
  }
  if (catalogOpenPromise) {
    return catalogOpenPromise;
  }

  return trackCatalogOpen(async () => {
    let rawDb: SQLiteDatabase | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      await ensureCatalogDownloaded(attempt > 0);
      rawDb = openDatabaseSync(CATALOG_FILE_NAME);

      if (await validateCatalogTables(rawDb)) {
        break;
      }

      if (attempt === 0) {
        console.warn('Catalog database is missing required tables; re-downloading...');
        try {
          await rawDb.closeAsync();
        } catch (err) {
          console.warn('Failed to close invalid catalog handle:', err);
        }
        rawDb = null;
      } else {
        try {
          await rawDb.closeAsync();
        } catch (err) {
          console.warn('Failed to close invalid catalog handle:', err);
        }
        throw new Error('Catalog database missing required tables after re-download');
      }
    }

    if (!rawDb) {
      throw new Error('Catalog database could not be opened');
    }

    sqliteDb = rawDb;
    db = drizzle(sqliteDb);
    useProgressStore.getState().setCatalogReady(true);
    return sqliteDb;
  });
}

