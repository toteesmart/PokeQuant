// catalogPrices — price-history reads: variant resolution, latest
// sub-type prices, per-card series, market data + velocity windows,
// and the per-card analytics cache. Optional/deep tables degrade via
// the session guard; nothing here re-downloads.
import type { SQLiteDatabase } from 'expo-sqlite';
import { catalogHasTable, sqliteDb, withCatalogGuard } from './catalogSession';


export type MarketMover = {
  name: string;
  number: string;
  set: string;
  rarity: string;
  condition: string;
  oldPrice: number;
  newPrice: number;
};

export type MarketVelocity = {
  label: string;
  change: number;
  movers: MarketMover[];
};

export type ProductVelocity = {
  delta1d: number;
  delta3d: number;
  delta7d: number;
};

export type MarketVelocityMap = Record<number, ProductVelocity>;

export type ProductMarketData = {
  marketPrice: number;
  matchedSubType: string;
  date: string;
  price1d: number;
  price3d: number;
  price7d: number;
  price30d: number;
  range90dHigh: number;
  range90dLow: number;
};

export type ProductMarketMap = Record<number, ProductMarketData>;

export type CardMarketAnalytics = {
  productId: number;
  subType: string;
  marketPrice: number;
  delta1d: number;
  delta1dPct: number;
  delta3d: number;
  delta3dPct: number;
  delta7d: number;
  delta7dPct: number;
  delta30d: number;
  delta30dPct: number;
  high90d: number;
  low90d: number;
};

const cardMarketAnalyticsCache = new Map<string, Promise<CardMarketAnalytics | null>>();

export function clearCardMarketAnalyticsCache(): void {
  cardMarketAnalyticsCache.clear();
}


export type PricePoint = { date: string; marketPrice: number };


const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function parseSqlDate(date: string): number {
  if (!date) return 0;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) {
    const parts = date.split('-').map((p) => Number.parseInt(p, 10));
    if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
      return new Date(parts[0], parts[1] - 1, parts[2]).getTime();
    }
    return 0;
  }
  return d.getTime();
}

export function normalizeSubType(subType: string): string {
  let text = subType
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  text = text
    .replace(/\b1st ed\b/g, '1st edition')
    .replace(/\bfirst edition\b/g, '1st edition')
    .replace(/\b1st edition\b/g, '1st edition');

  text = text
    .replace(/\bholo\b/g, 'holofoil')
    .replace(/\brev\b/g, 'reverse')
    .replace(/\bnormal\b/g, 'normal')
    .replace(/\bregular\b/g, 'normal')
    .replace(/\bcommon\b/g, 'normal')
    .replace(/\buncommon\b/g, 'normal');

  return text.trim();
}

export type SubTypePrice = { marketPrice: number; date: string };

export function resolveVariantPrice(
  subTypePrices: Record<string, SubTypePrice>,
  requestedVariant?: string | null
): { marketPrice: number; matchedSubType: string; date: string } {
  if (Object.keys(subTypePrices).length === 0) {
    return { marketPrice: 0, matchedSubType: '', date: '' };
  }

  const byCanonical: Record<string, SubTypePrice & { matchedSubType: string }> = {};
  for (const [subType, data] of Object.entries(subTypePrices)) {
    const canonical = normalizeSubType(subType);
    if (!byCanonical[canonical] || parseSqlDate(data.date) > parseSqlDate(byCanonical[canonical].date)) {
      byCanonical[canonical] = { ...data, matchedSubType: subType };
    }
  }

  const requestedCanonical = normalizeSubType(requestedVariant ?? 'Normal');
  const candidates = [requestedCanonical];
  if (requestedCanonical !== 'normal') {
    candidates.push('normal');
  }
  candidates.push('holofoil');

  if (requestedCanonical.startsWith('1st edition')) {
    const base = requestedCanonical.replace(/\s+holofoil$/, '').replace(/\s+normal$/, '').trim();
    if (base && base !== '1st edition') {
      candidates.push(base);
    }
    candidates.push('1st edition');
  }

  for (const candidate of candidates) {
    if (byCanonical[candidate]) {
      const match = byCanonical[candidate];
      return {
        marketPrice: match.marketPrice,
        matchedSubType: match.matchedSubType,
        date: match.date,
      };
    }
  }

  let lowest: (SubTypePrice & { matchedSubType: string }) | null = null;
  for (const data of Object.values(byCanonical)) {
    if (data.marketPrice > 0 && (lowest == null || data.marketPrice < lowest.marketPrice)) {
      lowest = data;
    }
  }

  if (lowest) {
    return {
      marketPrice: lowest.marketPrice,
      matchedSubType: lowest.matchedSubType,
      date: lowest.date,
    };
  }

  const first = Object.values(byCanonical)[0];
  return {
    marketPrice: first.marketPrice,
    matchedSubType: first.matchedSubType,
    date: first.date,
  };
}

