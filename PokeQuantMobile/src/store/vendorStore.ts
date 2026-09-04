import { create } from 'zustand';
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  getVendorSettings,
  initializeDatabase,
  setVendorSettings as persistVendorSettings,
} from '../db/database';
import { pullVendorSettings, pushVendorSettings } from '../api/cloudSync';

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

export const DEFAULT_TIERS: BuyTier[] = [
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

type VendorSettingsState = {
  tiers: BuyTier[];
  stickerRules: StickerRules;
  hasSeenTour: boolean;
  isTourActive: boolean;
};

type VendorSettingsActions = {
  setTiers: (tiers: BuyTier[]) => void;
  setStickerRules: (rules: StickerRules) => void;
  updateTier: (index: number, updates: Partial<BuyTier>) => void;
  updateStickerRules: (updates: Partial<StickerRules>) => void;
  getCashOffer: (marketPrice: number) => number;
  getStickerPrice: (marketPrice: number) => number;
  getConditionedMarket: (marketPrice: number, condition?: string) => number;
  launchTour: () => void;
  completeTour: () => void;
  loadForUser: (userId: string | null) => Promise<void>;
};

let dbRef: SQLiteDatabase | null = null;
let currentUserId: string | null = null;
let settingsLoaded = false;

async function getDb(): Promise<SQLiteDatabase | null> {
  if (dbRef) return dbRef;
  try {
    const { db } = await initializeDatabase();
    dbRef = db;
    return db;
  } catch (err) {
    console.error('Failed to initialize SQLite for vendor settings:', err);
    return null;
  }
}

async function persistSettings(
  state: VendorSettingsState,
  userId: string
): Promise<void> {
  const db = dbRef;
  if (!db) return;

  const updatedAt = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    tiers: state.tiers,
    stickerRules: state.stickerRules,
    updatedAt,
  });

  try {
    await persistVendorSettings(db, userId, payload, updatedAt);
    await pushVendorSettings(db, userId, payload, updatedAt);
  } catch (err) {
    console.error('Failed to persist or sync vendor settings:', err);
  }
}

export const useVendorStore = create<VendorSettingsState & VendorSettingsActions>(
  (set, get) => ({
    tiers: DEFAULT_TIERS,
    stickerRules: DEFAULT_STICKER_RULES,
    hasSeenTour: true,
    isTourActive: false,

    setTiers: (tiers) => set({ tiers }),
    setStickerRules: (rules) => set({ stickerRules: rules }),

    updateTier: (index, updates) => {
      set((state) => {
        const next = [...state.tiers];
        next[index] = { ...next[index], ...updates };
        return { tiers: next };
      });

      const userId = currentUserId;
      if (userId && settingsLoaded) {
        const state = get();
        persistSettings(state, userId);
      }
    },

    updateStickerRules: (updates) => {
      set((state) => ({
        stickerRules: { ...state.stickerRules, ...updates },
      }));

      const userId = currentUserId;
      if (userId && settingsLoaded) {
        const state = get();
        persistSettings(state, userId);
      }
    },

    getCashOffer: (marketPrice) => {
      if (marketPrice <= 0) return 0;

      const { tiers } = get();
      if (tiers.length === 0) return 0;

      const sorted = [...tiers].sort((a, b) => a.minDollar - b.minDollar);
      let tier = sorted.find(
        (t) => marketPrice >= t.minDollar && marketPrice <= t.maxDollar
      );

      if (!tier) {
        tier =
          marketPrice < sorted[0].minDollar
            ? sorted[0]
            : sorted[sorted.length - 1];
      }

      return Number((marketPrice * (tier.marginPercent / 100)).toFixed(2));
    },

    getStickerPrice: (marketPrice) => {
      const { stickerRules } = get();

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

    getConditionedMarket: (marketPrice, condition) => {
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

    launchTour: () => set({ isTourActive: false }),
    completeTour: () => set({ isTourActive: false, hasSeenTour: true }),

    loadForUser: async (userId) => {
      currentUserId = userId;

      if (!userId) {
        settingsLoaded = false;
        set({
          isTourActive: false,
          hasSeenTour: true,
        });
        return;
      }

      const db = await getDb();
      if (!db) return;

      try {
        const [localJson, remote] = await Promise.all([
          getVendorSettings(db, userId).catch((err) => {
            console.error('Failed to load local vendor settings:', err);
            return null;
          }),
          pullVendorSettings(db, userId).catch((err) => {
            console.error('Failed to pull remote vendor settings:', err);
            return null;
          }),
        ]);

        settingsLoaded = false;
        set({ isTourActive: false, hasSeenTour: true });

        let localUpdatedAt = 0;
        let parsed: {
          tiers?: BuyTier[];
          stickerRules?: StickerRules;
          updatedAt?: number;
        } | null = null;

        if (localJson) {
          try {
            parsed = JSON.parse(localJson) as {
              tiers?: BuyTier[];
              stickerRules?: StickerRules;
              updatedAt?: number;
            };
            if (typeof parsed?.updatedAt === 'number') {
              localUpdatedAt = parsed.updatedAt;
            }
          } catch (err) {
            console.error('Failed to parse local vendor settings:', err);
          }
        }

        // Last-Write-Wins: prefer the source with the most recent updated_at.
        const winner =
          remote && remote.updatedAt > localUpdatedAt ? remote : null;

        if (winner?.settingsJson) {
          try {
            parsed = JSON.parse(winner.settingsJson) as {
              tiers?: BuyTier[];
              stickerRules?: StickerRules;
            };
          } catch (err) {
            console.error('Failed to parse remote vendor settings:', err);
          }
        }

        if (parsed) {
          if (Array.isArray(parsed.tiers) && parsed.tiers.length > 0) {
            set({ tiers: parsed.tiers });
          }
          if (parsed.stickerRules) {
            set({ stickerRules: parsed.stickerRules });
          }
        }

        // If we have a newer local copy, push it up so the cloud matches.
        if (!winner && localUpdatedAt > 0 && localJson) {
          pushVendorSettings(db, userId, localJson, localUpdatedAt).catch(
            (err) => {
              console.error('Failed to push local vendor settings:', err);
            }
          );
        }

        settingsLoaded = true;
      } catch (err) {
        console.error('Failed to load or sync vendor settings:', err);
      }
    },
  })
);
