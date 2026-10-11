import { colors } from '../../../constants/colors';
import type { CardSignal } from '../../../db/catalogDb';
import type { SeriesFeatures } from './seriesSignals';

// Deal classification — composes the stamped engine signals into the
// table-time read the vendor actually needs: what kind of deal is this,
// how hard to shield the offer, and what to say to the customer.
// Pure classification on shipped stats — everything here is instant.

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

/** Classify from the stamped signal; when the caller has the card's
 *  price_series loaded (the analysis sheet does), pass its curve
 *  features — fresher returns and bounce/floor structure override the
 *  stalest stamp edges. List surfaces stay scalar-only. */
export function classifyDeal(
  signal: CardSignal | null | undefined,
  features?: SeriesFeatures
): DealRead {
  const price = signal?.price ?? null;
  const stance = signal?.stance ?? null;
  const trend = signal?.trend ?? null;
  // Series-fresh returns beat the stamps — they're computed at the
  // chart's last point, not the catalog's snapshot time.
  const r7 = features?.ret7d ?? signal?.ret7d ?? null;
  const r30 = features?.ret30d ?? signal?.ret30d ?? null;
  const r90 = signal?.ret90d ?? null;
  // A 'depreciating' stamp describes the whole window — a crash that
  // ended months ago still carries it. Only a slide still visible in
  // recent returns counts as bleeding; a flat card with an old crash
  // is dead/stable, not declining.
  // "Still bleeding" means the slide is happening NOW. A red quarter
  // alone doesn't count when the month has steadied — the crash can
  // sit inside a 90d window while the card recovers (ampharos: launch
  // crash → floor → +14% month). −0.8% on the month is flat, not
  // bleeding — that's why the r90 clause needs a real red month.
  const stillBleeding =
    f(r7) <= -7 || f(r30) <= -10 || (f(r90) <= -15 && f(r30) <= -3);

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
    return atPeakRead(r7, r30);
  }

  // New-set slide — a young series still coming off release hype. The
  // story beats the speed label: launch-window decay is expected, so it
  // shields hard but reads differently from a mature knife.
  if (
    isYoung(signal) &&
    f(signal.drawdown) <= -15 &&
    (f(r30) < 0 || f(r7) < 0)
  ) {
    return {
      cls: 'HYPE_DECAY',
      label: 'New-set slide',
      headline: `Off release hype — ${Math.abs(f(signal.drawdown)).toFixed(0)}% below its early high`,
      color: colors.velocityNegative,
      risk: 'risky',
      offerLoFactor: 0.7,
      offerHiFactor: 0.8,
      script:
        "It's still coming down from launch — normal for a new card, " +
        "but I only buy where it's going, not where it debuted.",
    };
  }

  // Post-spike bleed — a real drawdown off a peak that's already months
  // old and still drifting down. Checked before the generic knife rule:
  // "coming off a May spike" tells the story better than "free fall".
  // Old catalogs lack the peak-age stamp — a deep drawdown still
  // sliding is the bleed either way; the headline just loses the age.
  const dsh = features?.daysSinceAth ?? signal.daysSinceHigh;
  if (
    (dsh == null || (dsh >= 14 && dsh <= 365)) &&
    f(signal.drawdown) <= -25 &&
    (f(r30) <= -3 || f(r7) <= -3)
  ) {
    return {
      cls: 'POST_SPIKE_BLEED',
      label: 'Off the peak',
      headline:
        dsh != null
          ? `Down ${Math.abs(f(signal.drawdown)).toFixed(0)}% from its peak ~${Math.round(dsh / 30)}mo ago — still sliding`
          : `Down ${Math.abs(f(signal.drawdown)).toFixed(0)}% from its peak — still sliding`,
      color: colors.velocityNegative,
      risk: 'risky',
      offerLoFactor: 0.75,
      offerHiFactor: 0.85,
      script:
        "It's still coming off the top — yesterday's spike price isn't " +
        "today's. I buy where it's going, not where it peaked.",
    };
  }

  // Knife-speed WITH real damage — a red month is only a crash when it
  // breaks structure: deep drawdown, mid/low range position, broken
  // long trend, or extreme speed. A double-digit giveback off a peak
  // inside an intact uptrend is a pullback, not a free fall (the
  // flying-pikachu case: +690% all-time, 91st pctile, one soft month
  // is a grower cooling, not a card dying).
  const knifeSpeed = f(r30) <= -10 || f(r7) <= -7;
  const structural =
    f(signal.drawdown) <= -20 ||
    f(signal.pctile1y, 0) <= 50 ||
    trend === 'depreciating' ||
    f(r30) <= -20 ||
    f(r7) <= -15;
  // A bounce that already collapsed back onto a floor that held isn't
  // falling — the fall is done. Only a break *through* the floor is.
  const floorHeld =
    features?.failedBounce === true && features.atFloor === true;
  if (knifeSpeed && structural && !floorHeld) {
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

  // Revival — a quiet/spent card showing fresh upward life. This is the
  // pickup signal: momentum on a history that was flat or declining.
  if (isReviving(signal, r7, r30, trend, features)) {
    return {
      cls: 'REVIVAL',
      label: 'Waking up',
      headline: `Quiet for a while — now up ${Math.max(f(r7), f(r30)).toFixed(0)}% recently`,
      color: colors.velocityPositive,
      risk: 'good',
      offerLoFactor: 0.9,
      offerHiFactor: 1.0,
      script:
        "It's showing life after a long flat stretch — the kind of " +
        'early move worth paying rate for.',
    };
  }

  // Base forming — a real drawdown that stopped falling and is holding
  // a floor, on a card that isn't historically spent. Distinct from
  // dead/stable: buyers are defending a level on something still alive.
  const dd = f(signal.drawdown);
  const nearFloor =
    signal.low90d != null && price != null
      ? price <= signal.low90d * 1.15
      : f(signal.pctile1y, 100) <= 25;
  if (
    dd <= -20 &&
    !stillBleeding &&
    Math.abs(f(r30)) <= 12 &&
    nearFloor &&
    f(signal.cagr) > -15
  ) {
    return {
      cls: 'BASE_FORMING',
      label: 'At a floor',
      headline:
        `Down ${Math.abs(dd).toFixed(0)}% off its high but holding a ` +
        'floor — could build from here',
      color: colors.warning,
      risk: 'neutral',
      offerLoFactor: 0.85,
      offerHiFactor: 1.0,
      script:
        "It fell, then stopped — this level is holding. Safe to hold " +
        'or stock at rate; the tell is whether it starts ticking up.',
    };
  }

  // The 'depressed' stamp means "below its recent average" — not
  // necessarily cheap. A card mid-range or higher (pctile > 40) isn't
  // near a floor no matter what the stamp says; it falls through to
  // the position-aware branches below. Null pctile (old catalogs)
  // keeps trusting the stamp.
  if (stance === 'depressed' && f(signal.pctile1y, 0) <= 40) {
    // "Cheap" splits on direction — a slow long bleed is Long-term
    // decline (knives were caught above); only a genuinely flat cheap
    // card is Dormant. Bleeding is judged on the recent legs, not the
    // raw 90d window — a cheap card whose month turned up is recovering.
    if (stillBleeding) {
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
    // Cheap AND spent — flat at the floor because the run is over.
    if (f(signal.cagr) <= -15) {
      return {
        cls: 'DEAD_STABLE',
        label: 'Dead / stable',
        headline: `Cheap and spent (${f(signal.cagr).toFixed(0)}%/yr) — no growth left`,
        color: colors.warning,
        risk: 'neutral',
        offerLoFactor: 0.85,
        offerHiFactor: 0.95,
        script:
          "It's cheap and flat — the run already happened. Fine as " +
          "filler stock, but don't pay up for growth that isn't coming.",
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

  // A proven grower cooling off — the quarter is red but the month has
  // steadied and the long-term trend is strongly up. On cards like
  // this the dips keep getting bought; that's a pullback between runs,
  // not a decline. (Bubble mew: +598% all-time, 60th pctile, month
  // flat — its post-spike dips have set new highs twice.)
  if (
    f(signal.cagr) >= 25 &&
    f(signal.pctile1y) >= 50 &&
    f(r90) <= 0 &&
    f(r30) > -10
  ) {
    return {
      cls: 'STABLE_GROWER',
      label: 'Stable grower',
      headline:
        'Long-term grower cooling off its run — dips like this get bought',
      color: colors.velocityPositive,
      risk: 'good',
      offerLoFactor: 0.9,
      offerHiFactor: 1.0,
      script:
        "This one's a proven climber pausing after a run — its dips " +
        'keep getting bought, so I can pay near rate here.',
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
  // "stable flat" — it's a slow leak. But only when the leak is still
  // running; an old crash behind a flat card is dead/stable below.
  if (trend === 'depreciating' && stillBleeding) {
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
    offerHiFactor: 1.0,
    script:
      "Price has been pretty flat on this one — no real momentum " +
      'either way, so the standard rate applies.',
  };
}

/** tcgcsv price capture began ~Feb 2024 — a series whose first print
 *  is after that is a genuinely new card, not just newly tracked. */
const COLLECTION_FLOOR = '2024-04-01';

function isYoung(signal: CardSignal): boolean {
  if (signal.firstDate != null) return signal.firstDate > COLLECTION_FLOOR;
  return signal.spanDays != null && signal.spanDays <= 120;
}

/** Quiet-or-spent history showing fresh upward momentum — the early
 *  "pick it up before it runs" signal. */
function isReviving(
  signal: CardSignal,
  r7: number | null,
  r30: number | null,
  trend: string | null,
  features?: SeriesFeatures
): boolean {
  if (f(r7) < 5 && f(r30) < 10) return false;
  // A meaningfully red week means the bounce already happened and is
  // rolling over — "waking up" only counts while the move is arriving.
  if (r7 != null && r7 <= -3) return false;
  // A bounce that already ran and died back at the floor is a dead
  // cat, not a revival — unless the lows are now stepping up. A
  // retrace to a HIGHER shelf mid-recovery doesn't count.
  if (features?.failedBounce && features.atFloor && !features.higherLows)
    return false;
  // Confirmation: MA crossover / positive 30d slope when shipped, the
  // series' own slope or higher-lows shape when loaded — and a strong
  // 30d pop always counts, stamped or series-fresh.
  const confirmed =
    f(signal.ma20_60) > 0 ||
    f(signal.slope30d) > 0 ||
    (features?.slope30d ?? 0) > 0 ||
    features?.higherLows === true ||
    f(r30) >= 12;
  if (!confirmed) return false;
  if (trend === 'appreciating') return false;
  return (
    f(signal.cagr) <= 5 ||
    trend === 'flat' ||
    trend === 'depreciating' ||
    f(signal.pctile1y) <= 35
  );
}

/** Elevated stances — is the peak still building or rolling over? */
function atPeakRead(r7: number | null, r30: number | null): DealRead {
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
      peakState === 'intact' ? colors.velocityPositive : colors.warning,
    risk: peakState === 'topping' ? 'risky' : 'neutral',
    offerLoFactor: lo,
    offerHiFactor: hi,
    script: scripts[peakState],
    peakState,
  };
}

/** Static display names — DealRead.label can carry dynamic suffixes
 *  ("At peak · topping"); track-record rows need the base word. */
const CLASS_LABELS: Record<DealClassId, string> = {
  HYPE_DECAY: 'New-set slide',
  POST_SPIKE_BLEED: 'Post-spike bleed',
  REVIVAL: 'Waking up',
  BASE_FORMING: 'At a floor',
  DIP_BUY: 'Dip buy',
  FREE_FALL: 'Free fall',
  AT_PEAK: 'At peak',
  STABLE_GROWER: 'Stable grower',
  DECLINER: 'Long-term decline',
  DEAD_STABLE: 'Dead / stable',
  STABLE_FLAT: 'Stable / flat',
  DORMANT: 'Dormant / cheap',
  LOW_DATA: 'Low data',
};

export function classLabel(cls: DealClassId): string {
  return CLASS_LABELS[cls];
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
    case 'HYPE_DECAY':
      return 'Still sliding off launch hype — move it while the set is hot.';
    case 'POST_SPIKE_BLEED':
      return 'Coming down off the peak — sell into bumps before the slide continues.';
    case 'REVIVAL':
      return 'Waking up off a quiet floor — this is a hold, not a sell.';
    case 'BASE_FORMING':
      return 'Holding its floor — safe stock; upgrade if it starts ticking up.';
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
