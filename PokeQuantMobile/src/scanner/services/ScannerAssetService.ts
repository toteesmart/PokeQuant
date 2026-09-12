import { Paths, Directory, File, type DownloadProgress } from 'expo-file-system';
import {
  SCANNER_DETECTOR_MODEL_URL,
  SCANNER_EMBEDDER_MODEL_URL,
  SCANNER_SIDECAR_MANIFEST_URL,
  SCANNER_SIDECAR_BIN_URL,
} from '../../constants/api';
import { useProgressStore } from '../../store/progressStore';
import { isOfflineError, logError, logInfo, toOfflineMessage } from '../../utils/log';

// Bump when the sidecar or models are rebuilt so devices re-download.
const SCANNER_ASSET_VERSION = '1';

const scannerDir = new Directory(Paths.document, 'scanner');
const embeddingsDir = new Directory(scannerDir, 'catalog_embeddings');
const readyMarker = new File(scannerDir, '.ready');

// Optional dev fallback: files dropped into assets/scanner/ and embedded via
// the native bundle are copied instead of downloaded. Absent in normal builds,
// so this is a no-op unless the bundle was built with them.
const bundledScannerDir = new Directory(Paths.bundle, 'assets/scanner');

type ScannerAsset = {
  name: string;
  url: string;
  // Approximate byte size for progress weighting (the four files total ~141 MB).
  sizeHint: number;
};

const SCANNER_ASSETS: ScannerAsset[] = [
  { name: 'card_detector.tflite', url: SCANNER_DETECTOR_MODEL_URL, sizeHint: 5_300_000 },
  {
    name: 'mobileclip_s2_image_fp16.tflite',
    url: SCANNER_EMBEDDER_MODEL_URL,
    sizeHint: 71_700_000,
  },
  {
    name: 'catalog_embeddings/manifest.json',
    url: SCANNER_SIDECAR_MANIFEST_URL,
    sizeHint: 500_000,
  },
  {
    name: 'catalog_embeddings/embeddings.bin',
    url: SCANNER_SIDECAR_BIN_URL,
    sizeHint: 64_100_000,
  },
];

const TOTAL_SIZE_HINT = SCANNER_ASSETS.reduce((sum, a) => sum + a.sizeHint, 0);

function assetFile(name: string): File {
  return name.startsWith('catalog_embeddings/')
    ? new File(embeddingsDir, name.split('/')[1])
    : new File(scannerDir, name);
}

export function getScannerAssetUri(name: string): string {
  return assetFile(name).uri;
}

// Ready = marker written for the current version AND all four files on disk.
export async function areScannerAssetsReady(): Promise<boolean> {
  try {
    if (!readyMarker.exists) return false;
    const marker = await readyMarker.text();
    if (marker.trim() !== SCANNER_ASSET_VERSION) return false;
    return SCANNER_ASSETS.every((a) => assetFile(a.name).exists);
  } catch {
    return false;
  }
}

// Copy bundled copies for whichever assets are missing. Returns names copied.
function copyBundledAssets(): Set<string> {
  const copied = new Set<string>();
  try {
    if (!bundledScannerDir.exists) return copied;
    for (const asset of SCANNER_ASSETS) {
      const src = new File(bundledScannerDir, ...asset.name.split('/'));
      const dest = assetFile(asset.name);
      if (src.exists && !dest.exists) {
        dest.parentDirectory.create({ intermediates: true, idempotent: true });
        src.copy(dest);
        copied.add(asset.name);
      }
    }
  } catch (err) {
    logInfo('Scanner bundled-asset fallback skipped:', err);
  }
  return copied;
}

let scannerDownloadPromise: Promise<void> | null = null;

function trackScannerDownload(run: () => Promise<void>): Promise<void> {
  const tracked = run().finally(() => {
    if (scannerDownloadPromise === tracked) {
      scannerDownloadPromise = null;
    }
  });
  scannerDownloadPromise = tracked;
  return tracked;
}

export async function ensureScannerAssets(force = false): Promise<void> {
  const progress = useProgressStore.getState();

  if (scannerDownloadPromise) {
    return scannerDownloadPromise;
  }

  if (!force && (await areScannerAssetsReady())) {
    progress.setScannerAssetsReady(true);
    return;
  }

  return trackScannerDownload(async () => {
    scannerDir.create({ intermediates: true, idempotent: true });
    embeddingsDir.create({ intermediates: true, idempotent: true });

    try {
      progress.startScannerDownload();

      const bundled = copyBundledAssets();
      let completedBytes = SCANNER_ASSETS.filter((a) => bundled.has(a.name) || assetFile(a.name).exists)
        .reduce((sum, a) => sum + a.sizeHint, 0);

      for (const asset of SCANNER_ASSETS) {
        const dest = assetFile(asset.name);
        if (bundled.has(asset.name) || dest.exists) {
          continue;
        }
        const fileLabel =
          asset.name === 'card_detector.tflite'
            ? 'card detector model'
            : asset.name === 'mobileclip_s2_image_fp16.tflite'
              ? 'image embedder model'
              : 'card embeddings';
        const base = completedBytes;
        await File.downloadFileAsync(`${asset.url}?v=${Date.now()}`, dest, {
          idempotent: true,
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            Pragma: 'no-cache',
          },
          signal: AbortSignal.timeout(300_000),
          onProgress: (data: DownloadProgress) => {
            const pct = Math.min(
              1,
              (base + data.bytesWritten) / TOTAL_SIZE_HINT
            );
            progress.setScannerDownloadProgress(
              pct,
              `Downloading ${fileLabel}...`
            );
          },
        });
        completedBytes = base + asset.sizeHint;
      }

      readyMarker.create({ intermediates: true, overwrite: true });
      readyMarker.write(SCANNER_ASSET_VERSION);
      progress.setScannerDownloaded();
    } catch (err) {
      if (isOfflineError(err)) {
        logInfo('Offline: scanner asset download skipped.');
      } else {
        logError('Scanner asset download failed:', err);
      }
      progress.fail('scanner');
      if (isOfflineError(err)) {
        throw new Error(toOfflineMessage(false));
      }
      throw err;
    }
  });
}
