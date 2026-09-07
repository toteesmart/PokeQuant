import type { NativeEventSubscription } from 'react-native';
import { Directory, File, Paths, type DownloadProgress } from 'expo-file-system';
import { unzip, subscribe } from 'react-native-zip-archive';
import { CATALOG_IMAGE_BASE, CATALOG_IMAGES_ZIP_URL } from '../constants/api';
import { useProgressStore } from '../store/progressStore';

const IMAGES_DIR_NAME = 'catalog_images';
const IMAGES_ZIP_NAME = 'catalog_images.zip';
const IMAGES_READY_NAME = 'catalog_images.ready';
const IMAGES_MANIFEST_NAME = 'catalog_images.manifest';

const imagesDir = new Directory(Paths.document, IMAGES_DIR_NAME);
const imagesZipFile = new File(Paths.cache, IMAGES_ZIP_NAME);
const readyFile = new File(Paths.document, IMAGES_READY_NAME);
const manifestFile = new File(Paths.document, IMAGES_MANIFEST_NAME);

let extractionPromise: Promise<{ downloaded: boolean; extracted: number }> | null = null;
let extractedImagesDir: Directory = imagesDir;
let extractedImageIds: Set<number> | null = null;

function refreshExtractedImageCache(): Set<number> {
  const ids = new Set<number>();
  extractedImageIds = ids;
  if (!extractedImagesDir.exists) return ids;

  try {
    for (const item of extractedImagesDir.list()) {
      if (!(item instanceof File)) continue;
      const name = item.name;
      if (!name.toLowerCase().endsWith('.jpg')) continue;
      const id = Number.parseInt(name.replace(/\.jpg$/i, ''), 10);
      if (!Number.isNaN(id) && id > 0) {
        ids.add(id);
      }
    }
  } catch (err) {
    console.warn('Failed to index extracted catalog images:', err);
  }
  return ids;
}

function getImageFile(productId: number | string): File {
  return new File(extractedImagesDir, `${productId}.jpg`);
}

function writeExtractedImageManifest(): void {
  try {
    const dirName =
      extractedImagesDir === imagesDir ? '' : extractedImagesDir.name;
    manifestFile.create({ intermediates: true, overwrite: true });
    manifestFile.write(
      JSON.stringify({ dir: dirName, ids: [...(extractedImageIds ?? [])] })
    );
  } catch (err) {
    console.warn('Failed to write catalog image manifest:', err);
  }
}

async function readExtractedImageManifest(): Promise<{
  dir: string;
  ids: number[];
} | null> {
  try {
    if (!manifestFile.exists) return null;
    const parsed = JSON.parse(await manifestFile.text()) as {
      dir?: unknown;
      ids?: unknown;
    };
    if (!parsed || !Array.isArray(parsed.ids)) return null;
    const ids = parsed.ids.filter(
      (id): id is number =>
        typeof id === 'number' && Number.isFinite(id) && id > 0
    );
    return { dir: typeof parsed.dir === 'string' ? parsed.dir : '', ids };
  } catch {
    return null;
  }
}

// Populates the extracted-image index once. Called by the setup gate before
// any screen renders so image resolution is synchronous and correct for the
// whole session. The manifest (written at extraction time) makes returning
// launches a single small file read instead of a full directory scan; a
// manifest hit also restores a lost ready marker, since the manifest is only
// written after a completed extraction.
export async function warmCatalogImageIndex(): Promise<void> {
  if (extractedImageIds) return;
  // Never index a directory that is mid-extraction — wait for it instead; a
  // completed extraction populates extractedImageIds itself.
  if (extractionPromise) {
    try {
      await extractionPromise;
    } catch {
      // The caller surfaces extraction failures separately.
    }
    if (extractedImageIds) return;
  }

  const manifest = await readExtractedImageManifest();
  if (manifest) {
    const dir = manifest.dir
      ? new Directory(imagesDir, manifest.dir)
      : imagesDir;
    if (dir.exists) {
      extractedImagesDir = dir;
      extractedImageIds = new Set(manifest.ids);
      if (!readyFile.exists && manifest.ids.length > 0) {
        try {
          readyFile.create({ overwrite: true });
          readyFile.write(String(Date.now()));
        } catch {
          // Best-effort marker restore.
        }
      }
      return;
    }
    // Manifest is stale (files were removed) — fall through to a real scan.
  }

  if (!readyFile.exists) return;
  extractedImagesDir = discoverExtractedImageDirectory();
  const scanned = refreshExtractedImageCache();
  if (scanned.size > 0) {
    writeExtractedImageManifest();
  }
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
    if (!extractedImageIds) {
      extractedImagesDir = discoverExtractedImageDirectory();
      refreshExtractedImageCache();
    }
    if (extractedImageIds?.has(id)) {
      return getImageFile(id).uri;
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

export function getLocalCatalogImageUri(productId: number | string | null | undefined): string | undefined {
  const id =
    typeof productId === 'number'
      ? productId
      : Number.parseInt(String(productId), 10);
  if (Number.isNaN(id) || id <= 0) {
    return undefined;
  }

  if (readyFile.exists) {
    if (!extractedImageIds) {
      extractedImagesDir = discoverExtractedImageDirectory();
      refreshExtractedImageCache();
    }
    if (extractedImageIds?.has(id)) {
      return getImageFile(id).uri;
    }
  }

  return undefined;
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

  try {
    if (manifestFile.exists) {
      manifestFile.delete();
    }
  } catch {
    // Best-effort cleanup.
  }

  extractedImagesDir = imagesDir;
  extractedImageIds = null;
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
        signal: AbortSignal.timeout(120_000),
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

      await unzip(imagesZipFile.uri, imagesDir.uri);

      extractedImagesDir = discoverExtractedImageDirectory();
      refreshExtractedImageCache();
      writeExtractedImageManifest();

      readyFile.create({ overwrite: true });
      readyFile.write(String(Date.now()));

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
      progress.fail('image');
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
