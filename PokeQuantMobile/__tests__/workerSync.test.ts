// Characterization suite for worker.js (repo root) — the sync pipeline
// gateway. Pins the tenant-binding contract the multi-row inventory upsert
// relies on: injectAndValidateUserId must force every VALUES group's
// user_id slot to the JWT subject, not just the first, and literal user_id
// mismatches must still 403. FakeTurso records the forwarded statements,
// so assertions observe post-injection args at wire granularity.

import {
  FakeTurso,
  TestKey,
  callerFor,
  defaultClaims,
  installFetch,
  makeEnv,
  makeSigningKey,
  signJwt,
} from './helpers/workerHarness';
import worker from '../../worker.js';

const call = callerFor(worker);

let db: FakeTurso;
let key: TestKey;

const text = (v: string) => ({ type: 'text', value: v });
const int = (v: number) => ({ type: 'integer', value: String(v) });

beforeAll(async () => {
  key = await makeSigningKey();
  // The worker console.error()s every handled error path by design; silence.
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

beforeEach(() => {
  db = new FakeTurso();
  installFetch(db, { jwks: [key.jwk] });
});

async function authedPost(requests: unknown[]) {
  const token = await signJwt(key, defaultClaims({ aud: 'authenticated' }));
  return call('/', {
    method: 'POST',
    token,
    body: { requests },
    env: makeEnv(),
  });
}

describe('worker.js tenant user_id injection', () => {
  it('binds user_id in every VALUES group of a multi-row upsert', async () => {
    const res = await authedPost([
      {
        type: 'execute',
        stmt: {
          sql: 'INSERT INTO inventory (id, user_id, updated_at) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?) ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, updated_at = excluded.updated_at WHERE excluded.updated_at > inventory.updated_at',
          args: [
            text('r1'),
            text('attacker'),
            int(100),
            text('r2'),
            text('victim'),
            int(200),
            text('r3'),
            text('attacker'),
            int(300),
          ],
        },
      },
      { type: 'close' },
    ]);

    expect(res.status).toBe(200);
    const writes = db.matching(/^INSERT INTO inventory \(/);
    expect(writes).toHaveLength(1);
    // All three user_id slots are overwritten with the JWT subject.
    expect(writes[0].args).toEqual(['r1', 'user-1', 100, 'r2', 'user-1', 200, 'r3', 'user-1', 300]);
  });

  it('still binds user_id on a single-row upsert', async () => {
    const res = await authedPost([
      {
        type: 'execute',
        stmt: {
          sql: 'INSERT INTO inventory (id, user_id, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at',
          args: [text('r1'), text('attacker'), int(100)],
        },
      },
      { type: 'close' },
    ]);

    expect(res.status).toBe(200);
    const writes = db.matching(/^INSERT INTO inventory \(/);
    expect(writes).toHaveLength(1);
    expect(writes[0].args).toEqual(['r1', 'user-1', 100]);
  });

  it('rejects a literal user_id that does not match the JWT subject', async () => {
    const res = await authedPost([
      {
        type: 'execute',
        stmt: {
          sql: "INSERT INTO inventory (id, user_id, updated_at) VALUES ('x', 'victim', 5) ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at",
          args: [],
        },
      },
      { type: 'close' },
    ]);

    expect(res.status).toBe(403);
    expect(db.matching(/^INSERT INTO inventory \(/)).toHaveLength(0);
  });

  it('rejects a tenant insert with no user_id binding', async () => {
    const res = await authedPost([
      {
        type: 'execute',
        stmt: {
          sql: 'INSERT INTO inventory (id, updated_at) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at',
          args: [text('r1'), int(100)],
        },
      },
      { type: 'close' },
    ]);

    expect(res.status).toBe(403);
    expect(db.matching(/^INSERT INTO inventory \(/)).toHaveLength(0);
  });
});

describe('worker.js pull pagination query allowlist', () => {
  // cloudSync.ts's paginated pull predicate. The NOT(...) form is the
  // OR-free equivalent of `updated_at > ? OR (updated_at = ? AND id > ?)` —
  // required because the tenant allowlist rejects any SELECT containing OR.
  const KEYSET_SQL =
    'SELECT * FROM inventory WHERE user_id = ? AND updated_at >= ? AND NOT (updated_at = ? AND id <= ?) ORDER BY updated_at ASC, id ASC LIMIT 500';

  it('forwards the OR-free keyset SELECT and force-binds user_id', async () => {
    const res = await authedPost([
      {
        type: 'execute',
        stmt: {
          sql: KEYSET_SQL,
          args: [text('attacker'), int(100), int(100), text('id-0042')],
        },
      },
      { type: 'close' },
    ]);

    expect(res.status).toBe(200);
    const reads = db.matching(/^SELECT \* FROM inventory/i);
    expect(reads).toHaveLength(1);
    // user_id placeholder (arg 0) is overwritten with the JWT subject; the
    // cursor args pass through untouched.
    expect(reads[0].args).toEqual(['user-1', 100, 100, 'id-0042']);
  });

  it('rejects the OR-form keyset predicate — why the query stays OR-free', async () => {
    const res = await authedPost([
      {
        type: 'execute',
        stmt: {
          sql: 'SELECT * FROM inventory WHERE user_id = ? AND (updated_at > ? OR (updated_at = ? AND id > ?)) ORDER BY updated_at ASC, id ASC LIMIT 500',
          args: [text('user-1'), int(0), int(0), text('')],
        },
      },
      { type: 'close' },
    ]);

    expect(res.status).toBe(403);
    expect(db.matching(/^SELECT \* FROM inventory/i)).toHaveLength(0);
  });
});

describe('worker.js vendor_settings upsert allowlist', () => {
  // cloudSync.ts's LWW-guarded push. The allowlist pattern pins the conflict
  // target to (user_id) — the table's real PK — and unlike the inventory
  // upsert pattern it lives in the OR-banned group.
  const UPSERT_SQL =
    'INSERT INTO vendor_settings (user_id, settings_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at WHERE excluded.updated_at > vendor_settings.updated_at';

  it('accepts the LWW-guarded upsert and force-binds user_id', async () => {
    const res = await authedPost([
      {
        type: 'execute',
        stmt: {
          sql: UPSERT_SQL,
          args: [text('attacker'), text('{"tiers":[]}'), int(1791918923)],
        },
      },
      { type: 'close' },
    ]);

    expect(res.status).toBe(200);
    const writes = db.matching(/^INSERT INTO vendor_settings \(/);
    expect(writes).toHaveLength(1);
    // user_id placeholder (arg 0) is overwritten with the JWT subject.
    expect(writes[0].args).toEqual(['user-1', '{"tiers":[]}', 1791918923]);
  });

  it('still accepts the legacy INSERT OR REPLACE form used by older builds', async () => {
    const res = await authedPost([
      {
        type: 'execute',
        stmt: {
          sql: 'INSERT OR REPLACE INTO vendor_settings (user_id, settings_json, updated_at) VALUES (?, ?, ?)',
          args: [text('attacker'), text('{"tiers":[]}'), int(100)],
        },
      },
      { type: 'close' },
    ]);

    expect(res.status).toBe(200);
    const writes = db.matching(/^INSERT OR REPLACE INTO vendor_settings \(/);
    expect(writes).toHaveLength(1);
    expect(writes[0].args).toEqual(['user-1', '{"tiers":[]}', 100]);
  });

  it('accepts the newest-first pull SELECT', async () => {
    const res = await authedPost([
      {
        type: 'execute',
        stmt: {
          sql: 'SELECT settings_json, updated_at FROM vendor_settings WHERE user_id = ? ORDER BY updated_at DESC',
          args: [text('attacker')],
        },
      },
      { type: 'close' },
    ]);

    expect(res.status).toBe(200);
    const reads = db.matching(/^SELECT settings_json, updated_at FROM vendor_settings/i);
    expect(reads).toHaveLength(1);
    expect(reads[0].args).toEqual(['user-1']);
  });

  it('rejects an upsert pinned to the wrong conflict target', async () => {
    // vendor_settings has no id column; ON CONFLICT(id) must never reach Turso.
    const res = await authedPost([
      {
        type: 'execute',
        stmt: {
          sql: 'INSERT INTO vendor_settings (user_id, settings_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json',
          args: [text('user-1'), text('{"tiers":[]}'), int(100)],
        },
      },
      { type: 'close' },
    ]);

    expect(res.status).toBe(403);
    expect(db.matching(/^INSERT INTO vendor_settings/)).toHaveLength(0);
  });

  it('rejects a DO NOTHING variant — only DO UPDATE is allowlisted', async () => {
    const res = await authedPost([
      {
        type: 'execute',
        stmt: {
          sql: 'INSERT INTO vendor_settings (user_id, settings_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO NOTHING',
          args: [text('user-1'), text('{"tiers":[]}'), int(100)],
        },
      },
      { type: 'close' },
    ]);

    expect(res.status).toBe(403);
    expect(db.matching(/^INSERT INTO vendor_settings/)).toHaveLength(0);
  });

  it('rejects the guarded upsert when its WHERE tail carries an OR', async () => {
    const res = await authedPost([
      {
        type: 'execute',
        stmt: {
          sql: 'INSERT INTO vendor_settings (user_id, settings_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET updated_at = excluded.updated_at WHERE excluded.updated_at > vendor_settings.updated_at OR 1 = 1',
          args: [text('user-1'), text('{"tiers":[]}'), int(100)],
        },
      },
      { type: 'close' },
    ]);

    expect(res.status).toBe(403);
    expect(db.matching(/^INSERT INTO vendor_settings/)).toHaveLength(0);
  });
});
