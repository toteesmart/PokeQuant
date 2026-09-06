import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import { Directory, File, Paths } from 'expo-file-system';
import { getLocalCatalogImageUri } from '../services/CatalogImageService';

export type EventInventoryItem = {
  id: string;
  productId: number;
  name: string;
  number: string;
  set: string;
  rarity: string;
  condition: string;
  stickerPrice: number;
  quantity: number;
  vendorName: string;
  vendorTable: string;
  imageUrl?: string;
};

export type EventSearchResult = {
  items: EventInventoryItem[];
  hasMore: boolean;
  nextOffset: number;
};

export type EventSearchSort =
  | 'name'
  | 'price-low'
  | 'price-high'
  | 'vendor'
  | 'set';

export type EventSearchFilters = {
  vendorName?: string;
  setName?: string;
  rarity?: string;
  condition?: string;
  minPrice?: number;
  maxPrice?: number;
};

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS show_inventory (
    id TEXT PRIMARY KEY,
    show_id TEXT,
    product_id INTEGER,
    name TEXT,
    set_name TEXT,
    number TEXT,
    rarity TEXT,
    condition TEXT,
    sticker_price REAL,
    quantity INTEGER,
    vendor_name TEXT,
    vendor_table TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_show_inventory_name ON show_inventory(name);
  CREATE INDEX IF NOT EXISTS idx_show_inventory_number ON show_inventory(number);
  CREATE INDEX IF NOT EXISTS idx_show_inventory_set ON show_inventory(set_name);
`;

function migrateSchema(db: SQLiteDatabase): void {
  const migrations = [
    'ALTER TABLE show_inventory ADD COLUMN show_id TEXT;',
    'DELETE FROM show_inventory WHERE show_id IS NULL;',
    'ALTER TABLE show_inventory ADD COLUMN vendor_name TEXT;',
    'ALTER TABLE show_inventory ADD COLUMN vendor_table TEXT;',
  ];

  for (const sql of migrations) {
    try {
      db.execSync(sql);
    } catch {
      // Column may already exist.
    }
  }
}

let openDb: SQLiteDatabase | null = null;

function ensureDatabase(): SQLiteDatabase {
  if (!openDb) {
    openDb = openDatabaseSync('event_catalog.db');
    openDb.execSync(SCHEMA_SQL);
    migrateSchema(openDb);
  }
  return openDb;
}

export function isEventCatalogDatabaseOpen(): boolean {
  return openDb != null;
}

export function setEventCatalogDatabase(db: SQLiteDatabase): void {
  openDb = db;
  db.execSync(SCHEMA_SQL);
}

export function closeEventCatalogDatabase(): void {
  if (!openDb) return;
  try {
    openDb.closeSync();
  } catch (err) {
    console.warn('Failed to close event catalog database:', err);
  }
  openDb = null;
}

export function openEventCatalogDatabase(): SQLiteDatabase {
  return ensureDatabase();
}

function escapeLikePattern(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[''\-.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSearchClause(query: string): { clause: string; pattern: string } | null {
  const normalized = normalizeSearch(query);
  if (!normalized) return null;
  const pattern = `%${escapeLikePattern(normalized)}%`;
  const normalizeColumn = (column: string) =>
    `LOWER(REPLACE(REPLACE(REPLACE(${column}, '''', ''), '-', ''), '.', ''))`;

  const clause = `(
    ${normalizeColumn('name')} LIKE ? ESCAPE '\\' OR
    ${normalizeColumn('number')} LIKE ? ESCAPE '\\' OR
    ${normalizeColumn('set_name')} LIKE ? ESCAPE '\\'
  )`;
  return { clause, pattern };
}

let catalogImageDb: SQLiteDatabase | null = null;

function getCatalogDbPath(): File {
  return new File(new Directory(Paths.document, 'SQLite'), 'pokequant_catalog.db');
}

function normalizeCatalogColumn(column: string): string {
  return `LOWER(REPLACE(REPLACE(REPLACE(${column}, '''', ''), '-', ''), '.', ''))`;
}

function scoreCatalogMatch(
  item: EventInventoryItem,
  row: { card_name: string; set_name: string; card_number: string }
): number {
  const itemName = normalizeSearch(item.name);
  const rowName = normalizeSearch(row.card_name);
  const itemNumber = normalizeSearch(item.number);
  const rowNumber = normalizeSearch(row.card_number);
  const itemSet = normalizeSearch(item.set);
  const rowSet = normalizeSearch(row.set_name);

  let score = 0;
  if (itemName === rowName) score += 100;
  if (itemNumber && rowNumber === itemNumber) score += 50;
  if (itemSet && rowSet.includes(itemSet)) score += 30;
  if (itemSet && itemSet.includes(rowSet)) score += 25;
  return score;
}

export async function attachEventImages(items: EventInventoryItem[]): Promise<void> {
  try {
    const catalogFile = getCatalogDbPath();
    if (!catalogFile.exists) return;

    if (!catalogImageDb) {
      catalogImageDb = openDatabaseSync('pokequant_catalog.db');
    }

    const missing = items.filter((item) => !item.imageUrl && item.name);
    if (missing.length === 0) return;

    const names = new Set<string>();
    const conditions: string[] = [];
    const args: (string | number)[] = [];

    for (const item of missing) {
      const normalizedName = normalizeSearch(item.name);
      if (!normalizedName || names.has(normalizedName)) continue;
      names.add(normalizedName);
      conditions.push(`${normalizeCatalogColumn('card_name')} = ?`);
      args.push(normalizedName);
    }

    if (conditions.length === 0) return;

    const sql = `
      SELECT product_id, card_name, set_name, card_number
      FROM cards
      WHERE ${conditions.join(' OR ')}
    `;

    const catalogRows = (await catalogImageDb.getAllSync<{
      product_id: number;
      card_name: string;
      set_name: string;
      card_number: string;
    }>(sql, ...args)) ?? [];

    for (const item of missing) {
      let bestProductId: number | undefined;
      let bestScore = 0;

      for (const row of catalogRows) {
        const score = scoreCatalogMatch(item, row);
        if (score > bestScore) {
          bestScore = score;
          bestProductId = row.product_id;
        }
      }

      if (bestProductId) {
        const imageUri = getLocalCatalogImageUri(bestProductId);
        if (imageUri) {
          item.imageUrl = imageUri;
        }
      }
    }
  } catch (err) {
    console.warn('Failed to attach event catalog images:', err);
  }
}

const SORT_CLAUSES: Record<EventSearchSort, string> = {
  name: 'name COLLATE NOCASE ASC',
  'price-low': 'sticker_price ASC, name COLLATE NOCASE ASC',
  'price-high': 'sticker_price DESC, name COLLATE NOCASE ASC',
  vendor: 'vendor_name COLLATE NOCASE ASC, name COLLATE NOCASE ASC',
  set: 'set_name COLLATE NOCASE ASC, name COLLATE NOCASE ASC',
};

function buildWhereClause(
  query: string,
  filters: EventSearchFilters,
  showId?: string
): { clause: string; args: (string | number)[] } {
  const clauses: string[] = [];
  const args: (string | number)[] = [];

  if (showId) {
    clauses.push('show_id = ?');
    args.push(showId);
  }

  const search = buildSearchClause(query);
  if (search) {
    clauses.push(search.clause);
    args.push(search.pattern, search.pattern, search.pattern);
  }

  if (filters.vendorName) {
    clauses.push(`${normalizeCatalogColumn('vendor_name')} = ?`);
    args.push(filters.vendorName.toLowerCase());
  }
  if (filters.setName) {
    clauses.push(`${normalizeCatalogColumn('set_name')} = ?`);
    args.push(filters.setName.toLowerCase());
  }
  if (filters.rarity) {
    clauses.push('LOWER(rarity) = ?');
    args.push(filters.rarity.toLowerCase());
  }
  if (filters.condition) {
    clauses.push('LOWER(condition) = ?');
    args.push(filters.condition.toLowerCase());
  }
  if (filters.minPrice !== undefined && !Number.isNaN(filters.minPrice)) {
    clauses.push('sticker_price >= ?');
    args.push(filters.minPrice);
  }
  if (filters.maxPrice !== undefined && !Number.isNaN(filters.maxPrice)) {
    clauses.push('sticker_price <= ?');
    args.push(filters.maxPrice);
  }

  const clause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return { clause, args };
}

export async function searchEventInventory(
  db: SQLiteDatabase,
  query: string,
  limit = 50,
  offset = 0,
  filters: EventSearchFilters = {},
  sort: EventSearchSort = 'name',
  showId?: string
): Promise<EventSearchResult> {
  const { clause: where, args } = buildWhereClause(query, filters, showId);
  const orderBy = SORT_CLAUSES[sort] ?? SORT_CLAUSES.name;

  const rows = await db.getAllSync<{
    id: string;
    product_id: number;
    name: string;
    set_name: string;
    number: string;
    rarity: string;
    condition: string;
    sticker_price: number;
    quantity: number;
    vendor_name: string;
    vendor_table: string;
  }>(
    `SELECT * FROM show_inventory ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    ...args,
    limit + 1,
    offset
  );

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map((row) => ({
    id: String(row.id),
    productId: Number(row.product_id) || 0,
    name: String(row.name),
    number: String(row.number),
    set: String(row.set_name),
    rarity: String(row.rarity),
    condition: String(row.condition),
    stickerPrice: Number(row.sticker_price) || 0,
    quantity: Number(row.quantity) || 0,
    vendorName: String(row.vendor_name ?? ''),
    vendorTable: String(row.vendor_table ?? ''),
    imageUrl: getLocalCatalogImageUri(Number(row.product_id) || 0),
  }));

  await attachEventImages(items);

  return {
    items,
    hasMore,
    nextOffset: offset + items.length,
  };
}

export async function getEventInventoryCount(
  db: SQLiteDatabase,
  query: string,
  filters: EventSearchFilters = {},
  showId?: string
): Promise<number> {
  const { clause: where, args } = buildWhereClause(query, filters, showId);

  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM show_inventory ${where}`,
    ...args
  );
  return row?.count ?? 0;
}

export async function getDistinctEventValues(
  db: SQLiteDatabase,
  showId?: string
): Promise<{
  vendors: string[];
  sets: string[];
  rarities: string[];
  conditions: string[];
}> {
  const showClause = showId ? 'AND show_id = ?' : '';
  const args: (string | number)[] = showId ? [showId] : [];

  const vendors =
    (await db.getAllSync<{ vendor_name: string }>(
      `SELECT DISTINCT vendor_name FROM show_inventory WHERE vendor_name IS NOT NULL AND vendor_name != '' ${showClause} ORDER BY vendor_name COLLATE NOCASE ASC`,
      ...args
    )) ?? [];
  const sets =
    (await db.getAllSync<{ set_name: string }>(
      `SELECT DISTINCT set_name FROM show_inventory WHERE set_name IS NOT NULL AND set_name != '' ${showClause} ORDER BY set_name COLLATE NOCASE ASC`,
      ...args
    )) ?? [];
  const rarities =
    (await db.getAllSync<{ rarity: string }>(
      `SELECT DISTINCT rarity FROM show_inventory WHERE rarity IS NOT NULL AND rarity != '' ${showClause} ORDER BY rarity COLLATE NOCASE ASC`,
      ...args
    )) ?? [];
  const conditions =
    (await db.getAllSync<{ condition: string }>(
      `SELECT DISTINCT condition FROM show_inventory WHERE condition IS NOT NULL AND condition != '' ${showClause} ORDER BY condition COLLATE NOCASE ASC`,
      ...args
    )) ?? [];

  return {
    vendors: vendors.map((r) => String(r.vendor_name)),
    sets: sets.map((r) => String(r.set_name)),
    rarities: rarities.map((r) => String(r.rarity)),
    conditions: conditions.map((r) => String(r.condition)),
  };
}
