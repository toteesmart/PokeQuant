import {
  buildStockHealth,
  type StockCard,
} from '../src/scanner/services/deal/stockHealth';
import type { CardSignal } from '../src/db/catalogDb';

const card = (over: Partial<StockCard> = {}): StockCard => ({
  id: `c${Math.random().toString(36).slice(2, 8)}`,
  name: 'Test Card',
  productId: 1,
  productType: 'Normal',
  liveMarket: 10,
  amountPaid: 10,
  ...over,
});

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

describe('buildStockHealth', () => {
  test('dollar-weights buckets — a $200 bleeder outweighs ten $2 growers', () => {
    const growers = Array.from({ length: 10 }, (_, i) =>
      card({ id: `g${i}`, liveMarket: 2, amountPaid: 2 })
    );
    const bleeder = card({ id: 'b1', liveMarket: 200, amountPaid: 150 });
    const signals = new Map<StockCard, CardSignal>();
    growers.forEach((c) =>
      signals.set(c, sig({ trend: 'appreciating', cagr: 40, ret30d: 5 }))
    );
    signals.set(
      bleeder,
      sig({
        stance: 'depressed',
        cagr: -30,
        ret30d: -8,
        ret90d: -30,
        pctile1y: 20,
        price: 200,
      })
    );
    const health = buildStockHealth(
      [...growers, bleeder],
      (c) => signals.get(c)
    );
    // 11 cards but the bleeder is ~91% of value → headline warns.
    expect(health.buckets.grow.count).toBe(10);
    expect(health.buckets.rotate.count).toBe(1);
    expect(health.buckets.rotate.value).toBe(200);
    expect(health.headline).toMatch(/% of your stock's value/);
    expect(health.rotateOut[0].card.id).toBe('b1');
  });

  test('rotate-out sorts by dollars locked and carries the floor trigger', () => {
    const c1 = card({ id: 'a', liveMarket: 30, amountPaid: 30 });
    const c2 = card({ id: 'b', liveMarket: 80, amountPaid: 60 });
    const faller = (price: number) =>
      sig({
        stance: 'falling',
        trend: 'depreciating',
        ret30d: -16,
        drawdown: -45,
        daysSinceHigh: 200,
        pctile1y: 30,
        price,
        low90d: price * 0.99, // parked on the floor → watch, not rotate
      });
    const signals = new Map<StockCard, CardSignal>([
      [c1, sig({ stance: 'depressed', cagr: -30, ret30d: -8, ret90d: -30, pctile1y: 20, price: 30 })],
      [c2, sig({ stance: 'depressed', cagr: -45, ret30d: -6, ret90d: -25, pctile1y: 15, price: 80 })],
    ]);
    const health = buildStockHealth([c1, c2], (c) => signals.get(c));
    expect(health.rotateOut.map((i) => i.card.id)).toEqual(['b', 'a']);
  });

  test('graceful when signals are missing — coverage gates the panel', () => {
    const health = buildStockHealth(
      [card({ liveMarket: 50, amountPaid: 40 })],
      () => undefined
    );
    expect(health.coverage).toBe(0);
    expect(health.items).toHaveLength(0);
    expect(health.headline).toMatch(/thin/i);
  });

  test('dead money lands in its own bucket, not rotate', () => {
    const c = card({ liveMarket: 12, amountPaid: 8 });
    const health = buildStockHealth([c], () =>
      sig({ stance: 'depressed', cagr: -40, pctile1y: 15, price: 12 })
    );
    expect(health.buckets.dead.count).toBe(1);
    expect(health.buckets.rotate.count).toBe(0);
  });
});
