import type { PricePoint } from '../src/db/catalogDb';
import { buildSeriesFeatures } from '../src/scanner/services/deal/seriesSignals';

// Feature-shape pins — crafted series → buildSeriesFeatures outputs.
// The classifier trusts whatever this pass resolves; every divergence
// the live audit found traces back to a measurement here (window
// under-counts troughs, under-resolves cycles, stale ATH remnants).
// These pins lock the measurement semantics the union rules are
// built on — change the resolution, these diffs show it.

/** Deterministic series — dates step 1d from a fixed origin. */
function series(prices: number[], start = '2025-01-01'): PricePoint[] {
  const t0 = new Date(`${start}T00:00:00`).getTime();
  return prices.map((p, i) => ({
    date: new Date(t0 + i * 86400000).toISOString().slice(0, 10),
    marketPrice: p,
  }));
}

/** Plateau-jump series — [price, days held] steps. Swings only
 *  register when a single step moves ≥8%, so each jump must clear
 *  the reversal bar — that's how sparse real prints look inside the
 *  shipped window. */
function steps(legs: [price: number, days: number][], start = '2025-01-01'): PricePoint[] {
  const prices: number[] = [];
  for (const [p, d] of legs) for (let i = 0; i < d; i++) prices.push(p);
  return series(prices, start);
}

