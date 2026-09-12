import type { CatalogMatch } from '../catalog/catalogMatcher';
import type { VisualMatch } from '../visual/visualMatcher';

export type FusionResult = {
  top: CatalogMatch | null;
  candidates: CatalogMatch[];
  autoConfirm: boolean;
};

const AUTO_CONFIRM_THRESHOLD = 0.85;

export function fuseConfidence(
  textMatch: CatalogMatch | null,
  visualMatches: VisualMatch[]
): FusionResult {
  if (!textMatch && visualMatches.length === 0) {
    return { top: null, candidates: [], autoConfirm: false };
  }

  const byId = new Map<number, CatalogMatch>();

  if (textMatch) {
    byId.set(textMatch.card.productId, textMatch);
  }

  for (const v of visualMatches) {
    const existing = byId.get(v.card.productId);
    const visualMatch: CatalogMatch = {
      card: v.card,
      method: 'visual',
      confidence: Math.max(0, Math.min(1, v.score)),
    };
    if (!existing || visualMatch.confidence > existing.confidence) {
      byId.set(v.card.productId, visualMatch);
    }
  }

  const candidates: CatalogMatch[] = [];

  for (const candidate of byId.values()) {
    const isText = textMatch?.card.productId === candidate.card.productId;
    const textScore = isText ? textMatch.confidence : 0;
    const textMethod = isText ? textMatch.method : null;

    const visualScore = visualMatches
      .filter((v) => v.card.productId === candidate.card.productId)
      .reduce((best, v) => Math.max(best, v.score), 0);
    const clampedVisual = Math.max(0, Math.min(1, visualScore));

    const textWeight =
      textMethod === 'number' ? 0.75 : textMethod === 'name' ? 0.55 : 0.35;
    const visualWeight = 1 - textWeight;

    const fused = textScore * textWeight + clampedVisual * visualWeight;
    candidates.push({
      card: candidate.card,
      method: 'fused',
      confidence: fused,
    });
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  const top = candidates[0] ?? null;
  const autoConfirm = top !== null && top.confidence >= AUTO_CONFIRM_THRESHOLD;

  return { top, candidates, autoConfirm };
}
