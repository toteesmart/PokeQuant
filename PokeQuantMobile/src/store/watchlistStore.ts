import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { classKey } from '../scanner/services/deal/dealShiftTracker';

/**
 * Watchlist — cards the user does NOT own but wants lifecycle alerts
 * on (revivals, floor breaks). Device-local; survives catalog refreshes
 * because the key is productId+subType, not a row id.
 */
export type WatchedCard = {
  productId: number;
  subType: string;
  name: string;
  set?: string;
  number?: string;
  imageUrl?: string;
  addedAt: string; // ISO
};

type WatchlistState = {
  cards: Record<string, WatchedCard>;
};

type WatchlistActions = {
  toggle: (card: Omit<WatchedCard, 'addedAt'>) => void;
  isWatched: (productId: number | null | undefined, subType?: string) => boolean;
};

export const useWatchlistStore = create<WatchlistState & WatchlistActions>()(
  persist(
    (set, get) => ({
      cards: {},

      toggle: (card) => {
        const key = classKey(card.productId, card.subType);
        const next = { ...get().cards };
        if (next[key]) delete next[key];
        else next[key] = { ...card, addedAt: new Date().toISOString() };
        set({ cards: next });
      },

      isWatched: (productId, subType) => get().cards[classKey(productId, subType)] != null,
    }),
    {
      name: 'watchlist_v1',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
