import { useVendorStore } from '../../store/vendorStore';
import type { ConditionCode } from '../types/scan';

// Scanner previews must price exactly like inventory: vendorStore's
// CONDITION_MODIFIERS (nm/lp/mp/hp/dmg) are what addInventoryCard applies,
// so queue totals match what lands in pokequant.db.
export function priceForCondition(base: number, condition: ConditionCode): number {
  return useVendorStore.getState().getConditionedMarket(base, condition);
}

// Vendor economics preview for a conditioned market price: what the vendor
// pays (cash offer), what the card sells for (sticker), and the margin.
// Mirrors addScannedCards — offer and sticker are computed off the
// condition-adjusted market price.
// The tier-computed cash offer for a conditioned market price — the default
// a card carries before any per-card or deal-level negotiation.
export function autoOffer(marketPrice: number): number {
  return useVendorStore.getState().getCashOffer(marketPrice);
}

export function offerBreakdown(
  marketPrice: number,
  customOffer?: number
): {
  offer: number;
  offerPct: number;
  sticker: number;
  profit: number;
} {
  const { getCashOffer, getStickerPrice } = useVendorStore.getState();
  const offer = customOffer ?? getCashOffer(marketPrice);
  const sticker = getStickerPrice(marketPrice);
  return {
    offer,
    offerPct: marketPrice > 0 ? Math.round((offer / marketPrice) * 100) : 0,
    sticker,
    profit: Number((sticker - offer).toFixed(2)),
  };
}
