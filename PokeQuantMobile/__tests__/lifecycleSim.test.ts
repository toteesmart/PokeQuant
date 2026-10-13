import { classifyDeal, ownerNote } from '../src/scanner/services/deal/dealClassify';
import type { DealClassId } from '../src/scanner/services/deal/dealClassify';
import type { SeriesFeatures } from '../src/scanner/services/deal/seriesSignals';
import type { CardSignal } from '../src/db/catalogDb';

// Lifecycle simulation — a card's DATA changes over time and every
// surface must flip correctly WITH it. The static tests pin one state
// each; these journeys pin the transitions: crash→basing, dip→dead,
// floor-hold→failed→cracked, bump→revival-vs-fake. Each step asserts
// the class on BOTH surfaces (badge = scalar, sheet = series) plus
// that the owner note agrees with the class it's printed under.
// Every journey here is a card the app once got wrong.

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

type Step = {
  /** What happened in the card's life at this step. */
  at: string;
  /** Signal changes vs the previous step (accumulates). */
  sig?: Partial<CardSignal>;
  /** Series-feature state at this step (undefined = badge path too). */
  features?: Partial<SeriesFeatures>;
  /** Position context for the owner note — cracked mirrors the row. */
  ctx?: {
    price?: number;
    floor?: number;
    vsCost?: number;
    daysHeld?: number;
    cracked?: boolean;
  };
  cls: DealClassId;
  /** Expected class on the scalar badge path — surfaces must agree. */
  scalarCls?: DealClassId;
  note?: RegExp;
  notNote?: RegExp;
};

function journey(name: string, base: Partial<CardSignal>, steps: Step[]) {
  describe(`journey — ${name}`, () => {
    let cur = { ...base };
    for (const s of steps) {
      cur = { ...cur, ...s.sig };
      const signal = sig(cur);
      const fs = s.features != null ? feat(s.features) : undefined;
      const read = classifyDeal(signal, fs);
      const badgeRead = classifyDeal(signal);
      const note = ownerNote(read, fs, {
        price: s.ctx?.price ?? signal.price,
        floor: s.ctx?.floor ?? fs?.floorPrice ?? null,
        vsCost: s.ctx?.vsCost,
        daysHeld: s.ctx?.daysHeld,
        cracked: s.ctx?.cracked,
      });
      test(`${s.at} → ${s.cls}`, () => {
        expect(read.cls).toBe(s.cls);
        if (s.scalarCls) expect(badgeRead.cls).toBe(s.scalarCls);
        if (s.note) expect(note).toMatch(s.note);
        if (s.notNote) expect(note).not.toMatch(s.notNote);
        // A cracked floor kills every hold-premised note — the note
        // and the CRACKED row can never disagree again.
        if (s.ctx?.cracked) {
          expect(note).not.toMatch(
            /beats dumping|safe stock|dip others buy|hold while it holds|steady climb|hold; this/i
          );
        }
      });
    }
  });
}

/* ------------------------------------------------------------------ */
/* Toucannon — new secret rare still crashing on a dead floor.         */
/* Badge once said New-set slide while the sheet said Long-term        */
/* decline: parked-on-floor must be EARNED by a steadied month.        */
/* ------------------------------------------------------------------ */
journey(
  'toucannon: launch crash → steadies → basing',
  {
    firstDate: '2026-07-15',
    spanDays: 93,
    stance: 'depressed',
    trend: 'depreciating',
    cagr: -99,
    ret7d: -2.5,
    ret30d: -40,
    ret90d: -84,
    drawdown: -85,
    daysSinceHigh: 92,
    pctile1y: 6.5,
    price: 1.54,
  },
  [
    {
      at: 'still knifing AT the crash low, bounce already died',
      features: {
        lastPrice: 1.54,
        daysCovered: 93,
        ret7d: -2.5,
        ret30d: -40,
        daysSinceAth: 92,
        floorTests: 6,
        failedBounce: true,
        atFloor: true,
        floorPrice: 1.45,
        medianBouncePct: 22,
      },
      cls: 'HYPE_DECAY', // −40%/mo parked ≠ basing
      scalarCls: 'HYPE_DECAY',
    },
    {
      at: 'month steadies on the same dead floor',
      sig: { ret30d: -6, ret7d: -1 },
      features: {
        lastPrice: 1.5,
        daysCovered: 93,
        ret7d: -1,
        ret30d: -6,
        daysSinceAth: 92,
        floorTests: 6,
        failedBounce: true,
        atFloor: true,
        floorPrice: 1.45,
        medianBouncePct: 22,
      },
      cls: 'BASE_FORMING', // steadied now — parked counts
    },
    {
      at: 'price through the crack line — thesis dead',
      sig: { price: 1.3, ret30d: -9 },
      features: {
        lastPrice: 1.3,
        daysCovered: 95,
        ret7d: -6,
        ret30d: -9,
        daysSinceAth: 94,
        floorTests: 6,
        failedBounce: true,
        atFloor: false, // 1.30 vs 1.45 — below the zone, through it
        floorPrice: 1.45,
        medianBouncePct: 22,
      },
      ctx: { price: 1.3, floor: 1.45, cracked: true },
      cls: 'HYPE_DECAY', // still young + still sliding — parked is lost
      notNote: /safe stock|hold while it holds/,
    },
  ]
);

