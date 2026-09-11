import type { TestCatalogCard } from '../../types/catalog';
import type { EmbeddingMap } from './EmbeddingCache';

export type VisualMatch = {
  card: TestCatalogCard;
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

export function findVisualMatches(
  query: Float32Array,
  catalog: TestCatalogCard[],
  embeddings: EmbeddingMap,
  topK: number = 3
): VisualMatch[] {
  if (hasNaN(query)) return [];

  // Catalog and query embeddings are L2-normalized, so cosine = dot.
  const matches: VisualMatch[] = [];
  for (const card of catalog) {
    const embedding = embeddings.get(card.productId);
    if (!embedding || hasNaN(embedding)) continue;
    const score = dot(query, embedding);
    if (Number.isNaN(score)) continue;
    matches.push({ card, score });
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, topK);
}
