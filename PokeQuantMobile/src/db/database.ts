import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

const DB_NAME = 'pokequant.db';

const CORE_TABLES_SQL = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS cards (
  product_id INTEGER PRIMARY KEY,
  card_name TEXT,
  card_number TEXT,
  set_name TEXT,
  rarity TEXT,
  image_base64 TEXT
);

CREATE TABLE IF NOT EXISTS price_history (
  product_id INTEGER,
  sub_type TEXT,
  date TEXT,
  market_price REAL,
  PRIMARY KEY (product_id, sub_type, date)
);

CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  product_id INTEGER,
  card_name TEXT,
  card_number TEXT,
  set_name TEXT,
  variant TEXT,
  condition TEXT,
  purchase_price REAL,
  sticker_price REAL,
  date_bought TEXT,
  is_bulk_deal INTEGER DEFAULT 0,
  is_sold INTEGER DEFAULT 0,
  sold_price REAL DEFAULT 0.0,
  date_sold TEXT DEFAULT '',
  custom_image_data TEXT,
  is_deleted INTEGER DEFAULT 0,
  updated_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS vendor_settings (
  user_id TEXT PRIMARY KEY,
  settings_json TEXT NOT NULL,
  updated_at REAL DEFAULT 0.0
);

CREATE TABLE IF NOT EXISTS tour_state (
  user_id TEXT PRIMARY KEY,
  has_seen_tour INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sync_metadata (
  user_id TEXT PRIMARY KEY,
  last_updated REAL DEFAULT 0.0
);
`;

const EXPECTED_TABLES = ['cards', 'price_history', 'inventory', 'vendor_settings', 'tour_state', 'sync_metadata'];

let databaseInstance: SQLiteDatabase | null = null;

export type InitResult = {
  db: SQLiteDatabase;
  ok: boolean;
  message: string;
};

export async function initializeDatabase(): Promise<InitResult> {
  if (databaseInstance) {
    const ok = await verifyTables(databaseInstance);
    return {
      db: databaseInstance,
      ok,
      message: ok
        ? 'SQLite Foundation Initialized: Tables Verified'
        : 'SQLite Foundation Initialized: Tables Missing',
    };
  }

  const db = await openDatabaseAsync(DB_NAME);
  await db.execAsync(CORE_TABLES_SQL);

  const ok = await verifyTables(db);
  databaseInstance = db;

  return {
    db,
    ok,
    message: ok
      ? 'SQLite Foundation Initialized: Tables Verified'
      : 'SQLite Foundation Initialized: Tables Missing',
  };
}

export function getDatabase(): SQLiteDatabase | null {
  return databaseInstance;
}

async function verifyTables(db: SQLiteDatabase): Promise<boolean> {
  const placeholders = EXPECTED_TABLES.map(() => '?').join(', ');
  const rows = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`,
    ...EXPECTED_TABLES
  );
  return rows.length === EXPECTED_TABLES.length;
}

export async function getHasSeenTour(
  db: SQLiteDatabase,
  userId: string
): Promise<boolean> {
  const row = await db.getFirstAsync<{ has_seen_tour: number }>(
    'SELECT has_seen_tour FROM tour_state WHERE user_id = ?',
    userId
  );
  return row != null && row.has_seen_tour === 1;
}

export async function setHasSeenTour(
  db: SQLiteDatabase,
  userId: string,
  seen: boolean
): Promise<void> {
  await db.runAsync(
    'INSERT OR REPLACE INTO tour_state (user_id, has_seen_tour) VALUES (?, ?)',
    userId,
    seen ? 1 : 0
  );
}
