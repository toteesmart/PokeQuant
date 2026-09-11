import * as FileSystem from 'expo-file-system/legacy';
import { getEmbeddingFromUri } from './VisualEmbedder';
import type { TestCatalogCard } from '../../types/catalog';

const EMBEDDINGS_FILE = 'visual_embeddings_v2.json';

export type EmbeddingMap = Map<number, Float32Array>;

type SerializedCache = Record<string, number[]>;

let ensurePromise: Promise<EmbeddingMap> | null = null;

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

async function computeEmbeddingForCard(card: TestCatalogCard): Promise<[number, Float32Array]> {
  const localUri = await ensureImageFile(card.imageUrl, card.productId);
  const embedding = await getEmbeddingFromUri(localUri);
  return [card.productId, embedding];
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
      map.set(Number(key), new Float32Array(values));
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
    serialized[productId] = Array.from(vector);
  }
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(serialized));
  console.log('EmbeddingCache: saved', map.size, 'embeddings');
}

async function buildEmbeddings(catalog: TestCatalogCard[]): Promise<EmbeddingMap> {
  const cached = await loadCachedEmbeddings();
  const map = cached ?? new Map<number, Float32Array>();

  const missing = catalog.filter((c) => !map.has(c.productId));
  if (missing.length === 0) return map;

  console.log('EmbeddingCache: computing', missing.length, 'missing embeddings');
  // Sequential on purpose: the visual embedder is not safe to run concurrently
  // and this avoids memory spikes during first-time catalog indexing.
  for (const card of missing) {
    const [productId, embedding] = await computeEmbeddingForCard(card);
    map.set(productId, embedding);
  }

  await saveCachedEmbeddings(map);
  return map;
}

export function ensureEmbeddings(catalog: TestCatalogCard[]): Promise<EmbeddingMap> {
  if (!ensurePromise) {
    ensurePromise = buildEmbeddings(catalog).finally(() => {
      ensurePromise = null;
    });
  }
  return ensurePromise;
}

export async function getCardEmbedding(card: TestCatalogCard): Promise<Float32Array> {
  const map = await ensureEmbeddings([card]);
  return map.get(card.productId)!;
}
