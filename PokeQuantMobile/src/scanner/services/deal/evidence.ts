// Shared range/floor evidence resolution — the ONE place the stamp
// path (card_deep fields) and the deep path (SeriesFeatures) get
// reconciled into a single answer. Every classifier input that exists
// on both paths must resolve through here (AGENTS.md: "two data
// surfaces — keep them coherent"); badges, the sheet Pattern facet,
// ownerNote and the claims verifier all quote THIS resolution.
import type { CardSignal } from '../../../db/catalogDb';
import type { SeriesFeatures } from './seriesSignals';
import type { RangeEvidence, RangePosition } from './types';

/** The ONE position verdict — every "parked on"/"falling toward"/"at
 *  the sell end" claim resolves here against the levels the surface
 *  actually quotes. Resolution order is the honesty contract:
 *
 *  1. no price → 'no-structure'.
 *  2. The ×0.92 exit band only exists when the ceiling is a plausible
 *     RANGE TOP — it has to reach the recent-regime high zone (the
 *     same 0.6×ath bar the RANGE_PLAY core applies). A crater-shelf
 *     bounce target ($1.90 stamped against an ~$9 ATH) is a bounce
 *     level, not a sell end — treating it as one parked a young card
 *     on a held floor at "the top of its range" and stole the basing
 *     read (tremendous bomb). Degenerate evidence (floor above a real
 *     ceiling) also resolves 'no-structure'.
 *  3. CEILING-SIDE FIRST — price in the exit band of a plausible
 *     ceiling, or at/above the stamped sell-into → 'at-ceiling'. It
 *     wins even inside the floor band: a card can't be "sitting on a
 *     low" at the top of its own range (ninetales 42352: $38.86 parked
 *     over the $37.95 sell-into still read "Sitting on a low").
 *  4. floor-side bands, when a resolved floor exists: under the ~3%
 *     crack line → 'through-floor'; the ×[0.97,1.15] parked band →
 *     'on-floor'; the wider ×1.25 reach band → 'approaching-floor'.
 *  5. everything else with a floor → 'mid-range'; no floor at all →
 *     'no-structure' (a lone ceiling can't make a range to be mid of). */
export function resolvePosition(
  price: number | null | undefined,
  floor: number | null | undefined,
  ceiling: number | null | undefined,
  stampedTarget: number | null | undefined,
  ath?: number | null | undefined,
): RangePosition {
  if (price == null || price <= 0) return 'no-structure';
  const realCeiling =
    ceiling != null && (ath == null || ceiling >= ath * 0.6) ? ceiling : null;
  const realFloor = floor != null && floor > 0 ? floor : null;
  if (realFloor != null && realCeiling != null && realFloor > realCeiling) return 'no-structure';
  if (realCeiling != null && price >= realCeiling * 0.92) return 'at-ceiling';
  // The stamped sell-into stands on its own structure — the stamp's
  // own shelf/target pair stays coherent even when the caller's floor
  // resolves elsewhere, so "price reached the level the stamp says to
  // sell into" is honest regardless of where floors sit.
  if (stampedTarget != null && price >= stampedTarget) return 'at-ceiling';
  if (realFloor == null) return 'no-structure';
  if (price < realFloor * 0.97) return 'through-floor';
  if (price <= realFloor * 1.15) return 'on-floor';
  if (price <= realFloor * 1.25) return 'approaching-floor';
  return 'mid-range';
}