describe('buildSeriesFeatures — measurement semantics', () => {
  test('a clean 3-trough range resolves its shelf, count, rhythm, and bounce', () => {
    // 3 troughs at ~$10 spaced 60d, bounces to $14 (+40%), parked on
    // the floor at the end.
    const f = buildSeriesFeatures(
      steps([
        [10, 30],
        [14, 30],
        [10, 30],
        [14, 30],
        [10, 30],
        [14, 30],
        [10, 5],
      ]),
    );
    expect(f.floorPrice).toBeCloseTo(10, 1);
    expect(f.floorTests).toBe(3);
    // Trough dates resolve asymmetrically: the first plateau's trough
    // lands at plateau END (dir=0 tracking), later ones at plateau
    // START (dir=-1 holds the first-seen low) — 60d legs measure
    // spacings [31, 60] → median 45.5, not 60.
    expect(f.cycleDays).toBeCloseTo(45.5, 1);
    expect(f.medianBouncePct).toBeCloseTo(40, 0);
    expect(f.atShelf).toBe(true);
  });

  test('swings need a ≥8% single-step reversal — a smooth ramp registers nothing', () => {
    // THE under-resolution mechanism: the window keys on discrete
    // jumps. A card easing $10→$14 over 20 days has no swing points
    // at all — the deep engine's full-history stamps see structure
    // the shipped window literally cannot. This is why stamped and
    // window evidence must union, not just prefer one.
    const ramp = series(Array.from({ length: 21 }, (_, i) => 10 + (4 * i) / 20));
    const f = buildSeriesFeatures(ramp);
    expect(f.floorTests).toBe(0);
    expect(f.cycleDays).toBeNull();
  });

  test('crash-then-channel — the shelf under price is the NEW level, not the ancient low', () => {
    // Launch high $40 → crash → oscillate $19.5–$23 (lillie shape).
    // The window floor is ~$19.6 — the crash's trough is support only
    // if price sits on it; ATH stays the launch remnant. tests=2: the
    // parked $19.7 touch isn't a swing until a reversal confirms it.
    const f = buildSeriesFeatures(
      steps(
        [
          [40, 10],
          [30, 5],
          [22, 5],
          [19.5, 30],
          [23, 30],
          [19.6, 30],
          [22.8, 30],
          [19.7, 5],
        ],
        '2024-01-01',
      ),
    );
    expect(f.athPrice).toBeCloseTo(40, 1);
    expect(f.floorPrice).toBeCloseTo(19.6, 0);
    expect(f.floorTests).toBe(2);
    expect(f.atShelf).toBe(true);
  });

  test('the in-progress touch is not a test — it counts once a reversal confirms it', () => {
    // $5 ancient low, then two registered ~$8 troughs, parked at $8
    // now — the current touch isn't a swing yet, so tests=2 and the
    // $5 low never counts (37% away from the shelf under price).
    const f = buildSeriesFeatures(series([5, 9, 8, 9.2, 8.05, 9.1, 8.02]));
    expect(f.floorPrice).toBeCloseTo(8.05, 1);
    expect(f.floorTests).toBe(2);
  });

  test('despike — a one-print wick never becomes the ATH or a swing', () => {
    const clean = steps([
      [10, 15],
      [13, 15],
      [10, 15],
      [13, 15],
      [10, 5],
    ]);
    // Same shape with a $30 bad print injected mid-series.
    const wicked = [
      ...clean.slice(0, 20),
      { date: '2025-01-21', marketPrice: 30 },
      ...clean.slice(20),
    ];
    const f = buildSeriesFeatures(wicked);
    expect(f.athPrice).toBeCloseTo(13, 0);
    expect(f.floorTests).toBe(2);
    expect(f.medianBouncePct).toBeCloseTo(30, 0);
  });

  test('failedBounce — ran off the floor, came all the way back', () => {
    // Ogerpon shape: trough $10 → rally to $13 → die back at $10.10.
    const f = buildSeriesFeatures(series([12, 10, 13, 11, 10.1]));
    expect(f.failedBounce).toBe(true);
  });

  test('higherLows — last two troughs must step up >5%', () => {
    const up = buildSeriesFeatures(series([10, 14, 10.8, 14.5, 11.4, 15]));
    expect(up.higherLows).toBe(true);
    const flat = buildSeriesFeatures(series([10, 14, 10.1, 14.5, 10.05, 15]));
    expect(flat.higherLows).toBe(false);
  });

  test('sellInto caps the ceiling at what bounces actually ran', () => {
    // Structural peak $20 exists, but this shelf's bounces only ever
    // ran +25% → the eject is ~$12.50, not the far-off peak.
    const f = buildSeriesFeatures(series([10, 12.5, 10.1, 12.6, 20, 10.2, 12.4, 10.15]));
    expect(f.sellIntoPrice).toBeCloseTo(12.5, 0);
    expect(f.sellIntoPrice).toBeLessThan(20);
  });

  test('under-resolution artifact — a short window cannot see a 140d rhythm', () => {
    // THE union guard case: true 140d cycle, but the shipped window
    // holds ~1.3 troughs → spacing resolves huge or null. Exactly why
    // the classifier unions stamped cycle evidence on the same shelf
    // (sharpedo: window-resolved 256d vs stamped 140.5d).
    const short = buildSeriesFeatures(
      steps([
        [10, 60],
        [13, 50],
        [10.05, 40],
      ]),
    );
    expect(short.cycleDays == null || short.cycleDays > 140).toBe(true);
  });

  test('atFloor vs atShelf — the absolute bottom vs any defended shelf', () => {
    // Card fell to $5 long ago, cycles $8–$10 now, parked at $8.
    // atShelf (a defended shelf under price), never atFloor ($5 is
    // the absolute low the card left behind).
    const f = buildSeriesFeatures(
      steps(
        [
          [5, 10],
          [9, 10],
          [8, 20],
          [10, 20],
          [8.02, 20],
          [9.8, 20],
          [8.05, 5],
        ],
        '2024-06-01',
      ),
    );
    expect(f.atShelf).toBe(true);
    expect(f.floorPrice).toBeCloseTo(8.05, 1);
  });

  test('empty and single-point series degrade to nulls, not garbage', () => {
    const none = buildSeriesFeatures([]);
    expect(none.lastPrice).toBeNull();
    expect(none.floorTests).toBe(0);
    const one = buildSeriesFeatures(series([5]));
    expect(one.lastPrice).toBe(5);
    expect(one.cycleDays).toBeNull();
  });
});
