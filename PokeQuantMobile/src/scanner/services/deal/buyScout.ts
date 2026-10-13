// Buy scout — "where should the money go next". The SQL funnel pulls
// plausible candidates; classifyDeal is the honest filter (same classes
// the sheet shows); the score ranks what's left by the things a vendor
// actually weighs: trend quality, a floor under it, liquidity, and
// headroom back to the range top.

import type { ScoutRow } from '../../../db/catalogDb';
import { classifyDeal, type DealRead } from './dealClassify';

export type ScoutCandidate = {
  productId: number;
  subType: string;
  name: string;
  number: string | null;
  set: string | null;
  rarity: string | null;
  price: number;
  read: DealRead;
  score: number;
  /** The numbers the score is built on — rendered colored/bold so the
   *  row's rank is legible at a glance. */
  stat: string;
  /** One-line "why it's here" — the short gloss under the numbers. */
  why: string;
  owned: boolean;
};

/** Classes the scout surfaces. BASE_FORMING only counts when it's
 *  resting on the floor — 'testing' means a knife mid-fall, which is
 *  a watchlist candidate, not a buy. RANGE_PLAY only counts at the
 *  entry — mid-swing or at the ceiling you're buying the wrong end. */
const SCOUT_CLASSES = new Set([
  'REVIVAL',
  'DIP_BUY',
  'BASE_FORMING',
  'STABLE_GROWER',
  'RANGE_PLAY',
]);

const f = (n: number | null | undefined, d = 0): number =>
  n == null || Number.isNaN(n) ? d : n;

function scoreRow(row: ScoutRow, read: DealRead): number {
  const s = row.signal;
  const r30 = f(s.ret30d);
  const r90 = f(s.ret90d);
  const cagr = f(s.cagr);

  let score: number;
  switch (read.cls) {
    case 'REVIVAL':
      // Fresh turn off a beaten-down level — momentum + how far it's
      // still below the old range.
      score = 70 + Math.min(r30, 40) * 0.8 + Math.min(cagr, 60) * 0.15;
      break;
    case 'DIP_BUY':
      // Pullback inside an intact uptrend — pay for the trend quality.
      score = 65 + Math.min(cagr, 80) * 0.25 + Math.max(r90, -30) * 0.1;
      break;
    case 'BASE_FORMING': {
      // Resting on a held floor — pay for headroom back to the range top.
      const headroom =
        s.high90d != null && s.price != null && s.price > 0
          ? (s.high90d / s.price - 1) * 100
          : 0;
      score = 55 + Math.min(headroom, 60) * 0.4;
      break;
    }
    case 'STABLE_GROWER':
      score = 50 + Math.min(cagr, 80) * 0.4 + f(s.ma20_60) * 0.2;
      break;
    case 'RANGE_PLAY': {
      // At the buy end of a proven cycle — pay for the spread back to
      // the stamped ceiling.
      const spread =
        s.targetPrice != null && s.price != null && s.price > 0
          ? (s.targetPrice / s.price - 1) * 100
          : 0;
      score = 58 + Math.min(spread, 60) * 0.45;
      break;
    }
    default:
      score = 40;
  }

  // Confidence multipliers — a great chart on a thin feed is a worse
  // buy than a decent chart on a liquid one.
  if (s.confidence === 'low') score *= 0.7;
  if (s.liqFlag === 'stale' || s.liqFlag === 'thin') score *= 0.6;
  if (f(s.daysSinceChange, 0) > 30) score *= 0.8;
  if (s.volRegime === 'high') score *= 0.85;
  // Unbounded downside — the stamped 30d floor of the forecast sits
  // well under current price.
  if (s.fwd30dLo != null && s.price != null && s.fwd30dLo < s.price * 0.88) {
    score -= 15;
  }
  return Math.round(score);
}

/** The row's evidence split in two: `stat` is the colored numbers
 *  line the score is built from; `note` is the short muted gloss. */
