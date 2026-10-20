// Verdict construction — the DealRead each gate in classifyDeal lands
// on. Builders are pure: scalar params in, read out. The ordered
// decision list owns WHEN a read fires (precedence comments are the
// contract); this module owns WHAT it says — label, headline, band,
// risk, and the customer-relayable script. Offer factors anchor at
// 1.0 = the vendor's tier rate (invariant 7); language stays honest
// (invariants 8–10): floors are evidence, never forecasts. Functions
// appear in the same order the gates fire inside classifyDeal.
import { colors } from '../../../constants/colors';
import type { DealRead, PeakState } from './types';

/** LOW_DATA — no action stamp, UNRATED, or no price to read from. */
export function lowDataRead(): DealRead {
  return {
    cls: 'LOW_DATA',
    label: 'Low data',
    headline: "Not much sales history — can't call it",
    color: colors.textMuted,
    risk: 'risky',
    offerLoFactor: 0.85,
    offerHiFactor: 0.95,
    script:
      "This one doesn't have much sales history to go on, so I have to " +
      'stay conservative on the offer.',
  };
}

/** DIP_BUY — a stamped faller inside an intact appreciating trend. */
export function dipBuyRead(): DealRead {
  return {
    cls: 'DIP_BUY',
    label: 'Buy the dip',
    headline: 'Short-term dip inside an appreciating card',
    color: colors.velocityPositive,
    risk: 'good',
    offerLoFactor: 0.95,
    offerHiFactor: 1.05,
    script:
      "It's dipped off a strong run — the longer trend is still up, " +
      'so I can stay close to full rate on this.',
  };
}

/** AT_PEAK — elevated stances; is the peak still building or rolling over? */
export function atPeakRead(r7: number | null, r30: number | null): DealRead {
  let peakState: PeakState = 'intact';
  if (r7 != null && r7 < -3) {
    peakState = r30 != null && r30 < 0 ? 'topping' : 'fading';
  }
  const band: Record<PeakState, [number, number]> = {
    intact: [0.9, 1.0],
    fading: [0.9, 1.0],
    topping: [0.8, 0.9],
  };
  const scripts: Record<PeakState, string> = {
    intact:
      "It's at the top of its range but the trend hasn't broken — " +
      'I can pay near rate, just no premium for the peak.',
    fading:
      "It's priced at its high but the move is cooling — I need a " +
      'little cushion in case it starts easing back.',
    topping:
      "It's been at the top and it's already starting to roll over — " +
      'I have to protect myself on this one.',
  };
  const [lo, hi] = band[peakState];
  const peakWord =
    peakState === 'intact' ? 'still strong' : peakState === 'fading' ? 'easing' : 'rolling over';
  return {
    cls: 'AT_PEAK',
    label: `At its high · ${peakWord}`,
    headline:
      peakState === 'intact'
        ? 'Top of range — trend still intact'
        : peakState === 'fading'
          ? 'At its high — the move is cooling'
          : 'At peak — already rolling over',
    color: peakState === 'intact' ? colors.velocityPositive : colors.warning,
    risk: peakState === 'topping' ? 'risky' : 'neutral',
    offerLoFactor: lo,
    offerHiFactor: hi,
    script: scripts[peakState],
    peakState,
  };
}

/** HYPE_DECAY — a young series still coming off release hype. */
export function hypeDecayRead(drawdown: number): DealRead {
  return {
    cls: 'HYPE_DECAY',
    label: 'New-set slide',
    headline: `Off release hype — ${Math.abs(drawdown).toFixed(0)}% below its early high`,
    color: colors.velocityNegative,
    risk: 'risky',
    offerLoFactor: 0.85,
    offerHiFactor: 0.9,
    script:
      "It's still coming down from launch — normal for a new card, " +
      "but I only buy where it's going, not where it debuted.",
  };
}

/** RANGE_PLAY — a proven cycler; `variant` is the card's position in
 *  the range (decided at the gate: entry = at the floor, exit = at
 *  the ceiling, mid = mid-air). */
