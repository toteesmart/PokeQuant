// catalogDb — catalog-search core + the facade every consumer imports
// from. Lifecycle lives in catalogSession, price reads in
// catalogPrices, quant-engine reads in catalogSignals; this file keeps
// the card-search query builders and re-exports the rest so existing
// call sites stay put.
import { type SQLiteDatabase } from 'expo-sqlite';
import { getCatalogImageUri } from '../services/CatalogImageService';
import { JP_SET_PREFIX } from '../utils/jp';
import { normalizeSearch } from '../utils/search';
import { assignCatalogDb, sqliteDb, withCatalogGuard } from './catalogSession';
import { clearCardMarketAnalyticsCache, getLatestSubTypePrices, getProductMarketData, normalizeSubType } from './catalogPrices';

export * from './catalogSession';
export * from './catalogPrices';
export * from './catalogSignals';


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
  language?: string;
};


export function setCatalogDatabase(rawDb: SQLiteDatabase): void {
  assignCatalogDb(rawDb);
  clearCardMarketAnalyticsCache();
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



function buildSearchClause(query: string, args: (string | number)[]): string {
  const normalized = normalizeSearch(query);
  if (!normalized) {
    return '1 = 1';
  }

  const normalizeColumn = (column: string) =>
    `LOWER(REPLACE(REPLACE(REPLACE(REPLACE(${column}, '''', ''), '’', ''), '-', ''), '.', ''))`;

  // Tokenized AND match: each query term may hit name, number, or set
  // independently, so "pikachu 242" finds a card named "Pikachu" numbered
  // "242" even though no single column contains the whole phrase.
  const clauses = normalized
    .split(' ')
    .filter(Boolean)
    .map((token) => {
      const pattern = `%${escapeLikePattern(token)}%`;
      args.push(pattern, pattern, pattern);
      return `(
        ${normalizeColumn('c.card_name')} LIKE ? ESCAPE '\\' OR
        ${normalizeColumn('c.card_number')} LIKE ? ESCAPE '\\' OR
        ${normalizeColumn('c.set_name')} LIKE ? ESCAPE '\\'
      )`;
    });

  return `(${clauses.join(' AND ')})`;
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
  const { query, rarity, sortBy, maxPrice, productType, language } = filters;

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

  // JP rows are tagged by the tcgcsv category-85 set-name prefix.
  if (language === 'Japanese') {
    conditions.push(`c.set_name LIKE '${JP_SET_PREFIX}%'`);
  } else if (language === 'English') {
    conditions.push(`c.set_name NOT LIKE '${JP_SET_PREFIX}%'`);
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
