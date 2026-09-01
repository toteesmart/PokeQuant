import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

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
};

// Default vendor buy tiers. These exact percentage values are automatically
// imported into the Search & Buy screen's floating cards to calculate dynamic
// cash offers based on the live market price.
const DEFAULT_TIERS: BuyTier[] = [
  { minDollar: 0, maxDollar: 10, marginPercent: 50 },
  { minDollar: 10, maxDollar: 50, marginPercent: 60 },
  { minDollar: 50, maxDollar: 999, marginPercent: 70 },
];

const VendorSettingsContext =
  createContext<VendorSettingsContextValue | null>(null);

export function VendorSettingsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [tiers, setTiers] = useState<BuyTier[]>(DEFAULT_TIERS);
  const [stickerRules, setStickerRules] = useState<StickerRules>(
    DEFAULT_STICKER_RULES
  );

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

  const getCashOffer = (marketPrice: number) => {
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
  };

  const getStickerPrice = (marketPrice: number) => {
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
  };

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
    }),
    [tiers, sortedTiers, stickerRules]
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