export async function getLatestSubTypePrices(
  db: SQLiteDatabase,
  productIds: number[]
): Promise<Record<number, Record<string, SubTypePrice>>> {
  if (productIds.length === 0) return {};

  const placeholders = productIds.map(() => '?').join(',');
  const sql = `
    WITH latest AS (
      SELECT product_id, sub_type, MAX(date) as max_date
      FROM price_history
      WHERE product_id IN (${placeholders})
      GROUP BY product_id, sub_type
    )
    SELECT p.product_id, p.sub_type, p.market_price, p.date
    FROM price_history p
    JOIN latest l ON p.product_id = l.product_id AND p.sub_type = l.sub_type AND p.date = l.max_date
  `;

  const rows = await sqliteDb!.getAllAsync<{
    product_id: number;
    sub_type: string;
    market_price: number;
    date: string;
  }>(sql, ...productIds);

  const result: Record<number, Record<string, SubTypePrice>> = {};
  for (const row of rows) {
    const productId = Number.parseInt(String(row.product_id), 10) || 0;
    if (!result[productId]) result[productId] = {};
    result[productId][row.sub_type] = {
      marketPrice: Number(row.market_price) || 0,
      date: row.date,
    };
  }
  return result;
}

// Guarded export for the scanner's lazy per-candidate price hydration — the
// unguarded caller is the internal bulk paths above.
export const getLatestSubTypePricesForProducts = withCatalogGuard(
  getLatestSubTypePrices,
  {}
);


