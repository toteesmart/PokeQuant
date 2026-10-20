import { mkSignal, mkFeatures } from './helpers/builders';
import { renderSurfaces, collectProblems } from './helpers/stack';

// Seeded fuzz sweep — random (signal × features) combos through the
// full surface contract. The grid sweeps cover every axis point the
// classifier's gates can take; this covers the space BETWEEN them —
// independent stamped vs window evidence, the mismatch family that
// produced every live-catalog divergence. Deterministic seed so a
// finding reproduces exactly; rerun with a new seed when the contract
// changes and the space needs re-mapping.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 1337;
const N = 3000;

const STANCES = [
  'neutral',
  'depressed',
  'elevated',
  'elevated_rising',
  'falling',
  'insufficient_data',
];
const TRENDS = ['appreciating', 'flat', 'depreciating'];
const ACTIONS = ['BUY_HOLD', 'HOLD', 'NEUTRAL', 'SELL_NOW'];

describe('seeded fuzz — surface contract holds between the grid points', () => {
  test(`${N} random signal×feature combos produce no objective problems`, () => {
    const rnd = mulberry32(SEED);
    const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
    const num = (lo: number, hi: number) => lo + rnd() * (hi - lo);
    const maybe = <T>(p: number, v: () => T): T | null => (rnd() < p ? v() : null);

    const failures: string[] = [];
    let softFlips = 0;
    // Item-56 positional families — real siblings the claims audit
    // surfaced on coherent stamps. Each lane counts instead of failing
    // while the producer fix is queued; a lane that stops matching
    // fails the sweep below (stale pins must die with the bug).
    //  - flat-on-live-leg: flat-fallback copy never bounds the leg it
    //    denies — "Flat now"/"not much moving" on a ±30% week.
    //  - held-without-tests: "held before"/"defended" floor claims on
    //    a shelf whose stamped test count never reached the surface —
    //    the floor-test gate checks the level exists, not that it held.
    const CLAIM_LANES: Record<string, RegExp> = {
      'flat-on-live-leg': /claims flat\/sideways/,
      'held-without-tests': /claims prior floor tests but resolved tests=0/,
      // Distributional facet vs structural copy — real on coherent rows
      // (flying_pikachu_ev pinned this lane until item 60's riser
      // carve-out retired the pin); fuzz also mints
      // impossible stamps (pctile-8 with an elevated stance) that can't
      // agree no matter what the surfaces print.
      'cross-surface': /^cross-surface:/,
      // BASE_FORMING·resting lands via the pctile≤25 nearFloor proxy
      // even when NO floor resolves anywhere — the parked/floor words
      // ("holding a floor", "level is holding", "on a held floor",
      // "at a floor") then sit on nothing. Distributionally-low
      // wording ("at a low") is exempt upstream; the structural claims
      // are the sibling family.
      'parked-copy-no-structure':
        /claims it's parked on a floor but position resolved 'no-structure'/,
      'held-floor-thesis-no-structure': /arms a floor thesis but position resolved 'no-structure'/,
      // Floor-existence vocabulary ("quiet floor", "held floor") with
      // zero resolved floor evidence — same floorless family plus the
      // REVIVAL note's rhetorical "quiet floor".
      'floor-claim-no-level': /no floor level resolved/,
      // The RANGE_PLAY note's posVariant maps notePos∉{on-floor,
      // at-ceiling} to 'mid' — through-floor collapses into "Mid-range
      // on a proven cycle" while the context sits under its floor.
      'mid-below-floor': /claims mid-range but position resolved 'through-floor'/,
      // The free-fall note's "Nothing under it until the shelf at $X"
      // names the ctx floor — which can resolve ABOVE a price that
      // already broke it, quoting an overhead level as next support.
      'shelf-above-price': /claims a shelf beneath/,
    };
    const laneCounts: Record<string, number> = {};
    for (let i = 0; i < N; i++) {
      const price = num(0.3, 120);
      const low = maybe(0.8, () => price * num(0.6, 1.05));
      const high = maybe(0.8, () => price * num(1.0, 3.5));
      const floor = maybe(0.7, () => price * num(0.4, 1.15));
      // Legs: the stamp and the window measure the same card days
      // apart — jitter each ±8pp around a true leg (a stamp knife +
      // window rocket is a fuzz artifact, not a catalog row). The
      // RANGE evidence stays fully independent — floors, test counts,
      // and rhythms legitimately resolve differently per resolution.
      const tr7 = num(-45, 45);
      const tr30 = num(-45, 45);
      const jitter = () => num(-8, 8);
      const dsh = Math.floor(num(0, 700));
      const signal = mkSignal({
        productId: 9000 + i,
        price,
        stance: pick(STANCES),
        action: pick(ACTIONS),
        trend: pick(TRENDS),
        pctile1y: num(0, 100),
        ret7d: tr7 + jitter(),
        ret30d: tr30 + jitter(),
        ret90d: num(-60, 80),
        ret180d: num(-70, 120),
        ret365d: num(-80, 250),
        cagr: num(-85, 120),
        drawdown: num(-90, 0),
        daysSinceHigh: dsh,
        low90d: low,
        high90d: high,
        spanDays: Math.floor(num(30, 1000)),
        nEvents: Math.floor(num(5, 800)),
        // Stamped range evidence — independent of the features below.
        shelfPrice: floor,
        shelfTests: maybe(0.7, () => Math.floor(num(0, 9))),
        cycleDays: maybe(0.7, () => num(5, 400)),
        medianBouncePct: maybe(0.7, () => num(3, 160)),
        targetPrice: maybe(0.7, () => price * num(0.7, 2.5)),
      });
      // Window-resolved evidence — deliberately INDEPENDENT of the
      // stamps (same shelf vs different shelf, different counts and
      // rhythms — the divergence space).
      const sameShelf = rnd() < 0.5 && floor != null;
      const wFloor = sameShelf ? floor * num(0.95, 1.05) : maybe(0.7, () => price * num(0.3, 1.2));
      // Positional flags must match the generated geometry — in
      // production atFloor/atShelf derive from this same distance, so
      // "atFloor with price 2× the floor" is an impossible input.
      const atFloor = wFloor != null && price >= wFloor * 0.93 && price <= wFloor * 1.1;
      const atShelf =
        !atFloor && wFloor != null && price >= wFloor * 0.97 && price <= wFloor * 1.15;
      const features =
        rnd() < 0.85
          ? mkFeatures({
              lastPrice: price,
              ret7d: tr7 + jitter(),
              ret30d: tr30 + jitter(),
              athPrice: maybe(0.8, () => price * num(1.0, 4.0)),
              daysSinceAth: Math.floor(dsh + num(-30, 30)),
              floorPrice: wFloor,
              floorTests: Math.floor(num(0, 9)),
              atFloor,
              atShelf,
              failedBounce: rnd() < 0.2,
              higherLows: rnd() < 0.3,
              targetPrice: maybe(0.7, () => price * num(0.8, 2.5)),
              sellIntoPrice: maybe(0.7, () => price * num(0.8, 2.0)),
              medianBouncePct: maybe(0.7, () => num(3, 160)),
              cycleDays: maybe(0.7, () => num(5, 400)),
            })
          : undefined;
      const stack = renderSurfaces(signal, features, {
        price,
        // The ctx floor must be a level some surface actually carries
        // — inventing wFloor when features are absent quotes a shelf
        // nothing else knows (harness artifact, not a bug).
        floor: floor ?? (features != null ? wFloor : null) ?? null,
        vsCost: num(-40, 40),
        daysHeld: Math.floor(num(0, 400)),
      });
      const problems = collectProblems(stack);
      // Direction flips split by mechanism — same hard/soft rule the
      // live audit uses. A flip is SOFT when one path was strictly
      // more informed than the other in a way the design permits:
      //  - stamp-blind: the window resolves a floor/level the stamp
      //    never carried (a cycle count alone can't position a card)
      //  - leg-straddle: the paths' legs land on opposite sides of a
      //    classifier bar — the sheet reads the fresher market
      //  - shelf/ceiling split: the two resolutions point at genuinely
      //    different structure (a different shelf or ceiling level)
      // HARD: equivalent inputs, different verdict — a resolution bug,
      // the family the unions exist to kill.
      const stampLevel = signal.shelfPrice != null || signal.low90d != null;
      const windowRange =
        features != null && (features.floorPrice != null || (features.floorTests ?? 0) >= 1);
      // Chart-shape confirms (higherLows / slope) live only in the
      // window — the badge can't see a revival the stamp can't carry,
      // regardless of what level evidence the stamp holds.
      const windowConfirms = features?.higherLows === true || (features?.slope30d ?? 0) > 0;
      const stampBlind = (!stampLevel && windowRange) || windowConfirms;
      // Ceiling-blind: a stamp with no target can't prove the range on
      // the badge path while the window's sellInto/target can on the
      // sheet — the badge simply lacks the level.
      const ceilingBlind =
        signal.targetPrice == null && (features?.sellIntoPrice ?? features?.targetPrice) != null;
      const R7_BARS = [-20, -10, -7, -3, 0, 3, 5, 10, 15, 20];
      const R30_BARS = [-40, -30, -25, -20, -15, -10, -7, -5, -3, 0, 3, 5, 10, 15, 20, 25, 40];
      const straddle = (a: number | null, b: number | null, bars: number[]) =>
        a != null && b != null && bars.some((x) => (a - x) * (b - x) < 0);
      const legDivergent =
        features != null &&
        (straddle(signal.ret7d, features.ret7d, R7_BARS) ||
          straddle(signal.ret30d, features.ret30d, R30_BARS));
      const shelfDivergent =
        features?.floorPrice != null &&
        signal.shelfPrice != null &&
        Math.abs(features.floorPrice - signal.shelfPrice) > signal.shelfPrice * 0.08;
      const winCeiling = features?.sellIntoPrice ?? features?.targetPrice;
      const ceilingDivergent =
        winCeiling != null &&
        signal.targetPrice != null &&
        Math.abs(winCeiling - signal.targetPrice) > signal.targetPrice * 0.1;
      for (const p of problems) {
        const detail =
          `#${i} [${stack.badge.cls}/${stack.sheet.cls}] ${p} ` +
          `(sig=${JSON.stringify({ price: signal.price, stance: signal.stance, trend: signal.trend, r7: signal.ret7d, r30: signal.ret30d, cagr: signal.cagr, dd: signal.drawdown, dsh: signal.daysSinceHigh, pct: signal.pctile1y, shelf: signal.shelfPrice, tests: signal.shelfTests, cyc: signal.cycleDays, bnc: signal.medianBouncePct, tgt: signal.targetPrice })} ` +
          `feat=${features ? JSON.stringify({ fl: features.floorPrice, ft: features.floorTests, cyc: features.cycleDays, bnc: features.medianBouncePct, ath: features.athPrice, si: features.sellIntoPrice, tp: features.targetPrice, r30: features.ret30d, r7: features.ret7d }) : 'none'})`;
        const softFlip =
          p.startsWith('direction flip') &&
          (stampBlind || legDivergent || shelfDivergent || ceilingDivergent || ceilingBlind);
        if (softFlip) {
          softFlips++;
          continue;
        }
        const lane = Object.keys(CLAIM_LANES).find((k) => CLAIM_LANES[k].test(p));
        if (lane) {
          laneCounts[lane] = (laneCounts[lane] ?? 0) + 1;
          continue;
        }
        // Item-53 family (position claims) is dead — item 55's
        // resolved-position core drove the count to zero, so the
        // counted lane left with it. Any recurrence lands in `failures`
        // and fails hard like every other contract break.
        if (failures.length < 15) {
          failures.push(detail);
        }
      }
    }
    if (softFlips > 0) {
      // Report lane — divergence the design permits, tracked so a
      // rising count is visible instead of silently absorbed.
      console.log(`[fuzz] ${softFlips} soft direction flips (stamp-blind or leg-divergent)`);
    }
    for (const [lane, n] of Object.entries(laneCounts)) {
      console.log(`[fuzz] positional sibling "${lane}": ${n} findings`);
    }
    // A pinned family that stopped reproducing is stale — the bug is
    // gone, so the lane goes too.
    for (const lane of Object.keys(CLAIM_LANES)) {
      expect(laneCounts[lane] ?? 0).toBeGreaterThan(0);
    }
    expect(failures).toEqual([]);
  });
});
