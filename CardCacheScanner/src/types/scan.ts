import type { TestCatalogCard } from './catalog';

export type ConditionCode = 'NM' | 'LP' | 'MP' | 'HP' | 'DMG';

export type ScannedCard = {
  id: string;
  productId: number;
  name: string;
  set: string;
  number: string;
  rarity: string | null;
  imageUrl?: string;
  condition: ConditionCode;
  quantity: number;
  baseMarketPrice: number;
  marketPrice: number;
  totalPrice: number;
  scannedAt: number;
};

export function createScannedCard(
  card: TestCatalogCard,
  condition: ConditionCode = 'NM',
  quantity: number = 1
): ScannedCard {
  const marketPrice = getConditionPrice(card, condition);
  return {
    id: `${card.productId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    productId: card.productId,
    name: card.name,
    set: card.set,
    number: card.number,
    rarity: card.rarity,
    imageUrl: card.imageUrl,
    condition,
    quantity,
    baseMarketPrice: card.variants[0]?.marketPrice ?? 0,
    marketPrice,
    totalPrice: marketPrice * quantity,
    scannedAt: Date.now(),
  };
}

const CONDITION_MULTIPLIERS: Record<ConditionCode, number> = {
  NM: 1.0,
  LP: 0.85,
  MP: 0.7,
  HP: 0.5,
  DMG: 0.3,
};

export function getConditionPrice(card: TestCatalogCard, condition: ConditionCode): number {
  const base = card.variants[0]?.marketPrice ?? 0;
  return Number((base * CONDITION_MULTIPLIERS[condition]).toFixed(2));
}
