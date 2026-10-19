// Characterization suite for worker.js (repo root) — the production sync
// gateway and only tenant egress to Turso. Pins the tenant-binding contract
// the multi-row inventory upsert relies on: injectAndValidateUserId must
// force every VALUES group's user_id slot to the JWT subject, not just the
// first, and literal user_id mismatches must still 403. FakeTurso records
// the forwarded statements, so assertions observe post-injection args at
// wire granularity. The "request boundary" block pins the edge contract:
// CORS/method/size caps, the auth failure matrix, and JWKS cache reuse.

import {
  EdgeWorker,
  FakeTurso,
  TestKey,
  callerFor,
  defaultClaims,
  installFetch,
  makeEnv,
  makeSigningKey,
  signJwt,
  unsignedJwt,
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

describe('worker.js request boundary', () => {
  // A minimal valid pipeline body: `close` carries no stmt, so it skips
  // tenant validation and forwards straight to Turso.
  const VALID = [{ type: 'close' }];

  const authedToken = () => signJwt(key, defaultClaims({ aud: 'authenticated' }));

  const countJwksFetches = (spy: ReturnType<typeof installFetch>) =>
    spy.mock.calls.filter(([input]) =>
      String(input?.url ?? input).includes('/.well-known/jwks.json'),
    ).length;

  // Fresh worker module → module-level jwksCache/jwksFetchPromise reset to
  // cold, so JWKS fetch counts are measured from zero.
  const freshCaller = () => {
    jest.resetModules();
    let fresh: EdgeWorker = worker;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules needs a fresh CJS require to reset worker.js's module-level JWKS cache
      fresh = require('../../worker.js').default;
    });
    return callerFor(fresh);
  };

  it('answers OPTIONS with the CORS preflight headers', async () => {
    const res = await call('/', { method: 'OPTIONS' });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(res.headers.get('access-control-allow-headers')).toBe('Content-Type, Authorization');
    expect(res.text).toBe('');
  });

  it.each(['GET', 'PUT', 'DELETE'])('rejects %s with 405 and CORS headers', async (method) => {
    const res = await call('/', { method });
    expect(res.status).toBe(405);
    expect(res.text).toBe('Method not allowed');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('rejects a declared Content-Length over 1 MB before authentication', async () => {
    // No token on purpose: the header cap precedes auth entirely, so an
    // unauthenticated oversized request still gets 413, not 401.
    const res = await call('/', {
      method: 'POST',
      headers: { 'Content-Length': String(1024 * 1024 + 1) },
      rawBody: '{}',
    });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'Request body too large' });
  });

  it('rejects an actual body over 1 MB after auth when no Content-Length is set', async () => {
    const token = await authedToken();
    const res = await call('/', {
      method: 'POST',
      token,
      rawBody: 'x'.repeat(1024 * 1024 + 1),
    });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'Request body too large' });
  });

  it('rejects a pipeline with more than 2000 statements', async () => {
    const res = await authedPost(new Array(2001).fill({ type: 'close' }));
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'Too many pipeline statements' });
  });

  it('forwards a pipeline at exactly 2000 statements', async () => {
    const res = await authedPost(new Array(2000).fill({ type: 'close' }));
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(2000);
  });

  it('rejects a POST with no Authorization header', async () => {
    const res = await call('/', { method: 'POST', body: { requests: VALID } });
    expect(res.status).toBe(401);
    expect(res.text).toBe('Unauthorized');
  });

  it('rejects a non-Bearer authorization scheme', async () => {
    const res = await call('/', {
      method: 'POST',
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
      body: { requests: VALID },
    });
    expect(res.status).toBe(401);
    expect(res.text).toBe('Unauthorized');
  });

  it.each([
    ['missing segments', 'not-a-jwt'],
    ['non-JSON segments', 'aaa.bbb.ccc'],
  ])('rejects a malformed bearer token (%s)', async (_label, token) => {
    const res = await call('/', { method: 'POST', token, body: { requests: VALID } });
    expect(res.status).toBe(401);
    expect(res.text).toBe('Unauthorized');
  });

  it('rejects a well-formed ES256 JWT with an invalid signature', async () => {
    const token = unsignedJwt({ payload: defaultClaims({ aud: 'authenticated' }) });
    const res = await call('/', { method: 'POST', token, body: { requests: VALID } });
    expect(res.status).toBe(401);
    expect(res.text).toBe('Unauthorized');
  });

  it('rejects an expired token', async () => {
    const token = await signJwt(
      key,
      defaultClaims({ aud: 'authenticated', exp: Math.floor(Date.now() / 1000) - 3600 }),
    );
    const res = await call('/', { method: 'POST', token, body: { requests: VALID } });
    expect(res.status).toBe(401);
    expect(res.text).toBe('Unauthorized');
  });

  it('rejects a token whose header algorithm is not ES256', async () => {
    const token = unsignedJwt({
      header: { alg: 'HS256', typ: 'JWT', kid: key.kid },
      payload: defaultClaims({ aud: 'authenticated' }),
    });
    const res = await call('/', { method: 'POST', token, body: { requests: VALID } });
    expect(res.status).toBe(401);
    expect(res.text).toBe('Unauthorized');
  });

  it('rejects a token from a foreign issuer', async () => {
    const token = await signJwt(
      key,
      defaultClaims({ aud: 'authenticated', iss: 'https://evil.example.com/auth/v1' }),
    );
    const res = await call('/', { method: 'POST', token, body: { requests: VALID } });
    expect(res.status).toBe(401);
    expect(res.text).toBe('Unauthorized');
  });

  it('rejects a token without the "authenticated" audience', async () => {
    // Supabase access tokens carry aud="authenticated"; absent/mismatched
    // audiences are rejected to bound token reuse across projects/flows.
    const token = await signJwt(key, defaultClaims());
    const res = await call('/', { method: 'POST', token, body: { requests: VALID } });
    expect(res.status).toBe(401);
    expect(res.text).toBe('Unauthorized');
  });

  it('fetches JWKS on a cold cache and reuses it on the next request', async () => {
    const fetchSpy = installFetch(db, { jwks: [key.jwk] });
    const freshCall = freshCaller();
    const token = await authedToken();
    const post = () =>
      freshCall('/', { method: 'POST', token, body: { requests: VALID }, env: makeEnv() });

    expect((await post()).status).toBe(200);
    expect(countJwksFetches(fetchSpy)).toBe(1);
    expect((await post()).status).toBe(200);
    expect(countJwksFetches(fetchSpy)).toBe(1);
  });

  it('coalesces concurrent cold-cache verifications into a single JWKS fetch', async () => {
    const fetchSpy = installFetch(db, { jwks: [key.jwk] });
    const freshCall = freshCaller();
    const token = await authedToken();
    const post = () =>
      freshCall('/', { method: 'POST', token, body: { requests: VALID }, env: makeEnv() });

    const [r1, r2] = await Promise.all([post(), post()]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(countJwksFetches(fetchSpy)).toBe(1);
  });
});
