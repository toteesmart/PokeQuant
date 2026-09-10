import { create } from 'zustand';
import type { ScannedCard, ConditionCode } from '../types/scan';

type RecoveredCard = Pick<
  ScannedCard,
  'productId' | 'name' | 'set' | 'number' | 'rarity' | 'imageUrl' | 'baseMarketPrice'
>;

function priceForCondition(base: number, condition: ConditionCode): number {
  const multipliers: Record<ConditionCode, number> = {
    NM: 1.0,
    LP: 0.85,
    MP: 0.7,
    HP: 0.5,
    DMG: 0.3,
  };
  return Number((base * multipliers[condition]).toFixed(2));
}

export type ScanQueueState = {
  items: ScannedCard[];
  add: (item: ScannedCard) => void;
  remove: (id: string) => void;
  updateCondition: (id: string, condition: ConditionCode) => void;
  updateQuantity: (id: string, quantity: number) => void;
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
  clear: () => set({ items: [] }),
  totalCount: () => get().items.reduce((sum, item) => sum + item.quantity, 0),
  totalPrice: () => get().items.reduce((sum, item) => sum + item.totalPrice, 0),
}));
