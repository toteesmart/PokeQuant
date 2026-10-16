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
    expect(writes[0].args).toEqual([
      'r1',
      'user-1',
      100,
      'r2',
      'user-1',
      200,
      'r3',
      'user-1',
      300,
    ]);
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