export function rangePlayRead(
  variant: 'entry' | 'mid' | 'exit',
  floor: number,
  ceiling: number,
  cycleDays: number,
): DealRead {
  const cyc = Math.round(cycleDays);
  return {
    cls: 'RANGE_PLAY',
    label: 'Range bouncer',
    variant,
    headline:
      `Cycles ~$${floor.toFixed(2)} → ~$${ceiling.toFixed(2)} ` +
      `every ~${cyc} days — ` +
      (variant === 'entry'
        ? 'at the buy end of the range'
        : variant === 'exit'
          ? 'at the sell end of the range'
          : 'mid-range on the swing'),
    color: variant === 'entry' ? colors.velocityPositive : colors.warning,
    risk: variant === 'entry' ? 'good' : 'neutral',
    offerLoFactor: variant === 'entry' ? 0.95 : variant === 'mid' ? 0.85 : 0.75,
    offerHiFactor: variant === 'entry' ? 1.05 : variant === 'mid' ? 0.95 : 0.85,
    script:
      variant === 'entry'
        ? 'It bounces off this shelf on a rhythm — buy at the floor, ' +
          'sell the pop back toward the ceiling.'
        : variant === 'exit'
          ? 'Top of the range — it fades back to the floor on schedule. ' +
            'Sell into it; buying the top is buying the fade.'
          : 'Mid-swing on a proven range — the buy window is the floor ' +
            'and the sell window is the top; mid-air pays for neither.',
  };
}

/** POST_SPIKE_BLEED — real drawdown off an aging peak, still drifting. */
export function postSpikeBleedRead(drawdown: number, daysSinceHigh: number | null): DealRead {
  return {
    cls: 'POST_SPIKE_BLEED',
    label: 'Coming off its high',
    headline:
      daysSinceHigh != null
        ? `Down ${Math.abs(drawdown).toFixed(0)}% from its peak ~${Math.round(daysSinceHigh / 30)} months ago — still sliding`
        : `Down ${Math.abs(drawdown).toFixed(0)}% from its peak — still sliding`,
    color: colors.velocityNegative,
    risk: 'risky',
    offerLoFactor: 0.85,
    offerHiFactor: 0.95,
    script:
      "It's still coming off the top — yesterday's spike price isn't " +
      "today's. I buy where it's going, not where it peaked.",
  };
}

/** BASE_FORMING·testing — a knife dropping into a defended floor.
 *  `parked` is the resolved position's word for whether the price is
 *  ON the shelf or still closing into its reach band — "sitting on a
 *  low" only prints when the position verdict parked it there. */
export function knifeFloorTestRead(parked: boolean): DealRead {
  return {
    cls: 'BASE_FORMING',
    label: parked ? 'Sitting on a low' : 'Falling toward a low',
    variant: 'testing',
    headline: `Falling hard toward a low that's held before — whether it holds is the decision`,
    color: colors.warning,
    risk: 'neutral',
    offerLoFactor: 0.9,
    offerHiFactor: 1.0,
    script:
      "It's dropping into a level buyers have defended before — I " +
      "don't pay for a knife, but if the floor holds this is where " +
      'it turns.',
  };
}

/** FREE_FALL — knife-speed with real damage and no defended floor.
 *  `floorBeneath` is the resolved position's word for a shelf under
 *  the price — it can't stop the slide (that's why this read landed
 *  here and not at the floor-test gate), but "hasn't found a floor
 *  yet" can't print while a shelf is literally beneath it. */
