import {
  classifyDeal,
  dealAction,
  offerBand,
  ownerNote,
  positionAction,
  rotationBucket,
  type DealRead,
} from '../src/scanner/services/deal/dealClassify';
import { buildStockHealth } from '../src/scanner/services/deal/stockHealth';
import {
  buildFacets,
  engineLines,
  positionTriggers,
} from '../src/scanner/services/deal/sheetReads';
import type { SeriesFeatures } from '../src/scanner/services/deal/seriesSignals';
import type { CardSignal } from '../src/db/catalogDb';

// Surface coherence — every place a card's read renders must tell ONE
// story. The lifecycle journeys pin transitions card-by-card; this
// harness renders the WHOLE stack per scenario and asserts the
// surfaces agree: inventory badge vs sheet badge, verbs vs class,
// bucket vs direction, trigger row vs health-row trigger, engine
// lines vs the odds vocabulary. A card the user doesn't have to
// spot-check anymore — the contract is machine-checked per scenario.

const sig = (over: Partial<CardSignal> = {}): CardSignal => ({
  productId: 1,
  subType: 'Normal',
  price: 10,
  priceDate: '2026-01-15',
  firstDate: '2025-01-01',
  stance: 'neutral',
  action: 'NEUTRAL',
  confidence: 'high',
  pctile1y: 50,
  ret7d: 0,
  ret14d: 0,
  ret30d: 0,
  ret90d: 0,
  ret180d: 0,
  ret365d: 0,
  retAll: 0,
  cagr: 0,
  trend: 'flat',
  drawdown: 0,
  daysSinceHigh: 0,
  low90d: null,
  high90d: null,
  slope30d: null,
  ma20_60: null,
  z90: null,
  dailySigma: null,
  daysSinceChange: 2,
  nEvents: 200,
  coverage: 0.6,
  spanDays: 600,
  liqFlag: 'active',
  changesPerYear: 60,
  pctileAll: null,
  volRegime: 'normal',
  excess30d: null,
  fwd30dLo: null,
  fwd30dHi: null,
  reason: null,
  shelfPrice: null,
  shelfTests: null,
  cycleDays: null,
  medianBouncePct: null,
  targetPrice: null,
  ...over,
});

const feat = (over: Partial<SeriesFeatures> = {}): SeriesFeatures => ({
  lastPrice: 10,
  daysCovered: 300,
  ret7d: null,
  ret30d: null,
  slope30d: null,
  athPrice: 15,
  daysSinceAth: 100,
  floorTests: 0,
  failedBounce: false,
  atFloor: false,
  atShelf: false,
  floorPrice: null,
  targetPrice: null,
  sellIntoPrice: null,
  medianBouncePct: null,
  medianBounceDays: null,
  cycleDays: null,
  higherLows: false,
  ...over,
});

/* ------------------------------------------------------------------ */
/* The action family — what direction the surfaces prescribe. Badge   */
/* and sheet may refine into different classes on different evidence,  */
/* but they may never point opposite ways: "add" vs "dump" is a       */
/* contradiction the user can see.                                    */
/* ------------------------------------------------------------------ */
type Family = 'add' | 'keep' | 'dump';

function family(read: DealRead): Family {
  switch (read.cls) {
    case 'REVIVAL':
    case 'DIP_BUY':
    case 'STABLE_GROWER':
      return 'add';
    case 'RANGE_PLAY':
      return read.variant === 'exit' ? 'dump' : read.variant === 'entry' ? 'add' : 'keep';
    case 'BASE_FORMING':
      return read.variant === 'testing' ? 'keep' : 'add';
    case 'FREE_FALL':
    case 'HYPE_DECAY':
    case 'POST_SPIKE_BLEED':
    case 'DECLINER':
      return 'dump';
    default:
      return 'keep'; // AT_PEAK, DEAD_STABLE, DORMANT, STABLE_FLAT, LOW_DATA
  }
}

/* ------------------------------------------------------------------ */
/* The full surface stack — what the app renders for one card state.  */
/* Every consumer's output, side by side.                             */
/* ------------------------------------------------------------------ */
type SurfaceStack = {
  // InventoryCard badge — the scalar read.
  badge: DealRead;
  // The market price the stack renders against.
  px: number;
  // DealAnalysisSheet badge — the series read.
  sheet: DealRead;
  // Buy-scout action + offer band (not-owned sheet).
  scoutVerb: string;
  band: { open: number; max: number };
  // Owned sheet: verb, note, hero, triggers.
  ownerVerb: string;
  note: string;
  triggers: ReturnType<typeof positionTriggers>;
  // Stock-health row: bucket (deep pass + pre-hydration scalar) + trigger.
  bucket: string;
  scalarBucket: string;
  healthTrigger: string | null;
  onFloor: boolean;
  // Engine + facet lines.
  lines: { text: string; warn?: boolean }[];
  facets: { label: string; text: string }[];
};

