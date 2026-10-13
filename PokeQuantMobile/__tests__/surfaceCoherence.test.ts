import type { CardDeep, CardSignal, PatternStat } from '../src/db/catalogDb';
import type { SeriesFeatures } from '../src/scanner/services/deal/seriesSignals';
import { mkFeatures, mkSignal } from './helpers/builders';
import {
  assertContract,
  dumpStack,
  renderSurfaces,
} from './helpers/stack';

// Surface coherence — every place a card's read renders must tell ONE
// story. The lifecycle journeys pin transitions card-by-card; this
// harness renders the WHOLE stack per scenario and asserts the
// surfaces agree: inventory badge vs sheet badge, verbs vs class,
// bucket vs direction, trigger row vs health-row trigger, engine
// lines vs the odds vocabulary, and every numeric claim vs the inputs
// that generated it (the claims audit). A card the user doesn't have
// to spot-check anymore — the contract is machine-checked per
// scenario. Helpers live in ./helpers/{builders,stack,claims} so every
// suite shares one contract.

const sig = (over: Partial<CardSignal> = {}): CardSignal => mkSignal(over);
const feat = (over: Partial<SeriesFeatures> = {}): SeriesFeatures =>
  mkFeatures(over);

/* ------------------------------------------------------------------ */
/* Scenario table — every real card that's been audited plus a class  */
/* coverage grid. Each entry gets the whole contract, and hydrated    */
/* entries additionally require identical badge/sheet classes.        */
/* ------------------------------------------------------------------ */
type Scenario = {
  name: string;
  sig: Partial<CardSignal>;
  features?: Partial<SeriesFeatures>;
  ctx?: {
    price?: number;
    floor?: number | null;
    vsCost?: number;
    daysHeld?: number;
    cracked?: boolean;
    ceiling?: number | null;
    deep?: CardDeep | null;
    patterns?: Record<string, PatternStat>;
  };
  /** The stamp carries the same deep evidence the series computes —
   *  badge and sheet must name the SAME class, not just the same
   *  direction. */
  hydrated?: boolean;
  cls?: string;      // pin the sheet class
  badgeCls?: string; // pin the badge class when it differs legitimately
};

