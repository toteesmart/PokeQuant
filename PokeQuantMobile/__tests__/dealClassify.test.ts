import { classifyDeal, dealAction, ownerNote, offerBand, positionAction, rotationBucket } from '../src/scanner/services/deal/dealClassify';
import { buildSeriesFeatures, type SeriesFeatures } from '../src/scanner/services/deal/seriesSignals';
import { diffDealClasses, classKey } from '../src/scanner/services/deal/dealShiftTracker';
import { evaluateTrade, type TradeEntry } from '../src/scanner/services/deal/tradeEval';
import type { CardSignal } from '../src/db/catalogDb';

// Fixture signals — every field nullable; these pin the real misreads
// that shipped: stamp-vs-recent disagreement, spent-but-flat, thin data.

const sig = (over: Partial<CardSignal> = {}): CardSignal => ({
  productId: 1,
  subType: 'Normal',
  price: 10,
  priceDate: '2026-01-15',
  firstDate: '2024-03-01',
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

describe('classifyDeal — real misreads', () => {
  test('Petilil: stale BUY_HOLD stamp on a post-spike slide → Off the peak', () => {
    const r = classifyDeal(
      sig({
        stance: 'depressed',
        action: 'BUY_HOLD',
        ret7d: -7,
        ret30d: -9.7,
        ret90d: -39,
        cagr: 177,
        retAll: 177,
        drawdown: -41,
        daysSinceHigh: 150,
        pctile1y: 30,
      })
    );
    expect(r.cls).toBe('POST_SPIKE_BLEED');
    expect(r.risk).toBe('risky');
  });

  test('Emcees: depreciating stamp but floor held ~9mo → Dead / stable', () => {
    const r = classifyDeal(
      sig({
        stance: 'neutral',
        trend: 'depreciating',
        cagr: -57,
        ret7d: 11.3,
        ret30d: 10.1,
        ret90d: -12.8,
        drawdown: -50,
        daysSinceHigh: 270,
        pctile1y: 22,
        price: 1.97,
        low90d: 1.9,
        high90d: 2.4,
      })
    );
    expect(r.cls).toBe('DEAD_STABLE');
  });

  test('non-spent floor card → At a floor', () => {
    const r = classifyDeal(
      sig({
        stance: 'neutral',
        trend: 'flat',
        cagr: -5,
        ret7d: 1,
        ret30d: 2,
        ret90d: -8,
        drawdown: -30,
        daysSinceHigh: 120,
        price: 9.8,
        low90d: 9.5,
        high90d: 12,
      })
    );
    expect(r.cls).toBe('BASE_FORMING');
  });

  test('Moltres: +72% all-time but UNRATED → Low data, not risky verdict', () => {
    const r = classifyDeal(
      sig({ action: 'UNRATED', retAll: 72, ret365d: 40, cagr: 60 })
    );
    expect(r.cls).toBe('LOW_DATA');
    expect(classifyDeal(null).cls).toBe('LOW_DATA');
    expect(classifyDeal(sig({ action: null })).cls).toBe('LOW_DATA');
  });
});

describe('classifyDeal — lifecycle vocabulary', () => {
  test('dip inside an intact uptrend → Dip buy', () => {
    const r = classifyDeal(
      sig({
        stance: 'falling',
        trend: 'appreciating',
        cagr: 40,
        ret7d: -6,
        ret30d: -6,
        ret90d: 8,
      })
    );
    expect(r.cls).toBe('DIP_BUY');
  });

  test('fresh knife (recent high) → Free fall', () => {
    const r = classifyDeal(
      sig({
        stance: 'neutral',
        ret30d: -24,
        drawdown: -35,
        daysSinceHigh: 5,
      })
    );
    expect(r.cls).toBe('FREE_FALL');
  });

  test('depreciating stamp + still bleeding → Long-term decline', () => {
    const r = classifyDeal(
      sig({
        stance: 'neutral',
        trend: 'depreciating',
        cagr: -40,
        ret30d: -6,
        ret90d: -20,
        drawdown: -40,
        daysSinceHigh: 400,
      })
    );
    expect(r.cls).toBe('DECLINER');
  });

  test('quiet history + fresh pop → Waking up (new-catalog fields)', () => {
    const r = classifyDeal(
      sig({
        stance: 'neutral',
        trend: 'flat',
        cagr: -10,
        ret7d: 6,
        ret30d: 13,
        drawdown: -35,
        daysSinceHigh: 200,
        ma20_60: 2,
        pctile1y: 30,
      })
    );
    expect(r.cls).toBe('REVIVAL');
  });

  test('revival falls back to a stronger 30d pop on old catalogs', () => {
    const r = classifyDeal(
      sig({
        stance: 'neutral',
        trend: 'flat',
        cagr: -10,
        ret7d: 6,
        ret30d: 14,
        drawdown: -35,
        daysSinceHigh: 200,
        pctile1y: 30,
        low90d: 9, // priced above the 90d floor — no floor-read steal
      })
    );
    expect(r.cls).toBe('REVIVAL');
  });

  test('Ogerpon: +27% month already rolling over is a dead bounce, not a revival', () => {
    const r = classifyDeal(
      sig({
        stance: 'neutral',
        trend: 'flat',
        cagr: -29,
        ret7d: -5.4,
        ret30d: 27.7,
        ret90d: -3.9,
        retAll: -56.6,
        drawdown: -81,
        daysSinceHigh: 500,
        pctile1y: 54,
        price: 2.95,
        low90d: 2.4,
        high90d: 4.8,
      })
    );
    expect(r.cls).not.toBe('REVIVAL');
    expect(r.cls).toBe('DEAD_STABLE');
  });

  test('weak pop without confirmation does not false-fire revival', () => {
    const r = classifyDeal(
      sig({
        stance: 'neutral',
        trend: 'flat',
        cagr: -10,
        ret7d: 6,
        ret30d: 10,
        drawdown: -35,
        daysSinceHigh: 200,
        price: 9.9,
        low90d: 8.5,
        high90d: 14,
      })
    );
    expect(r.cls).not.toBe('REVIVAL');
  });

  test('young series sliding off launch → New-set slide', () => {
    const r = classifyDeal(
      sig({
        firstDate: '2025-10-01',
        spanDays: 100,
        drawdown: -20,
        ret30d: -8,
        pctile1y: 30,
      })
    );
    expect(r.cls).toBe('HYPE_DECAY');
  });

  test('21-month-old card is not a new-set slide — eevee ex regression', () => {
    // firstDate past the data floor but the series has aged out of any
    // launch window: span 632d, drawdown −68%, red month — reads as a
    // bleeder/floor story, not "new card coming off release hype".
    const r = classifyDeal(
      sig({
        firstDate: '2025-01-19',
        spanDays: 632,
        stance: 'falling',
        trend: 'depreciating',
        cagr: -40,
        drawdown: -68,
        ret30d: -24,
        ret7d: -10,
        ret90d: -21,
        pctile1y: 50,
      })
    );
    expect(r.cls).not.toBe('HYPE_DECAY');
  });

  test('200d-old set still reads as launch slide', () => {
    const r = classifyDeal(
      sig({
        firstDate: '2026-04-01',
        spanDays: 194,
        drawdown: -35,
        ret30d: -8,
        pctile1y: 30,
      })
    );
    expect(r.cls).toBe('HYPE_DECAY');
  });

  test('tremendous bomb: young card parked on a held floor is basing, not sliding', () => {
    // −80% in its first weeks, then 2+ months flat on a floor hit 8×.
    // The launch crash ended — "still coming down" is the stale story.
    // r90 (−79) IS the launch; a <120d card can't use that window.
    const features = {
      lastPrice: 1.85,
      daysCovered: 88,
      ret7d: -2,
      ret30d: -5,
      slope30d: -0.1,
      athPrice: 9.4,
      daysSinceAth: 80,
      floorTests: 8,
      failedBounce: true,
      atFloor: true,
      atShelf: true,
      floorPrice: 1.62,
      targetPrice: null,
      sellIntoPrice: null,
      medianBouncePct: 19,
      medianBounceDays: 12,
      cycleDays: 21,
      higherLows: false,
    } satisfies SeriesFeatures;
    const r = classifyDeal(
      sig({
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
      }),
      features
    );
    expect(r.cls).toBe('BASE_FORMING');
  });

  test('stamped cycle stats produce range play without a series', () => {
    // The card_deep join carries shelf/cycle/bounce/ceiling — the
    // scalar badge path must land on the same class the sheet would.
    const r = classifyDeal(
      sig({
        price: 8.3,
        drawdown: -25,
        pctile1y: 45,
        trend: 'flat',
        shelfPrice: 8.2,
        shelfTests: 4,
        cycleDays: 91,
        medianBouncePct: 36,
        targetPrice: 10.5,
      })
    );
    expect(r.cls).toBe('RANGE_PLAY');
    expect(r.variant).toBe('entry');
    expect(r.label).toBe('Range play');
  });

  test('stamps: a crater-bottom shelf is not a range — ceiling must reach the high', () => {
    // Tremendous-bomb shape on stamps alone: a held floor under an
    // −80% crash isn't a cycle, it's a crater. The stamped ceiling
    // ($1.90) never reaches the ATH zone (~$9.25) → stays basing.
    const r = classifyDeal(
      sig({
        firstDate: '2026-07-16',
        spanDays: 88,
        trend: 'depreciating',
        cagr: -79,
        ret7d: -2,
        ret30d: -5,
        ret90d: -79,
        drawdown: -80,
        pctile1y: 50,
        price: 1.85,
        shelfPrice: 1.62,
        shelfTests: 8,
        cycleDays: 21,
        medianBouncePct: 19,
        targetPrice: 1.9,
      })
    );
    expect(r.cls).toBe('BASE_FORMING');
  });

  test('toucannon: young card still crashing AT its floor is sliding, not declining', () => {
    // 93d old, −85% off launch, −40% on the month — sitting on the
    // crash low where a bounce already died. atFloor+failedBounce
    // parked the card, which suppressed the slide AND the knife read —
    // the sheet fell through to DECLINER (a stale lifecycle for a
    // 3-month-old card) while the badge said New-set slide. Parked
    // only earns the suppression once the month steadied.
    const features = {
      lastPrice: 1.54,
      daysCovered: 93,
      ret7d: -2.5,
      ret30d: -40,
      slope30d: -1,
      athPrice: 11,
      daysSinceAth: 92,
      floorTests: 6,
      failedBounce: true,
      atFloor: true,
      atShelf: false,
      floorPrice: 1.45,
      targetPrice: 3.5,
      sellIntoPrice: 1.9,
      medianBouncePct: 22,
      medianBounceDays: 4,
      cycleDays: null,
      higherLows: false,
    } satisfies SeriesFeatures;
    const s = sig({
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
    });
    // Sheet and badge must agree — the slide is still running.
    expect(classifyDeal(s, features).cls).toBe('HYPE_DECAY');
    expect(classifyDeal(s).cls).toBe('HYPE_DECAY');
    // At $1.54 the dollars are inconsequential — the note should read
    // binder real estate (consolidate or filler), not urgency.
    const note = ownerNote(classifyDeal(s, features), features, {
      price: 1.54,
      floor: 1.45,
    });
    expect(note).toMatch(/fodder|binder filler/);
    expect(note).not.toMatch(/move it while the set is hot/);
  });

  test('stamp path: deep shelf proves parked — badge reads At a floor too', () => {
    // The inventory badge never loads a series — the shipped card_deep
    // shelf carries the same proximity proof. Young card parked on a
    // tested shelf → basing, not "still coming down".
    const r = classifyDeal(
      sig({
        firstDate: '2026-07-16',
        spanDays: 88,
        stance: 'neutral',
        trend: 'depreciating',
        cagr: -79,
        ret30d: -5,
        ret7d: -2,
        ret90d: -79,
        drawdown: -80,
        daysSinceHigh: 80,
        pctile1y: 50,
        price: 1.85,
        low90d: 1.08,
        shelfPrice: 1.62,
        shelfTests: 8,
      })
    );
    expect(r.cls).toBe('BASE_FORMING');
  });

  test('stamp path: an untested shelf does not park the card', () => {
    // shelf_tests < 2 — the level was touched once, never defended.
    // Can't prove basing from it; the slide read stands.
    const r = classifyDeal(
      sig({
        firstDate: '2026-07-16',
        spanDays: 88,
        cagr: -79,
        ret30d: -5,
        ret90d: -79,
        drawdown: -80,
        daysSinceHigh: 80,
        pctile1y: 50,
        price: 1.85,
        shelfPrice: 1.62,
        shelfTests: 1,
      })
    );
    expect(r.cls).not.toBe('BASE_FORMING');
  });

  test('young card mid-air over a distant floor still reads New-set slide', () => {
    // floorTests counts tests of the shelf under the price — a shelf
    // far below a falling card is not one it's parked on (petilil rule).
    const features = {
      lastPrice: 3.0,
      daysCovered: 70,
      ret7d: -5,
      ret30d: -12,
      slope30d: -0.3,
      athPrice: 9.0,
      daysSinceAth: 60,
      floorTests: 4,
      failedBounce: false,
      atFloor: false,
      atShelf: false,
      floorPrice: 0.8,
      targetPrice: 4.2,
      sellIntoPrice: 1.1,
      medianBouncePct: 30,
      medianBounceDays: 20,
      cycleDays: null,
      higherLows: false,
    } satisfies SeriesFeatures;
    const r = classifyDeal(
      sig({
        firstDate: '2026-08-01',
        spanDays: 70,
        drawdown: -60,
        ret30d: -12,
        ret7d: -5,
        ret90d: -55,
        pctile1y: 40,
        price: 3.0,
      }),
      features
    );
    expect(r.cls).toBe('HYPE_DECAY');
  });

  test('elevated + still climbing → At peak · intact', () => {
    const r = classifyDeal(
      sig({ stance: 'elevated_rising', ret7d: 5, ret30d: 8 })
    );
    expect(r.cls).toBe('AT_PEAK');
    expect(r.peakState).toBe('intact');
  });

  test('elevated + rolling over → topping', () => {
    const r = classifyDeal(
      sig({ stance: 'elevated', ret7d: -5, ret30d: -2 })
    );
    expect(r.peakState).toBe('topping');
    expect(r.risk).toBe('risky');
  });
});

describe('diffDealClasses — alert kinds', () => {
  test('floor → falling is a floor_crack', () => {
    const prev = { [classKey(1, 'Normal')]: { cls: 'BASE_FORMING' as const, label: 'At a floor' } };
    const { shifts } = diffDealClasses(prev, [
      {
        card: 'c',
        productId: 1,
        subType: 'Normal',
        signal: sig({ ret30d: -24, drawdown: -40, daysSinceHigh: 10 }),
      },
    ]);
    expect(shifts).toHaveLength(1);
    expect(shifts[0].kind).toBe('floor_crack');
    expect(shifts[0].to.cls).toBe('FREE_FALL');
  });

  test('same class but price under the floor is still a floor_crack', () => {
    // The class-diff-only path missed this: a bleeder that stayed a
    // bleeder while going through its floor — the exit trigger fired.
    const prev = { [classKey(2, 'Normal')]: { cls: 'POST_SPIKE_BLEED' as const, label: 'Off the peak', cracked: false } };
    const { shifts, next } = diffDealClasses(prev, [
      {
        card: 'c',
        productId: 2,
        subType: 'Normal',
        signal: sig({
          stance: 'falling',
          trend: 'depreciating',
          ret30d: -16,
          drawdown: -45,
          daysSinceHigh: 200,
          pctile1y: 30,
          price: 4.8,
          low90d: 5.0, // 4.8 < 5.0*0.97 → cracked
        }),
      },
    ]);
    expect(shifts).toHaveLength(1);
    expect(shifts[0].kind).toBe('floor_crack');
    expect(next[classKey(2, 'Normal')].cracked).toBe(true);
    // And it must not re-fire while it stays cracked.
    const again = diffDealClasses(next, [
      {
        card: 'c',
        productId: 2,
        subType: 'Normal',
        signal: sig({
          stance: 'falling', trend: 'depreciating', ret30d: -16,
          drawdown: -45, daysSinceHigh: 200, pctile1y: 30,
          price: 4.6, low90d: 5.0,
        }),
      },
    ]);
    expect(again.shifts).toHaveLength(0);
  });

  test('anything → revival is a revival alert', () => {
    const prev = { [classKey(1, 'Normal')]: { cls: 'DEAD_STABLE' as const, label: 'Dead / stable' } };
    const { shifts } = diffDealClasses(prev, [
      {
        card: 'c',
        productId: 1,
        subType: 'Normal',
        signal: sig({ trend: 'flat', cagr: -10, ret30d: 14, ret7d: 6, drawdown: -35, daysSinceHigh: 200 }),
      },
    ]);
    expect(shifts[0].kind).toBe('revival');
  });

  test('LOW_DATA edges stay quiet', () => {
    const prev = { [classKey(1)]: { cls: 'STABLE_FLAT' as const, label: 'Stable / flat' } };
    const { shifts } = diffDealClasses(prev, [
      { card: 'c', productId: 1, signal: sig({ action: 'UNRATED' }) },
    ]);
    expect(shifts).toHaveLength(0);
  });
});

describe('evaluateTrade — lifecycle-aware reads', () => {
  let n = 0;
  const entry = (over: Partial<TradeEntry>): TradeEntry => ({
    key: `k${++n}`,
    productId: n,
    subType: 'Normal',
    name: 'Card',
    qty: 1,
    price: 10,
    signal: undefined,
    ...over,
  });

  test('offloading a faller dodges the slide — counts toward the win', () => {
    const v = evaluateTrade(
      [
        entry({
          name: 'Faller',
          signal: sig({ stance: 'falling', trend: 'flat', ret30d: -24, ret7d: -8, drawdown: -30, daysSinceHigh: 5 }),
        }),
      ],
      [entry({ name: 'Stable', signal: sig() })]
    );
    expect(v).not.toBeNull();
    expect(v!.decayAvoided).toBeGreaterThan(0);
    expect(v!.notes.join(' ')).toMatch(/dodges ~\$\d+ of the slide/);
    expect(v!.verdict).toBe('win');
  });

  test('incoming faller prices the slide against you', () => {
    const v = evaluateTrade(
      [entry({ name: 'Stable', signal: sig() })],
      [
        entry({
          name: 'Knife',
          signal: sig({ stance: 'falling', trend: 'flat', ret30d: -30, ret7d: -9, drawdown: -40, daysSinceHigh: 4 }),
        }),
      ]
    );
    expect(v!.verdict).toBe('lose');
    expect(v!.notes.join(' ')).toMatch(/expect ~\$\d+ less in 30d/);
  });

  test('incoming revival is good timing; outgoing revival is a gift', () => {
    const revival = sig({ trend: 'flat', cagr: -10, ret30d: 14, ret7d: 6, drawdown: -35, daysSinceHigh: 200 });
    const takeIn = evaluateTrade(
      [entry({ name: 'Stable', signal: sig() })],
      [entry({ name: 'Riser', signal: revival })]
    );
    expect(takeIn!.notes.join(' ')).toMatch(/good timing to take it/);

    const giveOut = evaluateTrade(
      [entry({ name: 'Riser', signal: revival })],
      [entry({ name: 'Stable', signal: sig() })]
    );
    expect(giveOut!.notes.join(' ')).toMatch(/hand them the run/);
  });

  test('thin/stale reads get an honesty note', () => {
    const v = evaluateTrade(
      [entry({ name: 'Mine', signal: sig() })],
      [entry({ name: 'Stale', signal: sig({ liqFlag: 'stale', daysSinceChange: 90 }) })]
    );
    expect(v!.notes.join(' ')).toMatch(/thin or stale read/);
  });

  test('floor cards coming in read as mostly-spent downside', () => {
    const v = evaluateTrade(
      [entry({ name: 'Mine', signal: sig() })],
      [
        entry({
          name: 'Floor',
          signal: sig({ cagr: -5, trend: 'flat', ret30d: 2, ret90d: -8, drawdown: -30, daysSinceHigh: 120, price: 9.8, low90d: 9.5, high90d: 12 }),
          price: 9.8,
        }),
      ]
    );
    expect(v!.notes.join(' ')).toMatch(/at a floor/);
  });
});

describe('classifyDeal — knife gate needs structure', () => {
  test('Flying Pikachu: high-pctile appreciating card, one soft month → not FREE_FALL', () => {
    // The real misread: 91st pctile, 12% off its high, +690% all-time,
    // +29% on the quarter — one −11.8% month is a pullback inside an
    // intact uptrend, not a crash. Knife speed alone isn't a fall.
    const r = classifyDeal(
      sig({
        stance: 'neutral',
        trend: 'appreciating',
        pctile1y: 91,
        drawdown: -12,
        ret7d: -4,
        ret30d: -11.8,
        ret90d: 29,
        cagr: 40,
      })
    );
    expect(r.cls).toBe('STABLE_GROWER');
  });

  test('Bubble mew: +598% grower mid-dip is a grower cooling, not a decline', () => {
    // The real misread: "Near its floor and still bleeding" on a card
    // at the 60th pctile, +598% all-time, whose post-spike dips have
    // set new highs twice. Depressed stamp lied about position, and
    // a flat month (−0.8%) isn't bleeding.
    const r = classifyDeal(
      sig({
        stance: 'depressed',
        trend: 'depreciating',
        cagr: 95,
        ret7d: -0.1,
        ret30d: -0.8,
        ret90d: -19.3,
        retAll: 598,
        drawdown: -17,
        daysSinceHigh: 60,
        pctile1y: 60,
        price: 872,
      })
    );
    expect(r.cls).toBe('STABLE_GROWER');
    expect(r.headline).toMatch(/cooling off its run/);
  });

  test('Snover: missing peak-age stamp still reads a bleed off a big drawdown', () => {
    // The list/sheet split: old catalogs ship no days_since_high, so
    // the scalar read couldn't see "peaked ~2mo ago" and fell to
    // Dead/stable. A −51% drawdown still sliding is the bleed either
    // way — the deep read just proves it on the sheet.
    const r = classifyDeal(
      sig({
        daysSinceHigh: null,
        drawdown: -51,
        ret7d: 0,
        ret30d: -4.8,
        ret90d: -11.9,
        pctile1y: 49,
        cagr: -20,
      })
    );
    expect(r.cls).toBe('POST_SPIKE_BLEED');
    expect(r.headline).not.toMatch(/mo ago/);
  });

  test('depressed stamp still works when the card IS near its floor', () => {
    const r = classifyDeal(
      sig({
        stance: 'depressed',
        trend: 'depreciating',
        cagr: -30,
        ret30d: -6,
        ret90d: -20,
        pctile1y: 20,
        drawdown: -40,
        daysSinceHigh: 400,
      })
    );
    expect(r.cls).toBe('DECLINER');
  });

  test('Zekrom: falling stamp + old peak bleed → Off the peak, not Free fall', () => {
    // The stamp's 'falling' short-circuited every lifecycle check —
    // a card down 34% from a 3-month-old peak, still sliding into a
    // triple-tested floor, reads as the bleed it is. The floor is the
    // watchpoint; "hasn't found a floor" was factually wrong.
    const r = classifyDeal(
      sig({
        stance: 'falling',
        trend: 'depreciating',
        cagr: -25,
        ret7d: -21.9,
        ret30d: -20.9,
        ret90d: -32.2,
        drawdown: -34,
        daysSinceHigh: 90,
        pctile1y: 28,
        price: 11,
        low90d: 11.2,
        high90d: 17.29,
      })
    );
    expect(r.cls).toBe('POST_SPIKE_BLEED');
  });

  test('owner note on a held floor says hold — not dump at the bottom', () => {
    // Zekrom's owner read: off its peak but parked on a floor that
    // held 3×. Selling into the floor test is the worst exit; the
    // floor breaking is the exit.
    const read = classifyDeal(
      sig({
        stance: 'falling',
        trend: 'depreciating',
        ret30d: -20.9,
        ret90d: -32.2,
        drawdown: -34,
        daysSinceHigh: 90,
        pctile1y: 28,
      })
    );
    expect(read.cls).toBe('POST_SPIKE_BLEED');
    const features = {
      lastPrice: 11.5,
      daysCovered: 300,
      ret7d: -20,
      ret30d: -20,
      slope30d: -0.5,
      athPrice: 17.29,
      daysSinceAth: 90,
      floorTests: 3,
      failedBounce: false,
      atFloor: true,
      atShelf: true,
      floorPrice: 11.2,
      targetPrice: 16.0,
      sellIntoPrice: 15.9,
      medianBouncePct: 42,
      medianBounceDays: 38,
      cycleDays: 140,
      higherLows: false,
    } satisfies SeriesFeatures;
    expect(ownerNote(read, features)).toMatch(/holding beats dumping/);
    expect(ownerNote(read)).toMatch(/sell into bumps/);
  });

  test('yamper: tested floor with feeble bounces does not earn "hold it"', () => {
    // 8 shelf tests but only +13% one-day bounces — touched, not
    // defended. The class already refuses the floor (atShelf needs a
    // ≥15% rally); the note has to stop recommending the hold.
    const features = {
      lastPrice: 3.1,
      daysCovered: 330,
      ret7d: -5.7,
      ret30d: -19.7,
      slope30d: -0.4,
      athPrice: 15.0,
      daysSinceAth: 400,
      floorTests: 8,
      failedBounce: true,
      atFloor: false,
      atShelf: false,
      floorPrice: 3.19,
      targetPrice: 3.7,
      sellIntoPrice: 3.6,
      medianBouncePct: 13,
      medianBounceDays: 1,
      cycleDays: 6,
      higherLows: false,
    } satisfies SeriesFeatures;
    const read = classifyDeal(
      sig({
        stance: 'falling',
        trend: 'depreciating',
        cagr: -79,
        ret7d: -5.7,
        ret30d: -19.7,
        ret90d: -8.5,
        drawdown: -77,
        daysSinceHigh: 333,
        pctile1y: 54,
        price: 3.1,
      }),
      features
    );
    expect(read.cls).toBe('FREE_FALL');
    // failedBounce trumps the feeble read — the defense already
    // produced a rally that died back on the shelf. And at $3.10 vs a
    // $3.19 floor, the bounce is spare change — "sell it", not "wait".
    expect(ownerNote(read, features)).toMatch(/spare change; sell it/);
    expect(ownerNote(read, features)).not.toMatch(/hold while it holds/);
    // A bounce worth real dollars still earns the wait-for-bump read —
    // $4 back to a cracked $200 shelf is worth the wait.
    const pricey = { ...features, floorPrice: 200, lastPrice: 196 };
    expect(
      ownerNote(read, pricey, { price: 196, floor: 200 })
    ).toMatch(/bounce back toward \$200/);
    // Feeble bounces without a failed rally still get the feeble read.
    const feeble = { ...features, failedBounce: false };
    expect(ownerNote(read, feeble)).toMatch(/barely bounces/);
    // A floor that actually bounces still earns the hold.
    const strong = { ...features, medianBouncePct: 26, failedBounce: false };
    expect(ownerNote(read, strong)).toMatch(/hold while it holds/);
  });

  test('mabosstiff: a cracked dip-buy stops saying "hold; this is the dip"', () => {
    // Dip-buy parked on an $8.15 shelf reads hold — but once price is
    // through the break level the thesis is dead and the note must
    // agree with the CRACKED row instead of contradicting it.
    const read = classifyDeal(
      sig({
        stance: 'falling',
        trend: 'appreciating',
        cagr: 80,
        ret90d: 5,
        ret30d: -13,
        ret7d: -8,
        drawdown: -15,
        pctile1y: 74,
        price: 7.8,
      })
    );
    expect(read.cls).toBe('DIP_BUY');
    const held = ownerNote(read, undefined, {
      price: 8.1,
      floor: 8.15,
      cracked: false,
    });
    expect(held).toMatch(/dip others buy/);
    // Below the break — cheap retest → flat "sell it", no bounce wait.
    const cracked = ownerNote(read, undefined, {
      price: 7.8,
      floor: 8.15,
      cracked: true,
    });
    expect(cracked).toMatch(/not a dip anymore/);
    expect(cracked).toMatch(/sell it/);
    // A real-dollar retest still names the level to sell into.
    const pricey = ownerNote(read, undefined, {
      price: 190,
      floor: 200,
      cracked: true,
    });
    expect(pricey).toMatch(/bounce back toward \$200/);
  });

  test('petilil: a held floor far below is not "parked on a floor"', () => {
    // Off its peak at $20 with the only proven shelf at $7.66 — the card
    // is mid-air, not parked. floorTests alone doesn't put it on the floor.
    const read = classifyDeal(
      sig({
        stance: 'falling',
        trend: 'depreciating',
        ret30d: -12,
        ret90d: -40,
        drawdown: -43,
        daysSinceHigh: 120,
        pctile1y: 58,
        price: 20,
      })
    );
    expect(read.cls).toBe('POST_SPIKE_BLEED');
    const features = {
      lastPrice: 20,
      daysCovered: 449,
      ret7d: -3.6,
      ret30d: -12,
      slope30d: -0.3,
      athPrice: 35,
      daysSinceAth: 120,
      floorTests: 2,
      failedBounce: false,
      atFloor: false,
      atShelf: false,
      floorPrice: 7.66,
      targetPrice: 34.9,
      sellIntoPrice: 9.58,
      medianBouncePct: 25,
      medianBounceDays: 40,
      cycleDays: 150,
      higherLows: false,
    } satisfies SeriesFeatures;
    const note = ownerNote(read, features, { price: 20, floor: 7.66 });
    expect(note).toMatch(/sell into bumps/);
    expect(note).not.toMatch(/parked on a floor/);
  });

  test('sellIntoPrice caps the ceiling at what bounces actually ran', () => {
    // Floor card: shelf $10 tested twice, bounces ran ~+25% — the eject
    // line is ~$12.50, not the far-off defended peak at $18.
    const pt = (date: string, marketPrice: number) => ({ date, marketPrice });
    const pts = [
      pt('2025-01-01', 10), pt('2025-01-20', 13), pt('2025-02-10', 10),
      pt('2025-03-01', 14), pt('2025-04-01', 18), pt('2025-04-20', 12),
      pt('2025-06-01', 10), pt('2025-06-20', 12.5), pt('2025-08-01', 10.2),
    ];
    const feats = buildSeriesFeatures(pts);
    expect(feats.floorPrice).toBeCloseTo(10, 0);
    expect(feats.targetPrice).not.toBeNull();
    expect(feats.sellIntoPrice).not.toBeNull();
    expect(feats.sellIntoPrice!).toBeLessThanOrEqual(
      feats.targetPrice ?? Infinity
    );
    // Capped near floor × (1 + medianBounce) — far below the $18 peak.
    expect(feats.sellIntoPrice!).toBeLessThan(15);
  });

  test('Bellibolt: knifing into a 2×-held shelf is Testing the floor, not Free fall', () => {
    // −17%/mo is real speed, but it's dropping INTO a floor that
    // held twice — mid-range of a +344% all-time chart. "Free fall —
    // hasn't found a floor" is wrong: the floor is at $5.02, it's at
    // $5.02. The test decides, not the panic.
    const r = classifyDeal(
      sig({
        stance: 'falling',
        trend: 'depreciating',
        cagr: 75,
        ret7d: -5.3,
        ret30d: -16.6,
        ret90d: -10.7,
        drawdown: -43,
        daysSinceHigh: 580, // the ATH is ancient — PSB correctly skips
        pctile1y: 51,
        price: 5.02,
        low90d: 5.02,
        high90d: 6.36,
      })
    );
    expect(r.cls).toBe('BASE_FORMING');
    expect(r.label).toBe('Testing the floor');
  });

  test('owner note on an unproven floor says discount it out, not hold', () => {
    // Bellibolt parked 0.4% above a floor that only held 2× while
    // still sliding — one crack from new lows. The honest vendor read
    // is redeploy, not "hold and hope".
    const read = classifyDeal(
      sig({
        stance: 'falling',
        trend: 'depreciating',
        cagr: 75,
        ret7d: -5.3,
        ret30d: -16.6,
        ret90d: -10.7,
        drawdown: -43,
        daysSinceHigh: 580,
        pctile1y: 51,
        price: 5.02,
        low90d: 5.02,
        high90d: 6.36,
      })
    );
    expect(read.cls).toBe('BASE_FORMING');
    const features = {
      lastPrice: 5.02,
      daysCovered: 700,
      ret7d: -5.3,
      ret30d: -16.6,
      slope30d: -0.4,
      athPrice: 9.1,
      daysSinceAth: 580,
      floorTests: 2,
      failedBounce: false,
      atFloor: false,
      atShelf: true,
      floorPrice: 5.0,
      targetPrice: 6.36,
      sellIntoPrice: 6.3,
      medianBouncePct: 26,
      medianBounceDays: 30,
      cycleDays: 150,
      higherLows: false,
    } satisfies SeriesFeatures;
    expect(ownerNote(read, features)).toMatch(/small discount/);
    // The exit line still carries the dollar trigger either way.
    expect(read.label).toBe('Testing the floor');
  });

  test('knife into a floor still reads Free fall without floor evidence', () => {
    // No low_90d, no series — nothing proves a floor exists. The
    // conservative read stands.
    const r = classifyDeal(
      sig({
        stance: 'falling',
        trend: 'depreciating',
        cagr: 75,
        ret30d: -16.6,
        drawdown: -43,
        daysSinceHigh: 580,
        pctile1y: 51,
        price: 5.02,
      })
    );
    expect(r.cls).toBe('FREE_FALL');
  });

  test('falling stamp that hits nothing structural lands Long-term decline', () => {
    // Direction without lifecycle — still a faller, just a slow one.
    const r = classifyDeal(
      sig({
        stance: 'falling',
        trend: 'flat',
        cagr: -10,
        ret30d: -5,
        ret90d: -8,
        pctile1y: 30,
        drawdown: -18,
      })
    );
    expect(r.cls).toBe('DECLINER');
  });

  test('same −11.8% month with broken structure still fires FREE_FALL', () => {
    const r = classifyDeal(
      sig({
        stance: 'neutral',
        trend: 'depreciating',
        pctile1y: 30,
        drawdown: -35,
        ret30d: -11.8,
        ret90d: -20,
      })
    );
    expect(r.cls).toBe('FREE_FALL');
  });
});

describe('classifyDeal — deep read (price_series features)', () => {
  const mk = (day: number, price: number, month = 1) => ({
    date: `2025-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    marketPrice: price,
  });

  test('a bounce that ran and died at the floor is not REVIVAL', () => {
    // Ogerpon's shape, synthesized: peak over a year ago → crash →
    // long flat floor → bounce → all the way back. The stamped r30
    // pop survives, but the series shows a failed bounce — a dead
    // cat, not a wake-up.
    const pt = (date: string, marketPrice: number) => ({ date, marketPrice });
    const series = [
      pt('2023-11-01', 2.0), pt('2023-11-20', 2.0),  // old ATH
      pt('2023-12-10', 1.0), pt('2024-03-01', 1.0),  // crash to floor
      pt('2024-06-01', 1.0), pt('2024-09-01', 1.0),  // flat for months
      pt('2024-12-20', 1.0), pt('2024-12-28', 1.3),  // the bounce
      pt('2025-01-05', 1.05), pt('2025-01-10', 1.05), // back at floor
    ];
    const features = buildSeriesFeatures(series);
    expect(features.failedBounce).toBe(true);
    const r = classifyDeal(
      sig({
        stance: 'neutral',
        trend: 'flat',
        cagr: -29,
        ret7d: -5.4,
        ret30d: 27.7,
        drawdown: -81,
        daysSinceHigh: 500,
        pctile1y: 54,
      }),
      features
    );
    expect(r.cls).not.toBe('REVIVAL');
    expect(r.cls).toBe('DEAD_STABLE');
  });

  test('floor tests + higher lows surface in the features', () => {
    const series = [
      mk(1, 1.0, 3), mk(2, 0.8, 3), mk(3, 0.9, 3),  // first low 0.80
      mk(4, 0.95, 3), mk(5, 0.9, 3), mk(6, 0.87, 3), // second low 0.87
      mk(7, 0.95, 3), mk(8, 1.0, 3), mk(9, 1.05, 3), // higher + lifting
      mk(10, 1.1, 3), mk(11, 1.15, 3),
    ];
    const features = buildSeriesFeatures(series);
    expect(features.higherLows).toBe(true);
    // floorTests counts tests of the shelf under current price —
    // the 0.87 shelf got tested once; the older 0.80 low is a
    // different level and doesn't count toward it.
    expect(features.floorTests).toBeGreaterThanOrEqual(1);
    expect(features.ret7d).not.toBeNull();
    expect(features.slope30d).not.toBeNull();
  });

  test('Ampharos: launch crash + recovering month reads the same scalar or deep', () => {
    // The real disagreement: inventory badge said "Waking up" while the
    // sheet's deep read said "Long-term decline". Crash → floor →
    // +14% on the month is a recovery, not a bleed — a red quarter is
    // just the old crash sitting inside the window.
    const signal = sig({
      trend: 'depreciating',
      cagr: -54,
      ret7d: 2.4,
      ret30d: 14,
      ret90d: -20.4,
      pctile1y: 55,
      drawdown: -40,
      daysSinceHigh: 130,
    });
    expect(classifyDeal(signal).cls).toBe('REVIVAL');

    // Same card, sparse weekly series — the deep read must not be
    // *stricter* than the scalar read: no dense slope to confirm with,
    // so the strong fresh month still carries it.
    const pt = (date: string, marketPrice: number) => ({ date, marketPrice });
    const sparse = [
      pt('2025-05-24', 20),
      pt('2025-06-15', 9),
      pt('2025-07-15', 8),
      pt('2025-09-10', 10),
      pt('2025-10-01', 11.5),
      pt('2025-10-10', 12.4),
    ];
    const features = buildSeriesFeatures(sparse);
    expect(classifyDeal(signal, features).cls).toBe('REVIVAL');
  });

  test('a red quarter WITH a still-negative month is still a decliner', () => {
    // Recency gate doesn't rescue a card whose month is also red —
    // the bleed is still running.
    const r = classifyDeal(
      sig({
        trend: 'depreciating',
        cagr: -30,
        ret90d: -20,
        ret30d: -8,
        ret7d: -1,
        drawdown: -45,
        daysSinceHigh: 400,
      })
    );
    expect(r.cls).toBe('DECLINER');
  });

  test('series-fresh returns override stale stamps', () => {
    // Stamp says +27% on the month, but the chart's tail shows the
    // bounce peaked and the last week is red — the deep read sees it.
    const series = [
      mk(1, 1.0, 2), mk(10, 1.0, 2), mk(20, 1.0, 2),
      mk(25, 1.3, 2), mk(28, 1.35, 2),              // peak mid-month
      mk(1, 1.28, 3), mk(5, 1.24, 3), mk(10, 1.2, 3), // rolling over
    ];
    const features = buildSeriesFeatures(series);
    expect(features.ret7d!).toBeLessThan(0);
    expect(features.ret30d!).toBeGreaterThan(10);
    const r = classifyDeal(
      sig({ trend: 'flat', cagr: -20, ret30d: 27, ret7d: 1, pctile1y: 40, drawdown: -60, daysSinceHigh: 300 }),
      features
    );
    expect(r.cls).not.toBe('REVIVAL');
  });
});

describe('megaplan phase 1 — trade plan + triage', () => {
  const mk = (day: number, price: number, month = 1) => ({
    date: `2025-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    marketPrice: price,
  });
  const feats = (over: Partial<SeriesFeatures> = {}): SeriesFeatures => ({
    lastPrice: 5, daysCovered: 400, ret7d: 0, ret30d: 0, slope30d: 0,
    athPrice: 9, daysSinceAth: 200, floorTests: 0, failedBounce: false,
    atFloor: false, atShelf: false, floorPrice: null, targetPrice: null,
    sellIntoPrice: null,
    medianBouncePct: null, medianBounceDays: null, cycleDays: null,
    higherLows: false, ...over,
  });

  test('rotationBucket maps every class into the five buckets', () => {
    const cases: Array<[Partial<CardSignal>, string]> = [
      [{ trend: 'appreciating', cagr: 40, ret90d: 10, ret30d: 5 }, 'grow'],           // STABLE_GROWER
      [{ stance: 'depressed', cagr: -40, ret30d: 0, pctile1y: 20 }, 'dead'],          // DEAD_STABLE
      [{ stance: 'falling', trend: 'depreciating', ret30d: -16, drawdown: -45,
         daysSinceHigh: 200, pctile1y: 30 }, 'rotate'],                              // PSB mid-air
      [{ stance: 'falling', trend: 'depreciating', ret30d: -16, drawdown: -45,
         daysSinceHigh: 200, pctile1y: 30, price: 5, low90d: 5.0 }, 'watch'],        // PSB on floor
      [{ stance: 'neutral', cagr: 2, trend: 'flat', ret30d: 0 }, 'keep'],            // STABLE_FLAT
    ];
    for (const [s, expected] of cases) {
      const signal = sig(s);
      expect(rotationBucket(classifyDeal(signal), signal)).toBe(expected);
    }
  });

  test('owner note goes cut-loss when underwater on a bleeder', () => {
    const read = classifyDeal(sig({
      stance: 'depressed', cagr: -30, ret30d: -8, ret90d: -30, pctile1y: 20,
    }));
    expect(read.cls).toBe('DECLINER');
    expect(
      ownerNote(read, undefined, { price: 6, floor: 5.8, vsCost: -4, daysHeld: 40 })
    ).toMatch(/underwater/i);
    // Same card in profit keeps the redeploy framing.
    expect(
      ownerNote(read, undefined, { price: 6, floor: 5.8, vsCost: 3, daysHeld: 40 })
    ).toMatch(/discount/);
  });

  test('dead card held 4 months reads as shelf rent', () => {
    const read = classifyDeal(sig({ stance: 'depressed', cagr: -40, pctile1y: 15 }));
    expect(read.cls).toBe('DEAD_STABLE');
    expect(
      ownerNote(read, undefined, { price: 3, floor: null, vsCost: 1, daysHeld: 120 })
    ).toMatch(/shelf rent/);
    expect(
      ownerNote(read, undefined, { price: 3, floor: null, vsCost: 1, daysHeld: 30 })
    ).toMatch(/filler|dead money/i);
  });

  test('series features — target, bounce memory, cycle', () => {
    // Boom-bust: a ~$0.80 floor tested every ~3 months, each test
    // bouncing ~30%+ to a defended peak. Parked on the floor now.
    const series = [
      mk(1, 1.0, 1), mk(28, 0.8, 1),     // trough T1
      mk(10, 1.05, 3),                   // peak P1 (+31%)
      mk(28, 0.82, 4),                   // trough T2 (~89d cycle)
      mk(10, 1.12, 6),                   // peak P2 (+37%)
      mk(28, 0.81, 7),                   // trough T3 (~91d)
      mk(10, 1.1, 9),                    // peak P3 (+36%)
      mk(28, 0.82, 10),                  // unconfirmed dip
      mk(5, 0.83, 11),                   // last price — on the shelf
    ];
    const f = buildSeriesFeatures(series);
    expect(f.floorPrice).not.toBeNull();
    expect(f.floorTests).toBeGreaterThanOrEqual(2);
    expect(f.targetPrice).not.toBeNull();
    expect(f.targetPrice!).toBeGreaterThan(f.lastPrice!);
    expect(f.medianBouncePct).not.toBeNull();
    expect(f.medianBouncePct!).toBeGreaterThan(0);
    expect(f.cycleDays).not.toBeNull();
  });

  test('despike drops a one-print bad tick instead of faking a swing', () => {
    const series = [
      mk(1, 1.0, 1), mk(5, 1.0, 1), mk(10, 1.0, 1),
      mk(15, 9.9, 1),          // bad print — 10x spike, reverts next tick
      mk(20, 1.0, 1), mk(25, 1.0, 1), mk(30, 1.0, 1),
      mk(35, 0.8, 1), mk(40, 0.8, 1),                  // real floor
      mk(45, 0.9, 1),
    ];
    const f = buildSeriesFeatures(series);
    // Without despike the 9.9 print becomes a fake ATH/peak.
    expect(f.athPrice).toBeLessThan(2);
  });
});

describe('offerBand — class factor anchored on vendor rate (1.0 = standard rate)', () => {
  // The band multiplies the vendor's own tier offer, NOT market — the
  // class adjusts their rate up/down. A floor card you'd stock should
  // open near the rate and be allowed a touch over; a knife protects
  // below it. (Bubble-mew bug: 0.85 stacked on an 80% tier = a 68%
  // insult open.)

  test('floor card opens ~5% under rate, may pay a touch over to secure it', () => {
    const read = classifyDeal(
      sig({
        stance: 'neutral',
        trend: 'flat',
        cagr: -5,
        ret30d: 2,
        drawdown: -25,
        pctile1y: 15,
        daysSinceHigh: 200,
      })
    );
    expect(read.cls).toBe('BASE_FORMING');
    const band = offerBand(read, 100); // vendor's $100 rate offer
    expect(band.open).toBe(95);
    expect(band.max).toBe(105);
  });

  test('free fall discounts meaningfully below rate', () => {
    const read = classifyDeal(
      sig({
        stance: 'falling',
        ret30d: -22,
        ret90d: -40,
        drawdown: -45,
        cagr: -30,
        pctile1y: 10,
        daysSinceHigh: 400,
      })
    );
    expect(read.cls).toBe('FREE_FALL');
    const band = offerBand(read, 100);
    expect(band.open).toBe(75);
    expect(band.max).toBe(85);
  });

  test('range play pays near rate at the floor, discounts the ceiling', () => {
    // The same proven cycler — position in the range sets the band.
    const cyc = (price: number, atFloor: boolean) => ({
      lastPrice: price,
      daysCovered: 300,
      ret7d: null,
      ret30d: -4,
      slope30d: null,
      athPrice: 1.12,
      daysSinceAth: 150,
      floorTests: 4,
      failedBounce: atFloor, // a completed cycle looks like a dead cat
      atFloor,
      atShelf: atFloor,
      floorPrice: 0.82,
      targetPrice: 1.05,
      sellIntoPrice: 1.05,
      medianBouncePct: 36,
      medianBounceDays: 40,
      cycleDays: 91,
      higherLows: false,
    });
    const base = sig({ price: 0.83, drawdown: -25, pctile1y: 45, trend: 'flat' });
    const entry = classifyDeal(base, cyc(0.83, true));
    expect(entry.cls).toBe('RANGE_PLAY');
    expect(entry.variant).toBe('entry');
    expect(offerBand(entry, 100)).toEqual({ open: 95, max: 105 });
    const exit = classifyDeal(
      sig({ price: 1.02, drawdown: -10, pctile1y: 90, trend: 'flat' }),
      cyc(1.02, false)
    );
    expect(exit.cls).toBe('RANGE_PLAY');
    expect(exit.variant).toBe('exit');
    const band = offerBand(exit, 100);
    expect(band.open).toBe(75);
    expect(band.max).toBe(85);
  });

  test('every class band opens at or above 0.75x rate — no insult opens', () => {
    const reads = [
      classifyDeal(sig({ stance: 'depressed', action: 'BUY_HOLD', ret7d: -7, ret30d: -9.7, ret90d: -39, drawdown: -41, daysSinceHigh: 150, pctile1y: 30 })), // post-spike bleed
      classifyDeal(sig({ stance: 'neutral', trend: 'flat', cagr: -5, ret30d: 2, drawdown: -25, pctile1y: 15, daysSinceHigh: 200 })), // floor
      classifyDeal(sig({ stance: 'falling', ret30d: -22, ret90d: -40, drawdown: -45, cagr: -30, pctile1y: 10, daysSinceHigh: 400 })), // free fall
      classifyDeal(sig({})), // stable flat
      classifyDeal(sig({ action: null })), // low data
    ];
    for (const r of reads) {
      expect(r.offerLoFactor).toBeGreaterThanOrEqual(0.75);
      expect(r.offerHiFactor).toBeGreaterThanOrEqual(r.offerLoFactor);
      expect(r.offerHiFactor).toBeLessThanOrEqual(1.05);
    }
  });
});

describe('action lines — the two-second read', () => {
  const cyc = (price: number) =>
    sig({
      price,
      shelfPrice: 8.2,
      shelfTests: 4,
      cycleDays: 91,
      medianBouncePct: 36,
      targetPrice: 10.5,
      drawdown: -25,
      pctile1y: 45,
    });

  test('every class has a verb — no gap in the action layer', () => {
    const reads = [
      classifyDeal(sig({ stance: 'depressed', action: 'BUY_HOLD', ret7d: -7, ret30d: -9.7, ret90d: -39, drawdown: -41, daysSinceHigh: 150, pctile1y: 30 })),
      classifyDeal(sig({ stance: 'falling', ret30d: -22, ret90d: -40, drawdown: -45, cagr: -30, pctile1y: 10, daysSinceHigh: 400 })),
      classifyDeal(sig({ trend: 'appreciating', cagr: 40, ret30d: 6 })),
      classifyDeal(cyc(8.3)),
      classifyDeal(cyc(10.4)),
      classifyDeal(sig({})),
      classifyDeal(sig({ action: null })),
    ];
    for (const r of reads) {
      expect(dealAction(r).length).toBeGreaterThan(3);
      expect(positionAction(r).length).toBeGreaterThan(3);
    }
  });

  test('the verb follows the read, not the story', () => {
    // Cycler at floor vs at ceiling — same card, opposite verb.
    expect(dealAction(classifyDeal(cyc(8.3)))).toBe('Buy the floor');
    expect(dealAction(classifyDeal(cyc(10.4)))).toMatch(/not a buy/i);
    // Knife — never a buy verb.
    const knife = classifyDeal(sig({ stance: 'falling', ret30d: -22, ret90d: -40, drawdown: -45, cagr: -30, pctile1y: 10, daysSinceHigh: 400 }));
    expect(dealAction(knife)).toMatch(/don't|pass|skip/i);
    // Owned: a cracked floor overrides the class verb entirely.
    expect(
      positionAction(classifyDeal(cyc(10.4)), { ceiling: 10.5 })
    ).toMatch(/sell into ~\$10\.50/i);
    expect(
      positionAction(classifyDeal(cyc(8.3)), { cracked: true, bounceCheap: false })
    ).toBe('Floor broke — sell the bounce back');
  });
});
