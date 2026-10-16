import {
  normalizeSubType,
  pickSignalForFinish,
  resolveVariantPrice,
  type CardSignal,
  PricePoint,
} from '../src/db/catalogDb';
import { diffDealClasses, classKey } from '../src/scanner/services/deal/dealShiftTracker';
import { mkSignal } from './helpers/builders';
import { renderSurfaces, assertContract } from './helpers/stack';
import { buildSeriesFeatures } from '../src/scanner/services/deal/seriesSignals';

// Phase 4 — the consumers of classification that sit OUTSIDE the
// badge/sheet pair: the movement-shift banner, the finish fallback,
// scout lanes, and trade notes. The stack contract (helpers/stack.ts
// rules 9–11) already verifies the class each consumer shows per
// scenario; this file pins the resolution mechanics the stack can't
// reach — multi-finish signal maps and the shift map's keying.

const sig = (over: Partial<CardSignal> = {}): CardSignal =>
  mkSignal({ firstDate: '2024-03-01', ...over });

describe('pickSignalForFinish — the finish fallback', () => {
  const holo = sig({ productId: 1, subType: 'Holofoil', ret30d: -20 });
  const normal = sig({ productId: 1, subType: 'Normal', ret30d: 5 });
  const rev = sig({ productId: 1, subType: 'Reverse Holofoil', ret30d: -5 });
  const map = {
    1: {
      Holofoil: holo,
      Normal: normal,
      'Reverse Holofoil': rev,
    },
  };

  test('exact finish wins — no silent cross-finish reads', () => {
    expect(pickSignalForFinish(map, { productId: 1, productType: 'Holofoil' })).toBe(holo);
    expect(
      pickSignalForFinish(map, {
        productId: 1,
        productType: 'Reverse Holofoil',
      }),
    ).toBe(rev);
  });

  test('missing finish falls to Normal before arbitrary variants', () => {
    // A row stamped with a finish the signal map lacks must land on
    // Normal — not the arbitrary first key — so the badge can't read
    // a different finish's class under the held finish's label.
    const noNormal = { 1: { Holofoil: holo, 'Reverse Holofoil': rev } };
    expect(
      pickSignalForFinish(noNormal, {
        productId: 1,
        productType: 'Unobtainable Finish',
      }),
    ).toBe(holo); // first loaded — only sane fallback left
    expect(
      pickSignalForFinish(map, {
        productId: 1,
        productType: 'Unobtainable Finish',
      }),
    ).toBe(normal); // Normal exists → it wins over arbitrary
  });

  test('no finish on the card falls to Normal, then any variant', () => {
    expect(pickSignalForFinish(map, { productId: 1 })).toBe(normal);
    const noNormal = { 1: { 'Reverse Holofoil': rev } };
    expect(pickSignalForFinish(noNormal, { productId: 1 })).toBe(rev);
  });

  test('unknown product → undefined (LOW_DATA, never a wrong card)', () => {
    expect(pickSignalForFinish(map, { productId: 999, productType: 'Normal' })).toBeUndefined();
    expect(pickSignalForFinish({}, { productId: 1, productType: 'Normal' })).toBeUndefined();
    expect(pickSignalForFinish(map, { productId: null })).toBeUndefined();
  });
});

describe('watched-row resolution matches the held-row chain', () => {
  // The bug class: the watchlist diff used `signals[pid]?.[subType] ??
  // Object.values()[0]` — skipping the Normal middle step the held
  // path takes. A watched card with an unstamped finish would
  // classify whatever variant happened to load first, keyed under
  // the requested finish — the shift banner's "→ Range play" could
  // be a Holofoil read hanging on a Reverse Holofoil row.
  test('watchlist resolves through pickSignalForFinish', () => {
    const holo = sig({
      productId: 7,
      subType: 'Holofoil',
      ret30d: -18,
      stance: 'falling',
      trend: 'depreciating',
      drawdown: -50,
    });
    const normal = sig({
      productId: 7,
      subType: 'Normal',
      ret30d: 6,
      trend: 'appreciating',
      cagr: 30,
    });
    const map = { 7: { Holofoil: holo, Normal: normal } };
    const resolved = pickSignalForFinish(map, {
      productId: 7,
      productType: 'Reverse Holofoil', // watched finish, unstamped
    });
    // Normal is the shared fallback — NOT Holofoil (the arbitrary
    // first variant the old path would have classified).
    expect(resolved).toBe(normal);
    // And the shift the resolved signal produces is the Normal read.
    const { shifts } = diffDealClasses(
      { [classKey(7, 'Reverse Holofoil')]: { cls: 'DEAD_STABLE', label: 'Dead / stable' } },
      [{ card: null, productId: 7, subType: 'Reverse Holofoil', signal: resolved }],
    );
    expect(shifts).toHaveLength(1);
    expect(shifts[0].to.cls).not.toBe('FREE_FALL'); // the Holofoil's read
  });
});