function whyFor(row: ScoutRow, read: DealRead): { stat: string; note: string } {
  const s = row.signal;
  switch (read.cls) {
    case 'REVIVAL':
      return {
        stat: `+${f(s.ret30d).toFixed(0)}% this month · ${Math.abs(f(s.drawdown)).toFixed(0)}% off the high`,
        note: 'quiet card turning up — the turn is live',
      };
    case 'DIP_BUY':
      return {
        stat: `${Math.min(f(s.ret30d), 0).toFixed(0)}% this month · +${f(s.ret90d).toFixed(0)}% this quarter`,
        note: 'a dip inside a trend that holds',
      };
    case 'BASE_FORMING': {
      // Scalar path guarantees a stamped shelf here (BASE_FORMING
      // requires onRealFloor — with no features that's shelfPrice).
      // Never quote low90d as the floor: a falling card's own recent
      // low isn't support (invariant: a fresh low is not a floor).
      const floor = s.shelfPrice;
      return {
        stat:
          floor != null
            ? `floor ~$${floor.toFixed(2)}${s.shelfTests != null ? ` · held ${s.shelfTests}×` : ''}`
            : 'on a held floor',
        note: 'resting on the floor — this is where bounces start',
      };
    }
    case 'STABLE_GROWER':
      return {
        stat: `+${f(s.cagr).toFixed(0)}%/yr · +${f(s.ret30d).toFixed(0)}% this month`,
        note: 'steady compounder — dips get bought',
      };
    case 'RANGE_PLAY': {
      const room =
        s.targetPrice != null && s.price != null && s.price > 0
          ? (s.targetPrice / s.price - 1) * 100
          : null;
      return {
        stat:
          s.shelfPrice != null
            ? `$${s.shelfPrice.toFixed(2)} floor${
                s.targetPrice != null ? ` → ~$${s.targetPrice.toFixed(2)}` : ''
              }${
                s.cycleDays != null
                  ? ` · every ~${Math.round(s.cycleDays)}d`
                  : ''
              }${room != null ? ` · +${room.toFixed(0)}% room` : ''}`
            : 'at the buy end of its range',
        note: 'proven floor-to-ceiling cycle — buy the floor, sell the pop',
      };
    }
    default:
      return { stat: '', note: read.headline };
  }
}

/** Shared row → candidate shaping for both scout views. */
function toCandidate(
  row: ScoutRow,
  read: DealRead,
  owned: boolean,
  price: number
): ScoutCandidate {
  return {
    productId: row.signal.productId,
    subType: row.signal.subType,
    name: row.name,
    number: row.number,
    set: row.set,
    rarity: row.rarity,
    price,
    read,
    score: scoreRow(row, read),
    stat: whyFor(row, read).stat,
    why: whyFor(row, read).note,
    owned,
  };
}

const byOwnedThenScore = (a: ScoutCandidate, b: ScoutCandidate): number =>
  a.owned !== b.owned ? (a.owned ? 1 : -1) : b.score - a.score;

/** Rank the scout rows. Owned productIds get flagged rather than
 *  excluded — "you already hold this scorer" is useful information,
 *  but they sort below unowned candidates at the same score. */
export function scoutCandidates(
  rows: ScoutRow[],
  ownedProductIds: Set<number>,
  limit = 20
): ScoutCandidate[] {
  const out: ScoutCandidate[] = [];
  for (const row of rows) {
    const read = classifyDeal(row.signal);
    if (!SCOUT_CLASSES.has(read.cls)) continue;
    if (read.cls === 'BASE_FORMING' && read.variant === 'testing') continue;
    // A cycler is only a buy at its floor — mid-swing and at the
    // ceiling you're paying the wrong end of the range.
    if (read.cls === 'RANGE_PLAY' && read.variant !== 'entry') continue;
    const price = row.signal.price;
    if (price == null || price <= 0) continue;
    out.push(
      toCandidate(row, read, ownedProductIds.has(row.signal.productId), price)
    );
  }
  return out.sort(byOwnedThenScore).slice(0, limit);
}

/** The floor-buy lane — entry-position cyclers only. They answer a
 *  different question ("what do I buy AT the floor today") than the
 *  main rank, and their ~65–85 scores get buried under revival/grower
 *  scores in one mixed top-40 — so they get their own list. */
export function scoutFloorBuys(
  rows: ScoutRow[],
  ownedProductIds: Set<number>,
  limit = 15
): ScoutCandidate[] {
  const out: ScoutCandidate[] = [];
  for (const row of rows) {
    const read = classifyDeal(row.signal);
    if (read.cls !== 'RANGE_PLAY' || read.variant !== 'entry') continue;
    const price = row.signal.price;
    if (price == null || price <= 0) continue;
    out.push(
      toCandidate(row, read, ownedProductIds.has(row.signal.productId), price)
    );
  }
  return out.sort(byOwnedThenScore).slice(0, limit);
}