/* ------------------------------------------------------------------ */
/* Mabosstiff IR — a real grower whose dip broke its own shelf.        */
/* ------------------------------------------------------------------ */
journey(
  'mabosstiff: dip-buy → crack → re-stamp',
  {
    spanDays: 975,
    stance: 'falling',
    trend: 'appreciating',
    cagr: 80,
    ret7d: -8,
    ret30d: -13,
    ret90d: 5,
    drawdown: -15,
    daysSinceHigh: 30,
    pctile1y: 74,
    price: 8.1,
  },
  [
    {
      at: 'dip parked on the $8.15 shelf — thesis alive',
      features: {
        lastPrice: 8.1,
        ret7d: -8,
        ret30d: -13,
        floorTests: 3,
        atShelf: true,
        floorPrice: 8.15,
        medianBouncePct: 30,
      },
      ctx: { price: 8.1, floor: 8.15, cracked: false },
      cls: 'DIP_BUY',
      note: /dip others buy/,
    },
    {
      at: 'intraday: through the break, stamp hasn’t moved yet',
      ctx: { price: 7.8, floor: 8.15, cracked: true },
      features: {
        lastPrice: 7.8,
        ret7d: -9,
        ret30d: -14,
        floorTests: 3,
        atShelf: false, // through the shelf zone now
        floorPrice: 8.15,
        medianBouncePct: 30,
      },
      cls: 'DIP_BUY', // stamped class lags — the NOTE must not
      note: /not a dip anymore/,
    },
    {
      at: 'next delta: trend stamp finally catches the break',
      sig: {
        stance: 'depressed',
        trend: 'depreciating',
        cagr: 60,
        ret30d: -18,
        ret7d: -9,
        drawdown: -32,
        daysSinceHigh: 60,
        pctile1y: 30,
        price: 6.9,
      },
      features: {
        lastPrice: 6.9,
        ret7d: -9,
        ret30d: -18,
        daysSinceAth: 60,
        floorTests: 2,
        atFloor: true,
        floorPrice: 6.4,
        medianBouncePct: 20,
      },
      ctx: { price: 6.9, floor: 6.4 },
      cls: 'POST_SPIKE_BLEED', // still sliding, floor overhead lost
    },
  ]
);

/* ------------------------------------------------------------------ */
/* Yamper — tested-but-feeble floor → bounce dies → cheap crack.       */
/* ------------------------------------------------------------------ */
journey(
  'yamper: feeble floor → failed bounce → spare-change crack',
  {
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
    price: 3.1,
  },
  [
    {
      at: 'on a floor that tests a lot but barely bounces',
      features: {
        lastPrice: 3.1,
        ret7d: -5.7,
        ret30d: -19.7,
        daysSinceAth: 700,
        floorTests: 7,
        failedBounce: false,
        atFloor: true,
        atShelf: false,
        floorPrice: 3.19,
        medianBouncePct: 13,
      },
      ctx: { price: 3.1, floor: 3.19, vsCost: 2.1 },
      cls: 'FREE_FALL',
      note: /barely bounces/,
    },
    {
      at: 'the bounce off it died back onto the shelf',
      sig: { price: 3.15 },
      features: {
        lastPrice: 3.15,
        ret7d: -5.7,
        ret30d: -19.7,
        daysSinceAth: 700,
        floorTests: 7,
        failedBounce: true,
        atFloor: true,
        floorPrice: 3.19,
        medianBouncePct: 13,
      },
      ctx: { price: 3.15, floor: 3.19, vsCost: 2.1 },
      cls: 'FREE_FALL', // a knife on a FAILED floor still knives
      note: /spare change|sell/,
      notNote: /hold while it holds/,
    },
    {
      at: 'deep through the shelf — no floor under it now',
      sig: { price: 2.9, ret30d: -24 },
      features: {
        lastPrice: 2.9,
        ret7d: -7,
        ret30d: -24,
        daysSinceAth: 700,
        floorTests: 7,
        failedBounce: true,
        floorPrice: 3.19,
        medianBouncePct: 13,
      },
      ctx: { price: 2.9, floor: 3.19, vsCost: 1.9, cracked: true },
      cls: 'FREE_FALL',
      note: /spare change|sell/,
    },
  ]
);

