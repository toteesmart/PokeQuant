// Test harness for the repo-root Cloudflare workers (worker_show_vendor.js,
// worker_pre_show.js via callerFor). Provides a stateful in-memory Turso
// `/v2/pipeline` fake, real ES256 keypairs + JWT signing (crypto.subtle is
// native under jest's node env), and a URL-routed fetch stub covering JWKS,
// RevenueCat, and the Supabase admin API. Only the SQL shapes the workers
// actually emit are implemented; anything else falls through to an empty
// result (which is also what schema-bootstrap statements see and harmlessly
// no-op on).

import worker from '../../../worker_show_vendor.js';

export type Row = Record<string, any>;

type RouteHandler = (args: any[], db: FakeTurso, sql: string) => Row[] | void;
type Route = { re: RegExp; fn: RouteHandler; once?: boolean };

const norm = (sql: string) => sql.replace(/\s+/g, ' ').trim();

function unwrapArg(a: any): any {
  if (a && typeof a === 'object' && 'type' in a) {
    if (a.type === 'null') return null;
    if (a.type === 'integer' || a.type === 'float') return Number(a.value);
    return a.value;
  }
  return a;
}

function splitTopLevel(s: string, sep = ','): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = '';
  for (const ch of s) {
    if (inStr) {
      cur += ch;
      if (ch === "'") inStr = false;
      continue;
    }
    if (ch === "'") {
      inStr = true;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    } else if (ch === sep && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim());
}

// Evaluates the limited expression grammar the worker emits in VALUES / SET
// clauses: '?', string/number literals, NULL, excluded.col, table.col
// (existing-row ref during upserts), bare col refs, and COALESCE(a, b).
function evalExpr(
  expr: string,
  ctx: { args: any[]; argIdx: { i: number }; incoming: Row; existing: Row | null }
): any {
  const e = expr.trim();
  if (e === '?') return ctx.args[ctx.argIdx.i++];
  let m = e.match(/^excluded\.(\w+)$/i);
  if (m) return ctx.incoming[m[1]];
  m = e.match(/^\w+\.(\w+)$/i);
  if (m) return ctx.existing ? ctx.existing[m[1]] : undefined;
  m = e.match(/^COALESCE\((.*)\)$/i);
  if (m) {
    const parts = splitTopLevel(m[1]);
    for (const p of parts) {
      const v = evalExpr(p, ctx);
      if (v !== null && v !== undefined) return v;
    }
    return null;
  }
  if (e.startsWith("'")) return e.slice(1, -1).replace(/''/g, "'");
  if (/^null$/i.test(e)) return null;
  if (/^-?\d+(\.\d+)?$/.test(e)) return Number(e);
  if (/^\w+$/.test(e) && ctx.existing) return ctx.existing[e];
  throw new Error(`workerHarness: unsupported expr '${e}'`);
}

function matchClause(row: Row, clause: string, ctx: { args: any[]; argIdx: { i: number } }): boolean {
  const c = clause.trim();
  let m = c.match(/^(\w+)\s+IS\s+NOT\s+NULL$/i);
  if (m) return row[m[1]] !== null && row[m[1]] !== undefined;
  m = c.match(/^(\w+)\s+IS\s+NULL$/i);
  if (m) return row[m[1]] === null || row[m[1]] === undefined;
  m = c.match(/^(\w+)\s+NOT\s+LIKE\s+(.+)$/i) || c.match(/^(\w+)\s+LIKE\s+(.+)$/i);
  if (m) {
    const negated = /NOT\s+LIKE/i.test(c);
    const pattern = evalExpr(m[2], { args: ctx.args, argIdx: ctx.argIdx, incoming: {}, existing: null });
    const needle = String(pattern).replace(/%/g, '');
    const value = String(row[m[1]] ?? '');
    const startsPct = String(pattern).startsWith('%');
    const endsPct = String(pattern).endsWith('%');
    const hit =
      startsPct && endsPct ? value.includes(needle) : startsPct ? value.endsWith(needle) : value.startsWith(needle);
    return negated ? !hit : hit;
  }
  m = c.match(/^(\w+)\s+NOT\s+IN\s*\((.*)\)$/i) || c.match(/^(\w+)\s+IN\s*\((.*)\)$/i);
  if (m) {
    const negated = /NOT\s+IN/i.test(c);
    const items = splitTopLevel(m[2]).map((p) =>
      evalExpr(p, { args: ctx.args, argIdx: ctx.argIdx, incoming: {}, existing: null })
    );
    const hit = items.map(String).includes(String(row[m[1]]));
    return negated ? !hit : hit;
  }
  m = c.match(/^COALESCE\((\w+),\s*([^)]+)\)\s*(=|>=|<=|<>|!=|>|<)\s*(.+)$/i);
  if (m) {
    const left = row[m[1]] ?? evalExpr(m[2], { args: ctx.args, argIdx: ctx.argIdx, incoming: {}, existing: null });
    const right = evalExpr(m[4], { args: ctx.args, argIdx: ctx.argIdx, incoming: {}, existing: null });
    return compare(left, m[3], right);
  }
  m = c.match(/^(\w+)\s*(=|>=|<=|<>|!=|>|<)\s*(.+)$/);
  if (m) {
    const right = evalExpr(m[3], { args: ctx.args, argIdx: ctx.argIdx, incoming: {}, existing: null });
    return compare(row[m[1]], m[2], right);
  }
  throw new Error(`workerHarness: unsupported WHERE clause '${c}'`);
}

