import { findVisualMatches } from '../src/scanner/services/visual/visualMatcher';

const DIM = 512;

// Deterministic unit-norm vectors — distinct but reproducible.
function mkVec(seed: number): Float32Array {
  const v = new Float32Array(DIM);
  for (let i = 0; i < DIM; i++) {
    v[i] = Math.sin(seed * 31.7 + i * 7.13 + seed * i * 0.001);
  }
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < DIM; i++) v[i] /= n;
  return v;
}

const card = (productId: number) =>
  ({ productId, name: `c${productId}`, number: '', set: '', rarity: '', imageUrl: '', variants: [] } as any);

test('coarse pass keeps the true top match in a large pool', () => {
  const catalog = [];
  const embeddings = new Map<number, Float32Array>();
  for (let i = 0; i < 600; i++) {
    catalog.push(card(i));
    embeddings.set(i, mkVec(i + 1));
  }
  // Query is identical to card 555's vector — dot 1.0, must survive the
  // 128-dim coarse shortlist and win the full re-rank.
  const top = findVisualMatches(mkVec(556), catalog, embeddings, 3);
  expect(top.length).toBe(3);
  expect(top[0].card.productId).toBe(555);
  expect(top[0].score).toBeCloseTo(1, 4);
});

test('small pools skip the coarse pass entirely', () => {
  const catalog = [card(1), card(2)];
  const embeddings = new Map<number, Float32Array>([
    [1, mkVec(10)],
    [2, mkVec(20)],
  ]);
  const top = findVisualMatches(mkVec(20), catalog, embeddings, 1);
  expect(top[0].card.productId).toBe(2);
});

test('cards without embeddings are skipped in both passes', () => {
  const catalog = [];
  const embeddings = new Map<number, Float32Array>();
  for (let i = 0; i < 600; i++) catalog.push(card(i));
  embeddings.set(7, mkVec(42));
  const top = findVisualMatches(mkVec(42), catalog, embeddings, 3);
  expect(top.length).toBe(1);
  expect(top[0].card.productId).toBe(7);
});
