import * as FileSystem from 'expo-file-system/legacy';
import { getEmbeddingFromUri } from './VisualEmbedder';
import type { TestCatalogCard } from '../../types/catalog';

const EMBEDDINGS_FILE = 'visual_embeddings_v2.json';

export type EmbeddingMap = Map<number, Float32Array>;

type SerializedCache = Record<string, number[]>;

let sharedMap: EmbeddingMap | null = null;
let buildPromise: Promise<EmbeddingMap> | null = null;
let startedCatalog: TestCatalogCard[] | null = null;

function getCacheUri(): string {
  return FileSystem.documentDirectory
    ? `${FileSystem.documentDirectory}${EMBEDDINGS_FILE}`
    : '';
}

async function ensureImageFile(imageUrl: string, productId: number): Promise<string> {
  const filename = `catalog_image_${productId}.jpg`;
  const localUri = `${FileSystem.cacheDirectory}${filename}`;

  const exists = await FileSystem.getInfoAsync(localUri);
  if (exists.exists) {
    return localUri;
  }

  console.log('EmbeddingCache: downloading', imageUrl);
  const result = await FileSystem.downloadAsync(imageUrl, localUri);
  if (result.status !== 200) {
    throw new Error(`Failed to download catalog image: ${imageUrl}`);
  }
  return localUri;
}

async function computeEmbeddingForCard(card: TestCatalogCard): Promise<[number, Float32Array] | null> {
  const localUri = await ensureImageFile(card.imageUrl, card.productId);
  const embedding = await getEmbeddingFromUri(localUri);
  if (hasNaN(embedding)) {
    console.warn('EmbeddingCache: NaN embedding for', card.productId, card.name, 'skipping');
    return null;
  }
  return [card.productId, embedding];
}

function hasNaN(vector: Float32Array): boolean {
  for (let i = 0; i < vector.length; i++) {
    if (Number.isNaN(vector[i])) return true;
  }
  return false;
}

async function loadCachedEmbeddings(): Promise<EmbeddingMap | null> {
  const uri = getCacheUri();
  if (!uri) return null;

  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) return null;

  try {
    const text = await FileSystem.readAsStringAsync(uri);
    const parsed: SerializedCache = JSON.parse(text);
    const map = new Map<number, Float32Array>();
    for (const [key, values] of Object.entries(parsed)) {
      const vector = new Float32Array(values);
      if (!hasNaN(vector)) {
        map.set(Number(key), vector);
      }
    }
    console.log('EmbeddingCache: loaded', map.size, 'cached embeddings');
    return map;
  } catch (e) {
    console.warn('EmbeddingCache: failed to read cache', e);
    return null;
  }
}

async function saveCachedEmbeddings(map: EmbeddingMap): Promise<void> {
  const uri = getCacheUri();
  if (!uri) return;

  const serialized: SerializedCache = {};
  for (const [productId, vector] of map.entries()) {
    if (!hasNaN(vector)) {
      serialized[productId] = Array.from(vector);
    }
  }
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(serialized));
  console.log('EmbeddingCache: saved', map.size, 'embeddings');
}

async function buildEmbeddings(catalog: TestCatalogCard[]): Promise<EmbeddingMap> {
  if (!sharedMap) {
    const cached = await loadCachedEmbeddings();
    sharedMap = cached ?? new Map<number, Float32Array>();
  }

  const missing = catalog.filter((c) => !sharedMap!.has(c.productId));
  if (missing.length === 0) return sharedMap;

  console.log('EmbeddingCache: computing', missing.length, 'missing embeddings');
  for (const card of missing) {
    try {
      const result = await computeEmbeddingForCard(card);
      if (result) {
        sharedMap.set(result[0], result[1]);
      }
    } catch (e) {
      console.warn('EmbeddingCache: failed to compute embedding for', card.productId, e);
    }
  }

  await saveCachedEmbeddings(sharedMap);
  return sharedMap;
}

export function getCurrentEmbeddings(): EmbeddingMap | null {
  return sharedMap;
}

export function startPrecompute(catalog: TestCatalogCard[]): void {
  if (startedCatalog) return;
  startedCatalog = catalog;
  ensureEmbeddings(catalog).catch((e) => {
    console.warn('EmbeddingCache: precompute failed', e);
  });
}

export function ensureEmbeddings(catalog: TestCatalogCard[]): Promise<EmbeddingMap> {
  if (startedCatalog && startedCatalog !== catalog) {
    // Catalog changed; rebuild from scratch when requested.
    sharedMap = null;
    buildPromise = null;
  }
  startedCatalog = catalog;

  if (!buildPromise) {
    buildPromise = buildEmbeddings(catalog).finally(() => {
      buildPromise = null;
    });
  }
  return buildPromise;
}

export async function getCardEmbedding(card: TestCatalogCard): Promise<Float32Array> {
  const map = await ensureEmbeddings([card]);
  return map.get(card.productId)!;
}
