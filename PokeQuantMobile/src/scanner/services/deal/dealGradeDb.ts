import type { SQLiteDatabase } from 'expo-sqlite';
import { generateId } from '../../../db/database';
import type { CardSignal } from '../../../db/catalogDb';
import type { DealClassId } from './dealClassify';

// Local-only deal grade ledger — lives in pokequant.db but deliberately
// outside the Drizzle schema: schema.ts documents itself as cloud-synced
// tables only, and the sync pipeline pushes inventory rows explicitly.
// Grades are advisory history; they never leave the device.

export type DealGradeInsert = {
  inventoryId: string;
  userId: string;
  productId: number | null;
  subType: string | null;
  offerGiven: number | null;
  signal: CardSignal | null | undefined;
  cls: DealClassId;
  risk: 'good' | 'neutral' | 'risky';
};

export type DealGradeRow = {
  id: string;
  inventoryId: string;
  productId: number | null;
  subType: string | null;
  dealClass: string | null;
  risk: string | null;
  marketAtGrade: number | null;
  offerGiven: number | null;
  action: string | null;
  confidence: string | null;
  createdAt: number;
};

let ensurePromise: Promise<void> | null = null;

function ensureTable(db: SQLiteDatabase): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = db
      .execAsync(
        `CREATE TABLE IF NOT EXISTS deal_grades (
          id TEXT PRIMARY KEY NOT NULL,
          inventory_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          product_id INTEGER,
          sub_type TEXT,
          deal_class TEXT,
          risk TEXT,
          market_at_grade REAL,
          offer_given REAL,
          action TEXT,
          confidence TEXT,
          signal_json TEXT,
          created_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_deal_grades_inventory
          ON deal_grades(inventory_id);
        CREATE INDEX IF NOT EXISTS idx_deal_grades_user
          ON deal_grades(user_id, created_at);`,
      )
      .catch((err) => {
        ensurePromise = null;
        throw err;
      });
  }
  return ensurePromise;
}

/** Persist one grade per scanned card landing in inventory. Best-effort —
 *  a bad row must never block the inventory write itself. */
export async function recordDealGrades(db: SQLiteDatabase, rows: DealGradeInsert[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    await ensureTable(db);
    const now = Date.now() / 1000;
    const args: (string | number | null)[] = [];
    for (const r of rows) {
      args.push(
        generateId(),
        r.inventoryId,
        r.userId,
        r.productId,
        r.subType,
        r.cls,
        r.risk,
        r.signal?.price ?? null,
        r.offerGiven,
        r.signal?.action ?? null,
        r.signal?.confidence ?? null,
        r.signal ? JSON.stringify(r.signal) : null,
        now,
      );
    }
    await db.runAsync(
      `INSERT INTO deal_grades
        (id, inventory_id, user_id, product_id, sub_type, deal_class,
         risk, market_at_grade, offer_given, action, confidence,
         signal_json, created_at)
       VALUES ${rows.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',')}`,
      ...args,
    );
  } catch (err) {
    console.warn('recordDealGrades failed (non-fatal):', err);
  }
}

export type ClassTrackRecord = {
  dealClass: string;
  graded: number;
  sold: number;
  /** Sold rows that beat the cost at add-time (offer given, else paid). */
  wins: number;
  /** Mean realized margin on sold rows ($, sold - cost). */
  avgMargin: number | null;
  /** Mean days from grade to sale, when date_sold is parseable. */
  avgDaysToSell: number | null;
};

/** Join grades to inventory outcomes: per-class realized record. Cost is
 *  the negotiated offer actually paid (offer_given), falling back to the
 *  row's purchase price — both are "what the card cost the vendor". */
export async function getClassTrackRecord(db: SQLiteDatabase): Promise<ClassTrackRecord[]> {
  try {
    await ensureTable(db);
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT g.deal_class AS cls,
              COUNT(*) AS graded,
              SUM(CASE WHEN i.is_sold = 1 THEN 1 ELSE 0 END) AS sold,
              SUM(CASE WHEN i.is_sold = 1 AND
                    i.sold_price > COALESCE(NULLIF(g.offer_given, 0), i.purchase_price, 0)
                    THEN 1 ELSE 0 END) AS wins,
              AVG(CASE WHEN i.is_sold = 1 THEN
                    i.sold_price - COALESCE(NULLIF(g.offer_given, 0), i.purchase_price, 0)
                    END) AS avg_margin,
              AVG(CASE WHEN i.is_sold = 1 AND i.date_sold != '' THEN
                    julianday(i.date_sold) - (g.created_at / 86400.0 + 2440587.5)
                    END) AS avg_days
         FROM deal_grades g
         JOIN inventory i ON i.id = g.inventory_id
        WHERE COALESCE(i.is_deleted, 0) = 0
        GROUP BY g.deal_class
        ORDER BY graded DESC`,
    );
    return rows.map((row) => ({
      dealClass: String(row.cls ?? 'UNKNOWN'),
      graded: Number(row.graded) || 0,
      sold: Number(row.sold) || 0,
      wins: Number(row.wins) || 0,
      avgMargin: row.avg_margin == null ? null : Number(row.avg_margin),
      avgDaysToSell: row.avg_days == null ? null : Number(row.avg_days),
    }));
  } catch {
    return [];
  }
}

export async function getDealGradesForInventory(
  db: SQLiteDatabase,
  inventoryIds: string[],
): Promise<Record<string, DealGradeRow>> {
  if (inventoryIds.length === 0) return {};
  try {
    await ensureTable(db);
    const ph = inventoryIds.map(() => '?').join(',');
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT id, inventory_id, product_id, sub_type, deal_class, risk,
              market_at_grade, offer_given, action, confidence, created_at
       FROM deal_grades WHERE inventory_id IN (${ph})`,
      ...inventoryIds,
    );
    const out: Record<string, DealGradeRow> = {};
    for (const row of rows) {
      const invId = String(row.inventory_id);
      out[invId] = {
        id: String(row.id),
        inventoryId: invId,
        productId: row.product_id == null ? null : Number(row.product_id),
        subType: row.sub_type == null ? null : String(row.sub_type),
        dealClass: row.deal_class == null ? null : String(row.deal_class),
        risk: row.risk == null ? null : String(row.risk),
        marketAtGrade: row.market_at_grade == null ? null : Number(row.market_at_grade),
        offerGiven: row.offer_given == null ? null : Number(row.offer_given),
        action: row.action == null ? null : String(row.action),
        confidence: row.confidence == null ? null : String(row.confidence),
        createdAt: Number(row.created_at) || 0,
      };
    }
    return out;
  } catch {
    return {};
  }
}
