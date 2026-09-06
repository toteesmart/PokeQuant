import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
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

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS show_inventory (
    id TEXT PRIMARY KEY,
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
  try {
    db.execSync('ALTER TABLE show_inventory ADD COLUMN vendor_name TEXT;');
  } catch {
    // Column may already exist.
  }
  try {
    db.execSync('ALTER TABLE show_inventory ADD COLUMN vendor_table TEXT;');
  } catch {
    // Column may already exist.
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

export async function searchEventInventory(
  db: SQLiteDatabase,
  query: string,
  limit = 50,
  offset = 0
): Promise<EventSearchResult> {
  const search = buildSearchClause(query);
  const args: (string | number)[] = [];
  const where = search ? `WHERE ${search.clause}` : '';
  if (search) {
    args.push(search.pattern, search.pattern, search.pattern);
  }
  args.push(limit + 1, offset);

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
    `SELECT * FROM show_inventory ${where} ORDER BY name COLLATE NOCASE ASC LIMIT ? OFFSET ?`,
    ...args
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

  return {
    items,
    hasMore,
    nextOffset: offset + items.length,
  };
}

export async function getEventInventoryCount(db: SQLiteDatabase, query: string): Promise<number> {
  const search = buildSearchClause(query);
  const args: (string | number)[] = [];
  const where = search ? `WHERE ${search.clause}` : '';
  if (search) {
    args.push(search.pattern, search.pattern, search.pattern);
  }

  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM show_inventory ${where}`,
    ...args
  );
  return row?.count ?? 0;
}
