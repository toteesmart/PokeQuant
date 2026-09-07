import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { InventoryCard } from './inventoryStore';
import type { ShowListingItem } from '../services/showVendorService';
import {
  deleteShowListing,
  getVendorListings,
  getVendorProfile,
  getVendorShows,
  triggerShowSnapshot,
  updateShowListing,
  uploadShowInventory,
} from '../services/showVendorService';

export type VendorProfile = {
  id: string;
  userId: string;
  name: string;
  tableDefault: string;
};

export type ShowSetup = {
  showId: string;
  vendorName: string;
  vendorTable: string;
};

export type UploadSelection = {
  cardId: string;
  productId: number;
  name: string;
  set: string;
  number: string;
  rarity: string;
  condition: string;
  stickerPrice: number;
  quantity: number;
};

type ShowVendorState = {
  profile: VendorProfile | null;
  isLoadingProfile: boolean;
  profileError: string | null;
  showsWithAccess: string[];
  setups: Record<string, ShowSetup>;
  selections: Record<string, Record<string, UploadSelection>>;
  listings: Record<string, ShowListingItem[]>;
  isLoadingListings: Record<string, boolean>;
  isUploading: Record<string, boolean>;
  uploadError: Record<string, string | null>;
  isTriggering: Record<string, boolean>;
};

type ShowVendorActions = {
  loadVendorProfile: () => Promise<void>;
  loadVendorShows: () => Promise<void>;
  setShowSetup: (showId: string, vendorName: string, vendorTable: string) => void;
  toggleCardSelection: (showId: string, card: InventoryCard) => void;
  updateSelection: (showId: string, cardId: string, updates: Partial<UploadSelection>) => void;
  clearSelection: (showId: string) => void;
  uploadToShow: (showId: string, vendorName: string, vendorTable: string) => Promise<string[]>;
  loadListings: (showId: string) => Promise<void>;
  updateListing: (showId: string, rowId: string, updates: Partial<ShowListingItem>) => Promise<void>;
  deleteListing: (showId: string, rowId: string) => Promise<void>;
  triggerSnapshot: (showId: string) => Promise<void>;
};

function buildInitialSelection(card: InventoryCard): UploadSelection {
  return {
    cardId: card.id,
    productId: card.productId ?? 0,
    name: card.name,
    set: card.set ?? '',
    number: card.number ?? '',
    rarity: card.productType ?? card.rarity ?? '',
    condition: card.condition ?? 'NM',
    stickerPrice: card.stickerPrice,
    quantity: 1,
  };
}

export const useShowVendorStore = create<
  ShowVendorState & ShowVendorActions
>()(
  persist(
    (set, get) => ({
      profile: null,
      isLoadingProfile: false,
      profileError: null,
      showsWithAccess: [],
      setups: {},
      selections: {},
      listings: {},
      isLoadingListings: {},
      isUploading: {},
      uploadError: {},
      isTriggering: {},

      loadVendorProfile: async () => {
        if (get().isLoadingProfile) return;
        set({ isLoadingProfile: true, profileError: null });
        try {
          const v = await getVendorProfile();
          set({
            profile: {
              id: v.id,
              userId: v.user_id,
              name: v.name,
              tableDefault: v.table_default,
            },
            isLoadingProfile: false,
          });
        } catch (err) {
          set({
            isLoadingProfile: false,
            profileError: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }
      },

      loadVendorShows: async () => {
        try {
          const showIds = await getVendorShows();
          set({ showsWithAccess: showIds });
        } catch (err) {
          console.error('Failed to load vendor shows:', err);
          throw err;
        }
      },

      setShowSetup: (showId, vendorName, vendorTable) => {
        set((state) => ({
          setups: {
            ...state.setups,
            [showId]: { showId, vendorName, vendorTable },
          },
        }));
      },

      toggleCardSelection: (showId, card) => {
        set((state) => {
          const showSelections = { ...state.selections[showId] };
          if (showSelections[card.id]) {
            delete showSelections[card.id];
          } else {
            showSelections[card.id] = buildInitialSelection(card);
          }
          return {
            selections: {
              ...state.selections,
              [showId]: showSelections,
            },
          };
        });
      },

      updateSelection: (showId, cardId, updates) => {
        set((state) => {
          const showSelections = { ...state.selections[showId] };
          const existing = showSelections[cardId];
          if (!existing) return state;
          showSelections[cardId] = { ...existing, ...updates };
          return {
            selections: {
              ...state.selections,
              [showId]: showSelections,
            },
          };
        });
      },

      clearSelection: (showId) => {
        set((state) => ({
          selections: {
            ...state.selections,
            [showId]: {},
          },
        }));
      },

      uploadToShow: async (showId, vendorName, vendorTable) => {
        const showSelections = get().selections[showId] || {};
        const rows = Object.values(showSelections);
        if (rows.length === 0) {
          throw new Error('No cards selected');
        }

        set((state) => ({
          isUploading: { ...state.isUploading, [showId]: true },
          uploadError: { ...state.uploadError, [showId]: null },
        }));

        try {
          const rowIds = await uploadShowInventory(
            showId,
            vendorName,
            vendorTable,
            rows.map((r) => ({
              product_id: r.productId,
              name: r.name,
              set_name: r.set,
              number: r.number,
              rarity: r.rarity,
              condition: r.condition,
              sticker_price: r.stickerPrice,
              quantity: r.quantity,
            }))
          );

          set((state) => ({
            isUploading: { ...state.isUploading, [showId]: false },
            selections: { ...state.selections, [showId]: {} },
            setups: {
              ...state.setups,
              [showId]: { showId, vendorName, vendorTable },
            },
          }));

          // Refresh listings after upload.
          await get().loadListings(showId);

          return rowIds;
        } catch (err) {
          set((state) => ({
            isUploading: { ...state.isUploading, [showId]: false },
            uploadError: { ...state.uploadError, [showId]: err instanceof Error ? err.message : String(err) },
          }));
          throw err;
        }
      },

      loadListings: async (showId) => {
        set((state) => ({
          isLoadingListings: { ...state.isLoadingListings, [showId]: true },
        }));
        try {
          const rows = await getVendorListings(showId);
          set((state) => ({
            listings: { ...state.listings, [showId]: rows },
            isLoadingListings: { ...state.isLoadingListings, [showId]: false },
          }));
        } catch (err) {
          set((state) => ({
            isLoadingListings: { ...state.isLoadingListings, [showId]: false },
          }));
          throw err;
        }
      },

      updateListing: async (showId, rowId, updates) => {
        await updateShowListing(rowId, {
          name: updates.name,
          set_name: updates.set,
          number: updates.number,
          rarity: updates.rarity,
          condition: updates.condition,
          sticker_price: updates.stickerPrice,
          quantity: updates.quantity,
          vendorName: updates.vendorName,
          vendorTable: updates.vendorTable,
        });
        await get().loadListings(showId);
      },

      deleteListing: async (showId, rowId) => {
        await deleteShowListing(rowId);
        await get().loadListings(showId);
      },

      triggerSnapshot: async (showId) => {
        set((state) => ({
          isTriggering: { ...state.isTriggering, [showId]: true },
        }));
        try {
          await triggerShowSnapshot(showId);
        } finally {
          set((state) => ({
            isTriggering: { ...state.isTriggering, [showId]: false },
          }));
        }
      },
    }),
    {
      name: 'show-vendor-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        profile: state.profile,
        setups: state.setups,
      }),
    }
  )
);