export function resolveRangeEvidence(
  signal: CardSignal | null | undefined,
  features?: SeriesFeatures | null,
): RangeEvidence {
  const price = signal?.price ?? null;
  const floor = features?.floorPrice ?? signal?.shelfPrice ?? null;
  // Floor-test counts measure the same thing at two resolutions: the
  // stamp counts troughs on full history, the series pass recounts on
  // the shipped downsampled window — which can only UNDER-count, never
  // invent tests the stamp missed (golduck: stamp 3 vs window 1 →
  // badge RANGE_PLAY, sheet FREE_FALL on identical evidence). When both
  // resolve the same level, the higher count is the honest one; a fresh
  // touch the stamp predates still lands through the series count.
  const sameShelf =
    features?.floorPrice != null &&
    signal?.shelfPrice != null &&
    Math.abs(features.floorPrice - signal.shelfPrice) <= signal.shelfPrice * 0.08;
  // When the window resolves NO floor, its zero troughs say nothing —
  // the stamp's count is the only evidence and must stand on its own
  // (a window that under-resolves can't veto a shelf it never saw).
  const tests =
    features?.floorPrice == null
      ? (signal?.shelfTests ?? 0)
      : sameShelf
        ? Math.max(features?.floorTests ?? 0, signal?.shelfTests ?? 0)
        : (features?.floorTests ?? 0);
  // Cycle days resolve per-resolution like the test count. The window
  // under-resolves real rhythms — a ~150-point shipped series can't
  // show two full 140d swings, so it measures "256d spacing" and the
  // band check fails (sharpedo: stamp 140.5d at the same shelf). The
  // stamp's full-history median has the opposite failure — pre-regime
  // chop pollutes it (zekrom: 12d vs the window's 31.5d). Same rule as
  // tests: when both measured the SAME shelf, the in-band measure is
  // the one that saw a rhythm; otherwise the window's regime wins.
  // And when the window resolves NO floor, its spacing isn't about
  // the resolved shelf at all — the stamp's measure stands alone
  // (fuzz: window saw 341d trough spacing on shelves it never located
  // and vetoed the stamp's honest 143d cycle).
  const inCycleBand = (c: number | null | undefined): c is number =>
    c != null && c >= 21 && c <= 180;
  const windowBlind = features?.floorPrice == null;
  const cycleDays = windowBlind
    ? (signal?.cycleDays ?? features?.cycleDays ?? null)
    : sameShelf &&
        features?.cycleDays != null &&
        signal?.cycleDays != null &&
        !inCycleBand(features.cycleDays) &&
        inCycleBand(signal.cycleDays)
      ? signal.cycleDays
      : (features?.cycleDays ?? signal?.cycleDays ?? null);
  // Bounce median is the third resolution leg — same shelf ⇒ same
  // structure ⇒ take the better-resolved measure; a blind window's
  // troughs aren't this shelf's bounce memory.
  const bouncePct = windowBlind
    ? (signal?.medianBouncePct ?? features?.medianBouncePct ?? null)
    : sameShelf && features?.medianBouncePct != null && signal?.medianBouncePct != null
      ? Math.max(features.medianBouncePct, signal.medianBouncePct)
      : (features?.medianBouncePct ?? signal?.medianBouncePct ?? null);
  const ceiling =
    features?.sellIntoPrice ??
    features?.targetPrice ??
    signal?.targetPrice ??
    (floor != null && bouncePct != null ? floor * (1 + bouncePct / 100) : null);
  // The range must BE the card's market — the ceiling reaches the high
  // zone. A launch crash parked on a shelf (tremendous bomb: floor
  // $1.62 vs ATH $9.40) is a crater bottom, not a cycle. The honest
  // bound is the RECENT-REGIME high (a 21–180d-cycle range is a ~90d
  // structure): a longer window's max can be a pre-regime crash
  // remnant (lillie: $41.76 launch spike inside the 380d window vetoed
  // the real $19.5–23 channel — badge ranged on high90d, sheet knifed
  // on window ATH). high90d is the stamped 90d high; the series' own
  // ATH is the fallback when no recent-high stamp ships; the drawdown
  // reconstruction is last resort.
  const ath =
    signal?.high90d ??
    features?.athPrice ??
    (signal?.drawdown != null && signal.drawdown > -99 && price != null
      ? price / (1 + signal.drawdown / 100)
      : null);
  return {
    floor,
    tests,
    cycleDays,
    bouncePct,
    ceiling,
    ath,
    sameShelf,
    // Position resolves against THIS resolution — the same floor,
    // ceiling and recent-regime high every other surface quotes —
    // plus the stamped sell-into.
    position: resolvePosition(price, floor, ceiling, signal?.targetPrice, ath),
  };
}

/** "A real floor is within reach" — the resolved position says the
 *  price sits ON the shelf (on-floor) or is closing into the reach
 *  band (approaching-floor). This is the DIRECTIONAL claim: the knife
 *  is falling toward a held level, the slide landed in reach of one,
 *  the bleeder has a floor beneath it worth watching. It is NOT the
 *  parked-on claim — "sitting on the low" copy needs the resolved
 *  `position === 'on-floor'` verdict. The verdict resolves once in
 *  `resolveRangeEvidence` — single-shelf (the window's own resolution
 *  wins when it resolves a different level) and ceiling-first, so a
 *  shelf a mid-air card can't reach and a sell end the card already
 *  passed both read false here. A raw 90d low is NOT floor evidence
 *  either way: a falling card's price IS its recent low, so low90d
 *  proximity can't separate "parked on support" from "mid-knife"
 *  (inventory audit: every low90d-based floor claim was a same-week
 *  fresh low print; none was an established shelf). A real floor has
 *  to have been touched and left before — the swing detector's
 *  troughs and the stamped shelf are exactly that evidence. */
export function floorWithinReach(
  signal: CardSignal | null | undefined,
  features?: SeriesFeatures | null,
): boolean {
  const pos = resolveRangeEvidence(signal, features).position;
  return pos === 'on-floor' || pos === 'approaching-floor';
}
