import { Paths, Directory, File, type DownloadProgress } from 'expo-file-system';
import { deleteAsync } from 'expo-file-system/legacy';
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

  ensureCatalogImagesDownloaded(force).catch((err) =>
    console.warn('Background catalog image download failed:', err)
  );

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

    return { exists: true, path: catalogFile.uri, downloaded: true };
  } finally {
    progress.setIsExtracting(false);
  }
}

export async function downloadLatestMarketPrices(): Promise<CatalogDownloadStatus> {
  catalogDir.create({ intermediates: true, idempotent: true });

  const { closeCatalogDatabase, setCatalogDatabase } = await import('../db/catalogDb');
  const { openDatabaseSync } = await import('expo-sqlite');
  const progress = useProgressStore.getState();

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

    const db = openDatabaseSync(CATALOG_FILE_NAME);
    setCatalogDatabase(db);
    progress.setCatalogReady(true);

    progress.setCatalogLastUpdated(Date.now());
    progress.setCatalogDownloaded();

    return { exists: true, path: catalogFile.uri, downloaded: true };
  } finally {
    progress.setIsExtracting(false);
  }
}
