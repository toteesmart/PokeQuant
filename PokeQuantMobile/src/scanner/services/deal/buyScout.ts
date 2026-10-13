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
  /** One-line "why it's here" — the evidence, not a promise. */
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

function whyFor(row: ScoutRow, read: DealRead): string {
  const s = row.signal;
  switch (read.cls) {
    case 'REVIVAL':
      return `Up ${f(s.ret30d).toFixed(0)}% on the month off a ${Math.abs(f(s.drawdown)).toFixed(0)}% drawdown — the turn is live`;
    case 'DIP_BUY':
      return `Down ${Math.abs(Math.min(f(s.ret30d), 0)).toFixed(0)}% this month inside a +${f(s.ret90d).toFixed(0)}% quarter — the trend holds`;
    case 'BASE_FORMING':
      return s.low90d != null
        ? `Parked on a $${s.low90d.toFixed(2)} floor — a hold here is where the bounce starts`
        : 'Holding a floor — a hold here is where the bounce starts';
    case 'STABLE_GROWER':
      return `Compounding ~${f(s.cagr).toFixed(0)}%/yr with a +${f(s.ret30d).toFixed(0)}% month — steady stock`;
    case 'RANGE_PLAY':
      return s.shelfPrice != null
        ? `Bounces off ~$${s.shelfPrice.toFixed(2)}${
            s.cycleDays != null ? ` every ~${Math.round(s.cycleDays)}d` : ''
          } — at the buy end of its range`
        : 'At the buy end of a proven price range';
    default:
      return read.headline;
  }
}

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
    const owned = ownedProductIds.has(row.signal.productId);
    const score = scoreRow(row, read);
    out.push({
      productId: row.signal.productId,
      subType: row.signal.subType,
      name: row.name,
      number: row.number,
      set: row.set,
      rarity: row.rarity,
      price,
      read,
      score,
      why: whyFor(row, read),
      owned,
    });
  }
  return out
    .sort((a, b) =>
      a.owned !== b.owned
        ? a.owned
          ? 1
          : -1
        : b.score - a.score
    )
    .slice(0, limit);
}
