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
  /** Last price is within ~12% of ANY trough that buyers defended —
   *  a swing low followed by a ≥15% rally. A floor doesn't have to be
   *  the all-time low to be real: a higher shelf that held is still
   *  support (bellibolt's $5 shelf vs its ancient $2.50 low). */
  atShelf: boolean;
  /** The dollar level of the defended shelf nearest current price —
   *  the support a holder should watch crack. Null when nothing under
   *  the price was ever bought. */
  floorPrice: number | null;
  /** Nearest swing peak meaningfully above the last price (>5%) —
   *  the resistance a bounce runs into first. Null when the card is
   *  at/above every prior peak (new-high territory — no ceiling to
   *  aim at). */
  targetPrice: number | null;
  /** Median rally % that followed prior touches of the current
   *  floor shelf — what "it bounced from here before" was actually
   *  worth. Null when the shelf was never tested before. */
  medianBouncePct: number | null;
  /** Median days a floor bounce took to reach its peak. */
  medianBounceDays: number | null;
  /** Median trough-to-trough spacing in days when ≥3 swings exist —
   *  the card's cycle rhythm (bellibolt's dip→spike heartbeat). */
  cycleDays: number | null;
  /** Recent swing lows stepping up — early accumulation shape. */
  higherLows: boolean;
};

const REVERSAL_PCT = 0.08;

/** A single bad print can fake a whole swing — a one-point wick that
 *  spikes/crashes >60% past both neighbors and reverts on the next
 *  tick is a data error, not a move. Drop it before any feature math
 *  (the pipeline's deep engine applies the same rule so the two
 *  layers' swing maps agree). */
function despike(points: PricePoint[]): PricePoint[] {
  if (points.length < 3) return points;
  return points.filter((p, i) => {
    if (i === 0 || i === points.length - 1) return true;
    const prev = points[i - 1].marketPrice;
    const next = points[i + 1].marketPrice;
    const v = p.marketPrice;
    if (prev <= 0 || next <= 0 || v <= 0) return true;
    const spikeUp = v > prev * 1.6 && v > next * 1.6;
    const spikeDown = v < prev * 0.4 && v < next * 0.4;
    return !(spikeUp || spikeDown);
  });
}

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

/** Nearest swing trough at-or-below the last price — the support
 *  level under you right now. Slight tolerance (2%) so a price parked
 *  exactly on the floor counts the floor itself. */
function nearestShelf(
  troughs: Swing[],
  lastPrice: number | null
): Swing | null {
  if (lastPrice == null) return null;
  let best: Swing | null = null;
  for (const tr of troughs) {
    if (tr.price <= lastPrice * 1.02 && (best == null || tr.price > best.price)) {
      best = tr;
    }
  }
  return best;
}

/** Was this trough ever bought — did price rally ≥15% off it after? */
function wasDefended(tr: Swing, peaks: Swing[]): boolean {
  return peaks.some((p) => p.date > tr.date && p.price >= tr.price * 1.15);
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function buildSeriesFeatures(points: PricePoint[]): SeriesFeatures {
  const clean = despike(points);
  const last = clean[clean.length - 1] ?? null;
  const first = clean[0] ?? null;
  const lastPrice = last?.marketPrice ?? null;

  // ATH context — over `clean` so a bad print can't become the
  // all-time high the drawdown math anchors to.
  let athPrice: number | null = null;
  let athDate: string | null = null;
  for (const p of clean) {
    if (athPrice == null || p.marketPrice > athPrice) {
      athPrice = p.marketPrice;
      athDate = p.date;
    }
  }

  const sw = swings(clean);
  const troughs = sw.filter((s) => s.kind === 'trough');
  const peaks = sw.filter((s) => s.kind === 'peak');

  // The lowest trough anchors "at the absolute bottom".
  const lowTrough = troughs.length
    ? Math.min(...troughs.map((t) => t.price))
    : null;

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

  // The shelf under the current price — the level a crack bleeds
  // through. "At the shelf" means parked within ~12% above it and it
  // was actually defended before; materially below it is a break.
  const shelf = nearestShelf(troughs, lastPrice);
  const floorPrice = shelf?.price ?? null;
  // Floor tests — how many times the shelf UNDER the current price
  // got hit, not the ancient all-time low. Bellibolt's $5 shelf held
  // 2× even though the series floor is way lower.
  const floorTests =
    floorPrice != null
      ? troughs.filter((t) => Math.abs(t.price - floorPrice) <= floorPrice * 0.08)
          .length
      : 0;
  const atShelf =
    shelf != null &&
    lastPrice != null &&
    lastPrice <= shelf.price * 1.12 &&
    wasDefended(shelf, peaks);

  // Upside target — the closest prior peak above current price.
  const abovePeaks =
    lastPrice != null
      ? peaks.filter((p) => p.price > lastPrice * 1.05).map((p) => p.price)
      : [];
  const targetPrice = abovePeaks.length ? Math.min(...abovePeaks) : null;

  // Bounce memory — what prior touches of THIS shelf produced. Each
  // floor-test trough pairs with the next swing peak after it; the
  // median is what "it bounced from here before" was actually worth.
  let medianBouncePct: number | null = null;
  let medianBounceDays: number | null = null;
  if (floorPrice != null) {
    const bouncesPct: number[] = [];
    const bouncesDays: number[] = [];
    for (const tr of troughs) {
      if (Math.abs(tr.price - floorPrice) > floorPrice * 0.08) continue;
      const postPeak = peaks.find((p) => p.date > tr.date);
      if (postPeak && postPeak.price > tr.price) {
        bouncesPct.push((postPeak.price / tr.price - 1) * 100);
        bouncesDays.push(daysBetween(tr.date, postPeak.date));
      }
    }
    medianBouncePct = median(bouncesPct);
    medianBounceDays = median(bouncesDays);
  }

  // Cycle rhythm — median spacing between consecutive swing lows.
  const cycleDays =
    troughs.length >= 3
      ? median(
          troughs
            .slice(1)
            .map((t, i) => daysBetween(troughs[i].date, t.date))
        )
      : null;

  return {
    lastPrice,
    daysCovered: first && last ? daysBetween(first.date, last.date) : 0,
    ret7d: ret(clean, 7),
    ret30d: ret(clean, 30),
    slope30d: slope(clean),
    athPrice,
    daysSinceAth:
      athDate && last ? daysBetween(athDate, last.date) : null,
    floorTests,
    failedBounce,
    atFloor: lowTrough != null && lastPrice != null && lastPrice <= lowTrough * 1.12,
    atShelf,
    floorPrice,
    targetPrice,
    medianBouncePct,
    medianBounceDays,
    cycleDays,
    higherLows,
  };
}
