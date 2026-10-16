// Characterization suite for worker_pre_show.js (repo root, ~360 lines).
// Public snapshot worker — no JWT. Pins the deployed contract: GET /shows
// sanitization, POST /trigger/{id} gating + the R2 artifact (real zip bytes
// decoded with node:zlib — the JS-unzipper ban is app-runtime only),
// POST /trigger batch semantics, and the plain-text catch-all.
// Statement-level Turso errors (results[] entries of {type:'error'})
// propagate as 500s — tursoPipeline scans the whole results array,
// mirroring worker_show_vendor/turso.js, and an error entry lacking
// `.error` falls through to a default message. The /trigger/{id} path
// param is decodeURIComponent'd like the vendor worker's route params.

import {
  FakeTurso,
  Row,
  callerFor,
  installFetch,
  makeEnv,
} from './helpers/workerHarness';
import worker from '../../worker_pre_show.js';

/* eslint-disable @typescript-eslint/no-require-imports -- node builtins via CJS require, same convention as inventoryHeld/liveCatalog */
const { inflateRawSync, crc32 } = require('node:zlib');
const { Buffer: ZipBuffer } = require('node:buffer');
// The jest env's ReadableStream is the RN web-streams polyfill, which the
// native undici Response refuses to consume ("member 'readable' is not a
// ReadableStream") inside buildZip's deflate pipeline. Swap in Node's
// native streams so CompressionStream('deflate-raw') runs as on workerd.
// (Call-site reads, not import-time — ES imports hoist over this anyway.)
const streamWeb = require('node:stream/web');
(globalThis as any).ReadableStream = streamWeb.ReadableStream;
(globalThis as any).CompressionStream = streamWeb.CompressionStream;
(globalThis as any).TransformStream = streamWeb.TransformStream;

const call = callerFor(worker);

// ---------- seeds ----------

const mkShow = (over: Row = {}): Row => ({
  id: 'show-1',
  vendor_id: 'org-v',
  name: 'Card Fest',
  start_date: '2026-11-01',
  location: 'Hall A',
  is_active: 1,
  table_count: 40,
  pay_instructions: 'Venmo @org',
  ...over,
});
const SHOW = mkShow();

const mkInv = (over: Row = {}): Row => ({
  id: 'row-1',
  show_id: 'show-1',
  vendor_id: 'vend',
  product_id: 111,
  name: 'Pikachu',
  set_name: 'Base Set',
  number: '58',
  rarity: 'Common',
  condition: 'NM',
  sticker_price: 5,
  quantity: 2,
  vendor_name: 'Vend Co',
  vendor_table: 'T9',
  dedupe_key: 'p:111',
  updated_at: 1000,
  ...over,
});

// ---------- plumbing ----------

let db: FakeTurso;
let bucket: { put: jest.Mock };
let env: Row;

