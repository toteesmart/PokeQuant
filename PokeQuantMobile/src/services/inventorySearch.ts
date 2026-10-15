// Inventory-side search index — the fields a row is searchable by,
// normalized once per render of the list so filtering stays a
// haystack.includes() scan.
import type { InventoryCard } from '../store/inventoryStore';
import { normalizeSearchTerm } from '../utils/search';

export function getSearchableText(card: InventoryCard): string {
  return [
    card.name,
    card.number,
    card.set,
    card.productType,
    card.rarity,
    card.condition,
  ]
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .join(' ');
}

export type SearchEntry = { card: InventoryCard; haystack: string };

export function buildSearchIndex(cards: InventoryCard[]): SearchEntry[] {
  return cards.map((card) => ({
    card,
    haystack: normalizeSearchTerm(getSearchableText(card)),
  }));
}