function yyyymmddToIso(n: number): string {
  const s = String(n);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

async function _getPriceSeries(
  db: SQLiteDatabase,
  productId: number,
  subType: string
): Promise<PricePoint[]> {
  if (!(await catalogHasTable('price_series'))) return [];
  const row = await sqliteDb!.getFirstAsync<{ series: string }>(
    'SELECT series FROM price_series WHERE product_id = ? AND sub_type = ?',
    Number.parseInt(String(productId), 10) || 0,
    subType
  );
  if (!row?.series) return [];
  try {
    const packed = JSON.parse(row.series) as [number, number][];
    return packed.map(([d, p]) => ({
      date: yyyymmddToIso(d),
      marketPrice: p,
    }));
  } catch {
    return [];
  }
}

export const getPriceSeries = withCatalogGuard(_getPriceSeries, []);



/** Bulk series fetch for the stock-health deep pass — one chunked IN
 *  query instead of N per-card selects. Returns the same finish-keyed
 *  shape as signalMap so callers reuse pickSignalForFinish-style
 *  resolution (finish → Normal → first available). */
async function _getPriceSeriesBulk(
  db: SQLiteDatabase,
  productIds: number[]
): Promise<Record<number, Record<string, PricePoint[]>>> {
  if (!(await catalogHasTable('price_series')) || productIds.length === 0) {
    return {};
  }
  const out: Record<number, Record<string, PricePoint[]>> = {};
  for (let i = 0; i < productIds.length; i += 300) {
    const chunk = productIds.slice(i, i + 300);
    const marks = chunk.map(() => '?').join(',');
    const rows = await sqliteDb!.getAllAsync<{
      product_id: number;
      sub_type: string;
      series: string;
    }>(
      `SELECT product_id, sub_type, series FROM price_series WHERE product_id IN (${marks})`,
      ...chunk
    );
    for (const row of rows) {
      try {
        const packed = JSON.parse(row.series) as [number, number][];
        const pid = Number.parseInt(String(row.product_id), 10) || 0;
        (out[pid] ??= {})[row.sub_type] = packed.map(([d, p]) => ({
          date: yyyymmddToIso(d),
          marketPrice: p,
        }));
      } catch {
        // malformed series row — skip it, the scalar read still stands
      }
    }
  }
  return out;
}

export const getPriceSeriesBulk = withCatalogGuard(_getPriceSeriesBulk, {});



async function getVariantHistories(
  db: SQLiteDatabase,
  productSubTypes: { productId: number; subType: string }[]
): Promise<Record<number, { date: string; marketPrice: number }[]>> {
  if (productSubTypes.length === 0) return {};

  const whereClauses: string[] = [];
  const args: (string | number)[] = [];
  for (const { productId, subType } of productSubTypes) {
    whereClauses.push('(product_id = ? AND sub_type = ?)');
    args.push(Number.parseInt(String(productId), 10) || 0, subType);
  }

  const sql = `
    SELECT product_id, sub_type, date, market_price
    FROM price_history
    WHERE ${whereClauses.join(' OR ')}
    ORDER BY product_id, sub_type, date DESC
  `;

  const rows = await sqliteDb!.getAllAsync<{
    product_id: number;
    sub_type: string;
    date: string;
    market_price: number;
  }>(sql, ...args);

  const result: Record<number, { date: string; marketPrice: number }[]> = {};
  for (const row of rows) {
    const productId = Number.parseInt(String(row.product_id), 10) || 0;
    if (!result[productId]) result[productId] = [];
    result[productId].push({
      date: row.date,
      marketPrice: Number(row.market_price) || 0,
    });
  }
  return result;
}

function findPriceForDate(
  history: { date: string; marketPrice: number }[],
  targetTime: number
): number | null {
  for (const row of history) {
    if (parseSqlDate(row.date) <= targetTime) {
      return row.marketPrice;
    }
  }
  return null;
}

async function _getProductMarketData(
  db: SQLiteDatabase,
  productIds: number[],
  variantMap?: Record<number, string | null | undefined>,
  latestSubTypePrices?: Record<number, Record<string, SubTypePrice>>
): Promise<ProductMarketMap> {
  if (productIds.length === 0) return {};

  const latestPrices = latestSubTypePrices ?? await getLatestSubTypePrices(db, productIds);
  const resolved: ProductMarketMap = {};
  const pairs: { productId: number; subType: string }[] = [];

  for (const productId of productIds) {
    const subTypePrices = latestPrices[productId];
    if (!subTypePrices) continue;
    const variant = variantMap?.[productId] ?? 'Normal';
    const { marketPrice, matchedSubType, date } = resolveVariantPrice(subTypePrices, variant);
    if (marketPrice > 0) {
      resolved[productId] = {
        marketPrice,
        matchedSubType,
        date,
        price1d: marketPrice,
        price3d: marketPrice,
        price7d: marketPrice,
        price30d: marketPrice,
        range90dHigh: marketPrice,
        range90dLow: marketPrice,
      };
      pairs.push({ productId, subType: matchedSubType });
    }
  }

  if (pairs.length === 0) return resolved;

  const histories = await getVariantHistories(db, pairs);

  for (const productId of Object.keys(resolved).map((k) => Number(k))) {
    const data = resolved[productId];
    const history = histories[productId] ?? [];
    if (history.length === 0) continue;

    const liveTime = parseSqlDate(data.date);
    if (liveTime === 0) continue;

    const price1d = findPriceForDate(history, liveTime - 1 * ONE_DAY_MS) ?? data.marketPrice;
    const price3d = findPriceForDate(history, liveTime - 3 * ONE_DAY_MS) ?? data.marketPrice;
    const price7d = findPriceForDate(history, liveTime - 7 * ONE_DAY_MS) ?? data.marketPrice;
    const price30d = findPriceForDate(history, liveTime - 30 * ONE_DAY_MS) ?? data.marketPrice;

    let high = data.marketPrice;
    let low = data.marketPrice;
    const cutoff = liveTime - 90 * ONE_DAY_MS;
    for (const row of history) {
      const t = parseSqlDate(row.date);
      if (t >= cutoff && t <= liveTime && row.marketPrice > 0) {
        high = Math.max(high, row.marketPrice);
        low = Math.min(low, row.marketPrice);
      }
    }

    resolved[productId] = {
      ...data,
      price1d,
      price3d,
      price7d,
      price30d,
      range90dHigh: high,
      range90dLow: low,
    };
  }

  return resolved;
}

export const getProductMarketData = withCatalogGuard(_getProductMarketData, {});


async function _getCardMarketAnalytics(
  db: SQLiteDatabase,
  productId: number,
  subType: string
): Promise<CardMarketAnalytics | null> {
  const key = `${productId}:${subType}`;
  const cached = cardMarketAnalyticsCache.get(key);
  if (cached) return cached;

  const promise = (async (): Promise<CardMarketAnalytics | null> => {
    const map = await getProductMarketData(db, [productId], { [productId]: subType });
    const data = map[productId];
    if (!data) return null;

    const calc = (latest: number, past: number) => {
      const delta = Number((latest - past).toFixed(2));
      const pct = past > 0 ? Number(((delta / past) * 100).toFixed(2)) : 0;
      return { delta, pct };
    };

    const d1 = calc(data.marketPrice, data.price1d);
    const d3 = calc(data.marketPrice, data.price3d);
    const d7 = calc(data.marketPrice, data.price7d);
    const d30 = calc(data.marketPrice, data.price30d);

    return {
      productId,
      subType: data.matchedSubType || subType,
      marketPrice: data.marketPrice,
      delta1d: d1.delta,
      delta1dPct: d1.pct,
      delta3d: d3.delta,
      delta3dPct: d3.pct,
      delta7d: d7.delta,
      delta7dPct: d7.pct,
      delta30d: d30.delta,
      delta30dPct: d30.pct,
      high90d: data.range90dHigh,
      low90d: data.range90dLow,
    };
  })();

  cardMarketAnalyticsCache.set(key, promise);
  try {
    return await promise;
  } catch (err) {
    cardMarketAnalyticsCache.delete(key);
    throw err;
  }
}

export const getCardMarketAnalytics = withCatalogGuard(_getCardMarketAnalytics, null);

async function _getMarketVelocity(
  db: SQLiteDatabase,
  productIds: number[],
  variantMap?: Record<number, string | null | undefined>
): Promise<MarketVelocityMap> {
  const data = await getProductMarketData(db, productIds, variantMap);
  const result: MarketVelocityMap = {};
  for (const [productIdStr, productData] of Object.entries(data)) {
    const productId = Number(productIdStr);
    result[productId] = {
      delta1d: productData.marketPrice - productData.price1d,
      delta3d: productData.marketPrice - productData.price3d,
      delta7d: productData.marketPrice - productData.price7d,
    };
  }
  return result;
}

export const getMarketVelocity = withCatalogGuard(_getMarketVelocity, {});
