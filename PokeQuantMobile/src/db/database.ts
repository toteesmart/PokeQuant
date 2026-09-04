import * as Crypto from 'expo-crypto';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { drizzle, type ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import migrationMeta from '../../drizzle/migrations';
import * as schema from './schema';

const DB_NAME = 'pokequant.db';

type DrizzleDb = ExpoSQLiteDatabase;

const drizzleMap = new WeakMap<SQLiteDatabase, DrizzleDb>();
let databaseInstance: SQLiteDatabase | null = null;

export function generateId(): string {
  return Crypto.randomUUID().replace(/-/g, '');
}

function getDrizzleDb(rawDb: SQLiteDatabase): DrizzleDb {
  let db = drizzleMap.get(rawDb);
  if (!db) {
    db = drizzle(rawDb);
    drizzleMap.set(rawDb, db);
  }
  return db;
}

export type InitResult = {
  db: SQLiteDatabase;
  ok: boolean;
  message: string;
};

let initPromise: Promise<InitResult> | null = null;

async function setupDb(): Promise<InitResult> {
  const rawDb = await openDatabaseAsync(DB_NAME);
  databaseInstance = rawDb;

  // PRAGMAs must run outside the Drizzle migration transaction.
  await rawDb.execAsync('PRAGMA journal_mode = WAL;');
  await rawDb.execAsync('PRAGMA synchronous = NORMAL;');

  const db = getDrizzleDb(rawDb);
  await migrate(db, migrationMeta as any);

  return {
    db: rawDb,
    ok: true,
    message: 'SQLite Foundation Initialized: Drizzle Migrations Applied',
  };
}

export const initializeDatabase = (): Promise<InitResult> => {
  if (!initPromise) {
    initPromise = setupDb();
  }
  return initPromise;
};

export const initDb = initializeDatabase;

export function getDatabase(): SQLiteDatabase | null {
  return databaseInstance;
}

export function getDrizzle(rawDb: SQLiteDatabase): DrizzleDb {
  return getDrizzleDb(rawDb);
}

export async function getHasSeenTour(
  _db: SQLiteDatabase,
  _userId: string
): Promise<boolean> {
  return true;
}

export async function setHasSeenTour(
  db: SQLiteDatabase,
  userId: string,
  seen: boolean
): Promise<void> {
  const d = getDrizzleDb(db);
  await d
    .insert(schema.tourState)
    .values({ userId, hasSeenTour: seen })
    .onConflictDoUpdate({
      target: schema.tourState.userId,
      set: { hasSeenTour: seen },
    })
    .run();
}

export async function getVendorSettings(
  db: SQLiteDatabase,
  userId: string
): Promise<string | null> {
  const d = getDrizzleDb(db);
  const row = await d
    .select({ settingsJson: schema.vendorSettings.settingsJson })
    .from(schema.vendorSettings)
    .where(eq(schema.vendorSettings.userId, userId))
    .get();
  return row?.settingsJson ?? null;
}

export async function setVendorSettings(
  db: SQLiteDatabase,
  userId: string,
  settingsJson: string,
  updatedAt?: number
): Promise<void> {
  const d = getDrizzleDb(db);
  const timestamp = updatedAt ?? Date.now() / 1000;
  await d
    .insert(schema.vendorSettings)
    .values({ userId, settingsJson, updatedAt: timestamp })
    .onConflictDoUpdate({
      target: schema.vendorSettings.userId,
      set: { settingsJson, updatedAt: timestamp },
    })
    .run();
}

export async function getAllLocalUserIds(db: SQLiteDatabase): Promise<string[]> {
  const d = getDrizzleDb(db);

  const [inventoryRows, settingsRows, syncRows] = await Promise.all([
    d.selectDistinct({ userId: schema.inventory.userId }).from(schema.inventory).all(),
    d
      .selectDistinct({ userId: schema.vendorSettings.userId })
      .from(schema.vendorSettings)
      .all(),
    d
      .selectDistinct({ userId: schema.syncMetadata.userId })
      .from(schema.syncMetadata)
      .all(),
  ]);

  const ids = new Set<string>();
  for (const row of inventoryRows) if (row.userId) ids.add(row.userId);
  for (const row of settingsRows) if (row.userId) ids.add(row.userId);
  for (const row of syncRows) if (row.userId) ids.add(row.userId);

  return [...ids];
}

export async function wipeLocalAccountData(
  db: SQLiteDatabase,
  userId?: string
): Promise<void> {
  const d = getDrizzleDb(db);
  const users = userId ? [userId] : await getAllLocalUserIds(db);

  d.transaction((tx) => {
    for (const uid of users) {
      tx.delete(schema.inventory).where(eq(schema.inventory.userId, uid)).run();
      tx
        .delete(schema.vendorSettings)
        .where(eq(schema.vendorSettings.userId, uid))
        .run();
      tx
        .delete(schema.syncMetadata)
        .where(eq(schema.syncMetadata.userId, uid))
        .run();
    }
  });
}
