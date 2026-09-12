import type { InventoryInput } from '../../store/inventoryStore';
import type { ScannedCard } from '../types/scan';

// Inventory rows are stock:1 — a queued quantity of N becomes N rows.
// liveMarket carries the unconditioned catalog price; addScannedCards
// re-resolves it through getProductMarketData and applies the vendor
// condition modifier itself, so previews match persisted rows.
export function scannedCardsToInventoryInputs(items: ScannedCard[]): InventoryInput[] {
  const inputs: InventoryInput[] = [];
  for (const card of items) {
    for (let i = 0; i < card.quantity; i++) {
      inputs.push({
        name: card.name,
        number: card.number,
        set: card.set,
        rarity: card.rarity ?? undefined,
        productType: card.subType,
        condition: card.condition,
        liveMarket: card.baseMarketPrice,
        imageUrl: card.imageUrl,
        productId: card.productId,
        amountPaid: card.customOffer,
      });
    }
  }
  return inputs;
}
