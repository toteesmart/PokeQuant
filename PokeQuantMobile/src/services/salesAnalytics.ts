// Sales analytics math — date bucketing, horizon filtering, and the
// metrics/tiers aggregations behind PerformanceAnalytics. Pure
// functions over CompletedSale rows; no UI, no stores.
import type { CompletedSale } from '../store/inventoryStore';

export type Horizon = 'today' | '7d' | '30d' | 'all';

export const HORIZON_OPTIONS: { key: Horizon; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'all', label: 'All time' },
];

export type Metrics = {
  totalRevenue: number;
  totalCost: number;
  netProfit: number;
  profitMargin: number;
  count: number;
  avgTicket: number;
};

export type Bucket = {
  label: string;
  start: Date;
  end: Date;
  revenue: number;
  cost: number;
  profit: number;
  units: number;
};

export type TierDef = {
  key: string;
  label: string;
  min?: number;
  max?: number;
};

export type Tier = TierDef & {
  revenue: number;
  count: number;
  share: number;
};

export function parseSaleDate(dateString: string): Date {
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return new Date();
  return d;
}

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, days: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + days);
  return result;
}

export function formatShortDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function formatHourLabel(d: Date): string {
  const h = d.getHours();
  return `${h}:00`;
}

export function timeAgo(date: Date, now: Date): string {
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return 'just now';
  const minutes = Math.floor(diffMs / (60 * 1000));
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (hours < 24) return `${hours} hr ago`;
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

export function getHorizonStart(
  horizon: Horizon,
  now: Date
): { start: Date; end: Date; count: number } {
  switch (horizon) {
    case 'today': {
      const start = startOfDay(now);
      return { start, end: addDays(start, 1), count: 6 };
    }
    case '7d': {
      const start = addDays(startOfDay(now), -6);
      return { start, end: addDays(start, 7), count: 7 };
    }
    case '30d': {
      const start = addDays(startOfDay(now), -30);
      const end = addDays(startOfDay(now), 1);
      return { start, end, count: 10 };
    }
    case 'all':
    default: {
      return { start: new Date(0), end: now, count: 14 };
    }
  }
}

export function createTimeBuckets(start: Date, end: Date, count: number): Bucket[] {
  const rangeMs = end.getTime() - start.getTime();
  if (rangeMs <= 0) {
    return [
      {
        label: formatShortDate(start),
        start,
        end,
        revenue: 0,
        cost: 0,
        profit: 0,
        units: 0,
      },
    ];
  }
  const buckets: Bucket[] = [];
  for (let i = 0; i < count; i++) {
    const bStart = new Date(start.getTime() + (rangeMs * i) / count);
    const bEnd = new Date(start.getTime() + (rangeMs * (i + 1)) / count);
    buckets.push({
      label: formatShortDate(bStart),
      start: bStart,
      end: bEnd,
      revenue: 0,
      cost: 0,
      profit: 0,
      units: 0,
    });
  }
  return buckets;
}

export function getBuckets(
  sales: CompletedSale[],
  horizon: Horizon,
  now: Date
): Bucket[] {
  if (sales.length === 0) return [];
  let { start, end, count } = getHorizonStart(horizon, now);

  if (horizon === 'all') {
    const minTime = Math.min(
      ...sales.map((s) => parseSaleDate(s.dateSold).getTime())
    );
    start = startOfDay(new Date(minTime));
    const days = Math.max(
      1,
      Math.ceil((now.getTime() - start.getTime()) / MS_PER_DAY)
    );
    count = Math.min(14, Math.max(7, days));
    end = addDays(start, Math.max(days, count));
  }

  const buckets = createTimeBuckets(start, end, count);

  if (horizon === 'today') {
    buckets.forEach((b) => {
      b.label = formatHourLabel(b.start);
    });
  }

  sales.forEach((sale) => {
    const d = parseSaleDate(sale.dateSold);
    const bucket = buckets.find((b) => d >= b.start && d < b.end);
    if (bucket) {
      bucket.revenue += sale.soldPrice;
      bucket.cost += sale.acquiredCost;
      bucket.units += 1;
    }
  });

  buckets.forEach((b) => {
    b.profit = b.revenue - b.cost;
  });

  return buckets;
}

export function calculateMetrics(sales: CompletedSale[]): Metrics {
  const totalRevenue = sales.reduce((sum, s) => sum + s.soldPrice, 0);
  const totalCost = sales.reduce((sum, s) => sum + s.acquiredCost, 0);
  const netProfit = totalRevenue - totalCost;
  const profitMargin =
    totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
  const count = sales.length;
  const avgTicket = count > 0 ? totalRevenue / count : 0;
  return {
    totalRevenue,
    totalCost,
    netProfit,
    profitMargin,
    count,
    avgTicket,
  };
}

export function calculateTiers(sales: CompletedSale[]): Tier[] {
  const totalRevenue = sales.reduce((sum, s) => sum + s.soldPrice, 0);
  const defs: TierDef[] = [
    { key: 'budget', label: 'Budget / Singles (< $15)', max: 15 },
    { key: 'mid', label: 'Mid-Tier ($15 – $50)', min: 15, max: 50 },
    { key: 'high', label: 'High-End ($50 – $200)', min: 50, max: 200 },
    { key: 'grail', label: 'Grails / Slab ($200+)', min: 200 },
  ];
  return defs.map((d) => {
    const filtered = sales.filter((s) => {
      if (d.max == null) return s.soldPrice >= (d.min ?? 0);
      if (d.min == null) return s.soldPrice < d.max;
      return s.soldPrice >= d.min && s.soldPrice < d.max;
    });
    const revenue = filtered.reduce((sum, s) => sum + s.soldPrice, 0);
    return {
      ...d,
      revenue,
      count: filtered.length,
      share: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0,
    };
  });
}

export function filterByHorizon(
  sales: CompletedSale[],
  horizon: Horizon,
  now: Date
): CompletedSale[] {
  const { start } = getHorizonStart(horizon, now);
  return sales.filter((s) => {
    const d = parseSaleDate(s.dateSold);
    return d.getTime() >= start.getTime() && d.getTime() <= now.getTime();
  });
}

