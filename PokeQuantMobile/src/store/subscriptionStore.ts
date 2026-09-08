import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CustomerInfo, PurchasesOfferings, PurchasesPackage } from 'react-native-purchases';
import {
  configure,
  getCustomerInfo,
  getOfferings,
  hasActiveEntitlement,
  isConfigured,
  login as revenueCatLogin,
  logout as revenueCatLogout,
  purchasePackage as revenueCatPurchasePackage,
  restorePurchases as revenueCatRestorePurchases,
} from '../services/revenueCat';
import { getRevenueCatApiKey, FOUNDER_OFFERING_ID, PRO_OFFERING_ID } from '../constants/revenuecat';
import { useShowVendorStore } from './showVendorStore';
import { syncVendorSubscription } from '../services/showVendorService';
import { logError } from '../utils/log';

export type SubscriptionError = {
  message: string;
  recoverable: boolean;
};

type SubscriptionState = {
  isConfigured: boolean;
  isLoadingCustomerInfo: boolean;
  isLoadingOfferings: boolean;
  customerInfo: CustomerInfo | null;
  offerings: PurchasesOfferings | null;
  hasSeenPricingPreview: boolean;
  lastPurchaseError: string | null;
  error: string | null;
};

type SubscriptionActions = {
  configure: () => void;
  login: (userId: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshCustomerInfo: () => Promise<void>;
  refreshOfferings: () => Promise<void>;
  purchasePackage: (aPackage: PurchasesPackage) => Promise<void>;
  restorePurchases: () => Promise<void>;
  markPricingPreviewSeen: () => void;
  hasVendorEntitlement: () => boolean;
  canUseVendorFeatures: () => boolean;
  isFounder: () => boolean;
  paymentsLive: () => boolean;
  getPaywallOfferingId: () => string;
};

const initialState: SubscriptionState = {
  isConfigured: false,
  isLoadingCustomerInfo: false,
  isLoadingOfferings: false,
  customerInfo: null,
  offerings: null,
  hasSeenPricingPreview: false,
  lastPurchaseError: null,
  error: null,
};

export const useSubscriptionStore = create<SubscriptionState & SubscriptionActions>()(
  persist(
    (set, get) => ({
      ...initialState,

      configure: () => {
        if (get().isConfigured || isConfigured()) return;
        const apiKey = getRevenueCatApiKey();
        if (!apiKey) {
          logError('[subscriptionStore] RevenueCat public API key not configured.');
          return;
        }
        configure(apiKey, null);
        set({ isConfigured: true });
      },

      login: async (userId: string) => {
        get().configure();
        if (!isConfigured()) return;

        set({ isLoadingCustomerInfo: true, isLoadingOfferings: true, error: null });
        try {
          const info = await revenueCatLogin(userId);
          set({ customerInfo: info, isLoadingCustomerInfo: false });

          // Sync the Turso-side subscription cache in the background.
          syncVendorSubscription().catch((err) =>
            logError('[subscriptionStore] syncVendorSubscription failed:', err)
          );

          const offerings = await getOfferings();
          set({ offerings, isLoadingOfferings: false });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logError('[subscriptionStore] login failed:', err);
          set({
            isLoadingCustomerInfo: false,
            isLoadingOfferings: false,
            error: message,
          });
        }
      },

      logout: async () => {
        if (!isConfigured()) return;
        try {
          await revenueCatLogout();
        } catch (err) {
          logError('[subscriptionStore] logout failed:', err);
        } finally {
          set({
            customerInfo: null,
            offerings: null,
            error: null,
          });
        }
      },

      refreshCustomerInfo: async () => {
        if (!isConfigured()) return;
        set({ isLoadingCustomerInfo: true, error: null });
        try {
          const info = await getCustomerInfo();
          set({ customerInfo: info, isLoadingCustomerInfo: false });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logError('[subscriptionStore] refreshCustomerInfo failed:', err);
          set({ isLoadingCustomerInfo: false, error: message });
        }
      },

      refreshOfferings: async () => {
        if (!isConfigured()) return;
        set({ isLoadingOfferings: true, error: null });
        try {
          const offerings = await getOfferings();
          set({ offerings, isLoadingOfferings: false });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logError('[subscriptionStore] refreshOfferings failed:', err);
          set({ isLoadingOfferings: false, error: message });
        }
      },

      purchasePackage: async (aPackage: PurchasesPackage) => {
        if (!isConfigured()) {
          throw new Error('RevenueCat is not configured');
        }
        set({ lastPurchaseError: null });
        try {
          const { customerInfo } = await revenueCatPurchasePackage(aPackage);
          set({ customerInfo });
          // Tell the worker to refresh its local subscription cache.
          await syncVendorSubscription();
          await get().refreshCustomerInfo();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          set({ lastPurchaseError: message });
          throw err;
        }
      },

      restorePurchases: async () => {
        if (!isConfigured()) {
          throw new Error('RevenueCat is not configured');
        }
        set({ lastPurchaseError: null, error: null });
        try {
          const customerInfo = await revenueCatRestorePurchases();
          set({ customerInfo });
          await syncVendorSubscription();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logError('[subscriptionStore] restorePurchases failed:', err);
          set({ error: message });
          throw err;
        }
      },

      markPricingPreviewSeen: () => {
        set({ hasSeenPricingPreview: true });
      },

      hasVendorEntitlement: () => {
        return hasActiveEntitlement(get().customerInfo);
      },

      canUseVendorFeatures: () => {
        const { paymentsLive } = useShowVendorStore.getState().profile ?? {};
        if (!paymentsLive) return true;
        return get().hasVendorEntitlement();
      },

      isFounder: () => {
        return useShowVendorStore.getState().profile?.isFounder ?? false;
      },

      paymentsLive: () => {
        return useShowVendorStore.getState().profile?.paymentsLive ?? false;
      },

      getPaywallOfferingId: () => {
        return get().isFounder() ? FOUNDER_OFFERING_ID : PRO_OFFERING_ID;
      },
    }),
    {
      name: 'subscription-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        hasSeenPricingPreview: state.hasSeenPricingPreview,
      }),
    }
  )
);