beforeAll(() => {
  // The worker console.log()s every request path by design; silence.
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

beforeEach(() => {
  db = new FakeTurso();
  installFetch(db);
  bucket = { put: jest.fn(async () => ({})) };
  env = makeEnv({ EVENT_CATALOG_BUCKET: bucket });
});

// Captures each /v2/pipeline POST as a statement list: the worker issues
// one statement per round-trip, so batching is pinned at wire granularity.
const normSql = (s: string) => s.replace(/\s+/g, ' ').trim();
const unwrapArg = (a: any) =>
  a && typeof a === 'object' && 'type' in a ? (a.type === 'null' ? null : a.value) : a;

const capturePipelines = (): { sql: string; args: any[] }[][] => {
  const pipes: { sql: string; args: any[] }[][] = [];
  installFetch(db, {
    onRequest: (url, init) => {
      if (!String(url).includes('/v2/pipeline')) return;
      pipes.push(
        (JSON.parse(init.body).requests || [])
          .filter((r: any) => r.type === 'execute')
          .map((r: any) => ({
            sql: normSql(String(r.stmt.sql)),
            args: (r.stmt.args || []).map(unwrapArg),
          }))
      );
    },
  });
  return pipes;
};

// Parses the single-member zip the worker emits (local header → raw deflate
// member → central directory → EOCD) and pins its structural fields.
function unzipJson(zip: Uint8Array): any {
  const buf = ZipBuffer.from(zip);
  expect(buf.readUInt32LE(0)).toBe(0x04034b50); // local file header magic
  expect(buf.readUInt16LE(8)).toBe(8); // compression method: deflate
  const storedCrc = buf.readUInt32LE(14);
  const csize = buf.readUInt32LE(18);
  const usize = buf.readUInt32LE(22);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  expect(buf.subarray(30, 30 + nameLen).toString('utf8')).toBe('event_catalog.json');
  expect(buf.readUInt32LE(buf.length - 22)).toBe(0x06054b50); // EOCD magic
  const start = 30 + nameLen + extraLen;
  const raw = inflateRawSync(buf.subarray(start, start + csize));
  expect(usize).toBe(raw.length);
  expect(Number(storedCrc)).toBe(Number(crc32(raw)));
  return JSON.parse(raw.toString('utf8'));
}

// ==========================================================================

describe('catch-all', () => {
  it('unmatched path or method → plain-text "ok" 200, no JSON, no CORS', async () => {
    for (const [path, method] of [
      ['/', 'GET'],
      ['/nope', 'GET'],
      ['/shows', 'POST'],
      ['/shows', 'OPTIONS'],
      ['/trigger', 'GET'],
      ['/trigger/x', 'GET'],
    ] as const) {
      const res = await call(path, { method, env });
      expect(res.status).toBe(200);
      expect(res.text).toBe('ok');
      expect(res.body).toBeNull();
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
  });
});

// ==========================================================================

describe('GET /shows', () => {
  it('returns active shows only, sanitized to the public shape', async () => {
    db.seed('shows', [
      SHOW,
      mkShow({ id: 'show-2', name: 'Second Fest', location: null }),
      mkShow({ id: 'show-dead', is_active: 0 }),
    ]);
    const res = await call('/shows', { env });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    // is_active / table_count / pay_instructions never leave the worker.
    expect(res.body).toEqual({
      ok: true,
      shows: [
        {
          id: 'show-1',
          vendor_id: 'org-v',
          name: 'Card Fest',
          start_date: '2026-11-01',
          location: 'Hall A',
        },
        {
          id: 'show-2',
          vendor_id: 'org-v',
          name: 'Second Fest',
          start_date: '2026-11-01',
          location: '',
        },
      ],
    });
    expect(
      db.matching(
        /^SELECT id, vendor_id, name, start_date, location, is_active FROM shows WHERE is_active = 1$/
      )
    ).toHaveLength(1);
  });

  it('non-string columns are stringified', async () => {
    db.seed('shows', [mkShow({ id: 42 })]);
    const res = await call('/shows', { env });
    expect(res.body.shows[0].id).toBe('42');
  });

  it('no active shows → ok:true with an empty array', async () => {
    const res = await call('/shows', { env });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, shows: [] });
  });

  it('Turso HTTP failure → 500', async () => {
    (globalThis as any).fetch = jest.fn(async () => new Response('nope', { status: 502 }));
    const res = await call('/shows', { env });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ ok: false, error: 'Turso pipeline failed: HTTP 502' });
  });

  it('missing Turso env → 500', async () => {
    const res = await call('/shows', { env: makeEnv({ TURSO_AUTH_TOKEN: undefined }) });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Turso environment not configured');
  });

  // A failed statement arrives as {type:'error'} with no `response` field;
  // tursoPipeline scans the whole results array and throws, so the route
  // surfaces a 500 instead of silently reporting an empty list.
  it('statement-level Turso error → 500', async () => {
    db.seed('shows', [SHOW]);
    db.failOnce(/^SELECT id, vendor_id, name, start_date/, 'db exploded');
    const res = await call('/shows', { env });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ ok: false, error: 'Turso pipeline error: db exploded' });
  });

  // A {type:'error'} entry with no .error payload falls through the
  // message/JSON.stringify chain — JSON.stringify(undefined) is the value
  // undefined, not a string — to the 'unknown error' default instead of
  // surfacing 'Turso pipeline error: undefined'. Same fix as vendor turso.js.
  it('error result lacking .error → defaulted message', async () => {
    (globalThis as any).fetch = jest.fn(async () =>
      Response.json({ results: [{ type: 'error' }] })
    );
    const res = await call('/shows', { env });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ ok: false, error: 'Turso pipeline error: unknown error' });
  });
});

// ==========================================================================

