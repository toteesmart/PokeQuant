import type { NativeEventSubscription } from 'react-native';
import { Directory, File, Paths, type DownloadProgress } from 'expo-file-system';
import { unzip, subscribe } from 'react-native-zip-archive';
import {
  CATALOG_IMAGE_BASE,
  CATALOG_IMAGES_JP_ZIP_URL,
  CATALOG_IMAGES_ZIP_URL,
} from '../constants/api';
import { useProgressStore } from '../store/progressStore';

type ImagePack = {
  dir: Directory;
  zipFile: File;
  readyFile: File;
  manifestFile: File;
  zipUrl: string;
  extractionPromise: Promise<{ downloaded: boolean; extracted: number }> | null;
  extractedDir: Directory;
  extractedIds: Set<number> | null;
};

function createPack(
  dirName: string,
  zipName: string,
  readyName: string,
  manifestName: string,
  zipUrl: string
): ImagePack {
  const dir = new Directory(Paths.document, dirName);
  return {
    dir,
    zipFile: new File(Paths.cache, zipName),
    readyFile: new File(Paths.document, readyName),
    manifestFile: new File(Paths.document, manifestName),
    zipUrl,
    extractionPromise: null,
    extractedDir: dir,
    extractedIds: null,
  };
}

const enPack = createPack(
  'catalog_images',
  'catalog_images.zip',
  'catalog_images.ready',
  'catalog_images.manifest',
  CATALOG_IMAGES_ZIP_URL
);
const jpPack = createPack(
  'catalog_images_jp',
  'catalog_images_jp.zip',
  'catalog_images_jp.ready',
  'catalog_images_jp.manifest',
  CATALOG_IMAGES_JP_ZIP_URL
);

