import {
  addDays,
  calculateMetrics,
  calculateTiers,
  createTimeBuckets,
  filterByHorizon,
  formatHourLabel,
  formatShortDate,
  getBuckets,
  getHorizonStart,
  parseSaleDate,
  startOfDay,
  timeAgo,
} from '../src/services/salesAnalytics';
import type { CompletedSale } from '../src/store/inventoryStore';

// Fixed clock: Sunday, October 18, 2026, 15:30 local time.
const NOW = new Date(2026, 9, 18, 15, 30);

const mkSale = (over: Partial<CompletedSale> = {}): CompletedSale => ({
  id: 'sale-1',
  name: 'Pikachu',
  acquiredCost: 10,
  soldPrice: 20,
  dateSold: NOW.toISOString(),
  ...over,
});

const saleAt = (d: Date, over: Partial<CompletedSale> = {}) =>
  mkSale({ dateSold: d.toISOString(), ...over });

describe('parseSaleDate', () => {
  test('a valid ISO string round-trips', () => {
    const iso = '2026-10-01T12:34:56.000Z';
    expect(parseSaleDate(iso).getTime()).toBe(new Date(iso).getTime());
  });

  test('an invalid string falls back to now', () => {
    const d = parseSaleDate('not a date');
    expect(Math.abs(d.getTime() - Date.now())).toBeLessThan(1000);
  });
});

describe('date helpers', () => {
  test('startOfDay zeroes the time', () => {
    expect(startOfDay(NOW)).toEqual(new Date(2026, 9, 18));
  });

  test('addDays rolls over a month boundary', () => {
    expect(addDays(new Date(2026, 0, 31), 1)).toEqual(new Date(2026, 1, 1));
    expect(addDays(NOW, -6)).toEqual(new Date(2026, 9, 12, 15, 30));
  });

  test('formatShortDate is M/D and formatHourLabel is H:00', () => {
    expect(formatShortDate(NOW)).toBe('10/18');
    expect(formatHourLabel(NOW)).toBe('15:00');
    expect(formatHourLabel(new Date(2026, 9, 18, 0, 59))).toBe('0:00');
  });
});

describe('timeAgo', () => {
  test.each([
    ['a future date', new Date(NOW.getTime() + 60_000), 'just now'],
    ['30 seconds ago', new Date(NOW.getTime() - 30_000), 'just now'],
    ['59 minutes ago', new Date(NOW.getTime() - 59 * 60_000), '59 min ago'],
    ['60 minutes ago', new Date(NOW.getTime() - 60 * 60_000), '1 hr ago'],
    ['23 hours ago', new Date(NOW.getTime() - 23 * 3_600_000), '23 hr ago'],
    ['24 hours ago', new Date(NOW.getTime() - 24 * 3_600_000), '1 day ago'],
    ['72 hours ago', new Date(NOW.getTime() - 72 * 3_600_000), '3 days ago'],
  ])('%s → %s', (_label, date, expected) => {
    expect(timeAgo(date, NOW)).toBe(expected);
  });
});

describe('getHorizonStart', () => {
  test('today: start-of-day to +1d in 6 buckets', () => {
    const { start, end, count } = getHorizonStart('today', NOW);
    expect(start).toEqual(new Date(2026, 9, 18));
    expect(end).toEqual(new Date(2026, 9, 19));
    expect(count).toBe(6);
  });

  test('7d: start-of-day minus 6 days to +7d in 7 buckets', () => {
    const { start, end, count } = getHorizonStart('7d', NOW);
    expect(start).toEqual(new Date(2026, 9, 12));
    expect(end).toEqual(addDays(new Date(2026, 9, 12), 7));
    expect(count).toBe(7);
  });

  test('30d: start-of-day minus 30 days to start-of-day +1d in 10 buckets', () => {
    const { start, end, count } = getHorizonStart('30d', NOW);
    expect(start).toEqual(new Date(2026, 8, 18));
    expect(end).toEqual(new Date(2026, 9, 19));
    expect(count).toBe(10);
  });

  test('all: epoch to now in 14 buckets', () => {
    const { start, end, count } = getHorizonStart('all', NOW);
    expect(start).toEqual(new Date(0));
    expect(end).toEqual(NOW);
    expect(count).toBe(14);
  });
});

describe('createTimeBuckets', () => {
  test('a zero or negative range yields a single zeroed bucket', () => {
    for (const end of [NOW, new Date(NOW.getTime() - 1000)]) {
      const buckets = createTimeBuckets(NOW, end, 6);
      expect(buckets).toHaveLength(1);
      expect(buckets[0]).toMatchObject({ revenue: 0, cost: 0, profit: 0, units: 0 });
      expect(buckets[0].label).toBe(formatShortDate(NOW));
    }
  });

  test('count evenly-spaced contiguous buckets', () => {
    const start = new Date(2026, 9, 18);
    const end = new Date(2026, 9, 19);
    const buckets = createTimeBuckets(start, end, 6);
    expect(buckets).toHaveLength(6);
    for (let i = 0; i < buckets.length - 1; i += 1) {
      expect(buckets[i].end.getTime()).toBe(buckets[i + 1].start.getTime());
    }
    expect(buckets[0].start).toEqual(start);
    expect(buckets[5].end).toEqual(end);
  });
});

