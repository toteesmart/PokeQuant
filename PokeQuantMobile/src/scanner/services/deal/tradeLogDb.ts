import type { SQLiteDatabase } from 'expo-sqlite';
import { generateId } from '../../../db/database';

// Local-only trade ledger — same posture as deal_grades: lives in
// pokequant.db but outside the Drizzle/sync schema, so records never
// leave the device. Outgoing cards also land in completed sales via
// markInventorySold; this table carries the trade context (what came
// back, the rate, the verdict) that a plain sale row can't.

export type TradeLeg = {
  inventoryId?: string; // set for cards given from inventory
  name: string;
  qty: number;
  face: number; // total face for the leg (unit × qty)
  basis?: number; // cost basis attributed (given: original paid; received: allocated)
};

export type TradeLogInsert = {
  userId: string;
  given: TradeLeg[];
  received: TradeLeg[];
  yourCash: number;
  theirCash: number;
  ratePct: number;
  verdict: 'win' | 'fair' | 'lose';
  tradeDelta: number; // decay-adjusted delta at completion
  reason: string; // one-line explanation shown on the analytics row
};

export type TradeLogSummary = {
  id: string;
  verdict: string;
  reason: string;
  tradedAt: string;
};

let ensurePromise: Promise<void> | null = null;

function ensureTable(db: SQLiteDatabase): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = db
      .execAsync(
        `CREATE TABLE IF NOT EXISTS trade_log (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL,
          traded_at TEXT NOT NULL,
          rate_pct INTEGER,
          verdict TEXT,
          trade_delta REAL,
          your_cash REAL,
          their_cash REAL,
          reason TEXT,
          given_json TEXT,
          received_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_trade_log_user
          ON trade_log(user_id, traded_at);`
      )
      .catch((err) => {
        ensurePromise = null;
        throw err;
      });
  }
  return ensurePromise;
}

export async function recordTradeLog(
  db: SQLiteDatabase,
  rec: TradeLogInsert
): Promise<string> {
  const id = generateId();
  try {
    await ensureTable(db);
    await db.runAsync(
      `INSERT INTO trade_log
        (id, user_id, traded_at, rate_pct, verdict, trade_delta,
         your_cash, their_cash, reason, given_json, received_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      id,
      rec.userId,
      new Date().toISOString(),
      rec.ratePct,
      rec.verdict,
      rec.tradeDelta,
      rec.yourCash,
      rec.theirCash,
      rec.reason,
      JSON.stringify(rec.given),
      JSON.stringify(rec.received)
    );
  } catch (err) {
    console.warn('recordTradeLog failed (non-fatal):', err);
  }
  return id;
}

/** Maps given-card inventory ids → their trade record, so completed-sale
 *  rows can show "Traded · WIN" context after an app restart. Volume is
 *  small, so matching happens in JS rather than JSON-path SQL. */
export async function getTradeLogByInventoryIds(
  db: SQLiteDatabase,
  inventoryIds: string[]
): Promise<Map<string, TradeLogSummary>> {
  const out = new Map<string, TradeLogSummary>();
  if (inventoryIds.length === 0) return out;
  try {
    await ensureTable(db);
    const rows = await db.getAllAsync<{
      id: string;
      verdict: string | null;
      reason: string | null;
      traded_at: string;
      given_json: string | null;
    }>(
      `SELECT id, verdict, reason, traded_at, given_json
       FROM trade_log ORDER BY traded_at DESC LIMIT 500`
    );
    const wanted = new Set(inventoryIds);
    for (const row of rows) {
      if (!row.given_json) continue;
      try {
        const given = JSON.parse(row.given_json) as TradeLeg[];
        for (const leg of given) {
          if (leg.inventoryId && wanted.has(leg.inventoryId)) {
            out.set(leg.inventoryId, {
              id: String(row.id),
              verdict: row.verdict ?? '',
              reason: row.reason ?? '',
              tradedAt: String(row.traded_at),
            });
          }
        }
      } catch {
        // malformed row — skip
      }
    }
  } catch {
    // table missing / read error — degrade to no badges
  }
  return out;
}
