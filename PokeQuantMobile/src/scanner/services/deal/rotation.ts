// Portfolio reads — what the verdict means for a card already in the
// case: which triage bucket it lands in, and what the class offer band
// pays against the vendor's own tier rate.
import type { CardSignal } from '../../../db/catalogDb';
import type { SeriesFeatures } from './seriesSignals';
import type { DealRead } from './types';
import { onRealFloor } from './evidence';

export type RotationBucket = 'grow' | 'keep' | 'watch' | 'rotate' | 'dead';

/** Inventory triage — which bucket a held card belongs in. `grow` and
 *  `keep` are the stock you want more of; `watch` is floor-tests and
 *  fading peaks that need a trigger watched; `rotate` is actively
 *  bleeding money; `dead` is parked capital that isn't growing.
 *  A POST_SPIKE_BLEED parked on its floor is a watch; mid-air it's
 *  a rotate — pass the signal so the real shelves can prove the
 *  floor (the 90d low can't — a faller's price IS its recent low). */
export function rotationBucket(
  read: DealRead,
  signal?: CardSignal | null,
  features?: SeriesFeatures
): RotationBucket {
  switch (read.cls) {
    case 'STABLE_GROWER':
    case 'REVIVAL':
    case 'DIP_BUY':
      return 'grow';
    case 'AT_PEAK':
      return read.peakState === 'intact' ? 'grow' : 'watch';
    case 'STABLE_FLAT':
    case 'LOW_DATA':
      return 'keep';
    case 'BASE_FORMING':
      return read.variant === 'testing' ? 'watch' : 'keep';
    case 'POST_SPIKE_BLEED': {
      // "At its 90d low" is not floor evidence — a falling card's
      // price IS the recent low, so that proximity check waved every
      // fresh knife through to watch (the inventory audit: all the
      // low90d-based watches were same-week low prints; none was an
      // established shelf). Watch needs a real floor: the swing
      // shelf or stamped deep shelf in proximity, or ≥2 counted
      // tests saying buyers defended the level before.
      const onFloor =
        (features?.floorTests ?? 0) >= 2 || onRealFloor(signal, features);
      return onFloor ? 'watch' : 'rotate';
    }
    case 'DORMANT':
      return 'watch';
    // A cycler always has a live plan — sell the ceiling, exit under
    // the floor. That's "holding, but a trigger is armed" by definition.
    case 'RANGE_PLAY':
      return 'watch';
    case 'FREE_FALL':
    case 'DECLINER':
    case 'HYPE_DECAY':
      return 'rotate';
    case 'DEAD_STABLE':
      return 'dead';
  }
}

/** Apply the class band to the vendor's own tier cash offer. */
export function offerBand(
  read: DealRead,
  baseOffer: number
): { open: number; max: number } {
  return {
    open: Number((baseOffer * read.offerLoFactor).toFixed(2)),
    max: Number((baseOffer * read.offerHiFactor).toFixed(2)),
  };
}