const scenarios: Scenario[] = [
  // Leafeon — the bug that started this: lifetime ATH ancient, window
  // peak recent. Both paths must land FREE_FALL.
  {
    name: 'leafeon — ancient ATH, hard knife',
    sig: {
      spanDays: 635,
      stance: 'falling',
      trend: 'depreciating',
      cagr: -58.3,
      ret7d: -22.4,
      ret30d: -14.8,
      ret90d: -18.9,
      drawdown: -78.1,
      daysSinceHigh: 635,
      pctile1y: 75,
      price: 4.37,
      low90d: 4.0,
      high90d: 7.17,
      shelfPrice: 4.43,
      shelfTests: 23,
      medianBouncePct: 20.3,
    },
    features: {
      daysSinceAth: 80,
      athPrice: 7.17,
      lastPrice: 4.37,
      failedBounce: true,
      atFloor: true,
      atShelf: true,
      floorPrice: 4.43,
      floorTests: 23,
      medianBouncePct: 20.3,
    },
    ctx: { price: 4.37, vsCost: 2.54 },
    hydrated: true,
    cls: 'FREE_FALL',
  },
  // Zekrom — a compounder in a real bleed parked on a held floor.
  // PSB on both paths; floor is the watchpoint.
  {
    name: 'zekrom — bleed parked on a held floor',
    sig: {
      spanDays: 700,
      stance: 'falling',
      trend: 'depreciating',
      cagr: 12,
      ret7d: -5.7,
      ret30d: -17.9,
      ret90d: -31,
      drawdown: -34,
      daysSinceHigh: 90,
      pctile1y: 28,
      price: 11.5,
      low90d: 11.2,
      high90d: 17.29,
      shelfPrice: 11.2,
      shelfTests: 3,
      medianBouncePct: 42,
    },
    features: {
      daysSinceAth: 90,
      athPrice: 17.29,
      lastPrice: 11.5,
      atFloor: true,
      atShelf: true,
      floorPrice: 11.2,
      floorTests: 3,
      medianBouncePct: 42,
    },
    ctx: { price: 11.5, vsCost: 10 },
    hydrated: true,
    cls: 'POST_SPIKE_BLEED',
  },
  // Togedemaru — dead money on a bulletproof floor. 10/13 bounces but
  // a 6-day cycle is micro-chop, not a range.
  {
    name: 'togedemaru — micro-chop on a held floor',
    sig: {
      spanDays: 600,
      stance: 'depressed',
      trend: 'depreciating',
      cagr: -45,
      ret7d: -1,
      ret30d: -3,
      ret90d: -8,
      drawdown: -45,
      daysSinceHigh: 300,
      pctile1y: 30,
      price: 2.33,
      low90d: 2.2,
      high90d: 2.6,
      shelfPrice: 2.33,
      shelfTests: 13,
      cycleDays: 6,
      medianBouncePct: 19.8,
    },
    features: {
      lastPrice: 2.33,
      atFloor: true,
      atShelf: true,
      floorPrice: 2.33,
      floorTests: 13,
      cycleDays: 6,
      medianBouncePct: 19.8,
    },
    ctx: { price: 2.33, vsCost: 0.5 },
    hydrated: true,
    cls: 'DEAD_STABLE',
  },
  // Yamper — parked on a floor whose defenses die: bounced 0/8, sits
  // right on it. The lifetime high is ancient (700d) so both paths
  // skip the bleed window and land the knife — even though the badge
  // can't see failedBounce, the stamp alone is enough.
  {
    name: 'yamper — dead bounce on the floor',
    sig: {
      spanDays: 331,
      stance: 'falling',
      trend: 'depreciating',
      cagr: -79,
      ret7d: -5.7,
      ret30d: -19.7,
      ret90d: -23.6,
      drawdown: -77,
      daysSinceHigh: 700,
      pctile1y: 54,
      price: 3.15,
      low90d: 3.15,
      high90d: 5.4,
      shelfPrice: 3.19,
      shelfTests: 7,
      medianBouncePct: 13,
    },
    features: {
      daysSinceAth: 700,
      athPrice: 14.1,
      lastPrice: 3.15,
      ret7d: -5.7,
      ret30d: -19.7,
      failedBounce: true,
      atFloor: true,
      floorPrice: 3.19,
      floorTests: 7,
      medianBouncePct: 13,
    },
    ctx: { price: 3.15, vsCost: 2.1 },
    hydrated: true,
    cls: 'FREE_FALL',
  },
  // Toucannon — new-set slide at fodder prices. Same class both ways;
  // the owned verb must be consolidate, not urgency.
  {
    name: 'toucannon — launch crash, dollar fodder',
    sig: {
      spanDays: 93,
      firstDate: '2026-07-15',
      stance: 'depressed',
      trend: 'depreciating',
      cagr: -99,
      ret7d: -2.5,
      ret30d: -8,
      ret90d: -60,
      drawdown: -80,
      daysSinceHigh: 80,
      pctile1y: 3,
      price: 1.49,
      low90d: 1.4,
      high90d: 7.5,
    },
    ctx: { price: 1.49, vsCost: 0.47 },
    cls: 'HYPE_DECAY',
  },
  // Tremendous bomb — the crash ENDED on a held floor. A young card
  // parked flat on a defended shelf is basing, not still sliding.
  {
    name: 'tremendous bomb — crash ended on a held floor',
    sig: {
      spanDays: 75,
      firstDate: '2026-08-10',
      stance: 'depressed',
      trend: 'depreciating',
      cagr: -99,
      ret7d: 0.5,
      ret30d: -4,
      ret90d: -78,
      drawdown: -82,
      daysSinceHigh: 70,
      pctile1y: 2,
      price: 1.62,
      low90d: 1.55,
      high90d: 9.4,
      shelfPrice: 1.62,
      shelfTests: 8,
      medianBouncePct: 22,
    },
    features: {
      daysSinceAth: 70,
      athPrice: 9.4,
      lastPrice: 1.62,
      atFloor: true,
      atShelf: true,
      floorPrice: 1.62,
      floorTests: 8,
      medianBouncePct: 22,
    },
    ctx: { price: 1.62 },
    hydrated: true,
    cls: 'BASE_FORMING',
  },
  // Flying pikachu — soft month in an intact +690% uptrend at the 91st
  // pctile. A giveback, not a crash — grower cooling.
  {
    name: 'flying pikachu — soft month in an intact uptrend',
    sig: {
      spanDays: 700,
      stance: 'neutral',
      trend: 'appreciating',
      cagr: 85,
      retAll: 690,
      ret7d: -2,
      ret30d: -11,
      ret90d: 8,
      drawdown: -15,
      daysSinceHigh: 45,
      pctile1y: 91,
      price: 55,
      low90d: 48,
      high90d: 65,
    },
    ctx: { price: 55 },
    cls: 'STABLE_GROWER',
  },
  // Golduck — the shipped window under-counts floor tests the stamp
  // saw on full history (1 vs 3 at the SAME $1.14 shelf). Same-shelf
  // levels union the count → RANGE_PLAY on both paths, not badge
  // range / sheet knife. The +34.6%/mo appreciating card can never
  // be "free fall" — the week is a giveback inside a run.
  {
    name: 'golduck — window under-counts the shelf tests',
    sig: {
      spanDays: 979,
      stance: 'neutral',
      trend: 'appreciating',
      cagr: 43.8,
      ret7d: -20.1,
      ret30d: 34.6,
      ret90d: 136.5,
      drawdown: -20.1,
      daysSinceHigh: 8,
      pctile1y: 92.9,
      price: 1.75,
      low90d: 0.74,
      high90d: 2.19,
      shelfPrice: 1.14,
      shelfTests: 3,
      cycleDays: 26,
      medianBouncePct: 44.5,
      targetPrice: 1.65,
    },
    features: {
      daysSinceAth: 8,
      athPrice: 2.19,
      lastPrice: 1.75,
      ret7d: -20.1,
      ret30d: 34.6,
      floorPrice: 1.14,
      floorTests: 1,
      cycleDays: 78,
      medianBouncePct: 92.1,
      targetPrice: 1.97,
      sellIntoPrice: 1.97,
    },
    ctx: { price: 1.75, vsCost: 1.26 },
    hydrated: true,
    cls: 'RANGE_PLAY',
  },
  // Week-knife on a flat card — r30 stays green but the trend isn't
  // appreciating, so the knife stands. The headline must quote the
  // week leg, never abs() the green month.
  {
    name: 'week knife — green month, flat trend',
    sig: {
      spanDays: 400,
      stance: 'neutral',
      trend: 'flat',
      cagr: -20,
      ret7d: -20,
      ret30d: 5,
      ret90d: -10,
      drawdown: -35,
      daysSinceHigh: 400,
      pctile1y: 30,
      price: 8,
      low90d: 6.5,
      high90d: 14,
    },
    ctx: { price: 8 },
    cls: 'FREE_FALL',
  },
];

