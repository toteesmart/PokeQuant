import { scoutCandidates } from '../src/scanner/services/deal/buyScout';
import type { ScoutRow } from '../src/db/catalogDb';
import type { CardSignal } from '../src/db/catalogDb';

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
  ...over,
});

const row = (signal: CardSignal, name = 'Card'): ScoutRow => ({
  signal,
  name,
  number: '001',
  set: 'Test Set',
  rarity: 'Rare',
});

describe('scoutCandidates', () => {
  test('keeps buy classes, drops everything else', () => {
    const rows = [
      // Revival — green month off a deep drawdown.
      row(sig({ productId: 1, ret30d: 14, drawdown: -45, pctile1y: 30, cagr: 20 }), 'Reviver'),
      // Stable grower.
      row(sig({ productId: 2, trend: 'appreciating', cagr: 45, ret30d: 4 }), 'Grower'),
      // Free faller — must not surface.
      row(sig({ productId: 3, stance: 'falling', trend: 'depreciating', ret30d: -18, ret7d: -9, drawdown: -50, pctile1y: 20 }), 'Knife'),
      // Dead stable — must not surface.
      row(sig({ productId: 4, stance: 'depressed', cagr: -40, pctile1y: 15 }), 'Dead'),
      // At peak — not a buy-the-dip class.
      row(sig({ productId: 5, stance: 'elevated', pctile1y: 95, ret30d: 10 }), 'Peaked'),
    ];
    const out = scoutCandidates(rows, new Set(), 20);
    const names = out.map((c) => c.name);
    expect(names).toContain('Reviver');
    expect(names).toContain('Grower');
    expect(names).not.toContain('Knife');
    expect(names).not.toContain('Dead');
    expect(names).not.toContain('Peaked');
  });

  test('a knife falling into a floor is not a buy — testing variants excluded', () => {
    // BASE_FORMING 'testing' = knife mid-fall into a floor — watchlist
    // material, not deploy-capital material.
    const knifeOnFloor = row(
      sig({
        productId: 6,
        trend: 'appreciating',
        cagr: 30,
        ret30d: -16,
        ret7d: -8,
        drawdown: -30,
        pctile1y: 40,
        price: 5,
        low90d: 5.0,
      }),
      'TestingKnife'
    );
    const out = scoutCandidates([knifeOnFloor], new Set(), 20);
    expect(out).toHaveLength(0);
  });

  test('owned candidates flag and sort below unowned at equal quality', () => {
    const mk = (id: number) =>
      row(
        sig({ productId: id, trend: 'appreciating', cagr: 50, ret30d: 5 }),
        `G${id}`
      );
    const out = scoutCandidates([mk(1), mk(2)], new Set([1]), 20);
    expect(out.find((c) => c.productId === 1)?.owned).toBe(true);
    expect(out[out.length - 1].productId).toBe(1);
  });

  test('thin liquidity and unbounded downside drag the score', () => {
    const liquid = row(
      sig({ productId: 7, trend: 'appreciating', cagr: 50, ret30d: 5 }),
      'Liquid'
    );
    const illiquid = row(
      sig({
        productId: 8,
        trend: 'appreciating',
        cagr: 50,
        ret30d: 5,
        liqFlag: 'stale',
        confidence: 'low',
        fwd30dLo: 6, // vs price 10 → deep downside
      }),
      'Illiquid'
    );
    const out = scoutCandidates([liquid, illiquid], new Set(), 20);
    const l = out.find((c) => c.name === 'Liquid');
    const i = out.find((c) => c.name === 'Illiquid');
    expect(l!.score).toBeGreaterThan(i!.score);
  });
});
