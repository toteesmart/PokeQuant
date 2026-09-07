import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import { drizzle, type ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { ensureCatalogDownloaded, CATALOG_FILE_NAME } from '../services/CatalogDownloadService';
import { getCatalogImageUri } from '../services/CatalogImageService';
import { useProgressStore } from '../store/progressStore';

let sqliteDb: SQLiteDatabase | null = null;
let db: ExpoSQLiteDatabase | null = null;
let catalogOpenPromise: Promise<SQLiteDatabase> | null = null;

function withCatalogGuard<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  fallback: Awaited<ReturnType<T>>
): T {
  return (async (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
    try {
      if (!db || !sqliteDb) return fallback;
      return await fn(...args);
    } catch (err) {
      console.error(`Catalog query ${fn.name} failed:`, err);
      return fallback;
    }
  }) as T;
}

export type CatalogVariant = {
  subType: string;
  marketPrice: number;
};

export type CatalogCard = {
  id: string;
  name: string;
  number: string;
  set: string;
  rarity: string;
  productType: string;
  liveMarket: number;
  velocity1d: number;
  velocity3d: number;
  velocity7d: number;
  velocity30d: number;
  range90dHigh: number;
  range90dLow: number;
  productId: number;
  imageUrl: string;
  variants: CatalogVariant[];
};

export type CatalogSortBy =
  | 'Newest'
  | 'Price: Low to High'
  | 'Price: High to Low'
  | 'Name A-Z';

export type CatalogFilters = {
  query: string;
  rarity: string;
  sortBy: CatalogSortBy;
  maxPrice?: number;
  productType?: string;
};

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

export function isCatalogDatabaseOpen(): boolean {
  return sqliteDb != null;
}

export function setCatalogDatabase(rawDb: SQLiteDatabase): void {
  sqliteDb = rawDb;
  db = drizzle(rawDb);
  cardMarketAnalyticsCache.clear();
  useProgressStore.getState().setCatalogReady(true);
}

export async function closeCatalogDatabase(): Promise<void> {
  if (!sqliteDb) return;

  try {
    await sqliteDb.closeAsync();
  } catch (err) {
    console.warn('Failed to close catalog database:', err);
  }

  sqliteDb = null;
  db = null;
  useProgressStore.getState().setCatalogReady(false);
}

const CATALOG_REQUIRED_TABLES = ['cards', 'price_history'];