function refreshExtractedImageCache(pack: ImagePack): Set<number> {
  const ids = new Set<number>();
  pack.extractedIds = ids;
  if (!pack.extractedDir.exists) return ids;

  try {
    for (const item of pack.extractedDir.list()) {
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

// Product IDs are unique across languages, so the JP index is checked first
// and anything absent falls through to the English directory.
function getImageFile(productId: number | string): File {
  const id =
    typeof productId === 'number'
      ? productId
      : Number.parseInt(String(productId), 10);
  if (jpPack.extractedIds?.has(id)) {
    return new File(jpPack.extractedDir, `${id}.jpg`);
  }
  return new File(enPack.extractedDir, `${id}.jpg`);
}

function writeExtractedImageManifest(pack: ImagePack): void {
  try {
    const dirName =
      pack.extractedDir === pack.dir ? '' : pack.extractedDir.name;
    pack.manifestFile.create({ intermediates: true, overwrite: true });
    pack.manifestFile.write(
      JSON.stringify({ dir: dirName, ids: [...(pack.extractedIds ?? [])] })
    );
  } catch (err) {
    console.warn('Failed to write catalog image manifest:', err);
  }
}

async function readExtractedImageManifest(pack: ImagePack): Promise<{
  dir: string;
  ids: number[];
} | null> {
  try {
    if (!pack.manifestFile.exists) return null;
    const parsed = JSON.parse(await pack.manifestFile.text()) as {
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

// Populates a pack's extracted-image index once. The manifest (written at
// extraction time) makes returning launches a single small file read instead
// of a full directory scan; a manifest hit also restores a lost ready marker,
// since the manifest is only written after a completed extraction.
async function warmPackImageIndex(pack: ImagePack): Promise<void> {
  if (pack.extractedIds) return;
  // Never index a directory that is mid-extraction — wait for it instead; a
  // completed extraction populates extractedIds itself.
  if (pack.extractionPromise) {
    try {
      await pack.extractionPromise;
    } catch {
      // The caller surfaces extraction failures separately.
    }
    if (pack.extractedIds) return;
  }

  const manifest = await readExtractedImageManifest(pack);
  if (manifest) {
    const dir = manifest.dir
      ? new Directory(pack.dir, manifest.dir)
      : pack.dir;
    if (dir.exists) {
      pack.extractedDir = dir;
      pack.extractedIds = new Set(manifest.ids);
      if (!pack.readyFile.exists && manifest.ids.length > 0) {
        try {
          pack.readyFile.create({ overwrite: true });
          pack.readyFile.write(String(Date.now()));
        } catch {
          // Best-effort marker restore.
        }
      }
      return;
    }
    // Manifest is stale (files were removed) — fall through to a real scan.
  }

  if (!pack.readyFile.exists) return;
  pack.extractedDir = discoverExtractedImageDirectory(pack);
  const scanned = refreshExtractedImageCache(pack);
  if (scanned.size > 0) {
    writeExtractedImageManifest(pack);
  }
}

// Called by the setup gate before any screen renders so image resolution is
// synchronous and correct for the whole session. Warms both the English and
// the optional Japanese pack indexes.
export async function warmCatalogImageIndex(): Promise<void> {
  await warmPackImageIndex(enPack);
  await warmPackImageIndex(jpPack);
}

function discoverExtractedImageDirectory(pack: ImagePack): Directory {
  if (!pack.dir.exists) {
    return pack.dir;
  }

  try {
    const listing = pack.dir.list();
    const dirs = listing.filter((item) => item instanceof Directory);

    // Python's make_archive wraps files in a single root directory.
    // If the extraction produced exactly one directory, use it directly.
    if (dirs.length === 1 && listing.length === dirs.length) {
      return dirs[0] as Directory;
    }
  } catch (err) {
    console.warn('Failed to inspect extracted image directory:', err);
  }

  return pack.dir;
}

export function catalogImagesReady(): boolean {
  return enPack.readyFile.exists;
}

export function catalogJpImagesReady(): boolean {
  return jpPack.readyFile.exists;
}

// Lazily builds a pack's index on first lookup when its ready marker exists
// (e.g. callers that run before the setup gate's warm pass finishes).
function ensureIndexed(pack: ImagePack): void {
  // Check the in-memory index first: readyFile.exists is a native stat, and
  // callers like the scanner warm-up resolve tens of thousands of URIs.
  if (pack.extractedIds || !pack.readyFile.exists) return;
  pack.extractedDir = discoverExtractedImageDirectory(pack);
  refreshExtractedImageCache(pack);
}

function localImageUri(
  productId: number | string | null | undefined
): string | undefined {
  const id =
    typeof productId === 'number'
      ? productId
      : Number.parseInt(String(productId), 10);
  if (Number.isNaN(id) || id <= 0) {
    return undefined;
  }

  ensureIndexed(enPack);
  ensureIndexed(jpPack);
  if (enPack.extractedIds?.has(id) || jpPack.extractedIds?.has(id)) {
    return getImageFile(id).uri;
  }
  return undefined;
}

export function getCatalogImageUri(productId: number | string | null | undefined): string | undefined {
  const id =
    typeof productId === 'number'
      ? productId
      : Number.parseInt(String(productId), 10);
  if (Number.isNaN(id) || id <= 0) {
    return undefined;
  }

  return localImageUri(id) ?? `${CATALOG_IMAGE_BASE}/${id}_400w.jpg`;
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
  return localImageUri(productId);
}

// Wipes and recreates one pack's workspace. Scoped per pack so reinstalling
// the English pack never deletes downloaded Japanese images (and vice versa).
function cleanImageWorkspace(pack: ImagePack): void {
  try {
    if (pack.dir.exists) {
      pack.dir.delete();
    }
  } catch {
    // Best-effort cleanup.
  }

  pack.dir.create({ intermediates: true, idempotent: true });

  try {
    if (pack.readyFile.exists) {
      pack.readyFile.delete();
    }
  } catch {
    // Best-effort cleanup.
  }

  try {
    if (pack.manifestFile.exists) {
      pack.manifestFile.delete();
    }
  } catch {
    // Best-effort cleanup.
  }

  pack.extractedDir = pack.dir;
  pack.extractedIds = null;
}

async function ensurePackDownloaded(
  pack: ImagePack,
  force: boolean
): Promise<{ downloaded: boolean; extracted: number }> {
  if (!force && pack.extractionPromise) {
    return pack.extractionPromise;
  }

  if (!force && pack.readyFile.exists) {
    return { downloaded: false, extracted: 0 };
  }

  const run = async (): Promise<{ downloaded: boolean; extracted: number }> => {
    const progress = useProgressStore.getState();
    let progressSub: NativeEventSubscription | null = null;

    try {
      cleanImageWorkspace(pack);
      progress.startImageDownload();

      const cacheBustUrl = `${pack.zipUrl}?v=${Date.now()}`;

      await File.downloadFileAsync(cacheBustUrl, pack.zipFile, {
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

      await unzip(pack.zipFile.uri, pack.dir.uri);

      pack.extractedDir = discoverExtractedImageDirectory(pack);
      refreshExtractedImageCache(pack);
      writeExtractedImageManifest(pack);

      pack.readyFile.create({ overwrite: true });
      pack.readyFile.write(String(Date.now()));

      try {
        if (pack.zipFile.exists) {
          pack.zipFile.delete();
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
      pack.extractionPromise = null;
    }
  };

  pack.extractionPromise = run();
  return pack.extractionPromise;
}

export async function ensureCatalogImagesDownloaded(
  force = false
): Promise<{ downloaded: boolean; extracted: number }> {
  return ensurePackDownloaded(enPack, force);
}

export async function ensureJpImagesDownloaded(
  force = false
): Promise<{ downloaded: boolean; extracted: number }> {
  return ensurePackDownloaded(jpPack, force);
}
