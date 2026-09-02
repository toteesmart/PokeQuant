import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { ensureCatalogDownloaded, CATALOG_FILE_NAME } from '../services/CatalogDownloadService';
import { CATALOG_IMAGE_BASE } from '../constants/api';

let catalogDb: SQLiteDatabase | null = null;

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

function buildOrderBy(sortBy: CatalogSortBy): string {
  switch (sortBy) {
    case 'Price: Low to High':
      return 'liveMarket ASC, c.card_name COLLATE NOCASE ASC';
    case 'Price: High to Low':
      return 'liveMarket DESC, c.card_name COLLATE NOCASE ASC';
    case 'Name A-Z':
      return 'c.card_name COLLATE NOCASE ASC';
    case 'Newest':
    default:
      return 'liveDate DESC, c.product_id DESC';
  }
}

export async function searchCatalogCards(
  db: SQLiteDatabase,
  filters: CatalogFilters,
  limit = 50
): Promise<CatalogCard[]> {
  const { query, rarity, sortBy, maxPrice } = filters;

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
  const havingClause =
    maxPrice !== undefined && !Number.isNaN(maxPrice)
      ? `HAVING liveMarket <= ${Number(maxPrice)}`
      : '';

  const orderBy = buildOrderBy(sortBy);

  const sql = `
    WITH latest AS (
      SELECT product_id, MAX(date) as max_date
      FROM price_history
      GROUP BY product_id
    )
    SELECT
      c.product_id,
      c.card_name as name,
      c.card_number as number,
      c.set_name as set,
      c.rarity,
      l.max_date as liveDate,
      MAX(p.market_price) as liveMarket,
      (SELECT MAX(market_price) FROM price_history WHERE product_id = c.product_id AND julianday(l.max_date) - julianday(date) <= 90) as range90dHigh,
      (SELECT MIN(market_price) FROM price_history WHERE product_id = c.product_id AND julianday(l.max_date) - julianday(date) <= 90) as range90dLow
    FROM cards c
    JOIN latest l ON c.product_id = l.product_id
    JOIN price_history p ON c.product_id = p.product_id AND p.date = l.max_date
    ${whereClause}
    GROUP BY c.product_id
    ${havingClause}
    ORDER BY ${orderBy}
    LIMIT ${Number(limit)}
  `;

  const rows = await db.getAllAsync<{
    product_id: number;
    name: string;
    number: string;
    set: string;
    rarity: string;
    liveMarket: number;
    range90dHigh: number;
    range90dLow: number;
  }>(sql, ...args);

  return rows.map((row) => ({
    id: String(row.product_id),
    name: row.name,
    number: row.number,
    set: row.set,
    rarity: row.rarity,
    productType: '',
    liveMarket: Number(row.liveMarket) || 0,
    velocity1d: 0,
    velocity3d: 0,
    velocity7d: 0,
    velocity30d: 0,
    range90dHigh: Number(row.range90dHigh) || Number(row.liveMarket) || 0,
    range90dLow: Number(row.range90dLow) || Number(row.liveMarket) || 0,
    productId: Math.trunc(Number(row.product_id)),
    imageUrl: `${CATALOG_IMAGE_BASE}/${Math.trunc(Number(row.product_id))}_200w.jpg`,
  }));
}