async function validateCatalogTables(rawDb: SQLiteDatabase): Promise<boolean> {
  try {
    const rows = await rawDb.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${CATALOG_REQUIRED_TABLES.map(() => '?').join(',')})`,
      ...CATALOG_REQUIRED_TABLES
    );
    const names = new Set(rows.map((r) => r.name));
    return CATALOG_REQUIRED_TABLES.every((t) => names.has(t));
  } catch {
    return false;
  }
}

function trackCatalogOpen(
  run: () => Promise<SQLiteDatabase>
): Promise<SQLiteDatabase> {
  const tracked = run().finally(() => {
    if (catalogOpenPromise === tracked) {
      catalogOpenPromise = null;
    }
  });
  catalogOpenPromise = tracked;
  return tracked;
}

export async function openCatalogDatabase(): Promise<SQLiteDatabase> {
  if (sqliteDb) {
    return sqliteDb;
  }
  if (catalogOpenPromise) {
    return catalogOpenPromise;
  }

  return trackCatalogOpen(async () => {
    let rawDb: SQLiteDatabase | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      await ensureCatalogDownloaded(attempt > 0);
      rawDb = openDatabaseSync(CATALOG_FILE_NAME);

      if (await validateCatalogTables(rawDb)) {
        break;
      }

      if (attempt === 0) {
        console.warn('Catalog database is missing required tables; re-downloading...');
        try {
          await rawDb.closeAsync();
        } catch (err) {
          console.warn('Failed to close invalid catalog handle:', err);
        }
        rawDb = null;
      } else {
        try {
          await rawDb.closeAsync();
        } catch (err) {
          console.warn('Failed to close invalid catalog handle:', err);
        }
        throw new Error('Catalog database missing required tables after re-download');
      }
    }

    if (!rawDb) {
      throw new Error('Catalog database could not be opened');
    }

    sqliteDb = rawDb;
    db = drizzle(sqliteDb);
    useProgressStore.getState().setCatalogReady(true);
    return sqliteDb;
  });
}

async function _getCatalogCardCount(db: SQLiteDatabase): Promise<number> {
  const row = await sqliteDb!.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM cards');
  return row?.count ?? 0;
}

export const getCatalogCardCount = withCatalogGuard(_getCatalogCardCount, 0);

function escapeLikePattern(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’\-.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSearchClause(query: string, args: (string | number)[]): string {
  const normalized = normalizeSearch(query);
  if (!normalized) {
    return '1 = 1';
  }

  const pattern = `%${escapeLikePattern(normalized)}%`;
  args.push(pattern, pattern, pattern);

  const normalizeColumn = (column: string) =>
    `LOWER(REPLACE(REPLACE(REPLACE(REPLACE(${column}, '''', ''), '’', ''), '-', ''), '.', ''))`;

  return `(
    ${normalizeColumn('c.card_name')} LIKE ? ESCAPE '\\' OR
    ${normalizeColumn('c.card_number')} LIKE ? ESCAPE '\\' OR
    ${normalizeColumn('c.set_name')} LIKE ? ESCAPE '\\'
  )`;
}

function buildLivePriceExpression(productIdColumn: string = 'c.product_id'): string {
  // The sort key must match the price resolveVariantPrice() displays for the
  // default variant: the 'normal' canonical bucket first, then 'holofoil',
  // then the lowest positive latest-per-bucket price, then the most recent
  // row when nothing is positive. sub_type is normalized (lowercase,
  // punctuation -> space, whitespace collapsed) and then canonicalized with
  // the same word-level aliases as normalizeSubType() so raw subtypes that
  // share a canonical bucket (e.g. 'Reverse Holo' / 'Reverse Holofoil')
  // collapse into one group instead of competing as separate rows.
  const norm = (column: string) =>
    `TRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(${column}), '-', ' '), '.', ' '), '''', ' '), '/', ' '), '  ', ' '), '  ', ' '))`;
  // Space padding makes each REPLACE word-boundary safe (' holo ' never
  // matches the 'holo' inside 'holofoil'), mirroring the \b aliases in
  // normalizeSubType().
  const canon = (column: string) =>
    `TRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(' ' || ${norm(column)} || ' ', ' 1st ed ', ' 1st edition '), ' first edition ', ' 1st edition '), ' holo ', ' holofoil '), ' rev ', ' reverse '), ' regular ', ' normal '), ' common ', ' normal '), ' uncommon ', ' normal '))`;
  const isNormal = `${canon('p.sub_type')} = 'normal'`;
  const isHolo = `${canon('p.sub_type')} = 'holofoil'`;
  const isOther = `NOT (${isNormal} OR ${isHolo})`;
  const price = 'CAST(p.market_price AS REAL)';
  return `
    COALESCE((
      SELECT ${price}
      FROM (
        SELECT ${canon('sub_type')} AS canon, MAX(date) AS max_date
        FROM price_history
        WHERE product_id = ${productIdColumn}
        GROUP BY canon
      ) grouped
      JOIN price_history p
        ON p.product_id = ${productIdColumn}
        AND ${canon('p.sub_type')} = grouped.canon
        AND p.date = grouped.max_date
      ORDER BY
        CASE WHEN ${isNormal} THEN 0 WHEN ${isHolo} THEN 1 ELSE 2 END,
        CASE WHEN ${isOther} AND ${price} > 0 THEN 0 ELSE 1 END,
        CASE WHEN ${isOther} THEN ${price} END,
        p.date DESC
      LIMIT 1
    ), 0)
  `.replace(/\s+/g, ' ').trim();
}

function buildOrderBy(sortBy: CatalogSortBy): string | null {
  switch (sortBy) {
    case 'Name A-Z':
      return 'c.card_name COLLATE NOCASE ASC, c.product_id ASC';
    case 'Newest':
      return 'c.product_id DESC';
    case 'Price: Low to High': {
      // Cards with no resolvable price (0) sort last, not first.
      const expr = buildLivePriceExpression();
      return `((${expr}) = 0) ASC, ${expr} ASC, c.product_id ASC`;
    }
    case 'Price: High to Low':
      return `${buildLivePriceExpression()} DESC, c.product_id ASC`;
    default:
      return null;
  }
}

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

function normalizeSubType(subType: string): string {
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

type SubTypePrice = { marketPrice: number; date: string };

function resolveVariantPrice(
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

async function getLatestSubTypePrices(
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

async function getVariantHistories(
  db: SQLiteDatabase,
  productSubTypes: Array<{ productId: number; subType: string }>
): Promise<Record<number, Array<{ date: string; marketPrice: number }>>> {
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

  const result: Record<number, Array<{ date: string; marketPrice: number }>> = {};
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
  history: Array<{ date: string; marketPrice: number }>,
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
  const pairs: Array<{ productId: number; subType: string }> = [];

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

async function _searchCatalogCardsByNames(
  db: SQLiteDatabase,
  names: string[]
): Promise<CatalogCard[]> {
  const normalizedNames = [...new Set(names.map(normalizeSearch).filter(Boolean))];
  if (normalizedNames.length === 0) return [];

  const normalizedNameColumn = `LOWER(REPLACE(REPLACE(REPLACE(REPLACE(c.card_name, '''', ''), '’', ''), '-', ''), '.', ''))`;
  const placeholders = normalizedNames.map(() => '?').join(',');
  const sql = `
    SELECT c.product_id, c.card_name as name, c.card_number as number, c.set_name as set_name, c.rarity
    FROM cards c
    WHERE ${normalizedNameColumn} IN (${placeholders})
  `;

  const rows = await db.getAllAsync<{
    product_id: number;
    name: string;
    number: string;
    set_name: string;
    rarity: string;
  }>(sql, ...normalizedNames);

  const productIds = rows.map((row) => Number.parseInt(String(row.product_id), 10) || 0);
  const latestPrices = await getLatestSubTypePrices(db, productIds);
  const marketData = await getProductMarketData(db, productIds, {}, latestPrices);

  const cards: CatalogCard[] = rows.map((row) => {
    const productId = Number.parseInt(String(row.product_id), 10) || 0;
    const marketDataForProduct = marketData[productId];
    const liveMarket = marketDataForProduct?.marketPrice ?? 0;
    const imageUrl = getCatalogImageUri(productId) ?? '';

    const subTypePrices = latestPrices[productId] ?? {};
    const variants: CatalogVariant[] = Object.entries(subTypePrices)
      .map(([subType, data]) => ({ subType, marketPrice: data.marketPrice }))
      .sort((a, b) => a.subType.localeCompare(b.subType));

    const velocity = (past: number): number => {
      if (past === 0 || liveMarket === 0 || past === liveMarket) return 0;
      return Number((((liveMarket - past) / past) * 100).toFixed(2));
    };

    const productType = marketDataForProduct?.matchedSubType ?? variants[0]?.subType ?? '';

    return {
      id: `${productId}-${productType || 'normal'}`,
      name: row.name,
      number: row.number,
      set: row.set_name,
      rarity: row.rarity,
      productType,
      liveMarket,
      velocity1d: velocity(marketDataForProduct?.price1d ?? liveMarket),
      velocity3d: velocity(marketDataForProduct?.price3d ?? liveMarket),
      velocity7d: velocity(marketDataForProduct?.price7d ?? liveMarket),
      velocity30d: velocity(marketDataForProduct?.price30d ?? liveMarket),
      range90dHigh: marketDataForProduct?.range90dHigh ?? liveMarket,
      range90dLow: marketDataForProduct?.range90dLow ?? liveMarket,
      productId,
      imageUrl,
      variants,
    };
  });

  return cards;
}

export const searchCatalogCardsByNames = withCatalogGuard(_searchCatalogCardsByNames, []);

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

export type SearchCatalogResult = {
  cards: CatalogCard[];
  hasMore: boolean;
  nextOffset: number;
};

async function _searchCatalogCards(
  db: SQLiteDatabase,
  filters: CatalogFilters,
  limit = 50,
  offset = 0
): Promise<SearchCatalogResult> {
  const { query, rarity, sortBy, maxPrice, productType } = filters;

  const isPriceSort = sortBy.startsWith('Price');
  const safeOffset = Math.max(0, Number(offset) || 0);

  if (isPriceSort && productType?.toLowerCase() === 'sealed only') {
    return { cards: [], hasMore: false, nextOffset: safeOffset };
  }

  const conditions: string[] = [];
  const args: (string | number)[] = [];

  if (query.trim()) {
    conditions.push(buildSearchClause(query, args));
  }

  if (rarity && rarity !== 'All') {
    conditions.push('c.rarity = ?');
    args.push(rarity);
  }

  if (isPriceSort && maxPrice !== undefined && !Number.isNaN(maxPrice)) {
    conditions.push(`(${buildLivePriceExpression()}) <= ?`);
    args.push(maxPrice);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderBy = buildOrderBy(sortBy);
  const fetchLimit = isPriceSort ? Math.max(limit, 1) : Math.max(limit * 4, 200);

  const livePriceSelect = isPriceSort ? `, (${buildLivePriceExpression()}) AS live_market` : '';
  const orderClause = orderBy ? `ORDER BY ${orderBy}` : '';
  const sql = `
    SELECT c.product_id, c.card_name as name, c.card_number as number, c.set_name as set_name, c.rarity${livePriceSelect}
    FROM cards c
    ${whereClause}
    ${orderClause}
    LIMIT ? OFFSET ?
  `;

  // Fetch one lookahead row beyond fetchLimit so `hasMore` reflects whether the
  // database actually has more rows — without it the list issues a wasted fetch
  // whenever the result set ends exactly on the fetch boundary.
  args.push(Number(fetchLimit) + 1, safeOffset);

  const rows = await sqliteDb!.getAllAsync<{
    product_id: number;
    name: string;
    number: string;
    set_name: string;
    rarity: string;
    live_market?: number;
  }>(sql, ...args);

  const hasMoreRows = rows.length > fetchLimit;
  const pageRows = hasMoreRows ? rows.slice(0, fetchLimit) : rows;

  const productIds = pageRows.map((row) => Number.parseInt(String(row.product_id), 10) || 0);

  const latestPrices = await getLatestSubTypePrices(db, productIds);
  const marketData = await getProductMarketData(db, productIds, {}, latestPrices);

  let cards: CatalogCard[] = pageRows.map((row) => {
    const productId = Number.parseInt(String(row.product_id), 10) || 0;
    const marketDataForProduct = marketData[productId];
    const liveMarket = isPriceSort
      ? Number(row.live_market) || 0
      : marketDataForProduct?.marketPrice ?? 0;
    const imageUrl = getCatalogImageUri(productId) ?? '';

    const subTypePrices = latestPrices[productId] ?? {};
    const variants: CatalogVariant[] = Object.entries(subTypePrices)
      .map(([subType, data]) => ({ subType, marketPrice: data.marketPrice }))
      .sort((a, b) => a.subType.localeCompare(b.subType));

    const velocity = (past: number): number => {
      if (past === 0 || liveMarket === 0 || past === liveMarket) return 0;
      return Number((((liveMarket - past) / past) * 100).toFixed(2));
    };

    const productType = marketDataForProduct?.matchedSubType ?? variants[0]?.subType ?? '';

    return {
      id: `${productId}-${productType || 'normal'}`,
      name: row.name,
      number: row.number,
      set: row.set_name,
      rarity: row.rarity,
      productType,
      liveMarket,
      velocity1d: velocity(marketDataForProduct?.price1d ?? liveMarket),
      velocity3d: velocity(marketDataForProduct?.price3d ?? liveMarket),
      velocity7d: velocity(marketDataForProduct?.price7d ?? liveMarket),
      velocity30d: velocity(marketDataForProduct?.price30d ?? liveMarket),
      range90dHigh: marketDataForProduct?.range90dHigh ?? liveMarket,
      range90dLow: marketDataForProduct?.range90dLow ?? liveMarket,
      productId,
      imageUrl,
      variants,
    };
  });

  if (productType && productType !== 'All') {
    const normalized = productType.toLowerCase();
    if (normalized === 'sealed only') {
      cards = [];
    } else if (normalized !== 'cards only') {
      cards = cards.filter((c) =>
        c.variants.some((v) => normalizeSubType(v.subType).includes(normalized))
      );
    }
  }

  if (maxPrice !== undefined && !Number.isNaN(maxPrice)) {
    cards = cards.filter((c) => c.liveMarket <= Number(maxPrice));
  }

  switch (sortBy) {
    case 'Name A-Z':
      cards.sort((a, b) => a.name.localeCompare(b.name) || a.productId - b.productId);
      break;
    case 'Price: Low to High':
    case 'Price: High to Low':
      // Price order comes from the SQL ORDER BY (live_market); re-sorting
      // here would scramble it.
      break;
    case 'Newest':
    default:
      cards.sort((a, b) => b.productId - a.productId);
      break;
  }

  const pageLimit = Math.max(1, Number(limit));

  // Without the lookahead row the raw result set is exhausted; return every
  // matching card so the list is not truncated at the page boundary.
  if (!hasMoreRows) {
    return {
      cards,
      hasMore: false,
      nextOffset: safeOffset + pageRows.length,
    };
  }

  // For SQL-ordered sorts we can page by the returned page size without gaps.
  // When post-filters leave fewer than a full page of cards, the buffer was
  // consumed whole and the next page must continue past it.
  const hasMoreInBuffer = cards.length >= pageLimit;
  return {
    cards: cards.slice(0, pageLimit),
    hasMore: true,
    nextOffset: hasMoreInBuffer ? safeOffset + pageLimit : safeOffset + pageRows.length,
  };
}

export const searchCatalogCards = withCatalogGuard(
  _searchCatalogCards,
  { cards: [], hasMore: false, nextOffset: 0 }
);