function compare(left: any, op: string, right: any): boolean {
  const l = left === null || left === undefined ? null : left;
  const r = right === null || right === undefined ? null : right;
  switch (op) {
    case '=':
      return String(l) === String(r);
    case '!=':
    case '<>':
      return String(l) !== String(r);
    case '>':
      return Number(l) > Number(r);
    case '<':
      return Number(l) < Number(r);
    case '>=':
      return Number(l) >= Number(r);
    case '<=':
      return Number(l) <= Number(r);
    default:
      throw new Error(`workerHarness: unsupported op '${op}'`);
  }
}

function matchWhere(row: Row, where: string, ctx: { args: any[]; argIdx: { i: number } }): boolean {
  // Worker WHERE tails are plain AND chains (parenthesized OR only appears in
  // dedicated join handlers that never reach this evaluator).
  return where
    .split(/\s+AND\s+/i)
    .every((c) => matchClause(row, c, ctx));
}

export type TableName =
  | 'vendors'
  | 'shows'
  | 'vendor_show_registrations'
  | 'public_show_inventory'
  | 'vendor_subscriptions'
  | 'teams'
  | 'team_members'
  | 'app_config'
  | 'founder_counter';

// SQLite column defaults from the worker's CREATE/ALTER statements — applied
// to columns absent from an INSERT's column list, exactly as SQLite does.
const COLUMN_DEFAULTS: Partial<Record<TableName, Row>> = {
  vendors: { is_founder: 0, is_organizer: 0 },
  shows: { is_active: 1 },
  vendor_show_registrations: { status: 'pending', total_due: 0, paid_amount: 0 },
  public_show_inventory: { updated_at: 0 },
  vendor_subscriptions: { product_id: '', is_active: 0, updated_at: 0 },
  teams: { seats_total: 0 },
  founder_counter: { claimed: 0 },
};

export class FakeTurso {
  tables: Record<TableName, Row[]> = {
    vendors: [],
    shows: [],
    vendor_show_registrations: [],
    public_show_inventory: [],
    vendor_subscriptions: [],
    teams: [],
    team_members: [],
    app_config: [
      { key: 'payments_live', value: '0' },
      { key: 'founder_seat_limit', value: '50' },
    ],
    founder_counter: [{ id: 'founder', claimed: 0 }],
  };

  executed: { sql: string; args: any[] }[] = [];
  lastChanges = 0;
  private routes: Route[] = [];

  constructor() {
    this.registerDefaults();
  }

  seed(table: TableName, rows: Row[]): this {
    this.tables[table].push(...rows);
    return this;
  }

  /** Upsert an app_config value (tests must overwrite, not duplicate, keys). */
  setConfig(key: string, value: string): this {
    const row = this.tables.app_config.find((r) => r.key === key);
    if (row) row.value = value;
    else this.tables.app_config.push({ key, value });
    return this;
  }

  table(table: TableName): Row[] {
    return this.tables[table];
  }

  /** Test-specific handler, tried before the built-in routes. */
  override(re: RegExp, fn: RouteHandler): this {
    this.routes.unshift({ re, fn });
    return this;
  }

  /** Make the next matching statement fail once with a Turso pipeline error. */
  failOnce(re: RegExp, message: string): this {
    this.routes.unshift({
      re,
      once: true,
      fn: () => {
        throw new Error(message);
      },
    });
    return this;
  }

  /** All executed statements whose normalized SQL matches `re`. */
  matching(re: RegExp): { sql: string; args: any[] }[] {
    return this.executed.filter((s) => re.test(s.sql));
  }

  /** Executed INSERT/UPDATE/DELETE statements targeting `table`. */
  writesTo(table: TableName): { sql: string; args: any[] }[] {
    return this.matching(new RegExp(`^(INSERT INTO|UPDATE|DELETE FROM)\\s+${table}\\b`));
  }

  private dispatch(sql: string, args: any[]): Row[] {
    for (let i = 0; i < this.routes.length; i++) {
      const route = this.routes[i];
      if (!route.re.test(sql)) continue;
      if (route.once) this.routes.splice(i, 1);
      return route.fn(args, this, sql) ?? [];
    }
    return [];
  }

  handlePipeline(init: any): Response {
    const body = JSON.parse(init.body);
    const results = (body.requests || []).map((req: any) => {
      if (req.type === 'close') return { type: 'ok', response: { type: 'close' } };
      if (req.type !== 'execute' || !req.stmt) {
        return { type: 'ok', response: { type: req.type } };
      }
      const sql = norm(req.stmt.sql);
      const args = (req.stmt.args || []).map(unwrapArg);
      this.executed.push({ sql, args });
      try {
        const rows = this.dispatch(sql, args);
        const cols: string[] = [];
        for (const row of rows) {
          for (const k of Object.keys(row)) {
            if (!cols.includes(k)) cols.push(k);
          }
        }
        return {
          type: 'ok',
          response: {
            type: 'execute',
            result: {
              cols: cols.map((name) => ({ name })),
              rows: rows.map((row) => cols.map((c) => row[c] ?? null)),
            },
          },
        };
      } catch (e: any) {
        return { type: 'error', error: { message: String(e?.message || e) } };
      }
    });
    return Response.json({ results });
  }