function renderSurfaces(
  signal: CardSignal,
  features: SeriesFeatures | undefined,
  ctx: {
    price: number;
    floor: number | null;
    vsCost?: number;
    daysHeld?: number;
    cracked?: boolean;
    ceiling?: number | null;
  }
): SurfaceStack {
  const badge = classifyDeal(signal);
  const sheet = classifyDeal(signal, features);
  const triggers = positionTriggers(sheet, signal, features);
  const health = buildStockHealth(
    [
      {
        id: 'x',
        name: 'x',
        liveMarket: signal.price ?? 0,
        amountPaid: 5,
      },
    ],
    () => signal,
    () => features
  );
  const item = health.items[0];
  return {
    badge,
    px: ctx.price,
    sheet,
    scoutVerb: dealAction(sheet),
    band: offerBand(sheet, 100),
    ownerVerb: positionAction(sheet, {
      cracked: triggers.floorCracked,
      bounceCheap: triggers.bounceCheap,
      ceiling: triggers.showTarget ? triggers.targetPrice : null,
      green: ctx.vsCost != null && ctx.vsCost >= 1,
      price: ctx.price,
    }),
    note: ownerNote(sheet, features, {
      price: ctx.price,
      floor: ctx.floor ?? triggers.floorPrice,
      vsCost: ctx.vsCost,
      daysHeld: ctx.daysHeld,
      cracked: triggers.floorCracked,
      ceiling: ctx.ceiling ?? triggers.targetPrice,
    }),
    triggers,
    bucket: rotationBucket(sheet, signal, features),
    scalarBucket: rotationBucket(badge, signal),
    healthTrigger: item?.trigger ?? null,
    onFloor: item?.onFloor ?? false,
    lines: engineLines(
      sheet,
      null,
      false,
      {},
      () => false
    ),
    facets: buildFacets(signal, features),
  };
}

