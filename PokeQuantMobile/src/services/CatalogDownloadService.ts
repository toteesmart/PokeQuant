import { Paths, Directory, File } from 'expo-file-system';
import { CATALOG_DOWNLOAD_URL } from '../constants/api';
import { ensureCatalogImagesDownloaded } from './CatalogImageService';

export const CATALOG_FILE_NAME = 'pokequant_catalog.db';

const catalogDir = new Directory(Paths.document, 'SQLite');
const catalogFile = new File(catalogDir, CATALOG_FILE_NAME);

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

  if (!force && catalogFile.exists) {
    return { exists: true, path: catalogFile.uri, downloaded: false };
  }

  const cacheBustUrl = `${CATALOG_DOWNLOAD_URL}?v=${Date.now()}`;

  await File.downloadFileAsync(cacheBustUrl, catalogFile, {
    idempotent: true,
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    },
  });

  return { exists: true, path: catalogFile.uri, downloaded: true };
}
