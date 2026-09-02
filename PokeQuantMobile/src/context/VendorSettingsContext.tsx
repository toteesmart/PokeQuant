import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  getVendorSettings,
  initializeDatabase,
  setVendorSettings as persistVendorSettings,
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

export const CONDITION_MODIFIERS: Record<string, number> = {
  nm: 1.0,
  lp: 0.85,
  mp: 0.65,
  hp: 0.4,
  dmg: 0.2,
  other: 1.0,
};

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
  /** Returns the condition-adjusted market price (e.g. LP = 85% of NM). */
  getConditionedMarket: (marketPrice: number, condition?: string) => number;
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

  const [hasSeenTour, setHasSeenTour] = useState(true);
  const [isTourActive, setIsTourActive] = useState(false);
  const [db, setDb] = useState<SQLiteDatabase | null>(null);
  const settingsLoadedRef = useRef(false);

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

  // Load the tour flag and vendor settings for the current user whenever the
  // user changes. Settings are stored as JSON in the vendor_settings table.
  useEffect(() => {
    if (!db) return;
    if (!userId) {
      setIsTourActive(false);
      settingsLoadedRef.current = false;
      return;
    }

    let mounted = true;
    getVendorSettings(db, userId)
      .then((settingsJson) => {
        if (!mounted) return;

        setHasSeenTour(true);
        setIsTourActive(false);

        if (settingsJson) {
          try {
            const parsed = JSON.parse(settingsJson) as {
              tiers?: BuyTier[];
              stickerRules?: StickerRules;
            };
            if (Array.isArray(parsed.tiers) && parsed.tiers.length > 0) {
              setTiers(parsed.tiers);
            }
            if (parsed.stickerRules) {
              setStickerRules(parsed.stickerRules);
            }
          } catch (err) {
            console.error('Failed to parse vendor settings:', err);
          }
        }

        settingsLoadedRef.current = true;
      })
      .catch((err) => {
        console.error('Failed to load settings or tour state:', err);
      });

    return () => {
      mounted = false;
      settingsLoadedRef.current = false;
    };
  }, [db, userId]);

  // Persist vendor settings whenever tiers or sticker rules change.
  // The first save is skipped until the initial load has completed.
  useEffect(() => {
    if (!db || !userId || !settingsLoadedRef.current) return;

    const payload = JSON.stringify({
      tiers,
      stickerRules,
      updatedAt: Date.now(),
    });

    persistVendorSettings(db, userId, payload).catch((err) => {
      console.error('Failed to persist vendor settings:', err);
    });
  }, [db, userId, tiers, stickerRules]);

  const launchTour = useCallback(() => {
    // Tour is permanently disabled; the button is a no-op.
    setIsTourActive(false);
  }, []);

  const completeTour = useCallback(async () => {
    setIsTourActive(false);
    setHasSeenTour(true);
  }, []);

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

  const getConditionedMarket = useCallback(
    (marketPrice: number, condition?: string) => {
      if (!condition || !Number.isFinite(marketPrice) || marketPrice <= 0) {
        return marketPrice;
      }
      const normalized = condition
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .trim();
      const mod = CONDITION_MODIFIERS[normalized] ?? CONDITION_MODIFIERS.other;
      return Math.max(0, Number((marketPrice * mod).toFixed(2)));
    },
    []
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
      getConditionedMarket,
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
      updateTier,
      updateStickerRules,
      getCashOffer,
      getStickerPrice,
      getConditionedMarket,
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
