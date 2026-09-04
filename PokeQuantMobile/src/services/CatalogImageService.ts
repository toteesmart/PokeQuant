import type { NativeEventSubscription } from 'react-native';
import { Directory, File, Paths, type DownloadProgress } from 'expo-file-system';
import { unzip, subscribe } from 'react-native-zip-archive';
import { CATALOG_IMAGE_BASE, CATALOG_IMAGES_ZIP_URL } from '../constants/api';
import { useProgressStore } from '../store/progressStore';

const IMAGES_DIR_NAME = 'catalog_images';
const IMAGES_ZIP_NAME = 'catalog_images.zip';
const IMAGES_READY_NAME = 'catalog_images.ready';

const imagesDir = new Directory(Paths.document, IMAGES_DIR_NAME);
const imagesZipFile = new File(Paths.cache, IMAGES_ZIP_NAME);
const readyFile = new File(Paths.document, IMAGES_READY_NAME);

let extractionPromise: Promise<{ downloaded: boolean; extracted: number }> | null = null;
let extractedImagesDir: Directory = imagesDir;

function getImageFile(productId: number | string): File {
  return new File(extractedImagesDir, `${productId}.jpg`);
}

function discoverExtractedImageDirectory(): Directory {
  if (!imagesDir.exists) {
    return imagesDir;
  }

  try {
    const listing = imagesDir.list();
    const dirs = listing.filter((item) => item instanceof Directory);

    // Python's make_archive wraps files in a single root directory.
    // If the extraction produced exactly one directory, use it directly.
    if (dirs.length === 1 && listing.length === dirs.length) {
      return dirs[0] as Directory;
    }
  } catch (err) {
    console.warn('Failed to inspect extracted image directory:', err);
  }

  return imagesDir;
}

export function catalogImagesReady(): boolean {
  return readyFile.exists;
}

export function getCatalogImageUri(productId: number | string | null | undefined): string | undefined {
  const id =
    typeof productId === 'number'
      ? productId
      : Number.parseInt(String(productId), 10);
  if (Number.isNaN(id) || id <= 0) {
    return undefined;
  }

  if (readyFile.exists) {
    const imageFile = getImageFile(id);
    if (imageFile.exists) {
      return imageFile.uri;
    }
  }

  return `${CATALOG_IMAGE_BASE}/${id}_400w.jpg`;
}

export function getCatalogImageFallbackUrl(productId: number | string | null | undefined): string | undefined {
  const id =
    typeof productId === 'number'
      ? productId
      : Number.parseInt(String(productId), 10);
  if (Number.isNaN(id) || id <= 0) {
    return undefined;
  }
  return `${CATALOG_IMAGE_BASE}/${id}_400w.jpg`;
}

function cleanImageWorkspace(): void {
  try {
    if (imagesDir.exists) {
      imagesDir.delete();
    }
  } catch {
    // Best-effort cleanup.
  }

  imagesDir.create({ intermediates: true, idempotent: true });

  try {
    if (readyFile.exists) {
      readyFile.delete();
    }
  } catch {
    // Best-effort cleanup.
  }

  extractedImagesDir = imagesDir;
}

export async function ensureCatalogImagesDownloaded(
  force = false
): Promise<{ downloaded: boolean; extracted: number }> {
  if (!force && extractionPromise) {
    return extractionPromise;
  }

  if (!force && readyFile.exists) {
    return { downloaded: false, extracted: 0 };
  }

  const run = async (): Promise<{ downloaded: boolean; extracted: number }> => {
    const progress = useProgressStore.getState();
    let progressSub: NativeEventSubscription | null = null;

    try {
      cleanImageWorkspace();
      progress.startImageDownload();

      const cacheBustUrl = `${CATALOG_IMAGES_ZIP_URL}?v=${Date.now()}`;

      await File.downloadFileAsync(cacheBustUrl, imagesZipFile, {
        idempotent: true,
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
        },
        onProgress: (data: DownloadProgress) => {
          const pct =
            data.totalBytes > 0 ? data.bytesWritten / data.totalBytes : 0;
          progress.setImageDownloadProgress(pct);
        },
      });

      progress.setImageDownloadExtracting(0);
      progress.setIsExtracting(true);

      let lastProgress = 0;
      progressSub = subscribe(({ progress: unzipProgress }) => {
        lastProgress = unzipProgress;
        progress.setImageDownloadExtracting(unzipProgress);
      });

      const { closeCatalogDatabase, openCatalogDatabase } = await import(
        '../db/catalogDb'
      );
      await closeCatalogDatabase();

      await unzip(imagesZipFile.uri, imagesDir.uri);

      extractedImagesDir = discoverExtractedImageDirectory();

      readyFile.create({ overwrite: true });
      readyFile.write(String(Date.now()));

      await openCatalogDatabase();

      try {
        if (imagesZipFile.exists) {
          imagesZipFile.delete();
        }
      } catch {
        // Best-effort cleanup of the compressed archive.
      }

      progress.setImagesDownloaded();
      progress.setCatalogLastUpdated(Date.now());

      // Gracefully hide the header banner after a short delay.
      setTimeout(() => {
        progress.resetImageDownload();
      }, 1500);

      return { downloaded: true, extracted: 0 };
    } catch (err) {
      console.error('Catalog image download/extraction failed:', err);
      throw err;
    } finally {
      progress.setIsExtracting(false);
      progressSub?.remove();
      extractionPromise = null;
    }
  };

  extractionPromise = run();
  return extractionPromise;
}