/** Prints the card the way the user reads it — the dump is the audit. */
function dumpStack(stack: SurfaceStack): string {
  const t = stack.triggers;
  return [
    `  badge (inventory) : ${stack.badge.cls}${stack.badge.variant ? `·${stack.badge.variant}` : ''}`,
    `  badge (sheet)     : ${stack.sheet.cls}${stack.sheet.variant ? `·${stack.sheet.variant}` : ''}`,
    `  scout action      : ${stack.scoutVerb}`,
    `  offer band        : $${stack.band.open} – $${stack.band.max} on $100`,
    `  owner action      : ${stack.ownerVerb}`,
    `  headline          : ${stack.sheet.headline}`,
    `  owner note        : "${stack.note}"`,
    `  floor row         : ${t.showFloor ? (t.floorCracked ? `CRACKED $${t.floorPrice?.toFixed(2)}` : `SELL UNDER $${t.crackPrice?.toFixed(2)}`) : '—'}`,
    `  target row        : ${t.showTarget ? `SELL INTO $${t.targetPrice?.toFixed(2)}` : '—'}`,
    `  health bucket     : ${stack.bucket} (scalar: ${stack.scalarBucket})`,
    `  health trigger    : ${stack.healthTrigger ?? '—'} · onFloor=${stack.onFloor}`,
    ...stack.lines.map((l) => `  engine line       : ${l.text}`),
    ...stack.facets.map((f) => `  facet ${f.label.padEnd(12)}: ${f.text}`),
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* The contract — applied to every scenario.                           */
/* ------------------------------------------------------------------ */
const DUMP_VERBS =
  /rotate|bank it|consolidate|sell|move it|pass|don't catch|lowball|dump|cut/i;
const ADD_VERBS = /buy|let it run|hold|watch/i;
const EXIT_ONLY = /floor broke|sell it|sell the bounce/i;

function assertContract(name: string, stack: SurfaceStack) {
  const problems: string[] = [];

  // 1) Direction coherence — badge and sheet may refine but never
  //    contradict: a scout-buy family can't sit under an exit-family
  //    sheet, and vice versa.
  const bf = family(stack.badge);
  const sf = family(stack.sheet);
  if (
    (bf === 'add' && sf === 'dump') ||
    (bf === 'dump' && sf === 'add')
  ) {
    problems.push(
      `direction flip: badge=${stack.badge.cls}(${bf}) sheet=${stack.sheet.cls}(${sf})`
    );
  }

  // 2) Verb coherence — the verbs must match the sheet class's own
  //    direction. Cracked floor → exit-only language.
  if (stack.triggers.floorCracked) {
    if (!EXIT_ONLY.test(stack.ownerVerb)) {
      problems.push(
        `cracked floor but owner verb is "${stack.ownerVerb}"`
      );
    }
    if (/hold|let it run|buy/i.test(stack.note)) {
      problems.push(`cracked floor but note says hold: "${stack.note}"`);
    }
  } else if (sf === 'dump') {
    if (!DUMP_VERBS.test(stack.ownerVerb) && !/dead money|hold|consolidate|fodder/i.test(stack.ownerVerb)) {
      problems.push(
        `dump-family class ${stack.sheet.cls} but owner verb is "${stack.ownerVerb}"`
      );
    }
    if (/buy the|solid buy/i.test(stack.scoutVerb)) {
      problems.push(
        `dump-family class ${stack.sheet.cls} but scout says "${stack.scoutVerb}"`
      );
    }
  } else if (sf === 'add') {
    if (!ADD_VERBS.test(stack.ownerVerb)) {
      problems.push(
        `add-family class ${stack.sheet.cls} but owner verb is "${stack.ownerVerb}"`
      );
    }
    if (/rotate|dump|consolidate|dead money|pass|don't/i.test(stack.scoutVerb)) {
      problems.push(
        `add-family class ${stack.sheet.cls} but scout says "${stack.scoutVerb}"`
      );
    }
  }

  // 3) Bucket coherence — the health bucket can't put a dump-family
  //    class in "grow" or an add-family class in "rotate".
  if (sf === 'dump' && stack.bucket === 'grow') {
    problems.push(
      `dump class ${stack.sheet.cls} landed in grow bucket`
    );
  }
  if (sf === 'add' && (stack.bucket === 'rotate' || stack.bucket === 'dead')) {
    problems.push(
      `add class ${stack.sheet.cls} landed in ${stack.bucket} bucket`
    );
  }

  // 4) Trigger coherence — the health row's exit line and the sheet's
  //    SELL UNDER row must name the same floor dollar figure.
  if (stack.triggers.showFloor && stack.triggers.floorPrice != null) {
    const m = stack.healthTrigger?.match(/\$(\d+(?:\.\d+)?)/);
    if (m && Math.abs(parseFloat(m[1]) - stack.triggers.floorPrice) > 0.011) {
      problems.push(
        `floor mismatch: sheet $${stack.triggers.floorPrice.toFixed(2)} vs health "${stack.healthTrigger}"`
      );
    }
  }

  // 5) Offer-band sanity — never inverted, never past full-rate +10%.
  if (!(stack.band.open <= stack.band.max && stack.band.max <= 110)) {
    problems.push(
      `insane band $${stack.band.open}-$${stack.band.max}`
    );
  }

  // 6) Language standards — every '%' inside an engine line sits in a
  //    parenthetical evidence clause (the odds word leads), and the
  //    pooled floor prior says "Market-wide", never "floors like this".
  for (const l of stack.lines) {
    if (/floors like this/i.test(l.text)) {
      problems.push(`pooled prior mislabeled: "${l.text}"`);
    }
    const stripped = l.text.replace(/\([^)]*\)/g, '');
    if (/\d(?:\.\d+)?%/.test(stripped)) {
      problems.push(
        `bare percent outside evidence parens: "${l.text}"`
      );
    }
  }

  // 7) Note coherence — a note can't claim a floor the price isn't at.
  const fl = stack.triggers.floorPrice;
  const px = stack.px;
  if (
    fl != null &&
    px != null &&
    px > fl * 1.3 &&
    /parked on|knifed back to|floor that's held|been tested/i.test(stack.note)
  ) {
    problems.push(`note claims distant floor: "${stack.note}"`);
  }

  if (problems.length > 0) {
    throw new Error(
      `${name} — surface contract broken:\n${dumpStack(stack)}\n` +
        problems.map((p) => `  ✗ ${p}`).join('\n')
    );
  }
}

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