export function freeFallRead(r7: number, r30: number, floorBeneath = false): DealRead {
  // Quote the leg that's actually knifing — a week-only knife on a
  // flat card must print "this week", never abs() of a green month
  // (golduck: +34.6%/mo rendered as "Down 35% in 30d").
  const legIsMonth = r30 <= -10;
  const legPct = legIsMonth ? r30 : Math.min(r7, r30);
  return {
    cls: 'FREE_FALL',
    label: 'Free fall',
    headline:
      `Down ${Math.abs(legPct).toFixed(0)}% ` +
      `${legIsMonth ? 'in 30 days' : 'this week'} and still sliding`,
    color: colors.velocityNegative,
    risk: 'risky',
    offerLoFactor: 0.75,
    offerHiFactor: 0.85,
    script:
      `Market's down ${Math.abs(legPct).toFixed(0)}% ` +
      `${legIsMonth ? 'this month' : 'this week'} and ` +
      (floorBeneath
        ? "the shelf under it hasn't stopped the slide — I have to " +
          "buy where it's going, not where it was."
        : "hasn't found a floor yet — I have to buy where it's going, " + 'not where it was.'),
  };
}

/** REVIVAL — a quiet/spent card showing fresh upward life. */
export function revivalRead(r7: number, r30: number): DealRead {
  return {
    cls: 'REVIVAL',
    label: 'Waking up',
    headline: `Quiet for a while — now up ${Math.max(r7, r30).toFixed(0)}% recently`,
    color: colors.velocityPositive,
    risk: 'good',
    offerLoFactor: 0.95,
    offerHiFactor: 1.05,
    script:
      "It's showing life after a long flat stretch — the kind of " +
      'early move worth paying rate for.',
  };
}

/** BASE_FORMING·resting — a real drawdown that stopped falling and is
 *  holding a floor on a card that isn't historically spent. */
export function baseFormingRestingRead(drawdown: number): DealRead {
  return {
    cls: 'BASE_FORMING',
    label: 'At a low',
    variant: 'resting',
    headline:
      `Down ${Math.abs(drawdown).toFixed(0)}% off its high but holding a ` +
      'floor — could build from here',
    color: colors.warning,
    risk: 'neutral',
    offerLoFactor: 0.95,
    offerHiFactor: 1.05,
    script:
      'It fell, then stopped — this level is holding. Safe to hold ' +
      'or stock at rate; the tell is whether it starts ticking up.',
  };
}

/** DECLINER — a cheap card (depressed stamp, low pctile) still
 *  bleeding; the slow long bleed, not the knife the gates caught.
 *  "Cheap" is the gate's own evidence — the depressed stamp plus the
 *  bottom-40 percentile. "Near its low" was a proximity claim the
 *  gate never verified: a resolved ceiling above the price made it
 *  print on a card at the top of its range (item 55). */
export function declinerNearLowRead(r90: number): DealRead {
  return {
    cls: 'DECLINER',
    label: 'Slow decline',
    headline: `Cheap and still sliding${r90 < 0 ? ` — ${Math.abs(r90).toFixed(0)}% in 90 days` : ''}`,
    color: colors.velocityNegative,
    risk: 'risky',
    offerLoFactor: 0.8,
    offerHiFactor: 0.9,
    script:
      "It's cheap, but the long trend is still drifting down — it " +
      "sells fine but doesn't hold value, so I keep margin in it.",
  };
}

/** DEAD_STABLE — cheap AND spent: flat at the floor, run is over. */
export function deadStableCheapRead(cagr: number): DealRead {
  return {
    cls: 'DEAD_STABLE',
    label: 'Spent / flat',
    headline: `Cheap and spent (${cagr.toFixed(0)}% a year) — no growth left`,
    color: colors.warning,
    risk: 'neutral',
    offerLoFactor: 0.8,
    offerHiFactor: 0.9,
    script:
      "It's cheap and flat — the run already happened. Fine as " +
      "filler stock, but don't pay up for growth that isn't coming.",
  };
}

/** DORMANT — cheap + alive but no appreciating stamp: nothing to ride. */
export function dormantRead(): DealRead {
  return {
    cls: 'DORMANT',
    label: 'Quiet / cheap',
    headline: 'Priced low — but no uptrend to ride yet',
    color: colors.warning,
    risk: 'neutral',
    offerLoFactor: 0.85,
    offerHiFactor: 0.95,
    script:
      "It's cheap right now but it's been flat a while — nothing says " +
      "it's turning up yet, so I keep a little margin.",
  };
}