/* ------------------------------------------------------------------ */
/* Tremendous bomb — the young floor case the parked rule was built    */
/* for: crash ENDED, parked on a defended floor, mild month.           */
/* ------------------------------------------------------------------ */
journey(
  'tremendous bomb: launch crash ENDED on a held floor',
  {
    firstDate: '2026-07-16',
    spanDays: 88,
    stance: 'neutral',
    trend: 'depreciating',
    cagr: -79,
    ret7d: -2,
    ret30d: -5,
    ret90d: -79,
    drawdown: -80,
    daysSinceHigh: 80,
    pctile1y: 50,
    price: 1.85,
    low90d: 1.08,
  },
  [
    {
      at: 'still crashing, mid-air over nothing proven',
      sig: { ret30d: -35, ret7d: -10 },
      features: {
        lastPrice: 3.2,
        ret7d: -10,
        ret30d: -35,
        daysSinceAth: 70,
        floorTests: 0,
        floorPrice: null,
      },
      cls: 'HYPE_DECAY',
      scalarCls: 'HYPE_DECAY',
    },
    {
      at: 'month steadied, parked on the 8× shelf — basing',
      sig: { ret30d: -5, ret7d: -2 },
      features: {
        lastPrice: 1.85,
        ret7d: -2,
        ret30d: -5,
        daysSinceAth: 80,
        floorTests: 8,
        atShelf: true,
        floorPrice: 1.62,
        medianBouncePct: 19,
      },
      ctx: { price: 1.85, floor: 1.62 },
      cls: 'BASE_FORMING',
    },
    {
      at: 'badge path agrees — deep shelf proves parked',
      scalarCls: 'BASE_FORMING',
      sig: { shelfPrice: 1.62, shelfTests: 8 },
      features: {
        lastPrice: 1.85,
        ret7d: -2,
        ret30d: -5,
        daysSinceAth: 80,
        floorTests: 8,
        atShelf: true,
        floorPrice: 1.62,
        medianBouncePct: 19,
      },
      cls: 'BASE_FORMING',
    },
  ]
);

/* ------------------------------------------------------------------ */
/* Ogerpon vs ampharos — the bump/recovery discriminator. Same +27%    */
/* month: rolling over = dead bounce, alive week + higher lows = real. */
/* ------------------------------------------------------------------ */
journey(
  'bump vs recovery: a +27% month splits on what it does NEXT',
  {
    spanDays: 500,
    stance: 'neutral',
    trend: 'flat',
    cagr: -29,
    ret30d: 27.7,
    ret7d: -5.4,
    drawdown: -81,
    daysSinceHigh: 500,
    pctile1y: 54,
    price: 1.05,
  },
  [
    {
      at: 'bounce already rolled over — a dead cat, not a turn',
      features: {
        lastPrice: 1.05,
        ret7d: -5.4,
        ret30d: 27.7,
        daysSinceAth: 500,
        floorTests: 3,
        failedBounce: true,
        atFloor: true,
        floorPrice: 1.0,
        higherLows: false,
      },
      cls: 'DEAD_STABLE',
      note: /dead money|filler|shelf rent/,
      notNote: /waking up/i,
    },
    {
      at: 'same pop but week alive + dips stepping up — real turn',
      sig: { trend: 'depreciating', ret7d: 2.4, ret30d: 14, ret90d: -20.4, cagr: -54, daysSinceHigh: 130, drawdown: -40, pctile1y: 55 },
      features: {
        lastPrice: 12.4,
        daysCovered: 140,
        ret7d: 2.4,
        ret30d: 14,
        daysSinceAth: 130,
        higherLows: true,
      },
      cls: 'REVIVAL',
      scalarCls: 'REVIVAL',
      note: /waking up|hold/,
    },
  ]
);

/* ------------------------------------------------------------------ */
/* Emcees — spent is spent: one green month on a −57%/yr card is a    */
/* bounce, not a restart. An appreciating stamp is what vetoes it.     */
/* ------------------------------------------------------------------ */
journey(
  'emcees: one green month does not restart a spent card',
  {
    spanDays: 700,
    stance: 'depressed',
    trend: 'depreciating',
    cagr: -57,
    ret30d: 10.1,
    ret7d: 11.3,
    ret90d: -12.8,
    drawdown: -50,
    daysSinceHigh: 270,
    pctile1y: 22,
    price: 1.97,
    low90d: 1.9,
    high90d: 2.4,
  },
  [
    {
      at: 'borderline pop on depreciating stamp — bounce, not revival',
      cls: 'DEAD_STABLE',
      note: /dead money|filler/,
      notNote: /waking up/,
    },
    {
      at: 'the stamp turns appreciating — vetoes spent and dormant',
      sig: { trend: 'appreciating', ret90d: 20, ret180d: 30 },
      cls: 'STABLE_GROWER',
    },
  ]
);
