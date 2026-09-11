import * as FileSystem from 'expo-file-system/legacy';
import { getEmbeddingFromUri } from './VisualEmbedder';
import type { TestCatalogCard } from '../../types/catalog';

const EMBEDDINGS_FILE = 'visual_embeddings_v2.json';

export type EmbeddingMap = Map<number, Float32Array>;

type SerializedCache = Record<string, number[]>;

function getCacheUri(): string {
  return FileSystem.documentDirectory
    ? `${FileSystem.documentDirectory}${EMBEDDINGS_FILE}`
    : '';
}

function stripFileScheme(uri: string): string {
  return uri.replace(/^file:\/\//, '');
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

export async function ensureEmbeddings(catalog: TestCatalogCard[]): Promise<EmbeddingMap> {
  const cached = await loadCachedEmbeddings();
  const map = cached ?? new Map<number, Float32Array>();

  const missing = catalog.filter((c) => !map.has(c.productId));
  if (missing.length === 0) return map;

  console.log('EmbeddingCache: computing', missing.length, 'missing embeddings');
  const computed = await Promise.all(missing.map(computeEmbeddingForCard));
  for (const [productId, embedding] of computed) {
    map.set(productId, embedding);
  }

  await saveCachedEmbeddings(map);
  return map;
}

export async function getCardEmbedding(card: TestCatalogCard): Promise<Float32Array> {
  const map = await ensureEmbeddings([card]);
  return map.get(card.productId)!;
}