describe('resolveVariantPrice + normalizeSubType — the price-side chain', () => {
  const prices = {
    Normal: { marketPrice: 10, date: '2026-10-10' },
    Holofoil: { marketPrice: 25, date: '2026-10-10' },
    'Reverse Holofoil': { marketPrice: 15, date: '2026-10-10' },
  };

  test('requested finish resolves exactly', () => {
    expect(resolveVariantPrice(prices, 'Holofoil').matchedSubType).toBe('Holofoil');
    expect(resolveVariantPrice(prices, 'Reverse Holofoil').matchedSubType).toBe('Reverse Holofoil');
  });

  test('missing finish falls back: Normal before Holofoil', () => {
    const r = resolveVariantPrice(prices, '1st Edition');
    expect(r.matchedSubType).toBe('Normal');
    // With no Normal, holofoil is next in the canonical chain.
    const noNormal = { Holofoil: prices.Holofoil, 'Reverse Holofoil': prices['Reverse Holofoil'] };
    expect(resolveVariantPrice(noNormal, '1st Edition').matchedSubType).toBe('Holofoil');
  });

  test('finish aliases canonicalize to the same bucket', () => {
    expect(normalizeSubType('Holo')).toBe('holofoil');
    expect(normalizeSubType('Rev Holo')).toBe('reverse holofoil');
    expect(normalizeSubType('Regular')).toBe('normal');
    expect(normalizeSubType('1st Ed Holo')).toBe('1st edition holofoil');
  });

  test('empty price map resolves to a zero row, never a crash', () => {
    const r = resolveVariantPrice({}, 'Holofoil');
    expect(r.marketPrice).toBe(0);
    expect(r.matchedSubType).toBe('');
  });
});

describe('consumer surfaces on real shapes — end-to-end', () => {
  // The contract rules in helpers/stack.ts run shift/scout/trade on
  // every scenario; these pin the MECHANICS the per-card rules rely
  // on — the banner must never show a class the badge doesn't, and a
  // floor lane can only ever carry entry cyclers.

  const mkSeries = (): PricePoint[] => {
    // A real cycler shape: three floor tests, 30d rhythm, 20% bounces.
    const pts: PricePoint[] = [];
    const floor = 10,
      ceil = 12.2;
    let day = new Date('2025-01-01').getTime();
    for (let i = 0; i < 6; i++) {
      const top = i % 2 === 1;
      for (let k = 0; k < 15; k++) {
        const frac = k / 14;
        const px = top ? ceil - (ceil - floor) * frac : floor + (ceil - floor) * frac;
        pts.push({ date: new Date(day).toISOString().slice(0, 10), marketPrice: px });
        day += 2 * 86400000;
      }
    }
    pts.push({ date: new Date(day).toISOString().slice(0, 10), marketPrice: floor * 1.02 });
    return pts;
  };

  test('entry cycler: banner, both scout lanes, and notes stay coherent', () => {
    const signal = sig({
      productId: 42,
      subType: 'Normal',
      price: 10.2,
      shelfPrice: 10,
      shelfTests: 4,
      cycleDays: 30,
      medianBouncePct: 22,
      targetPrice: 12.2,
      high90d: 12.5,
      drawdown: -18,
      pctile1y: 40,
    });
    const features = buildSeriesFeatures(mkSeries());
    const stack = renderSurfaces(signal, features, {
      price: 10.2,
      floor: 10,
      productId: 42,
      subType: 'Normal',
    });
    assertContract('cycler@floor', stack);
    expect(stack.shift?.to.cls).toBe(stack.badge.cls);
    if (stack.badge.cls === 'RANGE_PLAY' && stack.badge.variant === 'entry') {
      expect(stack.scoutFloor).not.toBeNull();
    }
  });

  test('a knife: no scout lane, and the banner never says buy', () => {
    const signal = sig({
      productId: 43,
      subType: 'Normal',
      stance: 'falling',
      trend: 'depreciating',
      ret30d: -25,
      ret7d: -9,
      drawdown: -55,
      pctile1y: 10,
      price: 4,
    });
    const stack = renderSurfaces(signal, undefined, {
      price: 4,
      floor: null,
      productId: 43,
      subType: 'Normal',
    });
    assertContract('knife', stack);
    expect(stack.scout).toBeNull();
    expect(stack.scoutFloor).toBeNull();
    if (stack.shift) expect(stack.shift.to.cls).toBe(stack.badge.cls);
  });
});
