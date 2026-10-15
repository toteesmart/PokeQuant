// Deal engine vocabulary — the verdict types every layer shares.
// Closed taxonomy: a new class only lands when the ACTION changes
// (AGENTS.md invariant 1) — variants + notes carry the story.

export type DealClassId =
  | 'DIP_BUY'
  | 'FREE_FALL'
  | 'HYPE_DECAY'
  | 'POST_SPIKE_BLEED'
  | 'REVIVAL'
  | 'BASE_FORMING'
  | 'AT_PEAK'
  | 'STABLE_GROWER'
  | 'DECLINER'
  | 'STABLE_FLAT'
  | 'DEAD_STABLE'
  | 'DORMANT'
  | 'RANGE_PLAY'
  | 'LOW_DATA';

export type PeakState = 'intact' | 'fading' | 'topping';

export type DealRead = {
  cls: DealClassId;
  label: string;
  headline: string;
  color: string;
  risk: 'good' | 'neutral' | 'risky';
  /** Multipliers on the vendor's tier cash offer → open/max band.
   *  Anchored at 1.0 = the vendor's standard rate: stockable classes
   *  pay ~rate (0.95–1.05), risky classes discount below it. */
  offerLoFactor: number;
  offerHiFactor: number;
  /** Customer-relayable reasoning — defensible, not a number from thin air. */
  script: string;
  peakState?: PeakState;
  /** BASE_FORMING splits two ways: 'testing' = still falling into the
   *  floor (watch the hold/break), 'resting' = stopped and parked
   *  (quiet accumulation). RANGE_PLAY carries position in the cycle:
   *  'entry' = at the floor (buy end), 'exit' = at the ceiling (sell
   *  end), 'mid' = mid-range. Rotation triage needs the difference. */
  variant?: 'testing' | 'resting' | 'entry' | 'mid' | 'exit';
};

/** The range-structure evidence, resolved across the two measurement
 *  resolutions the same way every consumer sees it — the classifier's
 *  badge/sheet paths, the analysis sheet's Pattern facet, and the
 *  claims audit all quote THIS resolution, so no surface can cite a
 *  cycle or bounce the classifier didn't use. */
export type RangeEvidence = {
  floor: number | null;
  tests: number;
  cycleDays: number | null;
  bouncePct: number | null;
  ceiling: number | null;
  ath: number | null;
  sameShelf: boolean;
};
