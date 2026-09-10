import type { SQLiteDatabase } from 'expo-sqlite';
import type { Session } from '@supabase/supabase-js';
import { logError, logWarn } from '../utils/log';
import { CLOUDFLARE_WORKER_URL, SYNC_BATCH_SIZE } from '../constants/api';

import { supabase } from './supabaseClient';
import { getSession as getStoredSession } from './sessionStorage';
import {
  applyRemoteInventoryChunk,
  coerceInventoryRow,
  type BulkInventoryInput,
} from '../db/inventoryDb';
import {
  getLastPush,
  getLastSync,
  getPendingInventoryRows,
  setLastPush,
  setLastSync,
} from '../db/syncDb';

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

type TursoRow = Record<string, unknown>;

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

export async function getAuthToken(): Promise<string> {
  // `supabase.auth.getSession()` returns the live, refreshed in-memory
  // session. Persisted tokens are only used for cold-start restoration.
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      logError('Supabase getSession error:', error.message);
    } else if (data.session?.access_token) {
      return data.session.access_token;
    }
  } catch (err) {
    logError('Failed to read live Supabase session:', err);
  }

  // persistSession:false means an offline session restore may not populate the
  // in-memory Supabase client. Fall back to the stored session and, if the
  // network is back, try to rehydrate the client so token refresh can resume.
  let stored: Session | null = null;
  try {
    stored = await getStoredSession();
  } catch (err) {
    logError('Failed to read stored session:', err);
  }

  if (stored?.access_token) {
    try {
      const { data, error } = await supabase.auth.setSession({
        access_token: stored.access_token,
        refresh_token: stored.refresh_token,
      });
      if (data.session?.access_token) {
        return data.session.access_token;
      }
      if (error) {
        logWarn(
          'Stored session setSession failed; falling back to stored token:',
          error.message
        );
      }
    } catch (err) {
      logWarn(
        'Stored session setSession unreachable; falling back to stored token:',
        err
      );
    }
    return stored.access_token;
  }

  throw new Error('No valid session token');
}

function isFatalMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return FATAL_MESSAGES.some((m) => lower.includes(m));
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

function buildInventoryStatement(row: TursoRow, userId: string): TursoStatement {
  const coerced = coerceInventoryRow(row, userId);
  const args: TursoArg[] = INVENTORY_COLUMNS.map((col) => {
    if (col === 'user_id') {
      return toTursoArg(userId);
    }
    return toTursoArg(coerced[col]);
  });

  if (args.length !== EXPECTED_PLACEHOLDER_COUNT) {
    throw new SyncFatalError(
      `Placeholder/argument count mismatch: expected ${EXPECTED_PLACEHOLDER_COUNT}, got ${args.length}`
    );
  }

  return { type: 'execute', stmt: { sql: INVENTORY_UPSERT_SQL, args } };
}

function isExecuteResult(
  r: TursoPipelineResponse['results'][number]
): r is { type: 'ok'; response: { type: 'execute'; result: TursoExecuteResult } } {
  return (
    r.type === 'ok' &&
    r.response?.type === 'execute' &&
    Array.isArray(r.response.result?.rows)
  );
}

function parsePipelineRows(response: TursoPipelineResponse): TursoRow[] {
  const executeResults = response.results.filter(isExecuteResult);

  if (executeResults.length === 0) {
    return [];
  }

  const { cols, rows } = executeResults[0].response.result;
  const colNames = cols.map((c) => c.name);
  return rows.map((row) => {
    const record: TursoRow = {};
    for (let i = 0; i < colNames.length; i++) {
      record[colNames[i]] = fromTursoValue(row[i]);
    }
    return record;
  });
}

