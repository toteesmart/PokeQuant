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

type TursoCell = { type: string; value?: unknown };

type TursoExecuteResult = {
  cols: Array<{ name: string; decltype?: string }>;
  rows: TursoCell[][];
  affected_row_count: number;
  last_insert_rowid?: string | null;
};

type TursoPipelineResponse = {
  baton?: string | null;
  base_url?: string | null;
  results: Array<
    | { type: 'ok'; response: { type: 'execute'; result: TursoExecuteResult } }
    | { type: 'ok'; response: { type: 'close' } }
    | { type: 'error'; error: { message?: string } }
  >;
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

function fromTursoValue(cell: unknown): unknown {
  if (cell === null || cell === undefined) {
    return null;
  }
  if (typeof cell !== 'object') {
    return cell;
  }
  const typed = cell as { type: string; value?: unknown };
  switch (typed.type) {
    case 'null':
      return null;
    case 'integer':
      return Number(typed.value);
    case 'float':
      return Number(typed.value);
    case 'text':
      return String(typed.value);
    case 'blob':
      return typed.value;
    default:
      return typed.value;
  }
}

function isFatalMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return FATAL_MESSAGES.some((m) => lower.includes(m));
}

export function sanitizeInventoryRow(row: any, userId?: string): any {
  const sanitized: any = {};
  for (const col of INVENTORY_COLUMNS) {
    const raw = row[col];
    if (col === 'user_id') {
      sanitized[col] = userId ?? String(raw ?? '');
    } else if (col === 'product_id') {
      sanitized[col] = raw != null ? Math.trunc(Number(raw)) : null;
    } else if (col === 'is_sold' || col === 'is_deleted' || col === 'is_bulk_deal') {
      sanitized[col] = raw ? 1 : 0;
    } else if (col === 'id') {
      sanitized[col] = String(raw ?? '');
    } else if (col === 'updated_at') {
      sanitized[col] = typeof raw === 'number' ? raw : Number(raw) || 0;
    } else if (
      col === 'purchase_price' ||
      col === 'sticker_price' ||
      col === 'sold_price'
    ) {
      const n = Number.parseFloat(String(raw));
      sanitized[col] = Number.isNaN(n) ? 0 : n;
    } else {
      sanitized[col] = raw ?? null;
    }
  }
  return sanitized;
}

function buildInventoryStatement(row: any, userId: string): TursoStatement {
  const sanitized = sanitizeInventoryRow(row, userId);
  const args: TursoArg[] = INVENTORY_COLUMNS.map((col) => {
    if (col === 'user_id') {
      return toTursoArg(userId);
    }
    return toTursoArg(sanitized[col]);
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

function parsePipelineRows(response: TursoPipelineResponse): any[] {
  const executeResults = response.results
    .filter(
      (r): r is { type: 'ok'; response: { type: 'execute'; result: TursoExecuteResult } } =>
        r.type === 'ok' &&
        (r as any).response?.type === 'execute' &&
        Array.isArray((r as any).response.result?.rows)
    );

  if (executeResults.length === 0) {
    return [];
  }

  const { cols, rows } = executeResults[0].response.result;
  const colNames = cols.map((c) => c.name);
  return rows.map((row) => {
    const record: any = {};
    for (let i = 0; i < colNames.length; i++) {
      record[colNames[i]] = fromTursoValue(row[i]);
    }
    return record;
  });
}

export async function pullCloudInventory(
  db: SQLiteDatabase,
  userId: string
): Promise<number> {
  const payload = {
    requests: [
      {
        type: 'execute',
        stmt: {
          sql: `SELECT * FROM inventory WHERE user_id = ?`,
          args: [toTursoArg(userId)],
        },
      },
      { type: 'close' },
    ],
  };

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
      `Pull failed: network error: ${
        networkErr instanceof Error ? networkErr.message : String(networkErr)
      }`
    );
  }

  const responseText = await response.text();

  if (!response.ok) {
    if (isFatalMessage(responseText)) {
      throw new SyncFatalError(`Pull failed: HTTP ${response.status}: ${responseText}`);
    }
    throw new Error(`Pull failed: HTTP ${response.status}: ${responseText}`);
  }

  const data: TursoPipelineResponse = JSON.parse(responseText);
  for (const result of data.results) {
    if (result.type === 'error') {
      const message = result.error?.message ?? 'Unknown Turso error';
      if (isFatalMessage(message)) {
        throw new SyncFatalError(`Pull failed: ${message}`);
      }
      throw new Error(`Pull failed: ${message}`);
    }
  }

  const rows = parsePipelineRows(data);

  await db.withTransactionAsync(async () => {
    for (const row of rows) {
      const sanitized = sanitizeInventoryRow(row, userId);
      await db.runAsync(
        INVENTORY_INSERT_SQL,
        sanitized.id,
        sanitized.user_id,
        sanitized.product_id,
        sanitized.card_name,
        sanitized.card_number,
        sanitized.set_name,
        sanitized.variant,
        sanitized.condition,
        sanitized.purchase_price,
        sanitized.sticker_price,
        sanitized.date_bought,
        sanitized.is_bulk_deal,
        sanitized.is_sold,
        sanitized.sold_price,
        sanitized.date_sold,
        sanitized.custom_image_data,
        sanitized.is_deleted,
        sanitized.updated_at
      );
    }
  });

  return rows.length;
}