describe('getBuckets', () => {
  test('empty sales → empty array', () => {
    expect(getBuckets([], '7d', NOW)).toEqual([]);
  });

  test('today labels are hour labels and a sale lands in its bucket', () => {
    const sale = saleAt(new Date(2026, 9, 18, 13, 0), { soldPrice: 30, acquiredCost: 10 });
    const buckets = getBuckets([sale], 'today', NOW);

    expect(buckets).toHaveLength(6);
    expect(buckets.map((b) => b.label)).toEqual([
      '0:00',
      '4:00',
      '8:00',
      '12:00',
      '16:00',
      '20:00',
    ]);
    // 13:00 lands in the 12:00–16:00 bucket.
    expect(buckets[3]).toMatchObject({ revenue: 30, cost: 10, profit: 20, units: 1 });
    expect(buckets.reduce((s, b) => s + b.units, 0)).toBe(1);
  });

  test('a sale outside the horizon range is dropped', () => {
    const yesterday = saleAt(new Date(2026, 9, 17, 10, 0));
    const buckets = getBuckets([yesterday], 'today', NOW);
    expect(buckets.reduce((s, b) => s + b.units, 0)).toBe(0);
    expect(buckets.reduce((s, b) => s + b.revenue, 0)).toBe(0);
  });

  test('all: a ~3 day span clamps to 7 buckets', () => {
    const sales = [saleAt(new Date(2026, 9, 15, 10, 0)), saleAt(new Date(2026, 9, 18, 9, 0))];
    const buckets = getBuckets(sales, 'all', NOW);
    expect(buckets).toHaveLength(7);
    expect(buckets[0].start).toEqual(new Date(2026, 9, 15));
    // end = start + max(days=4, count=7) = Oct 22
    expect(buckets[6].end).toEqual(new Date(2026, 9, 22));
    expect(buckets.reduce((s, b) => s + b.units, 0)).toBe(2);
  });

  test('all: a ~30 day span clamps to 14 buckets', () => {
    const sales = [saleAt(new Date(2026, 8, 19, 10, 0)), saleAt(new Date(2026, 9, 18, 9, 0))];
    const buckets = getBuckets(sales, 'all', NOW);
    expect(buckets).toHaveLength(14);
    expect(buckets[0].start).toEqual(new Date(2026, 8, 19));
    // end = start + max(days=30, count=14) = Oct 19
    expect(buckets[13].end).toEqual(new Date(2026, 9, 19));
    expect(buckets.reduce((s, b) => s + b.units, 0)).toBe(2);
  });
});

describe('calculateMetrics', () => {
  test('empty sales → all zeros', () => {
    expect(calculateMetrics([])).toEqual({
      totalRevenue: 0,
      totalCost: 0,
      netProfit: 0,
      profitMargin: 0,
      count: 0,
      avgTicket: 0,
    });
  });

  test('two sales aggregate revenue, cost, margin and ticket', () => {
    const metrics = calculateMetrics([
      mkSale({ soldPrice: 100, acquiredCost: 60 }),
      mkSale({ id: 's2', soldPrice: 50, acquiredCost: 30 }),
    ]);
    expect(metrics).toEqual({
      totalRevenue: 150,
      totalCost: 90,
      netProfit: 60,
      profitMargin: 40,
      count: 2,
      avgTicket: 75,
    });
  });
});

describe('calculateTiers', () => {
  test('boundary prices land in the documented tiers and shares sum to 100', () => {
    const prices = [14.99, 15, 49.99, 50, 199.99, 200];
    const tiers = calculateTiers(prices.map((soldPrice, i) => mkSale({ id: `s${i}`, soldPrice })));

    const byKey = Object.fromEntries(tiers.map((t) => [t.key, t]));
    expect(byKey.budget.count).toBe(1); // 14.99
    expect(byKey.budget.revenue).toBeCloseTo(14.99);
    expect(byKey.mid.count).toBe(2); // 15 + 49.99
    expect(byKey.mid.revenue).toBeCloseTo(64.99);
    expect(byKey.high.count).toBe(2); // 50 + 199.99
    expect(byKey.high.revenue).toBeCloseTo(249.99);
    expect(byKey.grail.count).toBe(1); // 200
    expect(byKey.grail.revenue).toBeCloseTo(200);
    expect(tiers.reduce((s, t) => s + t.share, 0)).toBeCloseTo(100);
  });

  test('zero total revenue → all shares 0', () => {
    const tiers = calculateTiers([mkSale({ soldPrice: 0 })]);
    expect(tiers.every((t) => t.share === 0)).toBe(true);
  });
});

describe('filterByHorizon', () => {
  test('keeps a sale exactly at now, drops future and pre-start sales', () => {
    const start = new Date(2026, 9, 12); // 7d start for NOW
    const sales = [
      saleAt(NOW, { id: 'at-now' }),
      saleAt(new Date(NOW.getTime() + 1), { id: 'future' }),
      saleAt(new Date(start.getTime() - 1), { id: 'before-start' }),
      saleAt(new Date(2026, 9, 15, 8, 0), { id: 'inside' }),
    ];

    const res = filterByHorizon(sales, '7d', NOW);

    expect(res.map((s) => s.id)).toEqual(['at-now', 'inside']);
  });
});