describe('POST /trigger/{id}', () => {
  it('unknown show → 404, nothing uploaded', async () => {
    const res = await call('/trigger/ghost', { method: 'POST', env });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ ok: false, error: 'show not found or not active' });
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it('inactive show → 400 (lookup is by id only; active is checked after)', async () => {
    db.seed('shows', [mkShow({ is_active: 0 })]);
    const res = await call('/trigger/show-1', { method: 'POST', env });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, error: 'show is not active' });
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it('empty show id (/trigger/) → 404', async () => {
    const res = await call('/trigger/', { method: 'POST', env });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('show not found or not active');
  });

  it('happy path uploads shows/{id}/event_catalog.json.zip with anti-cache metadata', async () => {
    db.seed('shows', [SHOW]).seed('public_show_inventory', [mkInv()]);
    const res = await call('/trigger/show-1', { method: 'POST', env });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, showId: 'show-1' });

    expect(bucket.put).toHaveBeenCalledTimes(1);
    const [key, bytes, meta] = bucket.put.mock.calls[0] as [string, Uint8Array, any];
    expect(key).toBe('shows/show-1/event_catalog.json.zip');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(meta).toEqual({
      httpMetadata: {
        contentType: 'application/zip',
        cacheControl: 'max-age=0, no-cache, no-store, must-revalidate',
      },
    });
  });

  it('zip member decodes to sanitized rows: 11 public keys, types coerced', async () => {
    db.seed('shows', [SHOW]).seed('public_show_inventory', [
      mkInv({ id: 'r1' }),
      mkInv({
        id: 'r2',
        product_id: '222', // string → number
        sticker_price: '7.5',
        quantity: null, // → 0
        name: null, // → ''
        number: 58, // → '58'
        condition: undefined, // missing column → ''
      }),
      mkInv({ id: 'r3', product_id: 'not-a-number' }), // NaN → 0
    ]);
    const res = await call('/trigger/show-1', { method: 'POST', env });
    expect(res.body.ok).toBe(true);

    // show_id / vendor_id / dedupe_key / updated_at never reach the artifact.
    expect(unzipJson(bucket.put.mock.calls[0][1])).toEqual([
      {
        id: 'r1',
        product_id: 111,
        name: 'Pikachu',
        set_name: 'Base Set',
        number: '58',
        rarity: 'Common',
        condition: 'NM',
        sticker_price: 5,
        quantity: 2,
        vendor_name: 'Vend Co',
        vendor_table: 'T9',
      },
      {
        id: 'r2',
        product_id: 222,
        name: '',
        set_name: 'Base Set',
        number: '58',
        rarity: 'Common',
        condition: '',
        sticker_price: 7.5,
        quantity: 0,
        vendor_name: 'Vend Co',
        vendor_table: 'T9',
      },
      {
        id: 'r3',
        product_id: 0,
        name: 'Pikachu',
        set_name: 'Base Set',
        number: '58',
        rarity: 'Common',
        condition: 'NM',
        sticker_price: 5,
        quantity: 2,
        vendor_name: 'Vend Co',
        vendor_table: 'T9',
      },
    ]);
  });

  it('ships exactly two single-statement pipelines (show lookup, inventory)', async () => {
    db.seed('shows', [SHOW]).seed('public_show_inventory', [mkInv()]);
    const pipes = capturePipelines();
    const res = await call('/trigger/show-1', { method: 'POST', env });
    expect(res.status).toBe(200);
    expect(pipes.map((p) => p.map((s) => s.sql))).toEqual([
      ['SELECT id, vendor_id, name, start_date, location, is_active FROM shows WHERE id = ?'],
      [
        'SELECT id, product_id, name, set_name, number, rarity, condition, sticker_price, quantity, vendor_name, vendor_table FROM public_show_inventory WHERE show_id = ?',
      ],
    ]);
    expect(pipes[0][0].args).toEqual(['show-1']);
    expect(pipes[1][0].args).toEqual(['show-1']);
  });

  // url.pathname stays percent-encoded, so the param is decodeURIComponent'd
  // like worker_show_vendor's route params — a %20 id binds decoded.
  it('path param is percent-decoded', async () => {
    db.seed('shows', [mkShow({ id: 'show 1' })]).seed('public_show_inventory', [
      mkInv({ show_id: 'show 1' }),
    ]);
    const res = await call('/trigger/show%201', { method: 'POST', env });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, showId: 'show 1' });
    const lookup = db.executed.find((s) => /FROM shows WHERE id = \?$/.test(s.sql));
    expect(lookup?.args).toEqual(['show 1']);
    expect(bucket.put.mock.calls[0][0]).toBe('shows/show 1/event_catalog.json.zip');
  });

  // A malformed percent sequence throws inside the route's try → JSON 500,
  // never an unhandled URIError escaping fetch.
  it('malformed percent sequence → JSON 500', async () => {
    const res = await call('/trigger/%', { method: 'POST', env });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ ok: false, error: 'URI malformed' });
    expect(bucket.put).not.toHaveBeenCalled();
  });

  // A failed show lookup surfaces as a real 500, not a fake 404
  // indistinguishable from an unknown show.
  it('statement error on the show lookup → 500', async () => {
    db.seed('shows', [SHOW]);
    db.failOnce(/^SELECT id, vendor_id, name, start_date.*WHERE id = \?$/, 'db exploded');
    const res = await call('/trigger/show-1', { method: 'POST', env });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ ok: false, error: 'Turso pipeline error: db exploded' });
    expect(bucket.put).not.toHaveBeenCalled();
  });

  // The money fix: a failed inventory read returns 500 and never reaches
  // bucket.put — a transient Turso error can no longer replace the
  // published artifact every attendee downloads with an empty catalog.
  it('statement error on inventory → 500, nothing uploaded', async () => {
    db.seed('shows', [SHOW]).seed('public_show_inventory', [mkInv()]);
    db.failOnce(/^SELECT id, product_id.*FROM public_show_inventory/, 'db exploded');
    const res = await call('/trigger/show-1', { method: 'POST', env });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ ok: false, error: 'Turso pipeline error: db exploded' });
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it('bucket.put rejection → 500', async () => {
    db.seed('shows', [SHOW]);
    bucket.put.mockRejectedValue(new Error('R2 down'));
    const res = await call('/trigger/show-1', { method: 'POST', env });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ ok: false, error: 'R2 down' });
  });

  it('missing EVENT_CATALOG_BUCKET binding → 500 TypeError', async () => {
    db.seed('shows', [SHOW]);
    const res = await call('/trigger/show-1', { method: 'POST', env: makeEnv() });
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('Cannot read properties of undefined');
  });
});

