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

/** Where the price sits against the resolved structure — computed ONCE
 *  inside `resolveRangeEvidence` and quoted by every gate and read that
 *  asserts position. Ceiling-side resolves BEFORE floor-side: a card at
 *  the top of its own range can't be "sitting on a low" even when it's
 *  inside the floor band. `low90d` never feeds it (invariant 14); the
 *  distributional position leg (`pctile1y`) stays a separate input.
 *
 *  - through-floor: under the crack line (~3% below the resolved floor)
 *  - on-floor: parked on the shelf (×[0.97,1.15] — the series' own
 *    atFloor/atShelf tightness)
 *  - approaching-floor: above the shelf inside the ×1.25 reach band —
 *    "falling toward" is honest here, "sitting on" is not
 *  - mid-range: above the reach band, below the sell end
 *  - at-ceiling: at the sell end — the ×0.92 exit band of the resolved
 *    ceiling, or the stamped sell-into reached outright
 *  - no-structure: no usable floor/ceiling evidence, or a degenerate
 *    resolution (floor above ceiling) that can't place the price */
export type RangePosition =
  'through-floor' | 'on-floor' | 'approaching-floor' | 'mid-range' | 'at-ceiling' | 'no-structure';

/** The range-structure evidence, resolved across the two measurement
 *  resolutions the same way every consumer sees it — the classifier's
 *  badge/sheet paths, the analysis sheet's Pattern facet, and the
 *  claims audit all quote THIS resolution, so no surface can cite a
 *  cycle or bounce the classifier didn't use. `position` is the same
 *  contract for proximity claims: the gate's precondition IS the
 *  copy's evidence, so a landing cannot assert what wasn't verified. */
export type RangeEvidence = {
  floor: number | null;
  tests: number;
  /** The observed held-bounce ledger, resolved across both surfaces —
   *  the stamped `analogBounceN` ("bounced K of N" on full history) vs
   *  the window's `floorBounces` (shelf sits whose ≥15% rally never
   *  broke its low). Tests+cycle measure the metronome and bouncePct
   *  the amplitude; this counts whether bounces actually HELD — the
   *  rhythm claim's own proof (item 59: "bounces on a rhythm" at a
   *  0-of-3 ledger is a fiction). */
  bounces: number;
  cycleDays: number | null;
  bouncePct: number | null;
  ceiling: number | null;
  ath: number | null;
  sameShelf: boolean;
  position: RangePosition;
};
