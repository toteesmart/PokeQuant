import type { EmbeddingMap, ScanCatalogCard } from '../../types/catalog';

export type VisualMatch = {
  card: ScanCatalogCard;
  score: number;
};

function hasNaN(vector: Float32Array): boolean {
  for (let i = 0; i < vector.length; i++) {
    if (Number.isNaN(vector[i])) return true;
  }
  return false;
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || hasNaN(a) || hasNaN(b)) return -1;
  const d = dot(a, b);
  const normA = Math.sqrt(dot(a, a));
  const normB = Math.sqrt(dot(b, b));
  if (normA === 0 || normB === 0) return -1;
  return d / (normA * normB);
}

// Large pools (a missed/garbled card number falls back to the full ~62k
// catalog) get a two-stage pass: the first 128 dims carry most of the
// discriminative signal, so a quarter-cost dot shortlists the pool for the
// full 512-dim ranking instead of scoring every card at full width.
const COARSE_DIMS = 128;
const COARSE_THRESHOLD = 500;
const COARSE_KEEP = 200;

export function findVisualMatches(
  query: Float32Array,
  catalog: ScanCatalogCard[],
  embeddings: EmbeddingMap,
  topK: number = 3
): VisualMatch[] {
  if (hasNaN(query)) return [];

  const start = Date.now();

  let pool = catalog;
  if (catalog.length > COARSE_THRESHOLD && query.length > COARSE_DIMS) {
    const idx: number[] = [];
    const coarse: number[] = [];
    for (let i = 0; i < catalog.length; i++) {
      const embedding = embeddings.get(catalog[i].productId);
      if (!embedding || embedding.length < COARSE_DIMS) continue;
      let s = 0;
      for (let d = 0; d < COARSE_DIMS; d++) s += query[d] * embedding[d];
      if (Number.isNaN(s)) continue;
      idx.push(i);
      coarse.push(s);
    }
    const order = coarse
      .map((_, i) => i)
      .sort((a, b) => coarse[b] - coarse[a])
      .slice(0, COARSE_KEEP);
    pool = order.map((oi) => catalog[idx[oi]]);
  }

  // Catalog and query embeddings are L2-normalized, so cosine = dot.
  // Keep only the top K to avoid allocating and sorting all N matches.
  const top: VisualMatch[] = [];

  for (const card of pool) {
    const embedding = embeddings.get(card.productId);
    if (!embedding) continue;

    const score = dot(query, embedding);
    if (Number.isNaN(score)) continue;

    if (top.length < topK) {
      top.push({ card, score });
      if (top.length === topK) {
        top.sort((a, b) => b.score - a.score);
      }
    } else if (score > top[topK - 1].score) {
      top[topK - 1] = { card, score };
      // Bubble into sorted position (small K, cheap).
      for (let i = topK - 1; i > 0 && top[i].score > top[i - 1].score; i--) {
        const tmp = top[i];
        top[i] = top[i - 1];
        top[i - 1] = tmp;
      }
    }
  }

  if (top.length && top.length < topK) {
    top.sort((a, b) => b.score - a.score);
  }

  console.log('findVisualMatches: computed', top.length, 'in', Date.now() - start, 'ms for', catalog.length, 'cards');
  return top;
}