  private whereRows(table: TableName, where: string, args: any[]): Row[] {
    // Fresh argIdx per row: every row sees the full arg list, as SQL binds it.
    return this.tables[table].filter((row) =>
      matchWhere(row, where, { args, argIdx: { i: 0 } })
    );
  }

  private applyUpdate(table: TableName, sql: string, args: any[]): void {
    const m = sql.match(/^UPDATE\s+\w+\s+SET\s+(.*)\s+WHERE\s+(.*)$/i);
    if (!m) throw new Error(`workerHarness: cannot parse UPDATE '${sql}'`);
    const assignments = splitTopLevel(m[1]).map((a) => {
      const am = a.match(/^(\w+)\s*=\s*(.*)$/s);
      if (!am) throw new Error(`workerHarness: bad assignment '${a}'`);
      return { col: am[1], expr: am[2] };
    });
    const where = m[2];
    let changed = 0;
    for (const row of this.tables[table]) {
      // One arg stream per row: SET '?' placeholders consume args[0..k-1],
      // WHERE '?' placeholders continue from k.
      const ctx = { args, argIdx: { i: 0 }, incoming: {}, existing: row as Row | null };
      const pending = assignments.map(({ col, expr }) => [col, evalExpr(expr, ctx)] as const);
      if (!matchWhere(row, where, ctx)) continue;
      for (const [col, v] of pending) row[col] = v;
      changed++;
    }
    this.lastChanges = changed;
  }