async function postTursoPipelineWithAuth(
  payload: { requests: TursoStatement[] },
  userId: string
): Promise<TursoPipelineResponse> {
  const jwt = await getAuthToken();

  let response: Response;
  try {
    response = await fetch(CLOUDFLARE_WORKER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwt}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
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
    const requests: TursoStatement[] = chunk.map((row) =>
      buildInventoryStatement(row, userId)
    );
    requests.push({ type: 'close' });

    await postTursoPipelineWithAuth({ requests }, userId);
  }

  const maxUpdatedAt = rows.reduce((max, row) => {
    const t = toUpdatedAt(row.updated_at);
    return t > max ? t : max;
  }, 0);

  await setLastPush(db, userId, maxUpdatedAt);

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

  // Rows we just received from the server are already on the server.
  // Advance the push watermark so they are not re-pushed or counted as
  // pending local changes.
  const currentLastPush = await getLastPush(db, userId);
  await setLastPush(db, userId, Math.max(currentLastPush, maxUpdatedAt));

  return rows.length;
}

const VENDOR_SETTINGS_UPSERT_SQL =
  'INSERT OR REPLACE INTO vendor_settings (user_id, settings_json, updated_at) VALUES (?, ?, ?)';

export async function pushVendorSettings(
  db: SQLiteDatabase,
  userId: string,
  settingsJson: string,
  updatedAt: number
): Promise<void> {
  const payload: { requests: TursoStatement[] } = {
    requests: [
      {
        type: 'execute',
        stmt: {
          sql: VENDOR_SETTINGS_UPSERT_SQL,
          args: [
            toTursoArg(userId),
            toTursoArg(settingsJson),
            toTursoArg(updatedAt),
          ],
        },
      },
      { type: 'close' },
    ],
  };

  await postTursoPipelineWithAuth(payload, userId);
}

export async function pullVendorSettings(
  db: SQLiteDatabase,
  userId: string
): Promise<{ settingsJson: string; updatedAt: number } | null> {
  const payload: { requests: TursoStatement[] } = {
    requests: [
      {
        type: 'execute',
        stmt: {
          sql: 'SELECT settings_json, updated_at FROM vendor_settings WHERE user_id = ?',
          args: [toTursoArg(userId)],
        },
      },
      { type: 'close' },
    ],
  };

  const data = await postTursoPipelineWithAuth(payload, userId);
  const rows = parsePipelineRows(data);

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  return {
    settingsJson: String(row.settings_json ?? ''),
    updatedAt: toUpdatedAt(row.updated_at),
  };
}

export async function deleteCloudAccount(userId: string): Promise<void> {
  const payload: { requests: TursoStatement[] } = {
    requests: [
      {
        type: 'execute',
        stmt: {
          sql: 'DELETE FROM inventory WHERE user_id = ?',
          args: [toTursoArg(userId)],
        },
      },
      {
        type: 'execute',
        stmt: {
          sql: 'DELETE FROM vendor_settings WHERE user_id = ?',
          args: [toTursoArg(userId)],
        },
      },
      {
        type: 'execute',
        stmt: {
          sql: 'DELETE FROM sync_metadata WHERE user_id = ?',
          args: [toTursoArg(userId)],
        },
      },
      {
        type: 'execute',
        stmt: {
          sql: `UPDATE founder_counter
                SET claimed = claimed - 1
                WHERE id = 'founder'
                  AND claimed > 0
                  AND EXISTS (
                    SELECT 1 FROM vendors WHERE user_id = ? AND founder_seat_number IS NOT NULL
                  )`,
          args: [toTursoArg(userId)],
        },
      },
      {
        type: 'execute',
        stmt: {
          sql: 'DELETE FROM vendor_subscriptions WHERE user_id = ?',
          args: [toTursoArg(userId)],
        },
      },
      // team_members.team_id is the owner's user_id.
      {
        type: 'execute',
        stmt: {
          sql: 'DELETE FROM team_members WHERE team_id = ?',
          args: [toTursoArg(userId)],
        },
      },
      {
        type: 'execute',
        stmt: {
          sql: 'DELETE FROM teams WHERE owner_user_id = ?',
          args: [toTursoArg(userId)],
        },
      },
      {
        type: 'execute',
        stmt: {
          sql: 'DELETE FROM team_members WHERE member_user_id = ?',
          args: [toTursoArg(userId)],
        },
      },
      {
        type: 'execute',
        stmt: {
          sql: 'DELETE FROM vendors WHERE user_id = ?',
          args: [toTursoArg(userId)],
        },
      },
      { type: 'close' },
    ],
  };

  await postTursoPipelineWithAuth(payload, userId);
}
