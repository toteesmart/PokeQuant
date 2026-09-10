import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isOfflineError, logError, logInfo } from '../utils/log';
import type { InventoryCard } from './inventoryStore';
import type { ShowListingItem } from '../services/showVendorService';
import {
  deleteShowListing,
  getTeam,
  getVendorListings,
  getVendorProfile,
  getVendorShows,
  leaveTeam,
  redeemTeamCode,
  regenerateTeamCode,
  removeTeamMember,
  renameTeam,
  triggerShowSnapshot,
  updateShowListing,
  uploadShowInventory,
} from '../services/showVendorService';
import { useSubscriptionStore } from './subscriptionStore';
import type { Team } from '../services/showVendorService';

export type VendorProfile = {
  id: string;
  userId: string;
  name: string;
  tableDefault: string;
  isFounder: boolean;
  founderSeatNumber: number | null;
  paymentsLive: boolean;
  founderSeatsRemaining: number;
  isVendor: boolean;
  isTeamMember: boolean;
  teamId: string | null;
  team: Team | null;
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
  team: Team | null;
  teamLoading: boolean;
  teamError: string | null;
  showsWithAccess: string[];
  setups: Record<string, ShowSetup>;
  selections: Record<string, Record<string, UploadSelection>>;
  listings: Record<string, ShowListingItem[]>;
  listingsError: Record<string, string | null>;
  isLoadingListings: Record<string, boolean>;
  isUploading: Record<string, boolean>;
  uploadError: Record<string, string | null>;
  isTriggering: Record<string, boolean>;
};

type ShowVendorActions = {
  loadVendorProfile: () => Promise<void>;
  loadVendorShows: () => Promise<void>;
  loadTeam: () => Promise<void>;
  redeemCode: (code: string) => Promise<Team>;
  regenerateCode: () => Promise<Team>;
  renameTeam: (name: string) => Promise<Team>;
  removeMember: (memberUserId: string) => Promise<void>;
  leaveTeam: () => Promise<void>;
  setShowSetup: (showId: string, vendorName: string, vendorTable: string) => void;
  toggleCardSelection: (showId: string, card: InventoryCard) => void;
  updateSelection: (showId: string, cardId: string, updates: Partial<UploadSelection>) => void;
  clearSelection: (showId: string) => void;
  uploadToShow: (showId: string, vendorName: string, vendorTable: string) => Promise<string[]>;
  loadListings: (showId: string) => Promise<void>;
  updateListing: (showId: string, rowId: string, updates: Partial<ShowListingItem>) => Promise<void>;
  deleteListing: (showId: string, rowId: string) => Promise<void>;
  triggerSnapshot: (showId: string) => Promise<void>;
  canUseVendorFeatures: () => boolean;
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
      team: null,
      teamLoading: false,
      teamError: null,
      showsWithAccess: [],
      setups: {},
      selections: {},
      listings: {},
      listingsError: {},
      isLoadingListings: {},
      isUploading: {},
      uploadError: {},
      isTriggering: {},

      canUseVendorFeatures: () => {
        if (!get().profile?.paymentsLive) return true;
        // The persisted vendor profile is the Turso-cached source of truth for
        // offline gating. RevenueCat's customerInfo is authoritative when
        // available, but after a force-close / offline relaunch it may not yet
        // be loaded, so we fall back to the cached profile.
        // Founder status is a discount/seat label, not a free pass; it still
        // requires an active subscription or active team membership.
        if (get().profile?.isVendor || get().profile?.isTeamMember) return true;
        return useSubscriptionStore.getState().hasVendorEntitlement();
      },

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
              isFounder: v.is_founder === 1,
              founderSeatNumber: v.founder_seat_number,
              paymentsLive: v.payments_live === 1,
              founderSeatsRemaining: v.founder_seats_remaining,
              isVendor: v.is_vendor === 1,
              isTeamMember: v.is_team_member === 1,
              teamId: v.team_id,
              team: v.team,
            },
            team: v.team,
            isLoadingProfile: false,
          });
        } catch (err) {
          const message = isOfflineError(err)
            ? 'Internet connection is offline — vendor profile unavailable.'
            : err instanceof Error
              ? err.message
              : String(err);
          set({
            isLoadingProfile: false,
            profileError: message,
          });
          throw err;
        }
      },

      loadTeam: async () => {
        if (get().teamLoading) return;
        set({ teamLoading: true, teamError: null });
        try {
          const t = await getTeam();
          set({ team: t, teamLoading: false });
        } catch (err) {
          const message = isOfflineError(err)
            ? 'Internet connection is offline — team info unavailable.'
            : err instanceof Error
              ? err.message
              : String(err);
          set({ teamError: message, teamLoading: false });
          throw err;
        }
      },

      redeemCode: async (code: string) => {
        try {
          const t = await redeemTeamCode(code);
          set({ team: t });
          await get().loadVendorProfile();
          return t;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          set({ teamError: message });
          throw err;
        }
      },

      regenerateCode: async () => {
        try {
          const t = await regenerateTeamCode();
          set({ team: t });
          return t;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          set({ teamError: message });
          throw err;
        }
      },

      renameTeam: async (name: string) => {
        try {
          const t = await renameTeam(name);
          set({ team: t });
          await get().loadVendorProfile();
          return t;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          set({ teamError: message });
          throw err;
        }
      },

      removeMember: async (memberUserId: string) => {
        await removeTeamMember(memberUserId);
        await get().loadTeam();
      },

      leaveTeam: async () => {
        await leaveTeam();
        set({ team: null });
        await get().loadVendorProfile();
      },

      loadVendorShows: async () => {
        try {
          const showIds = await getVendorShows();
          set({ showsWithAccess: showIds });
        } catch (err) {
          if (isOfflineError(err)) {
            logInfo('Offline: vendor shows not loaded.');
          } else {
            logError('Failed to load vendor shows:', err);
          }
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
        if (!get().canUseVendorFeatures()) {
          throw new Error('subscription_required');
        }
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

          // Refresh listings after upload. A refresh failure is reported via
          // listingsError inside loadListings — the upload itself already
          // succeeded, so it must never surface as an uploadError.
          try {
            await get().loadListings(showId);
          } catch (err) {
            logError('Failed to refresh show listings after upload:', err);
          }

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
          listingsError: { ...state.listingsError, [showId]: null },
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
            listingsError: {
              ...state.listingsError,
              [showId]: err instanceof Error ? err.message : String(err),
            },
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
        if (!get().canUseVendorFeatures()) {
          throw new Error('subscription_required');
        }
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