/** STABLE_GROWER — a proven climber cooling off; dips get bought. */
export function growerCoolingRead(): DealRead {
  return {
    cls: 'STABLE_GROWER',
    label: 'Steady riser',
    headline: 'Long-term riser cooling off its run — dips like this get bought',
    color: colors.velocityPositive,
    risk: 'good',
    offerLoFactor: 0.95,
    offerHiFactor: 1.05,
    script:
      "This one's a proven climber pausing after a run — its dips " +
      'keep getting bought, so I can pay near rate here.',
  };
}

/** STABLE_GROWER — the appreciating catch-all (cooperating legs). */
export function growerSteadyRead(): DealRead {
  return {
    cls: 'STABLE_GROWER',
    label: 'Steady riser',
    headline: 'Climbing steadily — safe to stock',
    color: colors.velocityPositive,
    risk: 'good',
    offerLoFactor: 0.95,
    offerHiFactor: 1.05,
    script:
      "This one's been climbing steadily, not spiking — it holds " +
      'value well, so I can pay full rate.',
  };
}

/** DECLINER — depreciating trend still bleeding, or a stamped faller
 *  that survived every structural check. */
export function declinerSlideRead(cagr: number | null): DealRead {
  return {
    cls: 'DECLINER',
    label: 'Slow decline',
    headline: `Sliding long-term${cagr != null ? ` (${cagr.toFixed(0)}% a year)` : ''} — thin margin for error`,
    color: colors.velocityNegative,
    risk: 'risky',
    offerLoFactor: 0.8,
    offerHiFactor: 0.9,
    script:
      'The long-term trend on this is drifting down — it sells fine ' +
      "but doesn't hold value, so I keep some margin in it.",
  };
}

/** DEAD_STABLE — deeply negative lifetime CAGR on a card that's
 *  actually flat now: post-hype spent, not bleeding. */
export function deadStableSpentRead(cagr: number): DealRead {
  return {
    cls: 'DEAD_STABLE',
    label: 'Spent / flat',
    headline: `Flat now — but long-term it's spent (${cagr.toFixed(0)}% a year)`,
    color: colors.warning,
    risk: 'neutral',
    offerLoFactor: 0.8,
    offerHiFactor: 0.9,
    script:
      "It moves at rate and won't tank on you, but the growth is gone — " +
      'only pick it up if you need the stock.',
  };
}

/** BASE_FORMING·testing — a suppressed possible-cycler still sliding
 *  toward a floor whose pops are worth holding for. Same parked-vs-
 *  approaching split as the knife gate — the label claims what the
 *  resolved position verified, nothing tighter. */
export function bleedFloorTestRead(parked: boolean): DealRead {
  return {
    cls: 'BASE_FORMING',
    label: parked ? 'Sitting on a low' : 'Falling toward a low',
    variant: 'testing',
    headline: `Falling toward a low that's held before — whether it holds is the decision`,
    color: colors.warning,
    risk: 'neutral',
    offerLoFactor: 0.9,
    offerHiFactor: 1.0,
    script:
      "It's dropping into a level buyers have touched before — I " +
      "don't pay for a knife, but if the floor holds this is where " +
      'it turns.',
  };
}

/** STABLE_FLAT — the default: no directional read fired, nothing
 *  claimed the card on the way down. "Trading sideways" is the read's
 *  earned claim — a leg-speed absence, verified by reaching the tail.
 *  "Sits in a flat band" was a range-structure claim the tail never
 *  measured (item 55): a card with no resolved floor or ceiling has
 *  no band to sit in. */
export function stableFlatRead(): DealRead {
  return {
    cls: 'STABLE_FLAT',
    label: 'Flat & steady',
    headline: 'Trading sideways — worth the going rate',
    color: colors.text,
    risk: 'neutral',
    offerLoFactor: 0.95,
    offerHiFactor: 1.0,
    script:
      'Price has been pretty flat on this one — no real moves ' +
      'either way, so the standard rate applies.',
  };
}
