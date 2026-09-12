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

// Loads the precomputed binary sidecar downloaded by ScannerAssetService into
// a Map<productId, Float32Array> backed by zero-copy ArrayBuffer views.
// The manifest entry order must match the row order used by
// tools/build_embeddings.py, so row `i` sits at offset `i * dims * 4` in the
// binary blob.
export function loadBinarySidecar(): Promise<EmbeddingMap> {
  if (binaryPromise) return binaryPromise;
  binaryPromise = (async () => {
    const manifestFile = new File(getScannerAssetUri('catalog_embeddings/manifest.json'));
    const manifest = JSON.parse(await manifestFile.text()) as EmbeddingManifest;

    if (
      !manifest ||
      !Array.isArray(manifest.productIds) ||
      manifest.floatBytes !== 4
    ) {
      throw new Error('Invalid binary manifest');
    }

    const binFile = new File(getScannerAssetUri('catalog_embeddings/embeddings.bin'));
    const buffer = await binFile.arrayBuffer();
    const dims = manifest.dimension;
    const map: EmbeddingMap = new Map();

    manifest.productIds.forEach((productId, i) => {
      const start = manifest.offsets?.[i] ?? i * dims * 4;
      const view = new Float32Array(buffer, start, dims);
      map.set(productId, view);
    });

    console.log(`Loaded binary sidecar: ${map.size} embeddings (${dims} dims)`);
    embeddingsMap = map;
    return map;
  })();
  return binaryPromise;
}

export function getCurrentEmbeddings(): EmbeddingMap | null {
  return embeddingsMap;
}

// Kept for API parity with the standalone scanner — production uses only the
// downloaded sidecar, so this is a no-op.
export function startPrecompute(_catalog?: ScanCatalogCard[]): void {
  // No-op: embeddings come exclusively from the binary sidecar.
}
