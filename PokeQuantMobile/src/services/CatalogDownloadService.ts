import { Paths, Directory, File, type DownloadProgress } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import { CATALOG_DOWNLOAD_URL } from '../constants/api';
import { useProgressStore } from '../store/progressStore';
import { isOfflineError, toOfflineMessage } from '../utils/log';

export const CATALOG_FILE_NAME = 'pokequant_catalog.db';

const catalogDir = new Directory(Paths.document, 'SQLite');
const catalogFile = new File(catalogDir, CATALOG_FILE_NAME);

function catalogSidecarFile(suffix: string): File {
  return new File(catalogDir, `${CATALOG_FILE_NAME}${suffix}`);
}

async function deleteStaleCatalogFiles(): Promise<void> {
  const staleFiles = [
    catalogFile,
    catalogSidecarFile('-wal'),
    catalogSidecarFile('-shm'),
  ];

  for (const file of staleFiles) {
    try {
      if (file.exists) {
        file.delete();
      }
    } catch (err) {
      console.warn(`Failed to delete stale catalog file ${file.uri}:`, err);
    }
  }
}

export type CatalogDownloadStatus = {
  exists: boolean;
  path: string;
  downloaded: boolean;
};

export function getCatalogFileUri(): string {
  return catalogFile.uri;
}

// Single in-flight catalog download shared by ensureCatalogDownloaded() and
// downloadLatestMarketPrices(). Without this, a catalog open that lands while
// a refresh has deleted the file (but not finished the download) would race a
// second download over the half-written file.
let catalogDownloadPromise: Promise<CatalogDownloadStatus> | null = null;

function trackCatalogDownload(
  run: () => Promise<CatalogDownloadStatus>
): Promise<CatalogDownloadStatus> {
  const tracked = run().finally(() => {
    if (catalogDownloadPromise === tracked) {
      catalogDownloadPromise = null;
    }
  });
  catalogDownloadPromise = tracked;
  return tracked;
}

export async function ensureCatalogDownloaded(
  force = false
): Promise<CatalogDownloadStatus> {
  catalogDir.create({ intermediates: true, idempotent: true });

  const progress = useProgressStore.getState();

  // Await an in-flight download instead of racing a second one over a file
  // that is mid-replacement. This must run before the exists check — during a
  // refresh the file can still be present but about to be unlinked.
  if (catalogDownloadPromise) {
    try {
      return await catalogDownloadPromise;
    } catch {
      // In-flight download failed — fall through and try our own below.
    }
  }

  if (!force && catalogFile.exists) {
    progress.setCatalogReady(true);
    return { exists: true, path: catalogFile.uri, downloaded: false };
  }

  return trackCatalogDownload(async () => {
    const { closeCatalogDatabase } = await import('../db/catalogDb');
    const { closeEventImageDb } = await import('../db/eventCatalogDb');

    try {
      await closeCatalogDatabase();
      closeEventImageDb();
      await deleteStaleCatalogFiles();
      progress.startCatalogDownload();
      progress.setIsExtracting(true);

      const cacheBustUrl = `${CATALOG_DOWNLOAD_URL}?v=${Date.now()}`;

      await File.downloadFileAsync(cacheBustUrl, catalogFile, {
        idempotent: true,
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
        },
        signal: AbortSignal.timeout(120_000),
        onProgress: (data: DownloadProgress) => {
          const pct =
            data.totalBytes > 0 ? data.bytesWritten / data.totalBytes : 0;
          progress.setCatalogDownloadProgress(pct);
        },
      });

      progress.setCatalogLastUpdated(Date.now());
      progress.setCatalogDownloaded();
      progress.setCatalogReady(true);

      return { exists: true, path: catalogFile.uri, downloaded: true };
    } catch (err) {
      progress.fail('catalog');
      if (isOfflineError(err)) {
        throw new Error(toOfflineMessage(false));
      }
      throw err;
    } finally {
      progress.setIsExtracting(false);
    }
  });
}

const CATALOG_REQUIRED_TABLES = ['cards', 'price_history'];

async function validateCatalogTables(rawDb: SQLiteDatabase): Promise<boolean> {
  try {
    const rows = await rawDb.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${CATALOG_REQUIRED_TABLES.map(() => '?').join(',')})`,
      ...CATALOG_REQUIRED_TABLES
    );
    const names = new Set(rows.map((r: any) => r.name));
    return CATALOG_REQUIRED_TABLES.every((t) => names.has(t));
  } catch {
    return false;
  }
}

export async function downloadLatestMarketPrices(): Promise<CatalogDownloadStatus> {
  // Coalesce with any catalog download already in flight — deleting the file
  // underneath a concurrent download corrupts it. This refresh swaps the
  // catalog DB only; the image archive is a separate explicit download.
  if (catalogDownloadPromise) {
    try {
      return await catalogDownloadPromise;
    } catch {
      // In-flight download failed — fall through and retry ourselves.
    }
  }

  return trackCatalogDownload(async () => {
    catalogDir.create({ intermediates: true, idempotent: true });

    const { closeCatalogDatabase, setCatalogDatabase } = await import('../db/catalogDb');
    const { closeEventImageDb } = await import('../db/eventCatalogDb');
    const { openDatabaseSync } = await import('expo-sqlite');
    const progress = useProgressStore.getState();

    try {
      let lastError: Error | null = null;

      for (let attempt = 0; attempt < 2; attempt++) {
        // Local validation handle — must be closed before retrying, otherwise
        // a stale open handle survives across the file delete/re-download.
        let db: SQLiteDatabase | null = null;
        try {
          await closeCatalogDatabase();
          closeEventImageDb();
          await deleteStaleCatalogFiles();
          progress.startCatalogDownload();
          progress.setIsExtracting(true);

          const cacheBustUrl = `${CATALOG_DOWNLOAD_URL}?v=${Date.now()}`;
          const destination = new File(catalogDir, CATALOG_FILE_NAME);

          await File.downloadFileAsync(cacheBustUrl, destination, {
            idempotent: true,
            headers: {
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              Pragma: 'no-cache',
            },
            signal: AbortSignal.timeout(120_000),
            onProgress: (data: DownloadProgress) => {
              const pct =
                data.totalBytes > 0 ? data.bytesWritten / data.totalBytes : 0;
              progress.setCatalogDownloadProgress(pct);
            },
          });

          db = openDatabaseSync(CATALOG_FILE_NAME) as SQLiteDatabase;

          if (await validateCatalogTables(db)) {
            const validated = db;
            db = null;
            setCatalogDatabase(validated);
            progress.setCatalogReady(true);
            progress.setCatalogLastUpdated(Date.now());
            progress.setCatalogDownloaded();
            return { exists: true, path: catalogFile.uri, downloaded: true };
          }

          if (attempt === 0) {
            console.warn('Downloaded catalog is missing required tables; retrying...');
            continue;
          }

          throw new Error('Downloaded catalog missing required tables after retry');
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (attempt === 0) continue;
          throw lastError;
        } finally {
          progress.setIsExtracting(false);
          if (db) {
            try {
              db.closeSync();
            } catch {
              // Best-effort close of a failed validation handle.
            }
          }
        }
      }

      throw lastError ?? new Error('Catalog download failed after retry');
    } catch (err) {
      progress.fail('catalog');
      if (isOfflineError(err)) {
        throw new Error(toOfflineMessage(false));
      }
      throw err;
    }
  });
}
