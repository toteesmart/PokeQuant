import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  getHasSeenTour,
  initializeDatabase,
  setHasSeenTour as persistHasSeenTour,
} from '../db/database';
import { useAuth } from './AuthContext';

export type BuyTier = {
  /** Minimum dollar amount (inclusive) for this tier. */
  minDollar: number;
  /** Maximum dollar amount (inclusive) for this tier. */
  maxDollar: number;
  /** Percentage of the live market price that the vendor pays for cards in this tier. */
  marginPercent: number;
};

export type RoundingMethod =
  | 'Custom Cutoff'
  | 'Always Round Up'
  | 'Always Round Down'
  | 'Exact Cents';

export type StickerRules = {
  roundingMethod: RoundingMethod;
  /** Fractional dollar cutoff used when rounding method is "Custom Cutoff". */
  cutoff: number;
  /** Absolute minimum sticker price regardless of rounding. */
  minSticker: number;
};

export const ROUNDING_METHODS: RoundingMethod[] = [
  'Custom Cutoff',
  'Always Round Up',
  'Always Round Down',
  'Exact Cents',
];

export const DEFAULT_STICKER_RULES: StickerRules = {
  roundingMethod: 'Custom Cutoff',
  cutoff: 0.3,
  minSticker: 1.0,
};

const DEFAULT_TIERS: BuyTier[] = [
  { minDollar: 0, maxDollar: 10, marginPercent: 50 },
  { minDollar: 10, maxDollar: 50, marginPercent: 60 },
  { minDollar: 50, maxDollar: 999, marginPercent: 70 },
];

type VendorSettingsContextValue = {
  tiers: BuyTier[];
  setTiers: (tiers: BuyTier[]) => void;
  updateTier: (index: number, updates: Partial<BuyTier>) => void;
  /** Returns the vendor cash offer for a card based on the current buy tiers. */
  getCashOffer: (marketPrice: number) => number;
  stickerRules: StickerRules;
  setStickerRules: (rules: StickerRules) => void;
  updateStickerRules: (updates: Partial<StickerRules>) => void;
  /** Returns the final sticker price for a card based on the current sticker rules. */
  getStickerPrice: (marketPrice: number) => number;
  /** Whether the current user has already completed the onboarding tour. */
  hasSeenTour: boolean;
  /** Whether the onboarding tour modal is currently visible. */
  isTourActive: boolean;
  /** Show the onboarding tour modal. */
  launchTour: () => void;
  /** Mark the onboarding tour as completed, persist it offline, and close it. */
  completeTour: () => void;
};

const VendorSettingsContext =
  createContext<VendorSettingsContextValue | null>(null);

export function VendorSettingsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { userId } = useAuth();

  const [tiers, setTiers] = useState<BuyTier[]>(DEFAULT_TIERS);
  const [stickerRules, setStickerRules] = useState<StickerRules>(
    DEFAULT_STICKER_RULES
  );

  const [hasSeenTour, setHasSeenTour] = useState(false);
  const [isTourActive, setIsTourActive] = useState(false);
  const [db, setDb] = useState<SQLiteDatabase | null>(null);

  // Initialize the SQLite bridge once so the tour state can be read and
  // written entirely offline. This is a non-blocking async setup.
  useEffect(() => {
    let mounted = true;
    initializeDatabase()
      .then(({ db }) => {
        if (mounted) setDb(db);
      })
      .catch((err) => {
        console.error('Failed to initialize SQLite for tour state:', err);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Load the tour flag for the current user whenever the user changes.
  // If the flag is missing, the tour is launched automatically on login.
  useEffect(() => {
    if (!db) return;
    if (!userId) {
      setIsTourActive(false);
      return;
    }

    let mounted = true;
    getHasSeenTour(db, userId)
      .then((seen) => {
        if (!mounted) return;
        setHasSeenTour(seen);
        if (!seen) setIsTourActive(true);
      })
      .catch((err) => {
        console.error('Failed to load tour state:', err);
      });

    return () => {
      mounted = false;
    };
  }, [db, userId]);

  const launchTour = useCallback(() => {
    setIsTourActive(true);
  }, []);

  const completeTour = useCallback(async () => {
    setIsTourActive(false);
    setHasSeenTour(true);
    if (db && userId) {
      try {
        await persistHasSeenTour(db, userId, true);
      } catch (err) {
        console.error('Failed to persist tour completion:', err);
      }
    }
  }, [db, userId]);

  // Sorted tiers ensure the cash offer lookup always evaluates thresholds
  // from smallest to largest, even if the user reorders them.
  const sortedTiers = useMemo(
    () => [...tiers].sort((a, b) => a.minDollar - b.minDollar),
    [tiers]
  );

  const updateTier = (index: number, updates: Partial<BuyTier>) => {
    setTiers((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...updates };
      return next;
    });
  };

  const updateStickerRules = (updates: Partial<StickerRules>) => {
    setStickerRules((prev) => ({ ...prev, ...updates }));
  };

  const getCashOffer = useCallback(
    (marketPrice: number) => {
      if (marketPrice <= 0 || sortedTiers.length === 0) return 0;
      let tier = sortedTiers.find(
        (t) => marketPrice >= t.minDollar && marketPrice <= t.maxDollar
      );
      if (!tier) {
        tier =
          marketPrice < sortedTiers[0].minDollar
            ? sortedTiers[0]
            : sortedTiers[sortedTiers.length - 1];
      }
      return Number((marketPrice * (tier.marginPercent / 100)).toFixed(2));
    },
    [sortedTiers]
  );

  const getStickerPrice = useCallback(
    (marketPrice: number) => {
      if (!Number.isFinite(marketPrice) || marketPrice <= 0) {
        return stickerRules.minSticker;
      }

      let sticker = marketPrice;

      switch (stickerRules.roundingMethod) {
        case 'Always Round Up':
          sticker = Math.ceil(sticker);
          break;
        case 'Always Round Down':
          sticker = Math.floor(sticker);
          break;
        case 'Custom Cutoff': {
          const fractional = sticker - Math.floor(sticker);
          sticker =
            fractional >= stickerRules.cutoff
              ? Math.ceil(sticker)
              : Math.floor(sticker);
          break;
        }
        case 'Exact Cents':
        default:
          sticker = Number(sticker.toFixed(2));
          break;
      }

      return Math.max(sticker, stickerRules.minSticker);
    },
    [stickerRules]
  );

  const value = useMemo(
    () => ({
      tiers,
      setTiers,
      updateTier,
      getCashOffer,
      stickerRules,
      setStickerRules,
      updateStickerRules,
      getStickerPrice,
      hasSeenTour,
      isTourActive,
      launchTour,
      completeTour,
    }),
    [
      tiers,
      sortedTiers,
      stickerRules,
      hasSeenTour,
      isTourActive,
      launchTour,
      completeTour,
      getCashOffer,
      getStickerPrice,
    ]
  );

  return (
    <VendorSettingsContext.Provider value={value}>
      {children}
    </VendorSettingsContext.Provider>
  );
}

export function useVendorSettings() {
  const context = useContext(VendorSettingsContext);
  if (!context) {
    throw new Error(
      'useVendorSettings must be used within a VendorSettingsProvider'
    );
  }
  return context;
}