  private insertRow(table: TableName, sql: string, args: any[]): void {
    const m = sql.match(
      /^INSERT\s+(OR\s+IGNORE\s+)?INTO\s+(\w+)\s*\(([^)]*)\)\s*VALUES\s*\(([\s\S]*?)\)\s*(?:ON\s+CONFLICT\s*\(([^)]*)\)\s*DO\s+UPDATE\s+SET\s+([\s\S]*?)(?:\s+WHERE\s+([\s\S]*))?)?$/i
    );
    if (!m) throw new Error(`workerHarness: cannot parse INSERT '${sql}'`);
    const cols = m[3].split(',').map((c) => c.trim());
    const valueExprs = splitTopLevel(m[4]);
    const ctx = { args, argIdx: { i: 0 }, incoming: {}, existing: null as Row | null };
    const incoming: Row = {};
    cols.forEach((col, i) => {
      incoming[col] = evalExpr(valueExprs[i], { ...ctx, incoming });
    });
    for (const [col, def] of Object.entries(COLUMN_DEFAULTS[m[2] as TableName] ?? {})) {
      if (!(col in incoming)) incoming[col] = def;
    }
    ctx.incoming = incoming;

    if (m[5]) {
      const conflictCols = m[5].split(',').map((c) => c.trim());
      const existing = this.tables[m[2] as TableName].find((row) =>
        conflictCols.every((c) => String(row[c]) === String(incoming[c]))
      );
      if (existing) {
        let doUpdate = true;
        if (m[7]) {
          const wm = m[7].trim().match(/^excluded\.(\w+)\s*>\s*\w+\.(\w+)$/i);
          if (wm) doUpdate = Number(incoming[wm[1]]) > Number(existing[wm[2]]);
          else throw new Error(`workerHarness: unsupported upsert WHERE '${m[7]}'`);
        }
        if (doUpdate) {
          for (const assign of splitTopLevel(m[6])) {
            const am = assign.match(/^(\w+)\s*=\s*(.*)$/s);
            if (!am) throw new Error(`workerHarness: bad assignment '${assign}'`);
            existing[am[1]] = evalExpr(am[2], {
              args,
              argIdx: { i: ctx.argIdx.i },
              incoming,
              existing,
            });
          }
        }
        this.lastChanges = doUpdate ? 1 : 0;
        return;
      }
    }

    const isOrIgnore = !!m[1];
    if (isOrIgnore && !m[5]) {
      // INSERT OR IGNORE without ON CONFLICT: primary-key emulation for
      // team_members (team_id, member_user_id) and unique single-col tables.
      const pkCols =
        m[2] === 'team_members' ? ['team_id', 'member_user_id'] : [cols[0]];
      const dupe = this.tables[m[2] as TableName].some((row) =>
        pkCols.every((c) => String(row[c]) === String(incoming[c]))
      );
      if (dupe) {
        this.lastChanges = 0;
        return;
      }
    }
    this.tables[m[2] as TableName].push(incoming);
    this.lastChanges = 1;
  }

  private registerDefaults(): void {
    const noise = (re: RegExp): Route => ({ re, fn: () => [] });
    this.routes.push(
      // ---- schema bootstrap noise (executes fine, affects nothing) ----
      noise(/^(CREATE|ALTER|DROP)\b/i),
      noise(/^INSERT\s+OR\s+IGNORE\s+INTO\s+(app_config|founder_counter)\b/i),
      noise(/^INSERT INTO founder_counter\b/i),
      noise(/^DELETE FROM founder_counter\b/i),
      noise(/^UPDATE founder_counter SET claimed = COUNT/i),
      noise(/^WITH ranked AS/i),
      noise(/^UPDATE public_show_inventory SET dedupe_key = CASE/i),
      noise(/^DELETE FROM public_show_inventory WHERE rowid NOT IN/i),
      noise(/^INSERT INTO vendor_subscriptions \(([^)]*)\)\s*SELECT\b/i),
      { re: /^PRAGMA table_info\('vendor_subscriptions'\)/i, fn: () => [{ pk: 1 }, { pk: 2 }] },
      {
        re: /^PRAGMA index_list/i,
        fn: () => [{ name: 'ux_public_show_inventory', unique: 1 }],
      },

      // ---- app_config / founder_counter ----
      {
        re: /^SELECT value FROM app_config WHERE key = \?$/,
        fn: (a, db) => db.tables.app_config.filter((r) => r.key === a[0]),
      },
      {
        // Gate-context batch reads both flags in one statement.
        re: /^SELECT key, value FROM app_config WHERE key IN \('payments_live', 'founder_seat_limit'\)$/,
        fn: (_a, db) =>
          db.tables.app_config.filter(
            (r) => r.key === 'payments_live' || r.key === 'founder_seat_limit'
          ),
      },
      {
        re: /^SELECT claimed FROM founder_counter/i,
        // Repair-loop view: claimed always equals the live seat count so the
        // schema recompute stays a no-op regardless of seed order.
        fn: (_a, db) => [
          { claimed: db.tables.vendors.filter((v) => v.founder_seat_number != null).length },
        ],
      },
      {
        re: /^UPDATE founder_counter SET claimed = claimed - 1 WHERE id = 'founder' AND claimed > 0$/,
        fn: (_a, db) => {
          const row = db.tables.founder_counter.find((r) => r.id === 'founder');
          if (row && Number(row.claimed) > 0) {
            row.claimed = Number(row.claimed) - 1;
            db.lastChanges = 1;
          } else {
            db.lastChanges = 0;
          }
        },
      },

      // ---- vendors ----
      {
        re: /^SELECT \* FROM vendors WHERE user_id = \?$/,
        fn: (a, db) => db.whereRows('vendors', 'user_id = ?', a),
      },
      {
        re: /^SELECT \* FROM vendors WHERE id = \?$/,
        fn: (a, db) => db.whereRows('vendors', 'id = ?', a),
      },
      {
        re: /^SELECT name FROM vendors WHERE user_id = \?$/,
        fn: (a, db) => db.whereRows('vendors', 'user_id = ?', a).map((v) => ({ name: v.name })),
      },
      {
        re: /^SELECT id, name FROM vendors WHERE id = \?$/,
        fn: (a, db) => db.whereRows('vendors', 'id = ?', a).map((v) => ({ id: v.id, name: v.name })),
      },
      {
        re: /^SELECT id, name FROM vendors WHERE id NOT LIKE 'manual:%'/i,
        fn: (_a, db) =>
          db.tables.vendors
            .filter((v) => !String(v.id).startsWith('manual:'))
            .map((v) => ({ id: v.id, name: v.name }))
            .sort((x, y) => String(x.name).toLowerCase().localeCompare(String(y.name).toLowerCase())),
      },
      {
        re: /^SELECT COUNT\(\*\) AS c FROM vendors WHERE founder_seat_number IS NOT NULL$/,
        fn: (_a, db) => [
          { c: db.tables.vendors.filter((v) => v.founder_seat_number != null).length },
        ],
      },
      {
        re: /^SELECT COUNT\(\*\) AS c FROM vendors WHERE founder_seat_number IS NULL$/,
        fn: (_a, db) => [
          { c: db.tables.vendors.filter((v) => v.founder_seat_number == null).length },
        ],
      },
      {
        re: /^SELECT COUNT\(\*\) AS c FROM vendors$/,
        fn: (_a, db) => [{ c: db.tables.vendors.length }],
      },
      {
        re: /^INSERT INTO vendors \(/,
        fn: (a, db, sql) => void db.insertRow('vendors', sql, a),
      },
      {
        // Atomic founder-seat claim: assigns MAX(seat)+1 when a seat is free.
        re: /^UPDATE vendors SET is_founder = 1, founder_seat_number = \(SELECT/,
        fn: (a, db) => {
          const limit = Number(a[1]);
          const claimed = db.tables.vendors.filter((v) => v.founder_seat_number != null);
          const vendor = db.tables.vendors.find((v) => v.id === a[0]);
          if (vendor && vendor.founder_seat_number == null && claimed.length < limit) {
            vendor.is_founder = 1;
            vendor.founder_seat_number =
              Math.max(0, ...claimed.map((v) => Number(v.founder_seat_number) || 0)) + 1;
            db.lastChanges = 1;
          } else {
            db.lastChanges = 0;
          }
        },
      },
      {
        re: /^UPDATE vendors SET is_founder = 0 WHERE user_id = \? AND is_founder = 1$/,
        fn: (a, db) => db.applyUpdate('vendors', 'UPDATE vendors SET is_founder = 0 WHERE user_id = ? AND is_founder = 1', a),
      },
      {
        re: /^UPDATE vendors SET is_founder = 1 WHERE user_id = \? AND founder_seat_number IS NOT NULL AND is_founder = 0$/,
        fn: (a, db) =>
          db.applyUpdate(
            'vendors',
            'UPDATE vendors SET is_founder = 1 WHERE user_id = ? AND founder_seat_number IS NOT NULL AND is_founder = 0',
            a
          ),
      },
      {
        re: /^DELETE FROM vendors WHERE user_id = \?$/,
        fn: (a, db) => {
          const n = db.tables.vendors.length;
          db.tables.vendors = db.tables.vendors.filter((v) => String(v.user_id) !== String(a[0]));
          db.lastChanges = n - db.tables.vendors.length;
        },
      },

      // ---- shows ----
      {
        re: /^SELECT \* FROM shows WHERE id = \?$/,
        fn: (a, db) => db.whereRows('shows', 'id = ?', a),
      },
      { re: /^INSERT INTO shows \(/, fn: (a, db, sql) => void db.insertRow('shows', sql, a) },
      {
        re: /^UPDATE shows SET /,
        fn: (a, db, sql) => db.applyUpdate('shows', sql, a),
      },

      // ---- show-access / list joins ----
      {
        re: /^SELECT s\.id AS show_id, s\.is_active AS is_active, s\.vendor_id AS owner_vendor_id/,
        fn: (a, db) => {
          const show = db.tables.shows.find((s) => String(s.id) === String(a[1]));
          if (!show) return [];
          const reg = db.tables.vendor_show_registrations.find(
            (r) => String(r.show_id) === String(a[1]) && String(r.vendor_id) === String(a[0])
          );
          return [
            {
              show_id: show.id,
              is_active: show.is_active,
              owner_vendor_id: show.vendor_id,
              registration_status: reg ? reg.status ?? '' : '',
            },
          ];
        },
      },
      {
        re: /^SELECT s\.id, s\.vendor_id, s\.name, s\.start_date/,
        fn: (a, db) =>
          db.tables.shows
            .filter((s) => Number(s.is_active) === 1)
            .map((s) => {
              const reg = db.tables.vendor_show_registrations.find(
                (r) => String(r.show_id) === String(s.id) && String(r.vendor_id) === String(a[0])
              );
              return { show: s, reg };
            })
            .filter(
              ({ show, reg }) =>
                String(show.vendor_id) === String(a[1]) ||
                (reg && (reg.status === 'approved' || reg.status === 'pending'))
            )
            .sort((x, y) => String(x.show.start_date ?? '').localeCompare(String(y.show.start_date ?? '')))
            .map(({ show, reg }) => ({
              id: show.id,
              vendor_id: show.vendor_id,
              name: show.name,
              start_date: show.start_date,
              location: show.location,
              is_active: show.is_active,
              table_count: show.table_count ?? null,
              pay_instructions: show.pay_instructions ?? '',
              my_status_raw: reg ? reg.status : null,
              my_table: reg ? reg.table_number ?? '' : '',
            })),
      },

      // ---- registrations ----
      {
        re: /^SELECT vsr\.show_id, s\.name AS show_name/,
        fn: (a, db) =>
          db.tables.vendor_show_registrations
            .filter(
              (r) =>
                String(r.vendor_id) === String(a[0]) &&
                r.status === 'approved' &&
                Number(r.total_due) > Number(r.paid_amount)
            )
            .map((r): Row | null => {
              const show = db.tables.shows.find((s) => String(s.id) === String(r.show_id));
              if (!show || Number(show.is_active) !== 1) return null;
              const org = db.tables.vendors.find((v) => String(v.id) === String(show.vendor_id));
              return {
                show_id: r.show_id,
                show_name: show.name ?? '',
                pay_instructions: show.pay_instructions ?? '',
                organizer_name: org ? org.name ?? '' : '',
                table_number: r.table_number ?? '',
                total_due: r.total_due,
                paid_amount: r.paid_amount,
                start_date: show.start_date ?? '',
              };
            })
            .filter((r): r is Row => r !== null)
            .sort((x, y) => String(x.start_date).localeCompare(String(y.start_date))),
      },
      {
        re: /^SELECT \* FROM vendor_show_registrations WHERE show_id = \? AND vendor_id = \?$/,
        fn: (a, db) => db.whereRows('vendor_show_registrations', 'show_id = ? AND vendor_id = ?', a),
      },
      {
        re: /^SELECT \* FROM vendor_show_registrations WHERE show_id = \? ORDER BY/,
        fn: (a, db) =>
          db
            .whereRows('vendor_show_registrations', 'show_id = ?', a)
            .sort((x, y) => Number(y.created_at ?? 0) - Number(x.created_at ?? 0)),
      },
      {
        re: /^INSERT INTO vendor_show_registrations \(/,
        fn: (a, db, sql) => void db.insertRow('vendor_show_registrations', sql, a),
      },
      {
        re: /^UPDATE vendor_show_registrations SET /,
        fn: (a, db, sql) => db.applyUpdate('vendor_show_registrations', sql, a),
      },

      // ---- public_show_inventory ----
      {
        re: /^SELECT \* FROM public_show_inventory WHERE vendor_id = \? AND show_id = \? ORDER BY/,
        fn: (a, db) =>
          db
            .whereRows('public_show_inventory', 'vendor_id = ? AND show_id = ?', a)
            .sort((x, y) => String(x.name ?? '').toLowerCase().localeCompare(String(y.name ?? '').toLowerCase())),
      },
      {
        re: /^SELECT vendor_id, product_id, name, set_name, number, condition, dedupe_key FROM public_show_inventory WHERE id = \?$/,
        fn: (a, db) => db.whereRows('public_show_inventory', 'id = ?', a),
      },
      {
        re: /^SELECT vendor_id FROM public_show_inventory WHERE id = \?$/,
        fn: (a, db) => db.whereRows('public_show_inventory', 'id = ?', a).map((r) => ({ vendor_id: r.vendor_id })),
      },
      {
        re: /^INSERT INTO public_show_inventory \(/,
        fn: (a, db, sql) => void db.insertRow('public_show_inventory', sql, a),
      },
      {
        re: /^UPDATE public_show_inventory SET /,
        fn: (a, db, sql) => db.applyUpdate('public_show_inventory', sql, a),
      },
      {
        re: /^DELETE FROM public_show_inventory WHERE id = \?$/,
        fn: (a, db) => {
          const n = db.tables.public_show_inventory.length;
          db.tables.public_show_inventory = db.tables.public_show_inventory.filter((r) => String(r.id) !== String(a[0]));
          db.lastChanges = n - db.tables.public_show_inventory.length;
        },
      },
      {
        re: /^DELETE FROM public_show_inventory WHERE vendor_id = \?$/,
        fn: (a, db) => {
          const n = db.tables.public_show_inventory.length;
          db.tables.public_show_inventory = db.tables.public_show_inventory.filter((r) => String(r.vendor_id) !== String(a[0]));
          db.lastChanges = n - db.tables.public_show_inventory.length;
        },
      },

      // ---- vendor_subscriptions ----
      {
        re: /^SELECT 1 FROM vendor_subscriptions WHERE user_id = \? AND entitlement_id = \? AND is_active = 1 AND \(expires_at IS NULL OR expires_at > \?\)/,
        fn: (a, db) =>
          db.tables.vendor_subscriptions
            .filter(
              (s) =>
                String(s.user_id) === String(a[0]) &&
                String(s.entitlement_id) === String(a[1]) &&
                Number(s.is_active) === 1 &&
                (s.expires_at == null || Number(s.expires_at) > Number(a[2]))
            )
            .map(() => ({ '1': 1 })),
      },
      {
        re: /^SELECT product_id, is_active, expires_at FROM vendor_subscriptions WHERE user_id = \? AND is_active = 1$/,
        fn: (a, db) =>
          db.whereRows('vendor_subscriptions', 'user_id = ? AND is_active = 1', a).map((s) => ({
            product_id: s.product_id,
            is_active: s.is_active,
            expires_at: s.expires_at,
          })),
      },
      {
        re: /^INSERT INTO vendor_subscriptions \(([^)]*)\) VALUES/,
        fn: (a, db, sql) => void db.insertRow('vendor_subscriptions', sql, a),
      },
      {
        re: /^DELETE FROM vendor_subscriptions WHERE user_id = \? AND product_id NOT IN/,
        fn: (a, db) => {
          const keep = new Set(a.slice(1).map(String));
          const n = db.tables.vendor_subscriptions.length;
          db.tables.vendor_subscriptions = db.tables.vendor_subscriptions.filter(
            (s) => String(s.user_id) !== String(a[0]) || keep.has(String(s.product_id))
          );
          db.lastChanges = n - db.tables.vendor_subscriptions.length;
        },
      },
      {
        re: /^DELETE FROM vendor_subscriptions WHERE user_id = \?$/,
        fn: (a, db) => {
          const n = db.tables.vendor_subscriptions.length;
          db.tables.vendor_subscriptions = db.tables.vendor_subscriptions.filter((s) => String(s.user_id) !== String(a[0]));
          db.lastChanges = n - db.tables.vendor_subscriptions.length;
        },
      },

      // ---- teams ----
      {
        re: /^SELECT \* FROM teams WHERE owner_user_id = \?$/,
        fn: (a, db) => db.whereRows('teams', 'owner_user_id = ?', a),
      },
      {
        re: /^SELECT \* FROM teams WHERE invite_code = \?$/,
        fn: (a, db) => db.whereRows('teams', 'invite_code = ?', a),
      },
      {
        re: /^SELECT t\.owner_user_id FROM team_members tm JOIN teams t ON tm\.team_id = t\.owner_user_id WHERE tm\.member_user_id = \? AND \(t\.expires_at IS NULL OR t\.expires_at > \?\)/,
        fn: (a, db) =>
          db.tables.team_members
            .filter((tm) => String(tm.member_user_id) === String(a[0]))
            .map((tm) => db.tables.teams.find((t) => String(t.owner_user_id) === String(tm.team_id)))
            .filter((t): t is Row => !!t && (t.expires_at == null || Number(t.expires_at) > Number(a[1])))
            .map((t) => ({ owner_user_id: t.owner_user_id })),
      },
      {
        re: /^SELECT t\.\* FROM team_members tm JOIN teams t ON tm\.team_id = t\.owner_user_id WHERE tm\.member_user_id = \?/,
        fn: (a, db) =>
          db.tables.team_members
            .filter((tm) => String(tm.member_user_id) === String(a[0]))
            .map((tm) => db.tables.teams.find((t) => String(t.owner_user_id) === String(tm.team_id)))
            .filter((t): t is Row => !!t)
            .slice(0, 1),
      },
      {
        re: /^SELECT tm\.member_user_id, v\.name AS member_name, tm\.created_at FROM team_members/,
        fn: (a, db) =>
          db.tables.team_members
            .filter((tm) => String(tm.team_id) === String(a[0]))
            .map((tm) => {
              const v = db.tables.vendors.find((x) => String(x.user_id) === String(tm.member_user_id));
              return { member_user_id: tm.member_user_id, member_name: v ? v.name : null, created_at: tm.created_at };
            })
            .sort((x, y) => Number(x.created_at ?? 0) - Number(y.created_at ?? 0)),
      },
      {
        re: /^SELECT COUNT\(\*\) AS c FROM team_members WHERE team_id = \?$/,
        fn: (a, db) => [{ c: db.tables.team_members.filter((tm) => String(tm.team_id) === String(a[0])).length }],
      },
      {
        re: /^INSERT INTO teams \(/,
        fn: (a, db, sql) => void db.insertRow('teams', sql, a),
      },
      {
        re: /^UPDATE teams SET /,
        fn: (a, db, sql) => db.applyUpdate('teams', sql, a),
      },
      {
        re: /^DELETE FROM teams WHERE owner_user_id = \?$/,
        fn: (a, db) => {
          const n = db.tables.teams.length;
          db.tables.teams = db.tables.teams.filter((t) => String(t.owner_user_id) !== String(a[0]));
          db.lastChanges = n - db.tables.teams.length;
        },
      },
      {
        re: /^INSERT OR IGNORE INTO team_members \(/,
        fn: (a, db, sql) => void db.insertRow('team_members', sql, a),
      },
      {
        re: /^DELETE FROM team_members WHERE team_id = \? AND member_user_id = \?$/,
        fn: (a, db) => {
          const n = db.tables.team_members.length;
          db.tables.team_members = db.tables.team_members.filter(
            (tm) => !(String(tm.team_id) === String(a[0]) && String(tm.member_user_id) === String(a[1]))
          );
          db.lastChanges = n - db.tables.team_members.length;
        },
      },
      {
        re: /^DELETE FROM team_members WHERE member_user_id = \?$/,
        fn: (a, db) => {
          const n = db.tables.team_members.length;
          db.tables.team_members = db.tables.team_members.filter((tm) => String(tm.member_user_id) !== String(a[0]));
          db.lastChanges = n - db.tables.team_members.length;
        },
      },
      {
        re: /^DELETE FROM team_members WHERE team_id = \?$/,
        fn: (a, db) => {
          const n = db.tables.team_members.length;
          db.tables.team_members = db.tables.team_members.filter((tm) => String(tm.team_id) !== String(a[0]));
          db.lastChanges = n - db.tables.team_members.length;
        },
      },

      // ---- misc ----
      {
        re: /^SELECT changes\(\) AS changes$/,
        fn: (_a, db) => [{ changes: db.lastChanges }],
      },

      // ---- worker_pre_show.js (public snapshot worker) ----
      // Column-projected to match the SELECT lists the worker emits; the
      // pipeline response's cols are built from returned row keys.
      {
        re: /^SELECT id, vendor_id, name, start_date, location, is_active FROM shows WHERE is_active = 1$/,
        fn: (_a, db) =>
          db.tables.shows
            .filter((s) => Number(s.is_active) === 1)
            .map((s) => ({
              id: s.id ?? null,
              vendor_id: s.vendor_id ?? null,
              name: s.name ?? null,
              start_date: s.start_date ?? null,
              location: s.location ?? null,
              is_active: s.is_active ?? null,
            })),
      },
      {
        re: /^SELECT id, vendor_id, name, start_date, location, is_active FROM shows WHERE id = \?$/,
        fn: (a, db) =>
          db.whereRows('shows', 'id = ?', a).map((s) => ({
            id: s.id ?? null,
            vendor_id: s.vendor_id ?? null,
            name: s.name ?? null,
            start_date: s.start_date ?? null,
            location: s.location ?? null,
            is_active: s.is_active ?? null,
          })),
      },
      {
        re: /^SELECT id, product_id, name, set_name, number, rarity, condition, sticker_price, quantity, vendor_name, vendor_table FROM public_show_inventory WHERE show_id = \?$/,
        fn: (a, db) =>
          db.whereRows('public_show_inventory', 'show_id = ?', a).map((r) => ({
            id: r.id ?? null,
            product_id: r.product_id ?? null,
            name: r.name ?? null,
            set_name: r.set_name ?? null,
            number: r.number ?? null,
            rarity: r.rarity ?? null,
            condition: r.condition ?? null,
            sticker_price: r.sticker_price ?? null,
            quantity: r.quantity ?? null,
            vendor_name: r.vendor_name ?? null,
            vendor_table: r.vendor_table ?? null,
          })),
      }
    );
  }
}

// ---------- JWT / identity ----------

export interface TestKey {
  kid: string;
  privateKey: CryptoKey;
  jwk: Record<string, any>;
}

export async function makeSigningKey(kid = 'test-key'): Promise<TestKey> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as Record<string, any>;
  jwk.kid = kid;
  jwk.alg = 'ES256';
  jwk.use = 'sig';
  return { kid, privateKey: pair.privateKey, jwk };
}

const b64u = (data: string | Uint8Array): string => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let bin = '';
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export async function signJwt(key: TestKey, payload: Row, header: Row = {}): Promise<string> {
  const head = b64u(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: key.kid, ...header }));
  const body = b64u(JSON.stringify(payload));
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key.privateKey,
      new TextEncoder().encode(`${head}.${body}`)
    )
  );
  return `${head}.${body}.${b64u(sig)}`;
}

