import { buildStockHealth, type StockCard } from '../src/scanner/services/deal/stockHealth';
import { positionTriggers } from '../src/scanner/services/deal/sheetReads';
import type { CardSignal } from '../src/db/catalogDb';
import { mkSignal } from './helpers/builders';

const card = (over: Partial<StockCard> = {}): StockCard => ({
  id: `c${Math.random().toString(36).slice(2, 8)}`,
  name: 'Test Card',
  productId: 1,
  productType: 'Normal',
  liveMarket: 10,
  amountPaid: 10,
  ...over,
});

const sig = (over: Partial<CardSignal> = {}): CardSignal =>
  mkSignal({ firstDate: '2024-03-01', ...over });

describe('buildStockHealth', () => {
  test('dollar-weights buckets — a $200 bleeder outweighs ten $2 growers', () => {
    const growers = Array.from({ length: 10 }, (_, i) =>
      card({ id: `g${i}`, liveMarket: 2, amountPaid: 2 }),
    );
    const bleeder = card({ id: 'b1', liveMarket: 200, amountPaid: 150 });
    const signals = new Map<StockCard, CardSignal>();
    growers.forEach((c) => signals.set(c, sig({ trend: 'appreciating', cagr: 40, ret30d: 5 })));
    signals.set(
      bleeder,
      sig({
        stance: 'depressed',
        cagr: -30,
        ret30d: -8,
        ret90d: -30,
        pctile1y: 20,
        price: 200,
      }),
    );
    const health = buildStockHealth([...growers, bleeder], (c) => signals.get(c));
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
    const signals = new Map<StockCard, CardSignal>([
      [
        c1,
        sig({ stance: 'depressed', cagr: -30, ret30d: -8, ret90d: -30, pctile1y: 20, price: 30 }),
      ],
      [
        c2,
        sig({ stance: 'depressed', cagr: -45, ret30d: -6, ret90d: -25, pctile1y: 15, price: 80 }),
      ],
    ]);
    const health = buildStockHealth([c1, c2], (c) => signals.get(c));
    expect(health.rotateOut.map((i) => i.card.id)).toEqual(['b', 'a']);
  });

  test('a card already through its floor does not show a pending stop', () => {
    // Same rule as the sheet's SELL UNDER → CRACKED flip: a stop that
    // already fired isn't a trigger, it's a state. Price 9 vs floor 10.
    const c = card({ id: 'x', liveMarket: 9, amountPaid: 9 });
    const health = buildStockHealth([c], () =>
      sig({
        stance: 'depressed',
        cagr: -30,
        ret30d: -8,
        ret90d: -30,
        pctile1y: 20,
        price: 9,
        low90d: 10,
      }),
    );
    expect(health.items[0].trigger).toMatch(/under ~\$10/);
    expect(health.items[0].trigger).not.toMatch(/exit below/);
  });

  test('the armed stop needs a resolved floor — a bare 90d low only names a level', () => {
    // Item 64 — the fresh-low tautology: a card at $10.20 with a $10
    // 90d low is "near its low" because it just printed the low, not
    // because a shelf held it. Same class either way (DECLINER), but
    // only the stamped shelf earns the armed wording + thin-ice flag;
    // the bare low names the level without asserting the card is
    // parked on it.
    const c = card({ id: 'x', liveMarket: 10.2, amountPaid: 10 });
    const bareLow = buildStockHealth([c], () =>
      sig({
        stance: 'depressed',
        cagr: -30,
        ret30d: -8,
        ret90d: -30,
        pctile1y: 20,
        price: 10.2,
        low90d: 10,
      }),
    );
    expect(bareLow.items[0].read.cls).toBe('DECLINER');
    expect(bareLow.items[0].onFloor).toBe(false);
    expect(bareLow.items[0].trigger).toBe('floor ~$10.00');

    const shelf = buildStockHealth([c], () =>
      sig({
        stance: 'depressed',
        cagr: -30,
        ret30d: -8,
        ret90d: -30,
        pctile1y: 20,
        price: 10.2,
        low90d: 10,
        shelfPrice: 10,
      }),
    );
    expect(shelf.items[0].read.cls).toBe('DECLINER');
    expect(shelf.items[0].onFloor).toBe(true);
    expect(shelf.items[0].trigger).toBe('sell if it drops below $10.00');
  });

  test('a card at its sell end inside the floor band cannot arm a floor stop', () => {
    // Item 64 — ceiling-blind was the bug: price inside the stamped
    // shelf's parked band but already at/above the stamped sell-into
    // resolves at-ceiling (the verdict's own ordering), so "sell if it
    // drops below the floor" is a proximity claim the position
    // disproves. The shelf still gets named; the stop doesn't arm.
    const c = card({ id: 'x', liveMarket: 10.4, amountPaid: 10 });
    const atCeiling = buildStockHealth([c], () =>
      sig({
        stance: 'neutral',
        trend: 'flat',
        cagr: -5,
        ret7d: -4,
        ret30d: -8,
        ret90d: -5,
        drawdown: -30,
        daysSinceHigh: 100,
        pctile1y: 40,
        price: 10.4,
        low90d: 9.8,
        high90d: 15,
        shelfPrice: 10,
        targetPrice: 10.3,
      }),
    );
    expect(atCeiling.items[0].read.cls).toBe('POST_SPIKE_BLEED');
    expect(atCeiling.items[0].onFloor).toBe(false);
    expect(atCeiling.items[0].trigger).toBe('floor ~$10.00');

    // The deep pass can supply the sell-into the stamps lacked — same
    // parked-on-the-shelf stamps, the window's $10.30 sell end puts
    // the price over the line. Hydration earning the honest read is
    // the designed flip, not incoherence.
    const signal = sig({
      stance: 'neutral',
      trend: 'flat',
      cagr: -5,
      ret7d: -4,
      ret30d: -8,
      ret90d: -5,
      drawdown: -30,
      daysSinceHigh: 100,
      pctile1y: 40,
      price: 10.4,
      low90d: 9.8,
      high90d: 15,
      shelfPrice: 10,
    });
    const scalar = buildStockHealth([c], () => signal);
    expect(scalar.items[0].onFloor).toBe(true);
    expect(scalar.items[0].trigger).toBe('sell if it drops below $10.00');
    const deep = buildStockHealth(
      [c],
      () => signal,
      () => ({
        lastPrice: 10.4,
        daysCovered: 400,
        ret7d: -4,
        ret30d: -8,
        slope30d: null,
        athPrice: 15,
        daysSinceAth: 100,
        floorTests: 2,
        failedBounce: false,
        atFloor: true,
        atShelf: true,
        floorPrice: 10,
        targetPrice: null,
        sellIntoPrice: 10.3,
        medianBouncePct: 20,
        medianBounceDays: null,
        cycleDays: null,
        floorBounces: 1,
        higherLows: false,
      }),
    );
    expect(deep.items[0].onFloor).toBe(false);
    expect(deep.items[0].trigger).toBe('floor ~$10.00');
  });

  test('a degenerate range (floor above its ceiling) cannot arm a floor stop', () => {
    // ev.position resolves no-structure when the resolved floor sits
    // above the resolved ceiling — an unprintable range — so the armed
    // wording can't render even though the price sits in the shelf's
    // own band.
    const c = card({ id: 'x', liveMarket: 10.4, amountPaid: 10 });
    const degenerate = buildStockHealth([c], () =>
      sig({
        stance: 'neutral',
        trend: 'flat',
        cagr: -5,
        ret7d: -4,
        ret30d: -8,
        ret90d: -5,
        drawdown: -30,
        daysSinceHigh: 100,
        pctile1y: 40,
        price: 10.4,
        low90d: 9.8,
        high90d: 15,
        shelfPrice: 10,
        targetPrice: 9,
      }),
    );
    expect(degenerate.items[0].read.cls).toBe('POST_SPIKE_BLEED');
    expect(degenerate.items[0].onFloor).toBe(false);
    expect(degenerate.items[0].trigger).toBe('floor ~$10.00');
  });

  test('a RANGE_PLAY exit names the resolved ceiling — derived included', () => {
    // Item 64 — the trigger's ceiling chain stopped at the stamped
    // target, so a range the verdict proved on a derived ceiling
    // (floor × (1 + median bounce)) printed "sell now" with no level.
    // The row quotes ev.ceiling — the same $45 the range verdict and
    // the sheet's SELL INTO row name.
    const c = card({ id: 'x', liveMarket: 41.5, amountPaid: 41.5 });
    const base = {
      stance: 'neutral',
      trend: 'flat',
      cagr: 2,
      ret7d: -1,
      ret30d: -4,
      ret90d: -12,
      drawdown: -17,
      daysSinceHigh: 100,
      pctile1y: 45,
      price: 41.5,
      low90d: 31,
      high90d: 50,
      shelfPrice: 30,
      shelfTests: 4,
      cycleDays: 90,
      medianBouncePct: 50,
      analogBounceN: 2,
    } satisfies Partial<CardSignal>;
    const derived = buildStockHealth([c], () => sig(base));
    expect(derived.items[0].read.cls).toBe('RANGE_PLAY');
    expect(derived.items[0].read.variant).toBe('exit');
    expect(derived.items[0].trigger).toBe('near the top of its range — sell around ~$45.00');

    // The sheet's own target row resolves the same ceiling — the row
    // can't name a level the sheet doesn't print.
    const sheetTriggers = positionTriggers(derived.items[0].read, sig(base), undefined);
    expect(sheetTriggers.showTarget).toBe(true);
    expect(sheetTriggers.targetPrice).toBeCloseTo(45, 2);

    // The stamped sell-into names the same level — no drift where the
    // resolutions agree.
    const stamped = buildStockHealth([c], () => sig({ ...base, targetPrice: 45 }));
    expect(stamped.items[0].trigger).toBe('near the top of its range — sell around ~$45.00');
  });

  test('the deep pass re-buckets on series evidence the stamp hid', () => {
    // Stamped "cheap and quiet" (flat month, no floor in view) → scalar
    // bucket is Watching. The shipped series shows the card still
    // sliding −22%/mo → the deep read says knife → Rotate out.
    const c = card({ liveMarket: 10, amountPaid: 10 });
    const signal = sig({
      stance: 'depressed',
      trend: 'depreciating',
      cagr: -5,
      ret30d: -2,
      ret7d: -1,
      ret90d: -8,
      pctile1y: 20,
      price: 10,
    });
    const scalar = buildStockHealth([c], () => signal);
    expect(scalar.items[0].bucket).toBe('watch');
    const deep = buildStockHealth(
      [c],
      () => signal,
      () => ({
        lastPrice: 10,
        daysCovered: 400,
        ret7d: -8,
        ret30d: -22,
        slope30d: null,
        athPrice: 15,
        daysSinceAth: 300,
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
        floorBounces: 0,
        higherLows: false,
      }),
    );
    expect(deep.items[0].bucket).toBe('rotate');
  });

  test('graceful when signals are missing — coverage gates the panel', () => {
    const health = buildStockHealth([card({ liveMarket: 50, amountPaid: 40 })], () => undefined);
    expect(health.coverage).toBe(0);
    expect(health.items).toHaveLength(0);
    expect(health.headline).toMatch(/thin|sales data/i);
  });

  test('a proven cycler lands in watch with the range-break trigger', () => {
    // Series evidence only — stamps can't see cycles, so this needs
    // the deep pass. Parked at the floor = buy end of the range.
    const c = card({ liveMarket: 8.3, amountPaid: 8.3 });
    const signal = sig({
      stance: 'neutral',
      trend: 'flat',
      cagr: 2,
      ret30d: -4,
      drawdown: -25,
      pctile1y: 45,
      price: 8.3,
      low90d: 8.2,
    });
    const health = buildStockHealth(
      [c],
      () => signal,
      () => ({
        lastPrice: 8.3,
        daysCovered: 400,
        ret7d: -1,
        ret30d: -4,
        slope30d: null,
        athPrice: 11.2,
        daysSinceAth: 150,
        floorTests: 4,
        failedBounce: true, // a completed cycle looks like a dead cat
        atFloor: true,
        atShelf: true,
        floorPrice: 8.2,
        targetPrice: 10.5,
        sellIntoPrice: 10.0,
        medianBouncePct: 36,
        medianBounceDays: 40,
        cycleDays: 91,
        floorBounces: 2,
        higherLows: false,
      }),
    );
    expect(health.items[0].read.cls).toBe('RANGE_PLAY');
    expect(health.items[0].bucket).toBe('watch');
    expect(health.items[0].trigger).toMatch(/drops below|range breaks below/);
  });

  test('dead money lands in its own bucket, not rotate', () => {
    const c = card({ liveMarket: 12, amountPaid: 8 });
    const health = buildStockHealth([c], () =>
      sig({ stance: 'depressed', cagr: -40, pctile1y: 15, price: 12 }),
    );
    expect(health.buckets.dead.count).toBe(1);
    expect(health.buckets.rotate.count).toBe(0);
  });
});
