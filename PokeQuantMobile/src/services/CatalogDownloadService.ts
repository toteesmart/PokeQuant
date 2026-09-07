import { Paths, Directory, File, type DownloadProgress } from 'expo-file-system';
import { deleteAsync } from 'expo-file-system/legacy';
import type { SQLiteDatabase } from 'expo-sqlite';
import { CATALOG_DOWNLOAD_URL } from '../constants/api';
import { useProgressStore } from '../store/progressStore';
import { ensureCatalogImagesDownloaded } from './CatalogImageService';

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
      await deleteAsync(file.uri, { idempotent: true });
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

export async function ensureCatalogDownloaded(
  force = false
): Promise<CatalogDownloadStatus> {
  catalogDir.create({ intermediates: true, idempotent: true });

  const progress = useProgressStore.getState();

  if (!force && catalogFile.exists) {
    progress.setCatalogReady(true);
    return { exists: true, path: catalogFile.uri, downloaded: false };
  }

  const { closeCatalogDatabase } = await import('../db/catalogDb');

  try {
    await closeCatalogDatabase();
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
      onProgress: (data: DownloadProgress) => {
        const pct =
          data.totalBytes > 0 ? data.bytesWritten / data.totalBytes : 0;
        progress.setCatalogDownloadProgress(pct);
      },
    });

    progress.setCatalogLastUpdated(Date.now());
    progress.setCatalogDownloaded();
    progress.setCatalogReady(true);

    // Only fetch the image archive when a catalog DB download actually happens.
    ensureCatalogImagesDownloaded(force).catch((err) =>
      console.warn('Background catalog image download failed:', err)
    );

    return { exists: true, path: catalogFile.uri, downloaded: true };
  } finally {
    progress.setIsExtracting(false);
  }
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
  catalogDir.create({ intermediates: true, idempotent: true });

  const { closeCatalogDatabase, setCatalogDatabase } = await import('../db/catalogDb');
  const { openDatabaseSync } = await import('expo-sqlite');
  const progress = useProgressStore.getState();

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await closeCatalogDatabase();
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
        onProgress: (data: DownloadProgress) => {
          const pct =
            data.totalBytes > 0 ? data.bytesWritten / data.totalBytes : 0;
          progress.setCatalogDownloadProgress(pct);
        },
      });

      const db = openDatabaseSync(CATALOG_FILE_NAME) as SQLiteDatabase;

      if (await validateCatalogTables(db)) {
        setCatalogDatabase(db);
        progress.setCatalogReady(true);
        progress.setCatalogLastUpdated(Date.now());
        progress.setCatalogDownloaded();

        // Only kick off the image archive once the catalog DB is validated.
        ensureCatalogImagesDownloaded().catch((err) =>
          console.warn('Background catalog image download failed:', err)
        );

        return { exists: true, path: catalogFile.uri, downloaded: true };
      }

      if (attempt === 0) {
        console.warn('Downloaded catalog is missing required tables; retrying...');
        continue;
      }

      throw new Error('Downloaded catalog missing required tables after retry');
    } finally {
      progress.setIsExtracting(false);
    }
  }

  throw new Error('Catalog download failed after retry');
}