export function unsignedJwt(parts: {
  header?: Row;
  payload: Row;
  signature?: string;
}): string {
  const head = b64u(JSON.stringify(parts.header ?? { alg: 'ES256', typ: 'JWT', kid: 'test-key' }));
  const body = b64u(JSON.stringify(parts.payload));
  return `${head}.${body}.${parts.signature ?? 'AAAA'}`;
}

export function makeEnv(overrides: Row = {}): Row {
  return {
    TURSO_DATABASE_URL: 'https://fake-db.turso.io',
    TURSO_AUTH_TOKEN: 'turso-token',
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_JWKS_URL: 'https://supabase.test/auth/v1/.well-known/jwks.json',
    ...overrides,
  };
}

export function defaultClaims(user: Row = {}): Row {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: 'user-1',
    email: 'vendor@example.com',
    user_metadata: { username: 'CardKing' },
    iss: 'https://supabase.test/auth/v1',
    iat: now,
    exp: now + 3600,
    ...user,
  };
}

// ---------- fetch plumbing ----------

export interface FetchRoutes {
  jwks?: Record<string, any>[] | (() => Response);
  revenueCat?: (url: string, init: any) => Response | Promise<Response>;
  onRequest?: (url: string, init: any) => void;
}

export function installFetch(db: FakeTurso, routes: FetchRoutes = {}) {
  const spy = jest.fn(async (input: any, init: any = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    routes.onRequest?.(url, init);
    if (url.includes('/v2/pipeline')) {
      // worker.js forwards via fetch(new Request(url, init)) — the body lives
      // on the Request, not init. Read it so handlePipeline sees init.body.
      const effectiveInit =
        typeof input === 'string'
          ? init
          : { ...init, body: await input.text() };
      return db.handlePipeline(effectiveInit);
    }
    if (url.includes('/.well-known/jwks.json')) {
      if (typeof routes.jwks === 'function') return routes.jwks();
      return Response.json({ keys: routes.jwks ?? [] });
    }
    if (url.startsWith('https://api.revenuecat.com/')) {
      if (routes.revenueCat) return routes.revenueCat(url, init);
      return new Response('not configured', { status: 404 });
    }
    if (url.includes('/auth/v1/admin/users/')) {
      return new Response(null, { status: 204 });
    }
    return new Response(`unmocked fetch: ${url}`, { status: 599 });
  });
  (globalThis as any).fetch = spy;
  return spy;
}

export interface CallOpts {
  method?: string;
  token?: string | null;
  body?: any;
  rawBody?: string;
  headers?: Record<string, string>;
  env?: Row;
}

export type EdgeWorker = {
  fetch: (request: Request, env: any, ctx?: any) => Promise<Response> | Response;
};

async function invokeFetch(w: EdgeWorker, path: string, opts: CallOpts) {
  const method = opts.method ?? 'GET';
  const headers = new Headers(opts.headers ?? {});
  if (opts.token) headers.set('Authorization', `Bearer ${opts.token}`);
  let body: string | undefined;
  if (opts.rawBody !== undefined) {
    body = opts.rawBody;
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  }
  const request = new Request(`https://worker.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : body,
  });
  const response = await w.fetch(request, opts.env ?? makeEnv());
  const text = await response.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* leave null */
  }
  return { status: response.status, body: json, headers: response.headers, text };
}

export async function callWorker(path: string, opts: CallOpts = {}) {
  return invokeFetch(worker, path, opts);
}

/** Request plumbing bound to a different repo-root worker (worker_pre_show.js). */
export function callerFor(w: EdgeWorker) {
  return (path: string, opts: CallOpts = {}) => invokeFetch(w, path, opts);
}
