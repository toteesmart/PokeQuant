import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { ensureCatalogDownloaded, CATALOG_FILE_NAME } from '../services/CatalogDownloadService';
import { getCatalogImageUri } from '../services/CatalogImageService';

let catalogDb: SQLiteDatabase | null = null;

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

export async function openCatalogDatabase(): Promise<SQLiteDatabase> {
  if (catalogDb) {
    return catalogDb;
  }

  await ensureCatalogDownloaded();
  catalogDb = await openDatabaseAsync(CATALOG_FILE_NAME);
  return catalogDb;
}

export async function getCatalogCardCount(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM cards');
  return row?.count ?? 0;
}

function escapeLikePattern(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[''\-.]/g, '')
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
    `LOWER(REPLACE(REPLACE(REPLACE(${column}, '''', ''), '-', ''), '.', ''))`;

  return `(
    ${normalizeColumn('c.card_name')} LIKE ? ESCAPE '\\' OR
    ${normalizeColumn('c.card_number')} LIKE ? ESCAPE '\\' OR
    ${normalizeColumn('c.set_name')} LIKE ? ESCAPE '\\'
  )`;
}

function buildOrderBy(sortBy: CatalogSortBy): string | null {
  switch (sortBy) {
    case 'Name A-Z':
      return 'c.card_name COLLATE NOCASE ASC';
    case 'Newest':
      return 'c.product_id DESC';
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

  const rows = await db.getAllAsync<{
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

  const rows = await db.getAllAsync<{
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

export async function getProductMarketData(
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

export async function getCardMarketAnalytics(
  db: SQLiteDatabase,
  productId: number,
  subType: string
): Promise<CardMarketAnalytics | null> {
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
}

export async function getMarketVelocity(
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

export type SearchCatalogResult = {
  cards: CatalogCard[];
  hasMore: boolean;
  nextOffset: number;
};

export async function searchCatalogCards(
  db: SQLiteDatabase,
  filters: CatalogFilters,
  limit = 50,
  offset = 0
): Promise<SearchCatalogResult> {
  const { query, rarity, sortBy, maxPrice, productType } = filters;

  const conditions: string[] = [];
  const args: (string | number)[] = [];

  if (query.trim()) {
    conditions.push(buildSearchClause(query, args));
  }

  if (rarity && rarity !== 'All') {
    conditions.push('c.rarity = ?');
    args.push(rarity);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderBy = buildOrderBy(sortBy);
  const fetchLimit = sortBy.startsWith('Price') ? 500 : Math.max(limit * 4, 200);
  const safeOffset = Math.max(0, Number(offset) || 0);

  const orderClause = orderBy ? `ORDER BY ${orderBy}` : '';
  const sql = `
    SELECT c.product_id, c.card_name as name, c.card_number as number, c.set_name as set_name, c.rarity
    FROM cards c
    ${whereClause}
    ${orderClause}
    LIMIT ? OFFSET ?
  `;

  args.push(Number(fetchLimit), safeOffset);

  const rows = await db.getAllAsync<{
    product_id: number;
    name: string;
    number: string;
    set_name: string;
    rarity: string;
  }>(sql, ...args);

  const productIds = rows.map((row) => Number.parseInt(String(row.product_id), 10) || 0);

  const latestPrices = await getLatestSubTypePrices(db, productIds);
  const marketData = await getProductMarketData(db, productIds, {}, latestPrices);

  let cards: CatalogCard[] = rows.map((row) => {
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
    case 'Price: Low to High':
      cards.sort((a, b) => a.liveMarket - b.liveMarket);
      break;
    case 'Price: High to Low':
      cards.sort((a, b) => b.liveMarket - a.liveMarket);
      break;
    case 'Name A-Z':
      cards.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'Newest':
    default:
      cards.sort((a, b) => b.productId - a.productId);
      break;
  }

  const pageLimit = Math.max(1, Number(limit));

  // If we have consumed the entire raw result set, return every matching card
  // so the list is not truncated at the page boundary.
  if (rows.length < fetchLimit) {
    return {
      cards,
      hasMore: false,
      nextOffset: safeOffset + rows.length,
    };
  }

  if (sortBy.startsWith('Price')) {
    // Price sorting/filtering happens in JS over a broad SQL window. Advance
    // by the full window size so each page is the top window-sorted set.
    return {
      cards: cards.slice(0, pageLimit),
      hasMore: true,
      nextOffset: safeOffset + fetchLimit,
    };
  }

  // For SQL-ordered sorts we can page by the returned page size without gaps.
  const hasMoreInBuffer = cards.length > pageLimit;
  return {
    cards: cards.slice(0, pageLimit),
    hasMore: true,
    nextOffset: hasMoreInBuffer ? safeOffset + pageLimit : safeOffset + rows.length,
  };
}
