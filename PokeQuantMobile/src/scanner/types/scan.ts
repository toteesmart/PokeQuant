import { priceForCondition } from '../utils/pricing';
import type { ScanCatalogCard } from './catalog';

export type ConditionCode = 'NM' | 'LP' | 'MP' | 'HP' | 'DMG';

export type ScannedCard = {
  id: string;
  productId: number;
  name: string;
  set: string;
  number: string;
  rarity: string | null;
  imageUrl?: string;
  subType?: string;
  /** Vendor-negotiated cash offer; overrides the tier-computed offer when set. */
  customOffer?: number;
  condition: ConditionCode;
  quantity: number;
  baseMarketPrice: number;
  marketPrice: number;
  totalPrice: number;
  scannedAt: number;
};

function resolveVariant(card: ScanCatalogCard, subType?: string) {
  return (
    (subType ? card.variants.find((v) => v.subType === subType) : undefined) ??
    card.variants[0]
  );
}

export function createScannedCard(
  card: ScanCatalogCard,
  condition: ConditionCode = 'NM',
  quantity: number = 1,
  subType?: string
): ScannedCard {
  const variant = resolveVariant(card, subType);
  const marketPrice = priceForCondition(variant?.marketPrice ?? 0, condition);
  return {
    id: `${card.productId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    productId: card.productId,
    name: card.name,
    set: card.set,
    number: card.number,
    rarity: card.rarity,
    imageUrl: card.imageUrl,
    subType: variant?.subType,
    condition,
    quantity,
    baseMarketPrice: variant?.marketPrice ?? 0,
    marketPrice,
    totalPrice: marketPrice * quantity,
    scannedAt: Date.now(),
  };
}

export function getConditionPrice(
  card: ScanCatalogCard,
  condition: ConditionCode,
  subType?: string
): number {
  return priceForCondition(resolveVariant(card, subType)?.marketPrice ?? 0, condition);
}
