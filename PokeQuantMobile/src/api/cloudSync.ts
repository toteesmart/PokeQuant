import type { SQLiteDatabase } from 'expo-sqlite';
import { CLOUDFLARE_WORKER_URL, SYNC_BATCH_SIZE } from '../constants/api';
import { applyRemoteInventoryChunk } from '../db/inventoryDb';
import { getLastSync, getPendingInventoryRows, setLastSync } from '../db/syncDb';

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

const INVENTORY_UPSERT_SQL = (() => {
  const columns = INVENTORY_COLUMNS.join(', ');
  const placeholders = INVENTORY_COLUMNS.map(() => '?').join(', ');
  const setClause = INVENTORY_COLUMNS
    .filter((col) => col !== 'id')
    .map((col) => `${col} = excluded.${col}`)
    .join(', ');
  return `INSERT INTO inventory (${columns}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${setClause} WHERE excluded.updated_at > inventory.updated_at`;
})();

const EXPECTED_PLACEHOLDER_COUNT = INVENTORY_UPSERT_SQL.split('?').length - 1;

const INVENTORY_INSERT_OR_REPLACE_SQL = (() => {
  const columns = INVENTORY_COLUMNS.join(', ');
  const placeholders = INVENTORY_COLUMNS.map(() => '?').join(', ');
  return `INSERT OR REPLACE INTO inventory (${columns}) VALUES (${placeholders})`;
})();

const EXPECTED_PUSH_PLACEHOLDER_COUNT =
  INVENTORY_INSERT_OR_REPLACE_SQL.split('?').length - 1;

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

function toBooleanFlag(raw: unknown): number {
  if (typeof raw === 'string') {
    const lower = raw.trim().toLowerCase();
    if (lower === 'true' || lower === '1' || lower === 'yes' || lower === 'on') {
      return 1;
    }
    if (
      lower === 'false' ||
      lower === '0' ||
      lower === 'no' ||
      lower === 'off' ||
      lower === ''
    ) {
      return 0;
    }
  }
  return Number(Boolean(raw)) || 0;
}

function toNumber(raw: unknown, fallback: number): number {
  if (raw == null || raw === '') return fallback;
  const n = Number.parseFloat(String(raw));
  return Number.isNaN(n) ? fallback : n;
}

function toNullableNumber(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = Number.parseFloat(String(raw));
  return Number.isNaN(n) ? null : n;
}

function toProductId(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  return Math.trunc(Number(raw)) || 0;
}

function toUpdatedAt(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  if (raw == null || raw === '') return 0;
  if (raw instanceof Date) return raw.getTime();
  const str = String(raw);
  const n = Number(str);
  if (!Number.isNaN(n)) return n;
  const d = Date.parse(str);
  return Number.isNaN(d) ? 0 : d;
}

function toNullableText(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) return raw.toISOString();
  const n = Number(raw);
  if (!Number.isNaN(n) && n > 0) return new Date(n).toISOString();
  return String(raw);
}

