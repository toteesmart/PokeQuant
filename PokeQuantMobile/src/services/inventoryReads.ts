// Finish-fallback lookups for inventory rows — signals and deep
// features are keyed by product finish; inventory rows store the
// scanned finish in productType. Shared with the shift tracker so a
// row's badge, sheet and diff all read the same finish.
import { pickSignalForFinish, type CardSignal } from '../db/catalogDb';
import type { SeriesFeatures } from '../scanner/services/deal/seriesSignals';
import type { InventoryCard } from '../store/inventoryStore';

// Shared finish fallback lives in catalogDb (pickSignalForFinish).
export function signalForCard(
  signalMap: Record<number, Record<string, CardSignal>>,
  card: InventoryCard,
): CardSignal | undefined {
  return pickSignalForFinish(signalMap, card);
}

// Same finish fallback as the signal map — the held finish first,
// then Normal, then whatever's loaded.
export function featuresForCard(
  featureMap: Record<number, Record<string, SeriesFeatures>>,
  card: { productId?: number | null; productType?: string },
): SeriesFeatures | undefined {
  if (card.productId == null) return undefined;
  const byFinish = featureMap[card.productId];
  if (!byFinish) return undefined;
  const finish = card.productType;
  return (finish ? byFinish[finish] : undefined) ?? byFinish.Normal ?? Object.values(byFinish)[0];
}
