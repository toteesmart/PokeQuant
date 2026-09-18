import { File } from 'expo-file-system';
import type { EmbeddingMap, ScanCatalogCard } from '../../types/catalog';
import { getScannerAssetUri } from '../ScannerAssetService';

export type { EmbeddingMap };

// Sidecar manifest produced by tools/build_embeddings.py: parallel arrays of
// productIds and byte offsets into embeddings.bin.
type EmbeddingManifest = {
  dimension: number;
  floatBytes: number;
  count: number;
  productIds: number[];
  offsets?: number[];
};

let embeddingsMap: EmbeddingMap | null = null;
let binaryPromise: Promise<EmbeddingMap> | null = null;
let jpMerged = false;

// Reads one manifest+embeddings.bin pair into the target map. Each pair gets
// its own ArrayBuffer so the Float32Array views stay zero-copy.
async function loadSidecarPair(
  dir: string,
  map: EmbeddingMap
): Promise<number> {
  const manifestFile = new File(getScannerAssetUri(`${dir}/manifest.json`));
  const manifest = JSON.parse(await manifestFile.text()) as EmbeddingManifest;

  if (
    !manifest ||
    !Array.isArray(manifest.productIds) ||
    manifest.floatBytes !== 4
  ) {
    throw new Error(`Invalid binary manifest: ${dir}`);
  }

  const binFile = new File(getScannerAssetUri(`${dir}/embeddings.bin`));
  const buffer = await binFile.arrayBuffer();
  const dims = manifest.dimension;

  manifest.productIds.forEach((productId, i) => {
    const start = manifest.offsets?.[i] ?? i * dims * 4;
    const view = new Float32Array(buffer, start, dims);
    map.set(productId, view);
  });
  return manifest.productIds.length;
}

// Loads the precomputed binary sidecar downloaded by ScannerAssetService into
// a Map<productId, Float32Array> backed by zero-copy ArrayBuffer views.
// The manifest entry order must match the row order used by
// tools/build_embeddings.py, so row `i` sits at offset `i * dims * 4` in the
// binary blob. When the optional Japanese sidecar is on disk, its rows merge
// into the same map — product IDs are globally unique, so no key can collide.
export async function loadBinarySidecar(): Promise<EmbeddingMap> {
  if (!binaryPromise) {
    binaryPromise = (async () => {
      const map: EmbeddingMap = new Map();
      const enCount = await loadSidecarPair('catalog_embeddings', map);

      const jpManifestFile = new File(
        getScannerAssetUri('catalog_embeddings_jp/manifest.json')
      );
      let jpCount = 0;
      if (jpManifestFile.exists) {
        jpCount = await loadSidecarPair('catalog_embeddings_jp', map);
        jpMerged = jpCount > 0;
      }

      console.log(
        `Loaded binary sidecar: ${map.size} embeddings (en=${enCount} jp=${jpCount})`
      );
      embeddingsMap = map;
      return map;
    })();
  }

  const map = await binaryPromise;
  // The optional JP sidecar can arrive mid-session (it downloads only after
  // the JP image pack is installed). Merge it on the next access instead of
  // serving a stale EN-only map until restart. A partially-downloaded pair
  // (manifest written, bin still in flight) just retries next call.
  if (!jpMerged) {
    const jpManifestFile = new File(
      getScannerAssetUri('catalog_embeddings_jp/manifest.json')
    );
    if (jpManifestFile.exists) {
      try {
        const jpCount = await loadSidecarPair('catalog_embeddings_jp', map);
        if (jpCount > 0) {
          jpMerged = true;
          console.log(`Merged JP sidecar: ${jpCount} embeddings (total ${map.size})`);
        }
      } catch (e) {
        console.warn('JP sidecar merge deferred:', e);
      }
    }
  }
  return map;
}

export function getCurrentEmbeddings(): EmbeddingMap | null {
  return embeddingsMap;
}

// Kept for API parity with the standalone scanner — production uses only the
// downloaded sidecar, so this is a no-op.
export function startPrecompute(_catalog?: ScanCatalogCard[]): void {
  // No-op: embeddings come exclusively from the binary sidecar.
}