export function sanitizeInventoryRow(row: any, userId?: string): any {
  const sanitized: any = {};
  for (const col of INVENTORY_COLUMNS) {
    const raw = row[col];
    if (col === 'user_id') {
      sanitized[col] = userId ?? String(raw ?? '');
    } else if (col === 'id') {
      sanitized[col] = String(raw ?? '');
    } else if (col === 'product_id') {
      sanitized[col] = toProductId(raw);
    } else if (col === 'is_sold' || col === 'is_deleted' || col === 'is_bulk_deal') {
      sanitized[col] = toBooleanFlag(raw);
    } else if (col === 'updated_at') {
      sanitized[col] = toUpdatedAt(raw);
    } else if (col === 'sold_price') {
      sanitized[col] = toNullableNumber(raw);
    } else if (col === 'purchase_price' || col === 'sticker_price') {
      sanitized[col] = toNumber(raw, 0);
    } else if (col === 'date_bought' || col === 'date_sold') {
      sanitized[col] = toNullableText(raw);
    } else {
      sanitized[col] = raw == null ? null : String(raw);
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

  return { type: 'execute', stmt: { sql: INVENTORY_UPSERT_SQL, args } };
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
  const maxUpdatedAt = rows.reduce((max, row) => {
    const t = toUpdatedAt(row.updated_at);
    return t > max ? t : max;
  }, 0);

  await db.withTransactionAsync(async () => {
    for (const row of rows) {
      const sanitized = sanitizeInventoryRow(row, userId);
      await db.runAsync(
        INVENTORY_UPSERT_SQL,
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

  await setLastSync(db, userId, maxUpdatedAt);

  return rows.length;
}

function buildPushStatement(row: any, userId: string): TursoStatement {
  const sanitized = sanitizeInventoryRow(row, userId);
  const args: TursoArg[] = INVENTORY_COLUMNS.map((col) => {
    if (col === 'user_id') {
      return toTursoArg(userId);
    }
    return toTursoArg(sanitized[col]);
  });

  if (args.length !== EXPECTED_PUSH_PLACEHOLDER_COUNT) {
    throw new SyncFatalError(
      `Push placeholder/argument count mismatch: expected ${EXPECTED_PUSH_PLACEHOLDER_COUNT}, got ${args.length}`
    );
  }

  return {
    type: 'execute',
    stmt: { sql: INVENTORY_INSERT_OR_REPLACE_SQL, args },
  };
}

async function postTursoPipelineWithAuth(
  payload: { requests: TursoStatement[] },
  userId: string
): Promise<TursoPipelineResponse> {
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
      `Network error: ${
        networkErr instanceof Error ? networkErr.message : String(networkErr)
      }`
    );
  }

  const responseText = await response.text();

  if (!response.ok) {
    if (isFatalMessage(responseText)) {
      throw new SyncFatalError(`HTTP ${response.status}: ${responseText}`);
    }
    throw new Error(`HTTP ${response.status}: ${responseText}`);
  }

  const data: TursoPipelineResponse = JSON.parse(responseText);
  for (const result of data.results) {
    if (result.type === 'error') {
      const message = result.error?.message ?? 'Unknown Turso error';
      if (isFatalMessage(message)) {
        throw new SyncFatalError(`Turso error: ${message}`);
      }
      throw new Error(`Turso error: ${message}`);
    }
  }

  return data;
}

function buildInsertOrReplacePayload(
  rows: any[],
  userId: string,
  isFinalChunk: boolean
): { requests: TursoStatement[] } {
  const requests: TursoStatement[] = rows.map((row) =>
    buildPushStatement(row, userId)
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

export async function pushLocalChanges(
  db: SQLiteDatabase,
  userId: string
): Promise<number> {
  const rows = await getPendingInventoryRows(db, userId);
  if (rows.length === 0) {
    return 0;
  }

  for (let i = 0; i < rows.length; i += SYNC_BATCH_SIZE) {
    const chunk = rows.slice(i, i + SYNC_BATCH_SIZE);
    const isFinalChunk = i + chunk.length >= rows.length;
    const payload = buildInsertOrReplacePayload(chunk, userId, isFinalChunk);

    await postTursoPipelineWithAuth(payload, userId);
  }

  const maxUpdatedAt = rows.reduce((max, row) => {
    const t = toUpdatedAt(row.updated_at);
    return t > max ? t : max;
  }, 0);

  await setLastSync(db, userId, maxUpdatedAt);

  return rows.length;
}

export async function pullRemoteChanges(
  db: SQLiteDatabase,
  userId: string
): Promise<number> {
  const lastSync = await getLastSync(db, userId);

  const payload: { requests: TursoStatement[] } = {
    requests: [
      {
        type: 'execute',
        stmt: {
          sql:
            'SELECT * FROM inventory WHERE user_id = ? AND updated_at > ? ORDER BY updated_at ASC',
          args: [toTursoArg(userId), toTursoArg(lastSync)],
        },
      },
      { type: 'close' },
    ],
  };

  const data = await postTursoPipelineWithAuth(payload, userId);
  const rows = parsePipelineRows(data);

  if (rows.length === 0) {
    return 0;
  }

  await applyRemoteInventoryChunk(db, rows, userId);

  const maxUpdatedAt = rows.reduce((max, row) => {
    const t = toUpdatedAt(row.updated_at);
    return t > max ? t : max;
  }, 0);

  await setLastSync(db, userId, maxUpdatedAt);

  return rows.length;
}