// ==========================================================================

describe('POST /trigger', () => {
  it('no active shows → ok:true with message; nothing uploaded', async () => {
    db.seed('shows', [mkShow({ is_active: 0 })]);
    const res = await call('/trigger', { method: 'POST', env });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, message: 'no active shows' });
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("snapshots every active show; each show's zip carries only its rows", async () => {
    db.seed('shows', [
      SHOW,
      mkShow({ id: 'show-2', name: 'B Fest' }),
      mkShow({ id: 'dead', is_active: 0 }),
    ]).seed('public_show_inventory', [
      mkInv(),
      mkInv({ id: 'r-b', show_id: 'show-2', name: 'Charizard' }),
      mkInv({ id: 'r-dead', show_id: 'dead' }),
    ]);
    const res = await call('/trigger', { method: 'POST', env });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      results: [
        { ok: true, showId: 'show-1' },
        { ok: true, showId: 'show-2' },
      ],
    });
    expect(bucket.put.mock.calls.map((c: any[]) => c[0])).toEqual([
      'shows/show-1/event_catalog.json.zip',
      'shows/show-2/event_catalog.json.zip',
    ]);
    expect(unzipJson(bucket.put.mock.calls[0][1]).map((r: Row) => r.id)).toEqual(['row-1']);
    expect(unzipJson(bucket.put.mock.calls[1][1]).map((r: Row) => r.id)).toEqual(['r-b']);
  });

  it('a per-show put failure lands in results[] without aborting siblings', async () => {
    db.seed('shows', [SHOW, mkShow({ id: 'show-2' }), mkShow({ id: 'show-3' })]);
    bucket.put.mockImplementation(async (key: string) => {
      if (key === 'shows/show-2/event_catalog.json.zip') throw new Error('R2 down');
      return {};
    });
    const res = await call('/trigger', { method: 'POST', env });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      results: [
        { ok: true, showId: 'show-1' },
        { ok: false, showId: 'show-2', error: 'R2 down' },
        { ok: true, showId: 'show-3' },
      ],
    });
    expect(bucket.put).toHaveBeenCalledTimes(3);
  });

  // Failure isolation: an inventory statement error lands in results[] as
  // {ok:false} without aborting siblings, and no artifact is uploaded for
  // the failed show.
  it('inventory statement error per show → {ok:false} in results[], siblings still upload', async () => {
    db.seed('shows', [SHOW, mkShow({ id: 'show-2' })]).seed('public_show_inventory', [mkInv()]);
    db.failOnce(/^SELECT id, product_id/, 'db exploded'); // first inventory read only
    const res = await call('/trigger', { method: 'POST', env });
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      { ok: false, showId: 'show-1', error: 'Turso pipeline error: db exploded' },
      { ok: true, showId: 'show-2' },
    ]);
    expect(bucket.put).toHaveBeenCalledTimes(1);
    expect(bucket.put.mock.calls[0][0]).toBe('shows/show-2/event_catalog.json.zip');
    expect(unzipJson(bucket.put.mock.calls[0][1])).toEqual([]); // show-2 legitimately has no rows
  });

  it('shows-query statement error → 500', async () => {
    db.seed('shows', [SHOW]);
    db.failOnce(/^SELECT id, vendor_id.*WHERE is_active = 1$/, 'db exploded');
    const res = await call('/trigger', { method: 'POST', env });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ ok: false, error: 'Turso pipeline error: db exploded' });
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it('shows-query HTTP failure → 500', async () => {
    db.seed('shows', [SHOW]);
    (globalThis as any).fetch = jest.fn(async () => new Response('nope', { status: 503 }));
    const res = await call('/trigger', { method: 'POST', env });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Turso pipeline failed: HTTP 503');
  });
});
