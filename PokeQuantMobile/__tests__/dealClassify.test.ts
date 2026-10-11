import { classifyDeal } from '../src/scanner/services/deal/dealClassify';
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
