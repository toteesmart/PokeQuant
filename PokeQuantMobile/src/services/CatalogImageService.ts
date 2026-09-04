import { Directory, File, Paths } from 'expo-file-system';
import { Unzip, UnzipInflate } from 'fflate';
import { CATALOG_IMAGE_BASE, CATALOG_IMAGES_ZIP_URL } from '../constants/api';

const IMAGES_DIR_NAME = 'catalog_images';
const IMAGES_ZIP_NAME = 'catalog_images.zip';
const IMAGES_READY_NAME = 'catalog_images.ready';

const imagesDir = new Directory(Paths.document, IMAGES_DIR_NAME);
const imagesZipFile = new File(Paths.cache, IMAGES_ZIP_NAME);
const readyFile = new File(Paths.document, IMAGES_READY_NAME);

let extractionPromise: Promise<{ downloaded: boolean; extracted: number }> | null = null;

function getImageFile(productId: number | string): File {
  return new File(imagesDir, `${productId}.jpg`);
}

function stripDirPrefix(name: string): string {
  // Python's make_archive may emit entries with a leading directory name.
  const slash = name.indexOf('/');
  if (slash >= 0) {
    return name.slice(slash + 1);
  }
  return name;
}

async function extractCatalogZip(zipFile: File, destDir: Directory): Promise<number> {
  destDir.create({ intermediates: true, idempotent: true });

  let extracted = 0;

  const unzip = new Unzip((file) => {
    const name = stripDirPrefix(file.name);
    if (!name || file.name.endsWith('/')) {
      return;
    }

    const outFile = new File(destDir, name);
    let created = false;

    file.ondata = (err, chunk, final) => {
      if (err) {
        console.warn(`Failed to decompress ${file.name}:`, err.message);
        return;
      }
      try {
        if (!created) {
          outFile.create({ overwrite: true });
          created = true;
        }
        if (chunk && chunk.length > 0) {
          outFile.write(chunk, { append: true });
        }
        if (final) {
          extracted += 1;
        }
      } catch (writeErr) {
        console.warn(`Failed to write image ${name}:`, (writeErr as Error).message);
      }
    };

    file.start();
  });

  unzip.register(UnzipInflate);

  const stream = zipFile.readableStream();
  const reader = stream.getReader();

  while (true) {
    const { done, value } = await reader.read();
    unzip.push(value ?? new Uint8Array(0), done);
    if (done) break;
  }

  return extracted;
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
    try {
      if (imagesDir.exists && (force || readyFile.exists)) {
        imagesDir.delete();
      }
      imagesDir.create({ intermediates: true, idempotent: true });

      if (readyFile.exists) {
        readyFile.delete();
      }

      const cacheBustUrl = `${CATALOG_IMAGES_ZIP_URL}?v=${Date.now()}`;

      await File.downloadFileAsync(cacheBustUrl, imagesZipFile, {
        idempotent: true,
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
        },
      });

      const extracted = await extractCatalogZip(imagesZipFile, imagesDir);
      readyFile.create({ overwrite: true });
      readyFile.write(String(Date.now()));

      try {
        if (imagesZipFile.exists) {
          imagesZipFile.delete();
        }
      } catch {
        // Best-effort cleanup of the compressed archive.
      }

      return { downloaded: true, extracted };
    } catch (err) {
      console.error('Catalog image download/extraction failed:', err);
      throw err;
    } finally {
      extractionPromise = null;
    }
  };

  extractionPromise = run();
  return extractionPromise;
}
