import type { CatalogCard } from '../db/catalogDb';

export type MatchableRow = {
  id: string;
  name: string;
  set: string;
  number: string;
  variant: string;
};

function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[''\-.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function scoreCatalogMatch(row: MatchableRow, card: CatalogCard): number {
  const normalizedQuery = normalizeSearch(row.name);
  if (!normalizedQuery) return -1;

  const normalizedName = normalizeSearch(card.name);
  const normalizedSet = normalizeSearch(card.set);
  const normalizedNumber = normalizeSearch(card.number);
  const queryParts = normalizedQuery.split(' ');

  let score = 0;
  if (normalizedName === normalizedQuery) score += 100;
  if (normalizedName.includes(normalizedQuery)) score += 50;
  for (const part of queryParts) {
    if (normalizedName.includes(part)) score += 10;
    if (normalizedSet.includes(part)) score += 5;
    if (normalizedNumber.includes(part)) score += 5;
  }

  const normalizedRowSet = normalizeSearch(row.set);
  if (normalizedRowSet && normalizedSet.includes(normalizedRowSet)) score += 25;

  const normalizedRowNumber = normalizeSearch(row.number);
  if (normalizedRowNumber && normalizedNumber.includes(normalizedRowNumber))
    score += 25;

  if (card.liveMarket > 0) score += 1;

  return score;
}
