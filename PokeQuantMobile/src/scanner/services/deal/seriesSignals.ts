import type { PricePoint } from '../../../db/catalogDb';

// Per-card curve features derived from the shipped price_series — the
// "deep read" that scalar stamps can't carry: floor tests, failed
// bounces, higher lows, fresh slopes. Cheap because it runs on one
// ~few-hundred-point series when the analysis sheet opens, never in
// list paths.

export type Swing = {
  kind: 'peak' | 'trough';
  price: number;
  date: string;
};

export type SeriesFeatures = {
  lastPrice: number | null;
  daysCovered: number;
  /** Fresh returns off the series tail — stamped r7/r30 can lag the
   *  catalog date; these don't. */
  ret7d: number | null;
  ret30d: number | null;
  /** Log-price regression slope over the last ~30 days, %/day. */
  slope30d: number | null;
  athPrice: number | null;
  daysSinceAth: number | null;
  /** Troughs within 10% of the window low — a floor tested 2×+ is a
   *  defended level, not a pause before the next leg down. */
  floorTests: number;
  /** A trough → ≥15% rally → return within 10% of that trough. The
   *  Ogerpon shape: it did wake up, ran, and came back to die at the
   *  floor — a dead bounce, not a revival. */
  failedBounce: boolean;
  /** Last price is sitting within ~12% of the lowest swing low — the
   *  fall already completed at a level that held, vs a knife still
   *  traveling through it. */
  atFloor: boolean;
  /** Recent swing lows stepping up — early accumulation shape. */
  higherLows: boolean;
};

const REVERSAL_PCT = 0.08;

function swings(points: PricePoint[]): Swing[] {
  const out: Swing[] = [];
  if (points.length < 3) return out;
  let dir: 1 | -1 | 0 = 0;
  let extreme = points[0];
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const change = p.marketPrice / extreme.marketPrice - 1;
    if (dir !== -1 && change <= -REVERSAL_PCT && extreme.marketPrice > 0) {
      // Reversed downward — the extreme was a peak.
      if (dir === 1 || out.length === 0) {
        out.push({ kind: 'peak', price: extreme.marketPrice, date: extreme.date });
      }
      dir = -1;
      extreme = p;
    } else if (dir !== 1 && change >= REVERSAL_PCT) {
      if (dir === -1 || out.length === 0) {
        out.push({ kind: 'trough', price: extreme.marketPrice, date: extreme.date });
      }
      dir = 1;
      extreme = p;
    } else if (
      (dir === 1 && p.marketPrice > extreme.marketPrice) ||
      (dir === -1 && p.marketPrice < extreme.marketPrice) ||
      dir === 0
    ) {
      extreme = p;
    }
  }
  return out;
}

function ret(points: PricePoint[], daysBack: number): number | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  const cutoff = new Date(`${last.date}T00:00:00`).getTime() - daysBack * 86400000;
  let base = points[0];
  for (const p of points) {
    if (new Date(`${p.date}T00:00:00`).getTime() <= cutoff) base = p;
    else break;
  }
  return base.marketPrice > 0
    ? (last.marketPrice / base.marketPrice - 1) * 100
    : null;
}

function slope(points: PricePoint[], daysBack = 30): number | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  const cutoff =
    new Date(`${last.date}T00:00:00`).getTime() - daysBack * 86400000;
  const tail = points.filter(
    (p) =>
      p.marketPrice > 0 &&
      new Date(`${p.date}T00:00:00`).getTime() >= cutoff
  );
  if (tail.length < 5) return null;
  const ys = tail.map((p) => Math.log(p.marketPrice));
  const xbar = (ys.length - 1) / 2;
  const ybar = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < ys.length; i++) {
    num += (i - xbar) * (ys[i] - ybar);
    den += (i - xbar) * (i - xbar);
  }
  return den > 0 ? (num / den) * 100 : null; // %/day in log space ≈ %/day
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00`).getTime() -
      new Date(`${a}T00:00:00`).getTime()) /
      86400000
  );
}

export function buildSeriesFeatures(points: PricePoint[]): SeriesFeatures {
  const last = points[points.length - 1] ?? null;
  const first = points[0] ?? null;
  const lastPrice = last?.marketPrice ?? null;

  // ATH context.
  let athPrice: number | null = null;
  let athDate: string | null = null;
  for (const p of points) {
    if (athPrice == null || p.marketPrice > athPrice) {
      athPrice = p.marketPrice;
      athDate = p.date;
    }
  }

  const sw = swings(points);
  const troughs = sw.filter((s) => s.kind === 'trough');
  const peaks = sw.filter((s) => s.kind === 'peak');

  // Floor tests — troughs within 10% of the lowest trough.
  const lowTrough = troughs.length
    ? Math.min(...troughs.map((t) => t.price))
    : null;
  const floorTests =
    lowTrough != null && lastPrice != null
      ? troughs.filter((t) => t.price <= lowTrough * 1.1).length
      : 0;

  // Failed bounce — a trough, a ≥15% rally after it, then the series
  // came back within 10% of that trough's level.
  let failedBounce = false;
  if (lowTrough != null && lastPrice != null) {
    for (const tr of troughs) {
      const postPeak = peaks.find(
        (p) => p.date > tr.date && p.price >= tr.price * 1.15
      );
      if (
        postPeak &&
        lastPrice <= tr.price * 1.1 &&
        lastPrice < postPeak.price * 0.9
      ) {
        failedBounce = true;
        break;
      }
    }
  }

  // Higher lows — last two troughs stepped up.
  const lastTwo = troughs.slice(-2);
  const higherLows =
    lastTwo.length === 2 && lastTwo[1].price > lastTwo[0].price * 1.05;

  return {
    lastPrice,
    daysCovered: first && last ? daysBetween(first.date, last.date) : 0,
    ret7d: ret(points, 7),
    ret30d: ret(points, 30),
    slope30d: slope(points),
    athPrice,
    daysSinceAth:
      athDate && last ? daysBetween(athDate, last.date) : null,
    floorTests,
    failedBounce,
    atFloor: lowTrough != null && lastPrice != null && lastPrice <= lowTrough * 1.12,
    higherLows,
  };
}
