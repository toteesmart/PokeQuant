// Sheet reads — the pure language layer of DealAnalysisSheet, lifted
// out of the component so the coherence harness renders THE SAME
// strings the user sees instead of a reimplementation that can drift.
// Everything here is a pure function of (read, signal, features, deep,
// patterns) — no React, no stores.

import type { CardDeep, CardSignal, PatternStat } from '../../../db/catalogDb';
import { stanceLabel } from './dealExplain';
import type { SeriesFeatures } from './seriesSignals';
import { resolveRangeEvidence, type DealRead } from './dealClassify';
import { fmtShort } from '../../../utils/format';

/** Odds words beat raw percents at a glance — "53%" is a number the
 *  user has to weigh; "coin flip" is the read. The percent stays as
 *  evidence, parenthesized. All phrasing fits the "___ to <verb>"
 *  frame so floors and turns share one vocabulary. */
export function oddsWord(pct: number): string {
  if (pct < 25) return 'a long shot';
  if (pct < 45) return 'against the odds';
  if (pct <= 55) return 'a coin flip';
  if (pct <= 75) return 'favored';
  return 'a near-lock';
}

export function fmtCases(n: number | null): string {
  if (n == null) return '?';
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

/** Classes where "does the floor hold" is the live question — these get
 *  the floor-hold base rate. Revival gets its own prior. */
const FLOOR_ODDS_CLASSES = new Set([
  'BASE_FORMING',
  'POST_SPIKE_BLEED',
  'FREE_FALL',
  'DIP_BUY',
  'DECLINER',
  'RANGE_PLAY',
]);

/** Engine context lines — self-history analogs + cross-card base rates,
 *  each line carrying its evidence (n, window) or not rendering. Deep
 *  stats past the staleness window are dropped, not shown as current. */
export function engineLines(
  read: DealRead,
  deep: CardDeep | null,
  deepStale: boolean,
  patterns: Record<string, PatternStat>,
  patternStale: (p: PatternStat | undefined) => boolean,
): { text: string; warn?: boolean }[] {
  const lines: { text: string; warn?: boolean }[] = [];

  // The card's own track record at this exact shelf — strongest prior.
  if (!deepStale && deep?.analogN != null && deep.analogN >= 3 && deep.analogBounceN != null) {
    const ownRate = (deep.analogBounceN / deep.analogN) * 100;
    lines.push({
      text:
        `Sat at this low ${deep.analogN} times — bounced ` +
        `${deep.analogBounceN} of ${deep.analogN} (${oddsWord(ownRate)})`,
    });
  }

  // Market-wide prior — every floor re-test pooled. Conditioning was
  // measured and barely differentiates (defended 53% vs soft 49%, same
  // odds band), so this line stays honest about what it is: the market
  // base rate. The per-card "like this" evidence is the analog line.
  const floorRate = patterns.floor_hold;
  if (
    FLOOR_ODDS_CLASSES.has(read.cls) &&
    floorRate &&
    !patternStale(floorRate) &&
    floorRate.holdRate != null &&
    (floorRate.nCases ?? 0) >= 20
  ) {
    const winMo = Math.round((floorRate.windowDays ?? 0) / 30);
    lines.push({
      text:
        `Across the market, lows hold ${oddsWord(floorRate.holdRate)} ` +
        `(~${Math.round(floorRate.holdRate)}% of ` +
        `${fmtCases(floorRate.nCases)} cases over ${winMo} months)`,
    });
  }
  const revRate = patterns.revival_follow;
  if (
    read.cls === 'REVIVAL' &&
    revRate &&
    !patternStale(revRate) &&
    revRate.holdRate != null &&
    (revRate.nCases ?? 0) >= 20
  ) {
    const winMo = Math.round((revRate.windowDays ?? 0) / 30);
    lines.push({
      text:
        `Cards turning up like this keep climbing ${oddsWord(revRate.holdRate)} ` +
        `(~${Math.round(revRate.holdRate)}% of ` +
        `${fmtCases(revRate.nCases)} cases over ${winMo} months)`,
    });
  }

  // Second-source disagreement — the JP/EN misattribution guard. Reads
  // still show, but with the caveat that history may not be this card.
  if (!deepStale && (deep?.pvFlag === 'level_mismatch' || deep?.pvFlag === 'shape_divergent')) {
    lines.push({
      text:
        'A second price source disagrees with this card’s history — ' +
        'it may be a different printing. Treat these numbers with care.',
      warn: true,
    });
  }

  return lines;
}

/* ------------------------------------------------------------------ */
/* Position triggers — the floor/target decision the owner card       */
/* renders as SELL UNDER / CRACKED / SELL INTO rows.                  */
/* ------------------------------------------------------------------ */

const FLOOR_CLASSES = new Set([
  'BASE_FORMING',
  'POST_SPIKE_BLEED',
  'FREE_FALL',
  'DIP_BUY',
  'DECLINER',
  'RANGE_PLAY',
]);

const TARGET_CLASSES = new Set([
  'BASE_FORMING',
  'POST_SPIKE_BLEED',
  'DIP_BUY',
  'DECLINER',
  'AT_PEAK',
  'RANGE_PLAY',
]);

export type PositionTriggers = {
  /** The floor the exit trigger is priced off — deep shelf first. */
  floorPrice: number | null;
  /** ~3% through the anchor = thesis dead (a shelf is a zone). */
  crackPrice: number | null;
  /** Price already under the crack line — the exit fired. */
  floorCracked: boolean;
  /** Bounce back worth under ~$3 — the exit isn't worth waiting for. */
  bounceCheap: boolean;
  /** Whether the floor row renders for this class at all. */
  showFloor: boolean;
  /** The eject window — where a bounce-back exits into. */
  targetPrice: number | null;
  showTarget: boolean;
};

export function positionTriggers(
  read: DealRead,
  signal: CardSignal | undefined,
  features: SeriesFeatures | null | undefined,
): PositionTriggers {
  const mkt = signal?.price ?? 0;
  // The floor is the decision for every fall-at-support class — give
  // it a dollar figure so "if it cracks" means something concrete.
  const floorPrice = features?.floorPrice ?? signal?.shelfPrice ?? signal?.low90d ?? null;
  const showFloor = floorPrice != null && floorPrice > 0 && FLOOR_CLASSES.has(read.cls);
  // A shelf is a zone, not a line — "thesis dead" is ~3% through the
  // anchor ($8.15 shelf → ~$7.91 break). Same threshold as the
  // at-floor band, so a card ON its shelf isn't flagged as through
  // it. Resolved zones get the margin whether the series computed
  // them or the deep stamp shipped them; the 90d-low fallback is
  // already the low itself — under it is broken by definition.
  const zoneFloor = (features?.floorPrice ?? signal?.shelfPrice ?? null) != null;
  const crackPrice = floorPrice != null && zoneFloor ? floorPrice * 0.97 : floorPrice;
  // The crack flag only exists where the floor is the thesis — an
  // AT_PEAK card sitting below a stale shelf has overhead resistance,
  // not a broken floor; flagging it "cracked" contradicts a note the
  // class never based on the shelf (fuzz: elevated card 12% under an
  // old shelf showed crack state next to "holding works").
  const floorCracked = showFloor && crackPrice != null && mkt > 0 && mkt < crackPrice;
  // Rounded-dollar reality: a bounce back worth under ~$3 isn't an
  // exit event, it's the same money — just sell it.
  const bounceCheap = floorCracked && floorPrice != null && floorPrice - mkt < 3;
  // The eject line — structural resistance capped by bounce memory, so
  // it reads as a realistic window, not a far-off peak. The resolved
  // ceiling carries the stamped/window sell-into AND the derived
  // floor×(1+bouncePct) tail — the same ev.ceiling the range verdict
  // and the health trigger quote, one level every surface; the bare
  // 90d high is the last resort when no range evidence resolves.
  const targetPrice = resolveRangeEvidence(signal, features).ceiling ?? signal?.high90d ?? null;
  const showTarget =
    targetPrice != null &&
    mkt > 0 &&
    targetPrice >= mkt * 1.08 &&
    // An eject measured in cents isn't a target — vendors deal in
    // rounded dollars, so the window needs real money behind it.
    targetPrice - mkt >= 3 &&
    TARGET_CLASSES.has(read.cls);
  return {
    floorPrice,
    crackPrice,
    floorCracked,
    bounceCheap,
    showFloor,
    targetPrice,
    showTarget,
  };
}

/* ------------------------------------------------------------------ */
/* "Where it is" — the facets under the verdict. Each row is one      */
/* plain-language read of a dimension the class alone can't carry.    */
/* ------------------------------------------------------------------ */

export type Facet = { label: string; text: string };

function fmtDaysAgo(days: number): string {
  if (days < 45) return `${Math.round(days)} days`;
  if (days < 365) return `~${Math.round(days / 30)} mo`;
  return `~${(days / 365).toFixed(1)} yrs`;
}

export function buildFacets(
  signal: CardSignal | undefined,
  features?: SeriesFeatures | null,
): Facet[] {
  if (!signal) return [];
  const out: Facet[] = [];
  const { pctile1y, drawdown, daysSinceHigh, low90d, high90d } = signal;
  const r7 = signal.ret7d;
  const r30 = signal.ret30d;
  const price = signal.price;

  // 1) Price level — where the price sits inside its own 1y band.
  if (pctile1y != null) {
    const p = Math.round(pctile1y);
    const band =
      p <= 15
        ? 'Bottom of its 1-year range'
        : p <= 40
          ? 'Low end of its 1-year range'
          : p <= 60
            ? 'Middle of its 1-year range'
            : p <= 85
              ? 'High end of its 1-year range'
              : 'Near its 1-year high';
    out.push({ label: 'Price level', text: band });
  } else if (signal.stance && signal.stance !== 'insufficient_data') {
    const s = stanceLabel(signal.stance);
    out.push({
      label: 'Price level',
      text: s.charAt(0).toUpperCase() + s.slice(1),
    });
  }

  // 2) From its peak — how far off the high, and how long ago it peaked.
  // Peak age resolves like the headline — the freshest of the stamp
  // and the window's own ATH date, so two rows can't cite two ages.
  const peakDays = Math.max(daysSinceHigh ?? 0, features?.daysSinceAth ?? 0);
  if (drawdown != null && drawdown <= -3) {
    let t = `Down ${Math.abs(drawdown).toFixed(0)}% from its high`;
    if (peakDays > 14) {
      t += ` — peaked ${fmtDaysAgo(peakDays)} ago`;
    }
    out.push({ label: 'From its peak', text: t });
  } else if (drawdown != null) {
    out.push({ label: 'From its peak', text: 'Basically at its high' });
  }

  // 3) Recent range — the last-90d floor and ceiling.
  if (low90d != null && high90d != null && price != null && low90d > 0) {
    const above = ((price - low90d) / low90d) * 100;
    const spot =
      above <= 15
        ? 'near the bottom'
        : above >= 80 && high90d > low90d
          ? 'near the top'
          : 'in the middle';
    out.push({
      label: 'Recent range',
      text: `$${low90d.toFixed(2)} – $${high90d.toFixed(2)} lately — ${spot}`,
    });
  }

  // 4) Right now — which direction it's pushing this week vs the month.
  // Series-fresh legs beat the stamps, same override the classifier
  // uses — a stamp that says "falling" can't print when the shipped
  // chart's own legs are green (fuzz: stamped −13% month vs window
  // +15% month on the same card). With a series loaded the resolved
  // pair IS the direction — a stale ma20_60 can't contradict the legs
  // the verdict and the chips quote (item 66: a +0.8 stamp printed
  // "Going up — picking up speed" beside a −18%/−25% window). The
  // stamp only speaks on scalar sheets, where it's the pipeline's
  // direction measure and stays; its speed clause reconciles the
  // window's slope the same way.
  const nowR7 = features?.ret7d ?? r7;
  const nowR30 = features?.ret30d ?? r30;
  const legsResolved = nowR7 != null && nowR30 != null;
  const legsText = (): string => {
    const a = nowR7!;
    const b = nowR30!;
    if (a >= 5 && b >= 5) return 'Rising — up this week and this month';
    if (a <= -5 && b <= -5) return 'Still falling — down this week and this month';
    if (b <= -5 && a > 0) return 'Easing — down on the month, up this week';
    if (b >= 5 && a < 0) return 'Cooling — up on the month, down this week';
    // One-sided legs — the live leg IS the move. "Not much moving" on
    // a ±15% week is the lie the claims audit flags (golduck Unlimited:
    // −20% week inside a flat month), and on a ±5%+ month the same
    // dishonesty one axis over (bellibolt: −18.6% month, quiet week).
    // Flat only prints when BOTH legs are quiet.
    if (a <= -5) return 'Slipping — down this week, flat on the month';
    if (a >= 5) return 'Rising — up this week, flat on the month';
    if (b <= -5) return 'Easing — down on the month, flat this week';
    if (b >= 5) return 'Cooling — up on the month, flat this week';
    return 'Flat — not much moving';
  };
  if (features != null && legsResolved) {
    out.push({ label: 'Right now', text: legsText() });
  } else if (signal.ma20_60 != null) {
    const m = signal.ma20_60;
    const slope = features?.slope30d ?? signal.slope30d;
    let t = m > 0.5 ? 'Going up' : m < -0.5 ? 'Going down' : 'Flat';
    if (slope != null && Math.abs(slope) >= 1) {
      t += slope > 0 ? ' — picking up speed' : ' — slowing down';
    }
    out.push({ label: 'Right now', text: t });
  } else if (legsResolved) {
    out.push({ label: 'Right now', text: legsText() });
  }

  // 5) Pattern — what the chart's shape itself says. The evidence
  // resolves the same way the classifier resolves it, so the facet
  // can never quote a cycle or bounce the verdict didn't use.
  if (features) {
    const ev = resolveRangeEvidence(signal, features);
    const bits: string[] = [];
    if (features.failedBounce) {
      bits.push('Bounced once, then fell back');
    }
    // "and held" is an outcome claim — only the resolved held-bounce
    // ledger can print it (item 59: tests=3 on a 0-of-3 card can't
    // read "held"; the pops ran and died lower).
    if (ev.tests >= 2) {
      bits.push(`Hit its floor ${ev.tests} times${ev.bounces >= 1 ? ' and held' : ''}`);
    }
    if (ev.bouncePct != null) {
      bits.push(`Past floor hits bounced ~+${ev.bouncePct.toFixed(0)}%`);
    }
    // The rhythm phrase rides the classifier's own bar — an observed
    // held bounce on either resolution, or a trend that doesn't
    // contradict the range story.
    if (
      ev.cycleDays != null &&
      ev.cycleDays >= 45 &&
      (ev.bounces >= 1 || signal.trend !== 'depreciating')
    ) {
      bits.push(`Bounces about every ~${Math.round(ev.cycleDays / 30)} months`);
    }
    if (features.higherLows) bits.push('Each dip bottoms higher');
    if (bits.length) out.push({ label: 'Pattern', text: bits.join(' · ') });
  }

  // 6) Data — how much history backs any of this.
  const bits: string[] = [];
  if (signal.nEvents != null) {
    bits.push(
      signal.nEvents < 30
        ? `only ${signal.nEvents} sales on record`
        : `${signal.nEvents} sales tracked`,
    );
  }
  if (signal.liqFlag === 'thin' || signal.liqFlag === 'no_data') bits.push('hardly ever sells');
  else if (signal.liqFlag === 'stale') bits.push('price may be old');
  if (signal.daysSinceChange != null && signal.daysSinceChange > 30) {
    bits.push(`no price change in ${signal.daysSinceChange} days`);
  }
  if (bits.length) {
    out.push({
      label: 'History',
      text: bits.join(' · ').replace(/^./, (c) => c.toUpperCase()),
    });
  }

  // 7) Vs its set — moving with or against the cards around it.
  if (signal.excess30d != null) {
    const e = signal.excess30d;
    out.push({
      label: 'Compared to its set',
      text:
        Math.abs(e) < 3
          ? 'Moving with the rest of its set'
          : e > 0
            ? `Doing better than its set this month (+${e.toFixed(0)}%)`
            : `Doing worse than its set this month (${e.toFixed(0)}%)`,
    });
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Catalog-age disclosure — when the stamp's own price data ends.      */
/* ------------------------------------------------------------------ */

/** "Prices as of M/D/YY" — the signal's latest-price date, always-on
 *  next to the verdict. Disclosure, not alarm: the catalog refreshes by
 *  delta so a few days back is normal, and the date is what makes a
 *  weeks-old verdict legible. Null when the row carries no stamp — or
 *  one that isn't a date, so the sheet never renders "NaN/NaN" off a
 *  malformed stamp (a full-ISO datetime still discloses its date). */
export function dataAgeLabel(signal: CardSignal | undefined): string | null {
  const d = signal?.priceDate;
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return null;
  return `Prices as of ${fmtShort(d.slice(0, 10))}`;
}
