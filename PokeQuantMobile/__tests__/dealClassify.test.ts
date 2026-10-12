import { classifyDeal } from '../src/scanner/services/deal/dealClassify';
import { buildSeriesFeatures } from '../src/scanner/services/deal/seriesSignals';
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
  test('floor → falling is a floor_break', () => {
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
    expect(shifts[0].kind).toBe('floor_break');
    expect(shifts[0].to.cls).toBe('FREE_FALL');
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
    expect(features.floorTests).toBeGreaterThanOrEqual(2);
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
