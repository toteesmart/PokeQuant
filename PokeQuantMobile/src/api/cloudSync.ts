import type { SQLiteDatabase } from 'expo-sqlite';
import { CLOUDFLARE_WORKER_URL, SYNC_BATCH_SIZE } from '../constants/api';
import { getPendingInventoryRows, setLastSync } from '../db/syncDb';

type TursoArg =
  | { type: 'null' }
  | { type: 'integer'; value: string }
  | { type: 'float'; value: number }
  | { type: 'text'; value: string };

type TursoStatement =
  | { type: 'execute'; stmt: { sql: string; args: TursoArg[] } }
  | { type: 'close' };

type TursoResponse = {
  results?: Array<{ type: 'ok' | 'error'; error?: { message?: string } }>;
};

const FATAL_MESSAGES = [
  'datatype mismatch',
  'syntax error',
  'wrong number of arguments',
  'no such table',
  'no such column',
  'constraint failed',
  'unique constraint failed',
];

export class SyncFatalError extends Error {
  fatal = true;
}

const INVENTORY_COLUMNS = [
  'id',
  'user_id',
  'product_id',
  'card_name',
  'card_number',
  'set_name',
  'variant',
  'condition',
  'purchase_price',
  'sticker_price',
  'date_bought',
  'is_bulk_deal',
  'is_sold',
  'sold_price',
  'date_sold',
  'custom_image_data',
  'is_deleted',
  'updated_at',
] as const;

const INVENTORY_INSERT_SQL = `INSERT OR REPLACE INTO inventory (
  id, user_id, product_id, card_name, card_number, set_name, variant, condition,
  purchase_price, sticker_price, date_bought, is_bulk_deal, is_sold, sold_price,
  date_sold, custom_image_data, is_deleted, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const EXPECTED_PLACEHOLDER_COUNT = INVENTORY_INSERT_SQL.split('?').length - 1;

const SYNC_METADATA_SQL =
  'INSERT OR REPLACE INTO sync_metadata (user_id, last_updated) VALUES (?, ?)';

function toTursoArg(value: unknown): TursoArg {
  if (value === null || value === undefined) {
    return { type: 'null' };
  }
  if (typeof value === 'boolean') {
    return { type: 'integer', value: value ? '1' : '0' };
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return { type: 'integer', value: String(value) };
    }
    return { type: 'float', value };
  }
  return { type: 'text', value: String(value) };
}

function isFatalMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return FATAL_MESSAGES.some((m) => lower.includes(m));
}

function buildInventoryStatement(row: any, userId: string): TursoStatement {
  const args: TursoArg[] = INVENTORY_COLUMNS.map((col) => {
    if (col === 'user_id') {
      return toTursoArg(userId);
    }
    return toTursoArg(row[col]);
  });

  if (args.length !== EXPECTED_PLACEHOLDER_COUNT) {
    throw new SyncFatalError(
      `Placeholder/argument count mismatch: expected ${EXPECTED_PLACEHOLDER_COUNT}, got ${args.length}`
    );
  }

  return { type: 'execute', stmt: { sql: INVENTORY_INSERT_SQL, args } };
}

function buildChunkPayload(
  rows: any[],
  userId: string,
  isFinalChunk: boolean
): { requests: TursoStatement[] } {
  const requests: TursoStatement[] = rows.map((row) =>
    buildInventoryStatement(row, userId)
  );
  if (isFinalChunk) {
    requests.push({
      type: 'execute',
      stmt: {
        sql: SYNC_METADATA_SQL,
        args: [toTursoArg(userId), toTursoArg(Date.now())],
      },
    });
  }
  requests.push({ type: 'close' });
  return { requests };
}

export async function pushPendingInventoryChanges(
  db: SQLiteDatabase,
  userId: string
): Promise<void> {
  const rows = await getPendingInventoryRows(db, userId);
  if (rows.length === 0) {
    await setLastSync(db, userId, Date.now());
    return;
  }

  for (let i = 0; i < rows.length; i += SYNC_BATCH_SIZE) {
    const chunk = rows.slice(i, i + SYNC_BATCH_SIZE);
    const isFinalChunk = i + chunk.length >= rows.length;
    const payload = buildChunkPayload(chunk, userId, isFinalChunk);

    let response: Response;
    try {
      response = await fetch(CLOUDFLARE_WORKER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Beta-Key': userId,
        },
        body: JSON.stringify(payload),
      });
    } catch (networkErr) {
      throw new Error(
        `Sync failed: network error: ${
          networkErr instanceof Error ? networkErr.message : String(networkErr)
        }`
      );
    }

    const responseText = await response.text();

    if (!response.ok) {
      if (isFatalMessage(responseText)) {
        throw new SyncFatalError(
          `Sync failed: HTTP ${response.status}: ${responseText}`
        );
      }
      throw new Error(`Sync failed: HTTP ${response.status}: ${responseText}`);
    }

    const data: TursoResponse = JSON.parse(responseText);
    for (const result of data.results ?? []) {
      if (result && result.type === 'error') {
        const message = result.error?.message ?? 'Unknown Turso error';
        if (isFatalMessage(message)) {
          throw new SyncFatalError(`Sync failed: ${message}`);
        }
        throw new Error(`Sync failed: ${message}`);
      }
    }
  }

  await setLastSync(db, userId, Date.now());
}
