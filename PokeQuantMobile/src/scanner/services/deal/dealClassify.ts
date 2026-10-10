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
  | 'STABLE_FLAT'
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
