import {
  scoutCandidates,
  scoutFloorBuys,
} from '../src/scanner/services/deal/buyScout';
import type { ScoutRow } from '../src/db/catalogDb';
import type { CardSignal } from '../src/db/catalogDb';
import { mkSignal } from './helpers/builders';

const sig = (over: Partial<CardSignal> = {}): CardSignal =>
  mkSignal({ firstDate: '2024-03-01', ...over });

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

  test('a cycler surfaces at its floor, not mid-range or at the top', () => {
    // Stamped cycle stats make "what do I buy at the floor today"
    // enumerable without loading series. Only the entry position is
    // a buy — mid-swing and ceiling are the wrong end of the range.
    const cyc = (price: number) =>
      sig({
        productId: 9,
        price,
        shelfPrice: 8.2,
        shelfTests: 4,
        cycleDays: 91,
        medianBouncePct: 36,
        targetPrice: 10.5,
        drawdown: -25,
        pctile1y: 45,
      });
    const out = scoutCandidates(
      [
        row(cyc(8.3), 'AtFloor'), // on the shelf → entry → scout it
        row(cyc(9.5), 'MidAir'), // mid-swing → not a buy
        row(cyc(10.4), 'AtCeiling'), // ~99% of ceiling → sell end
      ],
      new Set(),
      20
    );
    expect(out.map((c) => c.name)).toEqual(['AtFloor']);
    expect(out[0].why).toMatch(/buy end|floor|buy low/i);
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

describe('scoutFloorBuys', () => {
  const cyc = (id: number, price: number, over: Partial<CardSignal> = {}) =>
    row(
      sig({
        productId: id,
        price,
        shelfPrice: 8.2,
        shelfTests: 4,
        cycleDays: 91,
        medianBouncePct: 36,
        targetPrice: 10.5,
        drawdown: -25,
        pctile1y: 45,
        ...over,
      }),
      `C${id}`
    );

  test('entry cyclers only — mid and exit positions stay out', () => {
    const out = scoutFloorBuys(
      [
        cyc(1, 8.3), // entry
        cyc(2, 9.5), // mid
        cyc(3, 10.4), // exit
        row(
          sig({ productId: 4, trend: 'appreciating', cagr: 60, ret30d: 8 }),
          'Grower'
        ),
      ],
      new Set(),
      15
    );
    expect(out.map((c) => c.productId)).toEqual([1]);
  });

  test('ranked by score; owned sinks below unowned', () => {
    // Wider spread to ceiling = better buy — C2 (price 8.3) beats C1
    // (price 8.9, same floor+ceiling → thinner spread left).
    const out = scoutFloorBuys(
      [cyc(1, 8.9), cyc(2, 8.3), cyc(3, 8.3)],
      new Set([3]),
      15
    );
    expect(out.map((c) => c.productId)).toEqual([2, 1, 3]);
  });
});
