// catalogDb — the facade every consumer imports from. Lifecycle lives in
// catalogSession, price reads in catalogPrices, quant-engine reads in
// catalogSignals, card-search in catalogSearch; this file re-exports all
// four so existing call sites stay put. setCatalogDatabase stays here
// because it spans session + prices.
import { type SQLiteDatabase } from 'expo-sqlite';
import { assignCatalogDb } from './catalogSession';
import { clearCardMarketAnalyticsCache } from './catalogPrices';

export * from './catalogSession';
export * from './catalogPrices';
export * from './catalogSignals';
export * from './catalogSearch';

export function setCatalogDatabase(rawDb: SQLiteDatabase): void {
  assignCatalogDb(rawDb);
  clearCardMarketAnalyticsCache();
}
