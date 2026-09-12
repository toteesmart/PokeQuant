import { create } from 'zustand';
import type { ScannedCard, ConditionCode } from '../types/scan';
import type { ScanCatalogCard } from '../types/catalog';
import { autoOffer, priceForCondition } from '../utils/pricing';

type RecoveredCard = Pick<
  ScannedCard,
  'productId' | 'name' | 'set' | 'number' | 'rarity' | 'imageUrl' | 'baseMarketPrice'
>;

export type ScanQueueState = {
  items: ScannedCard[];
  add: (item: ScannedCard) => void;
  remove: (id: string) => void;
  updateCondition: (id: string, condition: ConditionCode) => void;
  updateQuantity: (id: string, quantity: number) => void;
  updateSubType: (
    id: string,
    variant: { subType: string; marketPrice: number }
  ) => void;
  updateOffer: (id: string, offer: number | null) => void;
  applyDealTotal: (total: number) => void;
  replaceCard: (id: string, card: ScanCatalogCard) => void;
  clear: () => void;
  totalCount: () => number;
  totalPrice: () => number;
};

export const useScanQueueStore = create<ScanQueueState>((set, get) => ({
  items: [],
  add: (item) => set((state) => ({ items: [item, ...state.items] })),
  remove: (id) => set((state) => ({ items: state.items.filter((i) => i.id !== id) })),
  updateCondition: (id, condition) =>
    set((state) => ({
      items: state.items.map((item) => {
        if (item.id !== id) return item;
        const marketPrice = priceForCondition(item.baseMarketPrice, condition);
        return {
          ...item,
          condition,
          marketPrice,
          totalPrice: marketPrice * item.quantity,
        };
      }),
    })),
  updateQuantity: (id, quantity) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id
          ? { ...item, quantity: Math.max(1, quantity), totalPrice: item.marketPrice * Math.max(1, quantity) }
          : item
      ),
    })),
  updateSubType: (id, variant) =>
    set((state) => ({
      items: state.items.map((item) => {
        if (item.id !== id) return item;
        const marketPrice = priceForCondition(
          variant.marketPrice,
          item.condition
        );
        return {
          ...item,
          subType: variant.subType,
          baseMarketPrice: variant.marketPrice,
          marketPrice,
          totalPrice: marketPrice * item.quantity,
        };
      }),
    })),
  updateOffer: (id, offer) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id
          ? {
              ...item,
              customOffer:
                offer != null && Number.isFinite(offer) && offer >= 0
                  ? offer
                  : undefined,
            }
          : item
      ),
    })),
  // Vendor strikes one deal for the whole queue ("$220 for everything") —
  // prorate it across cards by their current per-unit offer (custom or tier
  // auto), quantity-weighted. Rounding leftovers go to the largest line so
  // the per-card offers sum exactly to the deal.
  applyDealTotal: (total) =>
    set((state) => {
      if (!Number.isFinite(total) || total < 0 || state.items.length === 0) {
        return state;
      }
      const lines = state.items.map((item) => {
        const unit = item.customOffer ?? autoOffer(item.marketPrice);
        return { item, unit, line: unit * item.quantity };
      });
      const sum = lines.reduce((s, l) => s + l.line, 0);
      const unitCount = lines.reduce((s, l) => s + l.item.quantity, 0);

      const rounded = lines.map((l) => {
        const share =
          sum > 0
            ? (l.unit * total) / sum
            : unitCount > 0
              ? total / unitCount
              : 0;
        return Math.round(share * 100) / 100;
      });
      // Cents lost to rounding land on the highest-value line.
      const leftover =
        Math.round(
          (total - lines.reduce((s, l, i) => s + rounded[i] * l.item.quantity, 0)) * 100
        ) / 100;
      if (leftover !== 0) {
        let biggest = 0;
        lines.forEach((l, i) => {
          if (rounded[i] * l.item.quantity > rounded[biggest] * lines[biggest].item.quantity) {
            biggest = i;
          }
        });
        rounded[biggest] = Math.round((rounded[biggest] + leftover) * 100) / 100;
      }

      return {
        items: state.items.map((item, i) => ({
          ...item,
          customOffer: Math.max(0, rounded[i]),
        })),
      };
    }),
  replaceCard: (id, card) =>
    set((state) => ({
      items: state.items.map((item) => {
        if (item.id !== id) return item;
        const baseMarketPrice = card.variants[0]?.marketPrice ?? 0;
        const marketPrice = priceForCondition(baseMarketPrice, item.condition);
        return {
          ...item,
          productId: card.productId,
          name: card.name,
          set: card.set,
          number: card.number,
          rarity: card.rarity,
          imageUrl: card.imageUrl,
          subType: card.variants[0]?.subType,
          // A negotiated offer is tied to the physical card — switching to a
          // different printing clears it so it can't leak across.
          customOffer: undefined,
          baseMarketPrice,
          marketPrice,
          totalPrice: marketPrice * item.quantity,
        };
      }),
    })),
  clear: () => set({ items: [] }),
  totalCount: () => get().items.reduce((sum, item) => sum + item.quantity, 0),
  totalPrice: () => get().items.reduce((sum, item) => sum + item.totalPrice, 0),
}));
