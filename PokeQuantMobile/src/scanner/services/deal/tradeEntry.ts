// Trade-sheet entry helpers — key factory, cash parsing, credit-rate
// vocabulary, finish-variant hydration, and the TradeEntry→CatalogMatch
// adapter that feeds the nested DealAnalysisSheet.
import {
  getCardSignals,
  openCatalogDatabase,
} from '../../../db/catalogDb';
import type { CatalogMatch } from '../catalog/catalogMatcher';
import type { ScanCatalogVariant } from '../../types/catalog';
import type { TradeEntry } from './tradeEval';

/** A catalog row the user can add to their side of the trade. */
export type TradePick = {
  productId: number;
  name: string;
  number: string;
  set: string;
  marketPrice: number;
  imageUrl: string | undefined;
};

let entrySeq = 0;
export const nextTradeEntryKey = () => `te${++entrySeq}`;

/** Table-standard trade-credit rates — their incoming cards count at
 *  this fraction of face. 80% is the dominant vendor convention. */
export const TRADE_RATE_OPTIONS = [0.7, 0.8, 0.85, 0.9, 1];

export function parseTradeCash(text: string): number {
  const n = Number.parseFloat(text.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** All finish variants for a product from the stamped signals table —
 *  doubles as the nested analysis sheet's finish switcher. */
export async function tradeVariantsFor(
  productId: number,
  preferSubType?: string | null
): Promise<ScanCatalogVariant[]> {
  try {
    const db = await openCatalogDatabase();
    const subs = (await getCardSignals(db, [productId]))[productId] ?? {};
    const list = Object.values(subs).map((s) => ({
      subType: s.subType,
      marketPrice: s.price ?? 0,
      date: s.priceDate ?? '',
      signal: s,
    }));
    return list.sort((a, b) =>
      a.subType === preferSubType
        ? -1
        : b.subType === preferSubType
          ? 1
          : b.marketPrice - a.marketPrice
    );
  } catch {
    return [];
  }
}

export function tradeEntryMatch(entry: TradeEntry): CatalogMatch {
  return {
    card: {
      productId: entry.productId ?? 0,
      name: entry.name,
      number: entry.number ?? '',
      set: entry.set ?? '',
      rarity: null,
      imageUrl: entry.imageUrl ?? '',
      variants:
        entry.variants ??
        (entry.subType
          ? [
              {
                subType: entry.subType,
                marketPrice: entry.price,
                date: '',
                signal: entry.signal,
              },
            ]
          : []),
    },
    method: 'fused',
    confidence: 1,
  };
}