describe('surface coherence — every surface tells one story', () => {
  for (const s of scenarios) {
    const signal = sig(s.sig);
    const fs = s.features ? feat(s.features) : undefined;
    const stack = renderSurfaces(signal, fs, {
      price: s.ctx?.price ?? signal.price ?? 0,
      floor: s.ctx?.floor ?? fs?.floorPrice ?? signal.shelfPrice ?? null,
      vsCost: s.ctx?.vsCost,
      daysHeld: s.ctx?.daysHeld,
      cracked: s.ctx?.cracked,
      ceiling: s.ctx?.ceiling,
      deep: s.ctx?.deep ?? null,
      patterns: s.ctx?.patterns ?? {},
    });

    test(`${s.name}`, () => {
      console.log(`\n${s.name}\n${dumpStack(stack)}`);
      if (s.cls) expect(stack.sheet.cls).toBe(s.cls);
      if (s.hydrated) {
        // Stamps mirror the deep pass — the badge and the sheet must
        // name the same class. This is the steady-state invariant the
        // whole scalar/series architecture rests on.
        expect(stack.sheet.cls).toBe(stack.badge.cls);
      }
      if (s.badgeCls) expect(stack.badge.cls).toBe(s.badgeCls);
      assertContract(s.name, stack);
      // The full rendered stack is a review artifact — a wording,
      // class, or surface change shows up here as an intentional
      // diff, never a silent drift.
      expect(dumpStack(stack)).toMatchSnapshot();
    });
  }
});

/* ------------------------------------------------------------------ */
/* Context matrix — the same card under different owner states must   */
/* follow the language rules everywhere: fodder consolidates, green    */
/* banks, cracked overrides, underwater cuts.                         */
/* ------------------------------------------------------------------ */
describe('context matrix — language rules hold across owner states', () => {
  const fallingSig = sig({
    spanDays: 400,
    stance: 'falling',
    trend: 'depreciating',
    cagr: -25,
    ret7d: -8,
    ret30d: -14,
    ret90d: -20,
    drawdown: -45,
    daysSinceHigh: 150,
    pctile1y: 20,
    low90d: 8,
    high90d: 18,
    shelfPrice: 8.2,
    shelfTests: 4,
    medianBouncePct: 18,
  });

  const cases: {
    name: string;
    price: number;
    vsCost?: number;
    low90d?: number | null;
    shelf?: number | null;
    want: RegExp;
  }[] = [
    {
      name: 'green on a bleeder → bank the win',
      price: 10,
      vsCost: 4,
      want: /bank it while it's green/i,
    },
    {
      name: 'flat on a bleeder → rotate',
      price: 10,
      vsCost: 0.2,
      want: /rotate/i,
    },
    {
      name: 'underwater on a bleeder → rotate (cut, not bank)',
      price: 10,
      vsCost: -3,
      want: /rotate/i,
    },
    {
      name: 'fodder bleeder → consolidate, never urgency',
      price: 1.49,
      vsCost: 0.4,
      low90d: 1.3,
      shelf: 1.4,
      want: /consolidate|fodder/i,
    },
    {
      name: 'through the floor → crack language overrides everything',
      price: 6.5,
      vsCost: 4,
      low90d: 8,
      shelf: 8.2,
      want: /floor broke|sell/i,
    },
  ];

  for (const c of cases) {
    test(c.name, () => {
      const signal = sig({
        ...fallingSig,
        price: c.price,
        low90d: c.low90d ?? fallingSig.low90d,
        shelfPrice:
          c.shelf === null ? null : (c.shelf ?? fallingSig.shelfPrice),
      });
      const stack = renderSurfaces(signal, undefined, {
        price: c.price,
        floor: c.shelf ?? c.low90d ?? null,
        vsCost: c.vsCost,
      });
      console.log(`\n${c.name}\n${dumpStack(stack)}`);
      expect(stack.ownerVerb).toMatch(c.want);
      assertContract(c.name, stack);
    });
  }
});
