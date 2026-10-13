import { classifyDeal, ownerNote, positionAction } from '../src/scanner/services/deal/dealClassify';
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
    /** Stamped sell target — a cycler's ceiling without the series. */
    ceiling?: number;
  };
  cls: DealClassId;
  /** Expected class on the scalar badge path — surfaces must agree. */
  scalarCls?: DealClassId;
  /** Classes that split by state — BASE_FORMING's testing/resting,
   *  RANGE_PLAY's entry/mid/exit. */
  variant?: 'testing' | 'resting' | 'entry' | 'mid' | 'exit';
  note?: RegExp;
  notNote?: RegExp;
  /** The owned-side verb — pins the glanceable action, not just the
   *  class. A right class under a wrong verb still fails here. */
  action?: RegExp;
  notAction?: RegExp;
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
        ceiling: s.ctx?.ceiling,
      });
      // Mirror the sheet's ctx: green needs a real-dollar win, the
      // bounce-cheap flag follows the same <$3 spare-change rule.
      const ctxPrice = s.ctx?.price ?? signal.price ?? null;
      const ctxFloor = s.ctx?.floor ?? fs?.floorPrice ?? null;
      const action = positionAction(read, {
        cracked: s.ctx?.cracked,
        bounceCheap:
          s.ctx?.cracked === true &&
          ctxFloor != null &&
          ctxPrice != null &&
          ctxFloor - ctxPrice < 3,
        ceiling: s.ctx?.ceiling ?? null,
        green: s.ctx?.vsCost != null && s.ctx.vsCost >= 1,
        price: ctxPrice,
      });
      test(`${s.at} → ${s.cls}`, () => {
        expect(read.cls).toBe(s.cls);
        if (s.variant) expect(read.variant).toBe(s.variant);
        if (s.scalarCls) expect(badgeRead.cls).toBe(s.scalarCls);
        if (s.note) expect(note).toMatch(s.note);
        if (s.notNote) expect(note).not.toMatch(s.notNote);
        if (s.action) expect(action).toMatch(s.action);
        if (s.notAction) expect(action).not.toMatch(s.notAction);
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
      action: /fodder|consolidate/i, // $1.54 — no floor to lose, no
      // green to bank; filler phrasing, not urgency
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
      // A cracked $1 floor is still cents — the exit is spare-change,
      // not "sell the bounce back" like there's money to wait for.
      action: /floor broke — just sell/i,
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
      action: /let it run/i, // owned dip inside an intact uptrend
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
      action: /floor broke — just sell/i, // bounce back worth 35¢
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
      action: /rotate it out/i, // real dollars above fodder — an exit
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
      action: /bank it while it's green/i, // up $2.10 — bank the win
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
/* The five "waking up" cards — revival is only honest when the card   */
/* was actually quiet. A high-range compounder's green month is a dip  */
/* getting bought, not a sleeper waking.                               */
/* ------------------------------------------------------------------ */
journey(
  'greninja: bottomed for 2y, +30% bounce — a real revival',
  {
    spanDays: 976,
    stance: 'neutral',
    trend: 'flat',
    cagr: -14,
    ret7d: 21.5,
    ret30d: 18.4,
    ret90d: -9.6,
    drawdown: -60,
    daysSinceHigh: 673,
    pctile1y: 64,
  },
  [
    {
      at: 'mid-range price, dead lifetime, fresh +30% leg',
      cls: 'REVIVAL', // quiet card with live momentum — correct
      note: /waking up/i,
    },
  ]
);

journey(
  'toxtricity: 14th pctile bounce off the year low — still revival',
  {
    spanDays: 976,
    stance: 'neutral',
    trend: 'depreciating',
    cagr: 139,
    ret7d: 14.2,
    ret30d: 20.9,
    ret90d: -2.6,
    drawdown: -52,
    daysSinceHigh: 378,
    pctile1y: 14,
  },
  [
    {
      at: 'cheap vs its year and bouncing — waking up is honest',
      cls: 'REVIVAL',
    },
  ]
);

journey(
  'flygon/umbreon/ralts: high-range compounders are not waking up',
  {
    spanDays: 976,
    stance: 'neutral',
    trend: 'flat',
    price: 2.33,
  },
  [
    {
      at: 'flygon — 80th pctile, +16%/yr, steady climb + a dip bought',
      sig: {
        cagr: 16.5,
        ret7d: -1.3,
        ret30d: 17.1,
        ret90d: -8.6,
        drawdown: -14,
        daysSinceHigh: 111,
        pctile1y: 80,
      },
      cls: 'STABLE_GROWER', // dips get bought — not "quiet for a while"
      notNote: /waking up/i,
    },
    {
      at: 'umbreon — 66th pctile, +111%/yr, cooled off a big run',
      sig: {
        cagr: 111,
        ret7d: 3.5,
        ret30d: 11.4,
        ret90d: -1.2,
        drawdown: -33,
        daysSinceHigh: 131,
        pctile1y: 66,
      },
      cls: 'STABLE_GROWER',
      notNote: /waking up/i,
    },
    {
      at: 'ralts — 80th pctile, +44%/yr, IR faded then bouncing',
      sig: {
        cagr: 43.8,
        ret7d: -0.8,
        ret30d: 12.1,
        ret90d: -7.3,
        drawdown: -48,
        daysSinceHigh: 518,
        pctile1y: 80,
      },
      cls: 'STABLE_GROWER',
      notNote: /waking up/i,
    },
    {
      at: 'and if the same card later breaks instead — the dip dies',
      sig: {
        cagr: 43.8,
        ret7d: -8,
        ret30d: -14,
        ret90d: -25,
        drawdown: -52,
        pctile1y: 55,
      },
      cls: 'FREE_FALL', // the dip stopped getting bought — knife, not quiet
      notNote: /waking up|dips/i,
    },
  ]
);

/* ------------------------------------------------------------------ */
/* Range cycler — the same card at four points in ONE recurring        */
/* cycle. Feature values mirror the real boom-bust series (floor $0.82,*/
/* ~91d trough spacing, ~36% bounces). Each phase must read position,  */
/* not leg speed — and the break kills the class outright.             */
/* ------------------------------------------------------------------ */
journey(
  'range cycler: floor → ceiling → fade → break, same shape throughout',
  {
    spanDays: 600,
    stance: 'neutral',
    trend: 'flat',
    cagr: 2,
    ret30d: -4,
    ret7d: -1,
    ret90d: -10,
    drawdown: -25,
    daysSinceHigh: 150,
    pctile1y: 45,
    price: 0.83,
    // Stamped deep stats — card_deep ships the same cycle evidence,
    // so the badge path (scalar) must land on the same class.
    shelfPrice: 0.82,
    shelfTests: 3,
    cycleDays: 91,
    medianBouncePct: 36,
    targetPrice: 1.05,
  },
  [
    {
      at: 'parked on the floor — the buy end of a proven 90d cycle',
      features: {
        lastPrice: 0.83,
        athPrice: 1.12,
        floorTests: 3,
        cycleDays: 90,
        medianBouncePct: 36,
        floorPrice: 0.82,
        atFloor: true,
        // A completed cycle LOOKS like a dead cat — trough, +15% bounce,
        // back at the trough. On a proven rhythm that's the down-leg
        // finishing, not a failure.
        failedBounce: true,
        sellIntoPrice: 1.0,
        targetPrice: 1.05,
        ret30d: -4,
      },
      ctx: { price: 0.83, floor: 0.82, ceiling: 1.05 },
      cls: 'RANGE_PLAY',
      scalarCls: 'RANGE_PLAY', // stamped cycle evidence — badge agrees
      variant: 'entry',
      note: /buy end of a proven range/,
      action: /hold — at the buy end/i,
    },
    {
      at: 'bouncing +15% mid-range — already in the sell window',
      sig: { price: 0.95, ret30d: 15, ret7d: 6, drawdown: -20, targetPrice: 1.0 },
      features: {
        lastPrice: 0.95,
        athPrice: 1.12,
        floorTests: 4,
        cycleDays: 91,
        medianBouncePct: 36,
        floorPrice: 0.82,
        sellIntoPrice: 1.0,
        targetPrice: 1.05,
        ret30d: 15,
        ret7d: 6,
      },
      ctx: { price: 0.95, floor: 0.82, ceiling: 1.0 },
      cls: 'RANGE_PLAY',
      scalarCls: 'RANGE_PLAY',
      variant: 'exit', // ≥92% of the ceiling IS the sell window
      note: /sell into/,
      action: /sell into ~\$1\.00/i, // the verb carries the ceiling
    },
    {
      at: 'fading off the top — the normal down-leg, not a knife',
      sig: { price: 1.0, ret30d: -14, ret7d: -8, drawdown: -30, targetPrice: 1.1 },
      features: {
        lastPrice: 1.0,
        athPrice: 1.12,
        floorTests: 4,
        cycleDays: 91,
        medianBouncePct: 36,
        floorPrice: 0.82,
        sellIntoPrice: 1.1,
        targetPrice: 1.1,
        ret30d: -14,
        ret7d: -8,
      },
      ctx: { price: 1.0, floor: 0.82, ceiling: 1.1 },
      cls: 'RANGE_PLAY',
      scalarCls: 'RANGE_PLAY',
      variant: 'mid',
      note: /mid-range|fade back/,
      action: /hold for the ceiling/i,
    },
    {
      at: 'through the floor a year past the high — pattern is dead',
      sig: { price: 0.72, ret30d: -24, ret7d: -10, drawdown: -40, daysSinceHigh: 400, targetPrice: 1.1 },
      features: {
        lastPrice: 0.72,
        athPrice: 1.12,
        daysSinceAth: 400,
        floorTests: 4,
        cycleDays: 91,
        medianBouncePct: 36,
        floorPrice: 0.82,
        failedBounce: true,
        ret30d: -24,
        ret7d: -10,
      },
      ctx: { price: 0.72, floor: 0.82, cracked: true },
      cls: 'FREE_FALL', // under the zone = through it — range is over
      scalarCls: 'FREE_FALL', // and the stamp path drops it the same way
      notNote: /buy end|proven range/i,
      action: /floor broke — just sell/i, // 10¢ bounce is spare change
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
      action: /dead money/i, // filler at $1.97 — no urgency verb
    },
    {
      at: 'the stamp turns appreciating — vetoes spent and dormant',
      sig: { trend: 'appreciating', ret90d: 20, ret180d: 30 },
      cls: 'STABLE_GROWER',
    },
  ]
);

/* ------------------------------------------------------------------ */
/* Leafeon ex — the stamp's peak is the LIFETIME high (launch spike    */
/* 635d ago) while the series window only sees the recent ~$7 swing    */
/* top ~3mo back. The sheet once called it POST_SPIKE_BLEED where the  */
/* badge called FREE_FALL — an offer-band disagreement (0.85 vs 0.75). */
/* The older peak age must win so both surfaces land on the knife.     */
/* ------------------------------------------------------------------ */
journey(
  'leafeon: ancient lifetime ATH beats the window peak — one knife, two paths',
  {
    spanDays: 635,
    stance: 'falling',
    trend: 'depreciating',
    cagr: -58.3,
    ret7d: -22.4,
    ret30d: -14.8,
    ret90d: -18.9,
    drawdown: -78.1,
    daysSinceHigh: 635, // stamp: lifetime ATH $19.99 at launch
    pctile1y: 75,
    price: 4.37,
    low90d: 4.0,
    high90d: 7.17,
  },
  [
    {
      at: 'bleeding under a dead shelf — the older peak age wins on both paths',
      features: {
        daysSinceAth: 80, // series window's recent ~$7 swing top
        athPrice: 7.17,
        lastPrice: 4.37,
        failedBounce: true,
        atFloor: true,
        atShelf: true,
        floorPrice: 4.43,
        floorTests: 23,
        medianBouncePct: 20.3,
      },
      ctx: { price: 4.37, floor: 4.43, vsCost: 2.54 },
      cls: 'FREE_FALL',
      scalarCls: 'FREE_FALL', // badge path was already the honest one
      note: /failed floor|sell it/,
      action: /bank it while/i, // green +$2.54 — bank, don't ride it through
    },
  ]
);
