import { colors } from '../../../constants/colors';
import type { CardSignal } from '../../../db/catalogDb';

// Deal classification — composes the stamped engine signals into the
// table-time read the vendor actually needs: what kind of deal is this,
// how hard to shield the offer, and what to say to the customer.
// Pure classification on shipped stats — everything here is instant.

export type DealClassId =
  | 'DIP_BUY'
  | 'FREE_FALL'
  | 'AT_PEAK'
  | 'STABLE_GROWER'
  | 'DECLINER'
  | 'STABLE_FLAT'
  | 'DEAD_STABLE'
  | 'DORMANT'
  | 'LOW_DATA';

export type PeakState = 'intact' | 'fading' | 'topping';

export type DealRead = {
  cls: DealClassId;
  label: string;
  headline: string;
  color: string;
  risk: 'good' | 'neutral' | 'risky';
  /** Multiply the tier cash offer by these to get the open/max band. */
  offerLoFactor: number;
  offerHiFactor: number;
  /** Customer-relayable reasoning — defensible, not a number from thin air. */
  script: string;
  peakState?: PeakState;
};

function f(v: number | null | undefined, fallback = 0): number {
  return v ?? fallback;
}

export function classifyDeal(signal: CardSignal | null | undefined): DealRead {
  const price = signal?.price ?? null;
  const stance = signal?.stance ?? null;
  const trend = signal?.trend ?? null;
  const r7 = signal?.ret7d ?? null;
  const r30 = signal?.ret30d ?? null;
  const r90 = signal?.ret90d ?? null;

  if (!signal || !signal.action || signal.action === 'UNRATED' || price == null) {
    return {
      cls: 'LOW_DATA',
      label: 'Low data',
      headline: 'Thin price history — no reliable read',
      color: colors.textMuted,
      risk: 'risky',
      offerLoFactor: 0.7,
      offerHiFactor: 0.8,
      script:
        "This one doesn't have much sales history to go on, so I have to " +
        'stay conservative on the offer.',
    };
  }

  if (stance === 'falling') {
    // A dip inside an intact long-term uptrend is a different animal than
    // a card in genuine decline — the trend line is the difference.
    if (trend === 'appreciating' && f(r90) > 0 && f(signal.cagr) > 0) {
      return {
        cls: 'DIP_BUY',
        label: 'Dip buy',
        headline: 'Short-term dip inside an appreciating card',
        color: colors.velocityPositive,
        risk: 'good',
        offerLoFactor: 0.9,
        offerHiFactor: 1.0,
        script:
          "It's dipped off a strong run — the longer trend is still up, " +
          'so I can stay close to full rate on this.',
      };
    }
    return {
      cls: 'FREE_FALL',
      label: 'Free fall',
      headline: `Down ${Math.abs(f(r30)).toFixed(0)}% in 30d and still sliding`,
      color: colors.velocityNegative,
      risk: 'risky',
      offerLoFactor: 0.7,
      offerHiFactor: 0.8,
      script:
        `Market's down ${Math.abs(f(r30)).toFixed(0)}% this month and ` +
        "hasn't found a floor yet — I have to buy where it's going, " +
        'not where it was.',
    };
  }

  if (stance === 'elevated' || stance === 'elevated_rising') {
    // Continuation read: is the peak still building or rolling over?
    let peakState: PeakState = 'intact';
    if (r7 != null && r7 < -3) {
      peakState = r30 != null && r30 < 0 ? 'topping' : 'fading';
    }
    const band: Record<PeakState, [number, number]> = {
      intact: [0.9, 1.0],
      fading: [0.8, 0.9],
      topping: [0.7, 0.8],
    };
    const scripts: Record<PeakState, string> = {
      intact:
        "It's at the top of its range but the trend hasn't broken — " +
        'I can pay near rate, just no premium for the peak.',
      fading:
        "It's priced at its high but momentum's cooling — I need a " +
        'little cushion in case it starts easing back.',
      topping:
        "It's been at the top and it's already starting to roll over — " +
        'I have to protect myself on this one.',
    };
    const [lo, hi] = band[peakState];
    return {
      cls: 'AT_PEAK',
      label: `At peak · ${peakState}`,
      headline:
        peakState === 'intact'
          ? 'Top of range — trend still intact'
          : peakState === 'fading'
            ? 'At peak — momentum cooling'
            : 'At peak — already rolling over',
      color:
        peakState === 'intact'
          ? colors.velocityPositive
          : colors.warning,
      risk: peakState === 'topping' ? 'risky' : 'neutral',
      offerLoFactor: lo,
      offerHiFactor: hi,
      script: scripts[peakState],
      peakState,
    };
  }

  if (stance === 'depressed') {
    // "Cheap" splits three ways on slope — the engine's depressed stamp
    // only describes the level, not the direction. A knife (−10%/mo or
    // −7%/wk) is Free fall; a slow long bleed is Long-term decline;
    // only a genuinely flat cheap card is Dormant.
    if (f(r30) <= -10 || f(r7) <= -7) {
      return {
        cls: 'FREE_FALL',
        label: 'Free fall',
        headline: `Cheap and still falling — down ${Math.abs(f(r30)).toFixed(0)}% in 30d`,
        color: colors.velocityNegative,
        risk: 'risky',
        offerLoFactor: 0.7,
        offerHiFactor: 0.8,
        script:
          "It's cheap versus its own history but it's still dropping — " +
          "I have to buy where it's going, not where it was.",
      };
    }
    if (trend === 'depreciating' || f(r90) <= -15) {
      return {
        cls: 'DECLINER',
        label: 'Long-term decline',
        headline: `Near its floor and still bleeding${f(r90) < 0 ? ` — ${Math.abs(f(r90)).toFixed(0)}% in 90d` : ''}`,
        color: colors.velocityNegative,
        risk: 'risky',
        offerLoFactor: 0.8,
        offerHiFactor: 0.9,
        script:
          "It's cheap, but the long trend is still drifting down — it " +
          "sells fine but doesn't hold value, so I keep margin in it.",
      };
    }
    return {
      cls: 'DORMANT',
      label: 'Dormant / cheap',
      headline: 'Priced low — but no uptrend to ride yet',
      color: colors.warning,
      risk: 'neutral',
      offerLoFactor: 0.8,
      offerHiFactor: 0.9,
      script:
        "It's cheap right now but it's been flat a while — nothing says " +
        "it's turning up yet, so I keep a little margin.",
    };
  }

  if (trend === 'appreciating') {
    return {
      cls: 'STABLE_GROWER',
      label: 'Stable grower',
      headline: 'Steady appreciation — safe to stock',
      color: colors.velocityPositive,
      risk: 'good',
      offerLoFactor: 0.9,
      offerHiFactor: 1.0,
      script:
        "This one's been climbing steadily, not spiking — it holds " +
        'value well, so I can pay full rate.',
    };
  }

  // A neutral/quiet stance on top of a depreciating long trend is not
  // "stable flat" — it's a slow leak. Distinct class so the offer shields.
  if (trend === 'depreciating') {
    return {
      cls: 'DECLINER',
      label: 'Long-term decline',
      headline: `Bleeding long-term${signal.cagr != null ? ` (${signal.cagr.toFixed(0)}%/yr)` : ''} — thin margin for error`,
      color: colors.velocityNegative,
      risk: 'risky',
      offerLoFactor: 0.8,
      offerHiFactor: 0.9,
      script:
        "The long-term trend on this is drifting down — it sells fine " +
        "but doesn't hold value, so I keep some margin in it.",
    };
  }

  // Reaching here means flat NOW — check whether it's flat because it
  // died. A deeply negative long-term CAGR on a flat card is post-hype
  // spent: stable, but no growth left. Honest read for stock decisions.
  if (f(signal.cagr) <= -15) {
    return {
      cls: 'DEAD_STABLE',
      label: 'Dead / stable',
      headline: `Flat now — but long-term it's spent (${f(signal.cagr).toFixed(0)}%/yr)`,
      color: colors.warning,
      risk: 'neutral',
      offerLoFactor: 0.85,
      offerHiFactor: 0.95,
      script:
        "It moves at rate and won't tank on you, but the growth is gone — " +
        'only pick it up if you need the stock.',
    };
  }
  return {
    cls: 'STABLE_FLAT',
    label: 'Stable / flat',
    headline: 'Price sits in a flat band — moves at rate',
    color: colors.text,
    risk: 'neutral',
    offerLoFactor: 0.85,
    offerHiFactor: 0.95,
    script:
      "Price has been pretty flat on this one — no real momentum " +
      'either way, so the standard rate applies.',
  };
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

/** Same classes, phrased for "I already hold this" instead of
 *  "should I buy it" — the inventory-side read. */
export function ownerNote(read: DealRead): string {
  switch (read.cls) {
    case 'FREE_FALL':
      return "It's falling hard — moving it sooner beats riding it down.";
    case 'DECLINER':
      return 'Long-term bleed — better to move it than to ride it down.';
    case 'AT_PEAK':
      return read.peakState === 'topping'
        ? "It's already rolling over — take the win before it fades."
        : read.peakState === 'fading'
          ? "Momentum's cooling at the top — a good window to move it."
          : 'At its high and still strong — holding or selling into strength both work.';
    case 'STABLE_GROWER':
      return 'Steady climb — holding is doing the work for you.';
    case 'DIP_BUY':
      return 'A dip inside an uptrend — hold; this is the dip others buy.';
    case 'DEAD_STABLE':
      return "Stable but spent — it won't grow; keep it as filler or move it when you need the slot.";
    case 'DORMANT':
      return 'Cheap and quiet — a patience hold, not dead weight.';
    case 'LOW_DATA':
      return 'Trust your sticker over the model on this one.';
    default:
      return 'Flat and stable — no urgency in either direction.';
  }
}
