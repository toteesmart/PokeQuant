// Characterization suite for worker_show_vendor.js (repo root, ~2.6k lines).
// Pins the deployed contract: route table, ES256 auth, organizer/vendor
// gating truth tables, inventory write access, the manual:* vendor
// namespace, percent-decoded path params, and the RevenueCat webhook's
// product hygiene. Assertions target response status/shape plus the exact
// SQL + args the worker emits (the FakeTurso captures every statement).
// Where observed behavior looks buggy it is pinned as-is, never "fixed".

import {
  FakeTurso,
  Row,
  TestKey,
  callWorker,
  defaultClaims,
  installFetch,
  makeEnv,
  makeSigningKey,
  signJwt,
  unsignedJwt,
} from './helpers/workerHarness';

// ---------- seeds ----------

const mkVendor = (over: Row = {}): Row => ({
  id: 'vend',
  user_id: 'user-1',
  name: 'Vend Co',
  table_default: 'T9',
  created_at: 1000,
  is_founder: 0,
  founder_seat_number: null,
  is_organizer: 0,
  ...over,
});
const ORGANIZER = mkVendor({
  id: 'org-v',
  user_id: 'user-org',
  name: 'Org Co',
  is_organizer: 1,
  is_founder: 1,
  founder_seat_number: 1,
});
const VENDOR = mkVendor({ is_founder: 1, founder_seat_number: 2 });

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

const mkReg = (over: Row = {}): Row => ({
  vendor_id: 'vend',
  show_id: 'show-1',
  status: 'approved',
  vendor_name: 'Vend Co',
  vendor_table: 'T9',
  table_number: '12',
  total_due: 100,
  paid_amount: 0,
  manual_name: '',
  manual_phone: '',
  created_at: 1000,
  ...over,
});

const mkSub = (over: Row = {}): Row => ({
  user_id: 'user-1',
  entitlement_id: 'Cardcache_pro',
  product_id: 'cc_pro_monthly',
  is_active: 1,
  expires_at: null,
  updated_at: 1000,
  ...over,
});

const mkInvRow = (over: Row = {}): Row => ({
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

const mkTeam = (over: Row = {}): Row => ({
  owner_user_id: 'boss',
  product_id: 'cc_pro_team_base_monthly',
  seats_total: 3,
  expires_at: null,
  invite_code: '123456',
  name: 'Boss Team',
  updated_at: 1000,
  created_at: 900,
  ...over,
});

// ---------- auth plumbing ----------

let key: TestKey;
let db: FakeTurso;
const tokenCache = new Map<string, Promise<string>>();

function tokenFor(sub: string, claims: Row = {}): Promise<string> {
  const cacheKey = `${sub}:${JSON.stringify(claims)}`;
  if (!tokenCache.has(cacheKey)) {
    tokenCache.set(cacheKey, signJwt(key, defaultClaims({ sub, ...claims })));
  }
  return tokenCache.get(cacheKey)!;
}

const hmacHex = async (secret: string, body: string): Promise<string> => {
  const k = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
};

beforeAll(async () => {
  key = await makeSigningKey('test-key');
  // The worker console.error()s every handled error path by design; silence.
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

beforeEach(() => {
  db = new FakeTurso();
  installFetch(db, { jwks: [key.jwk] });
});

// ==========================================================================

describe('infra: CORS, health, unknown routes', () => {
  it('OPTIONS preflight returns CORS headers', async () => {
    const res = await callWorker('/vendor/me', { method: 'OPTIONS' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });

  it('GET /health → ok', async () => {
    const res = await callWorker('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('unknown path → 404 {ok:false}', async () => {
    const res = await callWorker('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ ok: false, error: 'Not found' });
  });

  it('right path, wrong method → 404', async () => {
    expect((await callWorker('/shows', { method: 'GET' })).status).toBe(404);
    expect((await callWorker('/vendor/me', { method: 'POST' })).status).toBe(404);
  });
});

describe('auth truth table', () => {
  it('missing Authorization header → 401', async () => {
    const res = await callWorker('/vendor/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Missing Authorization header');
  });

  it('Bearer without a token → 401', async () => {
    const res = await callWorker('/vendor/me', { headers: { Authorization: 'Bearer' } });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Missing Authorization header');
  });

  it('two-segment token → 401 Invalid JWT format', async () => {
    const res = await callWorker('/vendor/me', { token: 'aaa.bbb' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid JWT format');
  });

  it('non-ES256 alg → 401 Unsupported JWT algorithm', async () => {
    const token = unsignedJwt({
      header: { alg: 'HS256', typ: 'JWT', kid: 'test-key' },
      payload: defaultClaims(),
    });
    const res = await callWorker('/vendor/me', { token });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unsupported JWT algorithm');
  });

  it('non-JWT typ → 401', async () => {
    const token = await signJwt(key, defaultClaims(), { typ: 'JWS' });
    const res = await callWorker('/vendor/me', { token });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unsupported JWT type');
  });

  it('missing kid → 401', async () => {
    const token = unsignedJwt({
      header: { alg: 'ES256', typ: 'JWT' },
      payload: defaultClaims(),
    });
    const res = await callWorker('/vendor/me', { token });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('JWT header missing kid');
  });

  it('expired token → 401', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(key, defaultClaims({ exp: now - 60, iat: now - 3600 }));
    const res = await callWorker('/vendor/me', { token });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('JWT expired');
  });

  it('nbf in the future → 401', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(key, defaultClaims({ nbf: now + 3600 }));
    const res = await callWorker('/vendor/me', { token });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('JWT not yet valid');
  });

  it('issuer outside the Supabase URL → 401', async () => {
    const token = await signJwt(key, defaultClaims({ iss: 'https://evil.example.com/auth/v1' }));
    const res = await callWorker('/vendor/me', { token });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('JWT issuer mismatch');
  });

  it('tampered signature → 401', async () => {
    const good = await signJwt(key, defaultClaims());
    const [h, p, s] = good.split('.');
    const bad = `${h}.${p}.${s.slice(0, -2)}${s.endsWith('A') ? 'BB' : 'AA'}`;
    const res = await callWorker('/vendor/me', { token: bad });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid JWT signature');
  });

  it('missing sub claim → 401', async () => {
    const claims = defaultClaims();
    delete claims.sub;
    const token = await signJwt(key, claims);
    const res = await callWorker('/vendor/me', { token });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('JWT missing sub');
  });

  // quirk: the status mapper has no keyword for this message, so an unknown
  // signing key surfaces as a 500 rather than a 401.
  it('unknown kid → 500 (status-mapper quirk)', async () => {
    const token = unsignedJwt({
      header: { alg: 'ES256', typ: 'JWT', kid: 'other-kid' },
      payload: defaultClaims(),
      signature: 'AAAA',
    });
    const res = await callWorker('/vendor/me', { token });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('No matching JWKS key found');
  });

  it('JWKS endpoint down → 500', async () => {
    installFetch(db, {
      jwks: () => new Response('down', { status: 500 }),
    });
    const env = makeEnv({
      SUPABASE_URL: 'https://down.test',
      SUPABASE_JWKS_URL: 'https://down.test/auth/v1/.well-known/jwks.json',
    });
    const token = await signJwt(key, defaultClaims({ iss: 'https://down.test/auth/v1' }));
    const res = await callWorker('/vendor/me', { token, env });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('JWKS fetch failed: HTTP 500');
  });

  it('missing Turso env vars → 500', async () => {
    const token = await tokenFor('user-1');
    const res = await callWorker('/vendor/me', { token, env: makeEnv({ TURSO_DATABASE_URL: undefined }) });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Turso environment not configured');
  });

  it('Turso statement error → 500 Turso pipeline error', async () => {
    db.failOnce(/SELECT \* FROM vendors WHERE user_id/, 'db exploded');
    const token = await tokenFor('user-1');
    const res = await callWorker('/vendor/me', { token });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Turso pipeline error: db exploded');
  });
});

// ==========================================================================

describe('GET /vendor/me', () => {
  it('first hit inserts a vendors row, slugs from username, claims founder seat', async () => {
    const res = await callWorker('/vendor/me', { token: await tokenFor('user-1') });
    expect(res.status).toBe(200);

    const inserts = db.matching(/^INSERT INTO vendors/);
    expect(inserts).toHaveLength(1);
    // table_default is an inline '' literal in the SQL — only 4 bound args.
    const [id, userId, name, createdAt] = inserts[0].args;
    expect(id).toBe('cardking'); // slugify('CardKing')
    expect(userId).toBe('user-1');
    expect(name).toBe('CardKing');
    expect(createdAt).toEqual(expect.any(Number));

    const row = db.table('vendors')[0];
    expect(row).toMatchObject({
      id: 'cardking',
      user_id: 'user-1',
      is_founder: 1,
      founder_seat_number: 1,
      is_organizer: 0,
    });

    expect(res.body).toEqual({
      ok: true,
      vendor: {
        id: 'cardking',
        user_id: 'user-1',
        name: 'CardKing',
        table_default: '',
        is_organizer: 0,
        payments_live: 0,
        is_vendor: 0,
        is_founder: 1,
        founder_seat_number: 1,
        founder_seats_remaining: 49,
        is_team_member: 0,
        team_id: null,
        team: null,
      },
    });
  });

  it('existing vendor returns the row unchanged (no insert)', async () => {
    db.seed('vendors', [VENDOR]);
    const res = await callWorker('/vendor/me', { token: await tokenFor('user-1') });
    expect(res.status).toBe(200);
    expect(res.body.vendor.id).toBe('vend');
    expect(res.body.vendor.is_founder).toBe(1);
    expect(db.matching(/^INSERT INTO vendors/)).toHaveLength(0);
  });

  it('vendor id slugifies punctuation; name falls back to email localpart', async () => {
    const token = await tokenFor('user-2', {
      user_metadata: {},
      email: 'cash.vendor+shop@example.com',
    });
    const res = await callWorker('/vendor/me', { token });
    expect(res.body.vendor.id).toBe('cash-vendor-shop');
    expect(res.body.vendor.name).toBe('cash.vendor+shop');
  });

  it('retries with a suffixed id on UNIQUE collision', async () => {
    db.seed('vendors', [mkVendor({ id: 'cardking', user_id: 'other-user' })]);
    db.failOnce(/^INSERT INTO vendors/, 'UNIQUE constraint failed: vendors.id');
    const res = await callWorker('/vendor/me', { token: await tokenFor('user-1') });
    expect(res.status).toBe(200);
    expect(res.body.vendor.id).toMatch(/^cardking-[0-9a-f]{6}$/);
  });

  // quirk: tryClaimFounderSeat reads `firstRow(result.results[1])` — a single
  // result object, never an array — so `changed` is always null and the
  // founder_counter sync statements are never issued.
  it('founder_counter sync is skipped on seat claim (mis-indexed result)', async () => {
    await callWorker('/vendor/me', { token: await tokenFor('user-1') });
    expect(db.table('vendors')[0].founder_seat_number).toBe(1);
    expect(db.matching(/^DELETE FROM founder_counter/)).toHaveLength(0);
  });

  it('payments_live=1 + active sub → is_vendor 1', async () => {
    db.setConfig('payments_live', '1')
      .seed('vendors', [VENDOR])
      .seed('vendor_subscriptions', [mkSub()]);
    const res = await callWorker('/vendor/me', { token: await tokenFor('user-1') });
    expect(res.body.vendor.is_vendor).toBe(1);
    expect(res.body.vendor.payments_live).toBe(1);
  });

  it('payments_live=1 + expired sub → is_vendor 0', async () => {
    db.setConfig('payments_live', '1')
      .seed('vendors', [VENDOR])
      .seed('vendor_subscriptions', [
        mkSub({ expires_at: Math.floor(Date.now() / 1000) - 60 }),
      ]);
    const res = await callWorker('/vendor/me', { token: await tokenFor('user-1') });
    expect(res.body.vendor.is_vendor).toBe(0);
  });

  it('payments_live=1 + team membership → is_vendor 1, is_team_member 1', async () => {
    db.setConfig('payments_live', '1')
      .seed('vendors', [VENDOR])
      .seed('teams', [mkTeam()])
      .seed('team_members', [{ team_id: 'boss', member_user_id: 'user-1', created_at: 1000 }]);
    const res = await callWorker('/vendor/me', { token: await tokenFor('user-1') });
    expect(res.body.vendor.is_vendor).toBe(1);
    expect(res.body.vendor.is_team_member).toBe(1);
    expect(res.body.vendor.team_id).toBe('boss');
    expect(res.body.vendor.team.owner_user_id).toBe('boss');
  });
});

// ==========================================================================

describe('GET /vendor/shows — paid-vendor gating', () => {
  const seedShows = () =>
    db.seed('vendors', [VENDOR, ORGANIZER]).seed('shows', [
      mkShow({ id: 'show-own', vendor_id: 'vend' }),
      mkShow({ id: 'show-approved' }),
      mkShow({ id: 'show-pending' }),
      mkShow({ id: 'show-rejected' }),
      mkShow({ id: 'show-dead', is_active: 0 }),
    ]);

  it('payments_live + unpaid non-organizer → ok with empty shows (not an error)', async () => {
    seedShows().setConfig('payments_live', '1');
    const res = await callWorker('/vendor/shows', { token: await tokenFor('user-1') });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, shows: [] });
  });

  it('payments_live + unpaid organizer still sees owned shows', async () => {
    seedShows().setConfig('payments_live', '1');
    const res = await callWorker('/vendor/shows', { token: await tokenFor('user-org') });
    expect(res.status).toBe(200);
    // mkShow defaults vendor_id to org-v: the three active seeded shows are
    // all owned by the organizer. show-own belongs to vend and show-dead is
    // inactive — neither appears.
    expect(res.body.shows.map((s: Row) => s.id)).toEqual([
      'show-approved',
      'show-pending',
      'show-rejected',
    ]);
    for (const s of res.body.shows) expect(s.my_status).toBe('owner');
  });

  it('payments_live + paid → owned + approved + pending, rejected/inactive excluded', async () => {
    seedShows()
      .setConfig('payments_live', '1')
      .seed('vendor_subscriptions', [mkSub()])
      .seed('vendor_show_registrations', [
        mkReg({ show_id: 'show-approved', status: 'approved', table_number: 'A1' }),
        mkReg({ show_id: 'show-pending', status: 'pending' }),
        mkReg({ show_id: 'show-rejected', status: 'rejected' }),
        mkReg({ show_id: 'show-dead', status: 'approved' }),
      ]);
    const res = await callWorker('/vendor/shows', { token: await tokenFor('user-1') });
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.shows.map((s: Row) => [s.id, s]));
    expect(Object.keys(byId).sort()).toEqual(['show-approved', 'show-own', 'show-pending']);
    expect(byId['show-own'].my_status).toBe('owner');
    expect(byId['show-approved'].my_status).toBe('approved');
    expect(byId['show-approved'].my_table).toBe('A1');
    expect(byId['show-pending'].my_status).toBe('pending');
  });

  it('payments off → same list regardless of subscription', async () => {
    seedShows().seed('vendor_show_registrations', [
      mkReg({ show_id: 'show-approved', status: 'approved' }),
      mkReg({ show_id: 'show-pending', status: 'pending' }),
      mkReg({ show_id: 'show-rejected', status: 'rejected' }),
    ]);
    const res = await callWorker('/vendor/shows', { token: await tokenFor('user-1') });
    expect(res.body.shows.map((s: Row) => s.id).sort()).toEqual([
      'show-approved',
      'show-own',
      'show-pending',
    ]);
  });

  it('organizer of a show reports my_status owner even with a rejected registration', async () => {
    seedShows().seed('vendor_show_registrations', [
      mkReg({ show_id: 'show-own', status: 'rejected' }),
    ]);
    const res = await callWorker('/vendor/shows', { token: await tokenFor('user-1') });
    const own = res.body.shows.find((s: Row) => s.id === 'show-own');
    expect(own.my_status).toBe('owner');
  });
});

// ==========================================================================

describe('GET /vendor/balances', () => {
  it('returns approved, active-show, underpaid registrations only', async () => {
    db.seed('vendors', [VENDOR, ORGANIZER])
      .seed('shows', [SHOW, mkShow({ id: 'show-2' }), mkShow({ id: 'show-3' }), mkShow({ id: 'show-4', is_active: 0 })])
      .seed('vendor_show_registrations', [
        mkReg({ show_id: 'show-1', total_due: 100, paid_amount: 30, table_number: 'A1' }),
        mkReg({ show_id: 'show-2', total_due: 50, paid_amount: 50 }),
        mkReg({ show_id: 'show-3', status: 'pending', total_due: 80, paid_amount: 0 }),
        mkReg({ show_id: 'show-4', total_due: 70, paid_amount: 0 }),
      ]);
    const res = await callWorker('/vendor/balances', { token: await tokenFor('user-1') });
    expect(res.status).toBe(200);
    expect(res.body.balances).toEqual([
      {
        show_id: 'show-1',
        show_name: 'Card Fest',
        organizer_name: 'Org Co',
        pay_instructions: 'Venmo @org',
        table_number: 'A1',
        total_due: 100,
        paid_amount: 30,
        remaining: 70,
      },
    ]);
  });
});

// ==========================================================================

describe('GET /vendor/inventory', () => {
  it('missing show_id → 400', async () => {
    db.seed('vendors', [VENDOR]);
    const res = await callWorker('/vendor/inventory', { token: await tokenFor('user-1') });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing show_id');
  });

  it('returns only the caller’s rows, sanitized', async () => {
    db.seed('vendors', [VENDOR]).seed('public_show_inventory', [
      mkInvRow(),
      mkInvRow({ id: 'row-2', vendor_id: 'other-vendor', name: 'Not Mine' }),
    ]);
    const res = await callWorker('/vendor/inventory?show_id=show-1', {
      token: await tokenFor('user-1'),
    });
    expect(res.status).toBe(200);
    expect(res.body.show_id).toBe('show-1');
    expect(res.body.rows).toHaveLength(1);
    expect(Object.keys(res.body.rows[0]).sort()).toEqual([
      'condition',
      'id',
      'name',
      'number',
      'product_id',
      'quantity',
      'rarity',
      'set_name',
      'show_id',
      'sticker_price',
      'vendor_id',
      'vendor_name',
      'vendor_table',
    ]);
    expect(res.body.rows[0]).toMatchObject({ id: 'row-1', product_id: 111, sticker_price: 5 });
  });

  it('does NOT require show access — pending vendor still gets their (empty) list', async () => {
    db.seed('vendors', [VENDOR]).seed('shows', [SHOW]);
    const res = await callWorker('/vendor/inventory?show_id=show-1', {
      token: await tokenFor('user-1'),
    });
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([]);
  });

  // quirk: subscription_required is thrown but never matched by the status
  // mapper — unpaid vendors get a 500, not a 403.
  it('payments_live + unpaid → 500 subscription_required (status-mapper quirk)', async () => {
    db.setConfig('payments_live', '1').seed('vendors', [VENDOR]).seed('shows', [SHOW]);
    const res = await callWorker('/vendor/inventory?show_id=show-1', {
      token: await tokenFor('user-1'),
    });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('subscription_required');
  });

  it('payments_live + active sub → allowed', async () => {
    db.setConfig('payments_live', '1')
      .seed('vendors', [VENDOR])
      .seed('vendor_subscriptions', [mkSub()])
      .seed('shows', [SHOW]);
    const res = await callWorker('/vendor/inventory?show_id=show-1', {
      token: await tokenFor('user-1'),
    });
    expect(res.status).toBe(200);
  });
});

// ==========================================================================

describe('POST /vendor/inventory — write access truth table', () => {
  const body = (over: Row = {}) => ({
    show_id: 'show-1',
    vendor_name: 'Vend Co',
    vendor_table: 'T9',
    rows: [{ product_id: 111, name: 'Pikachu', set_name: 'Base Set', number: '58', condition: 'NM', sticker_price: 5, quantity: 2 }],
    ...over,
  });

  it('approved registration → upserts rows and reports per-row results', async () => {
    db.seed('vendors', [VENDOR, ORGANIZER])
      .seed('shows', [SHOW])
      .seed('vendor_show_registrations', [mkReg()]);
    const res = await callWorker('/vendor/inventory', {
      method: 'POST',
      token: await tokenFor('user-1'),
      body: body(),
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.results).toEqual([{ id: expect.stringMatching(/^[0-9a-f]{32}$/), status: 'upserted' }]);
    expect(res.body.row_ids).toEqual([res.body.results[0].id]);

    const row = db.table('public_show_inventory')[0];
    expect(row).toMatchObject({
      show_id: 'show-1',
      vendor_id: 'vend',
      product_id: 111,
      name: 'Pikachu',
      dedupe_key: 'p:111',
      vendor_name: 'Vend Co',
      vendor_table: 'T9',
      sticker_price: 5,
      quantity: 2,
    });
  });

  it('pending registration → 403', async () => {
    db.seed('vendors', [VENDOR, ORGANIZER])
      .seed('shows', [SHOW])
      .seed('vendor_show_registrations', [mkReg({ status: 'pending' })]);
    const res = await callWorker('/vendor/inventory', {
      method: 'POST',
      token: await tokenFor('user-1'),
      body: body(),
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Vendor is not authorized for this show');
  });

  it('rejected registration → 403', async () => {
    db.seed('vendors', [VENDOR, ORGANIZER])
      .seed('shows', [SHOW])
      .seed('vendor_show_registrations', [mkReg({ status: 'rejected' })]);
    const res = await callWorker('/vendor/inventory', {
      method: 'POST',
      token: await tokenFor('user-1'),
      body: body(),
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Vendor is not authorized for this show');
  });

  it('unknown show → 404', async () => {
    db.seed('vendors', [VENDOR]);
    const res = await callWorker('/vendor/inventory', {
      method: 'POST',
      token: await tokenFor('user-1'),
      body: body({ show_id: 'ghost' }),
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Show not found');
  });

  // quirk: assertShowAccess throws "Show is not active" which the mapper
  // catches as 'not active' → 403; the same message is a 400 on /request.
  it('inactive show → 403 (thrown path)', async () => {
    db.seed('vendors', [VENDOR, ORGANIZER])
      .seed('shows', [mkShow({ is_active: 0 })])
      .seed('vendor_show_registrations', [mkReg()]);
    const res = await callWorker('/vendor/inventory', {
      method: 'POST',
      token: await tokenFor('user-1'),
      body: body(),
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Show is not active');
  });

  it('show owner writes without a registration row', async () => {
    db.seed('vendors', [VENDOR, ORGANIZER]).seed('shows', [SHOW]);
    const res = await callWorker('/vendor/inventory', {
      method: 'POST',
      token: await tokenFor('user-org'),
      body: body({ vendor_name: 'Org Co' }),
    });
    expect(res.status).toBe(200);
    expect(db.table('public_show_inventory')[0].vendor_id).toBe('org-v');
  });

  it('validation: missing show_id / vendor_name / rows → 400', async () => {
    db.seed('vendors', [VENDOR, ORGANIZER])
      .seed('shows', [SHOW])
      .seed('vendor_show_registrations', [mkReg()]);
    const token = await tokenFor('user-1');
    expect(
      (await callWorker('/vendor/inventory', { method: 'POST', token, body: body({ show_id: '' }) })).body.error
    ).toBe('Missing show_id');
    expect(
      (await callWorker('/vendor/inventory', { method: 'POST', token, body: body({ vendor_name: '' }) })).body.error
    ).toBe('Missing vendor_name');
    expect(
      (await callWorker('/vendor/inventory', { method: 'POST', token, body: body({ rows: [] }) })).body.error
    ).toBe('No rows provided');
    expect(
      (await callWorker('/vendor/inventory', { method: 'POST', token, body: body({ rows: 'nope' }) })).body.error
    ).toBe('No rows provided');
    expect(
      (await callWorker('/vendor/inventory', { method: 'POST', token, rawBody: 'not json' })).body.error
    ).toBe('Invalid JSON body');
  });

  it('same-batch rows sharing condition+dedupe_key collapse to one upsert', async () => {
    db.seed('vendors', [VENDOR, ORGANIZER])
      .seed('shows', [SHOW])
      .seed('vendor_show_registrations', [mkReg()]);
    const res = await callWorker('/vendor/inventory', {
      method: 'POST',
      token: await tokenFor('user-1'),
      body: body({
        rows: [
          { product_id: 111, name: 'Pikachu', condition: 'NM' },
          { product_id: 111, name: 'Pikachu', condition: 'NM' },
          { product_id: 111, name: 'Pikachu', condition: 'LP' },
        ],
      }),
    });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(3);
    expect(res.body.results[0].id).toBe(res.body.results[1].id);
    expect(res.body.results[0].id).not.toBe(res.body.results[2].id);
    expect(db.table('public_show_inventory')).toHaveLength(2);
  });

  it('dedupe_key: product rows key p:<id>; name/set/number rows key n:<n>|<s>|<num>', async () => {
    db.seed('vendors', [VENDOR, ORGANIZER])
      .seed('shows', [SHOW])
      .seed('vendor_show_registrations', [mkReg()]);
    await callWorker('/vendor/inventory', {
      method: 'POST',
      token: await tokenFor('user-1'),
      body: body({
        rows: [
          { product_id: '111', name: 'Pikachu' },
          { product_id: 0, name: 'Loose Card', set_name: 'Promo', number: 'SWSH001' },
          {},
        ],
      }),
    });
    const rows = db.table('public_show_inventory');
    expect(rows[0].dedupe_key).toBe('p:111');
    expect(rows[1].dedupe_key).toBe('n:loose card|promo|swsh001');
    expect(rows[2].dedupe_key).toMatch(/^n:row:[0-9a-f]{12}$/);
  });

  it('re-upload overwrites when incoming updated_at is newer (LWW guard)', async () => {
    db.seed('vendors', [VENDOR, ORGANIZER])
      .seed('shows', [SHOW])
      .seed('vendor_show_registrations', [mkReg()])
      .seed('public_show_inventory', [mkInvRow({ sticker_price: 5, updated_at: 1000 })]);
    await callWorker('/vendor/inventory', {
      method: 'POST',
      token: await tokenFor('user-1'),
      body: body({ rows: [{ product_id: 111, name: 'Pikachu', sticker_price: 9 }] }),
    });
    expect(db.table('public_show_inventory')).toHaveLength(1);
    expect(db.table('public_show_inventory')[0].sticker_price).toBe(9);
  });
});

// ==========================================================================

describe('POST /vendor/inventory/update + /delete', () => {
  const seedOwnedRow = () =>
    db.seed('vendors', [VENDOR])
      .seed('vendor_subscriptions', [])
      .seed('public_show_inventory', [mkInvRow()]);

  it('updates only provided fields + updated_at', async () => {
    seedOwnedRow();
    const res = await callWorker('/vendor/inventory/update', {
      method: 'POST',
      token: await tokenFor('user-1'),
      body: { id: 'row-1', sticker_price: 9.5, quantity: 3 },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, id: 'row-1' });
    const upd = db.matching(/^UPDATE public_show_inventory/)[0];
    expect(upd.sql).toContain('sticker_price = ?');
    expect(upd.sql).toContain('quantity = ?');
    expect(upd.sql).toContain('updated_at = ?');
    expect(upd.sql).not.toContain('name = ?');
    expect(upd.args[0]).toBe(9.5);
    expect(upd.args[1]).toBe(3);
    expect(db.table('public_show_inventory')[0].sticker_price).toBe(9.5);
  });

  it('name change on a product_id=0 row rewrites dedupe_key', async () => {
    seedOwnedRow();
    db.table('public_show_inventory')[0].product_id = 0;
    db.table('public_show_inventory')[0].dedupe_key = 'n:pikachu|base set|58';
    await callWorker('/vendor/inventory/update', {
      method: 'POST',
      token: await tokenFor('user-1'),
      body: { id: 'row-1', name: 'Raichu' },
    });
    const upd = db.matching(/^UPDATE public_show_inventory/)[0];
    expect(upd.sql).toContain('dedupe_key = ?');
    expect(db.table('public_show_inventory')[0].dedupe_key).toBe('n:raichu|base set|58');
  });

  it('name change on a product row keeps p:<id> (no dedupe_key write)', async () => {
    seedOwnedRow();
    await callWorker('/vendor/inventory/update', {
      method: 'POST',
      token: await tokenFor('user-1'),
      body: { id: 'row-1', name: 'Raichu' },
    });
    const upd = db.matching(/^UPDATE public_show_inventory/)[0];
    expect(upd.sql).not.toContain('dedupe_key');
    expect(db.table('public_show_inventory')[0].dedupe_key).toBe('p:111');
  });

  it('edit on another vendor’s row → 403; missing → 404; missing id → 400', async () => {
    db.seed('vendors', [VENDOR]).seed('public_show_inventory', [mkInvRow({ vendor_id: 'other-vendor' })]);
    const token = await tokenFor('user-1');
    const forbidden = await callWorker('/vendor/inventory/update', {
      method: 'POST',
      token,
      body: { id: 'row-1', name: 'X' },
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toBe('Not authorized to edit this row');
    expect(
      (await callWorker('/vendor/inventory/update', { method: 'POST', token, body: { id: 'ghost', name: 'X' } })).body.error
    ).toBe('Row not found');
    expect(
      (await callWorker('/vendor/inventory/update', { method: 'POST', token, body: {} })).body.error
    ).toBe('Missing id');
  });

  it('delete removes only the caller’s own row', async () => {
    seedOwnedRow();
    const res = await callWorker('/vendor/inventory/delete', {
      method: 'POST',
      token: await tokenFor('user-1'),
      body: { id: 'row-1' },
    });
    expect(res.status).toBe(200);
    expect(db.table('public_show_inventory')).toHaveLength(0);
  });

  it('delete on another vendor’s row → 403; missing → 404', async () => {
    db.seed('vendors', [VENDOR]).seed('public_show_inventory', [mkInvRow({ vendor_id: 'other-vendor' })]);
    const token = await tokenFor('user-1');
    const forbidden = await callWorker('/vendor/inventory/delete', {
      method: 'POST',
      token,
      body: { id: 'row-1' },
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toBe('Not authorized to delete this row');
    expect(db.table('public_show_inventory')).toHaveLength(1);
    expect(
      (await callWorker('/vendor/inventory/delete', { method: 'POST', token, body: { id: 'ghost' } })).status
    ).toBe(404);
  });

  it('unpaid vendor → 500 subscription_required before ownership checks', async () => {
    db.setConfig('payments_live', '1')
      .seed('vendors', [VENDOR])
      .seed('public_show_inventory', [mkInvRow()]);
    const res = await callWorker('/vendor/inventory/delete', {
      method: 'POST',
      token: await tokenFor('user-1'),
      body: { id: 'row-1' },
    });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('subscription_required');
  });
});

// ==========================================================================

describe('POST /vendor/shows/{id}/request', () => {
  const post = (token: string, body?: Row) =>
    callWorker('/vendor/shows/show-1/request', {
      method: 'POST',
      token,
      body: body ?? { vendor_name: 'Shop', vendor_table: 'A4' },
    });

  it('creates a pending registration', async () => {
    db.seed('vendors', [VENDOR, ORGANIZER]).seed('shows', [SHOW]);
    const res = await post(await tokenFor('user-1'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, status: 'pending' });
    expect(db.table('vendor_show_registrations')[0]).toMatchObject({
      vendor_id: 'vend',
      show_id: 'show-1',
      status: 'pending',
      vendor_name: 'Shop',
      vendor_table: 'A4',
    });
  });

  it('re-request after rejection flips the row back to pending', async () => {
    db.seed('vendors', [VENDOR, ORGANIZER])
      .seed('shows', [SHOW])
      .seed('vendor_show_registrations', [mkReg({ status: 'rejected' })]);
    const res = await post(await tokenFor('user-1'));
    expect(res.status).toBe(200);
    expect(db.table('vendor_show_registrations')).toHaveLength(1);
    expect(db.table('vendor_show_registrations')[0].status).toBe('pending');
    const upsert = db.matching(/^INSERT INTO vendor_show_registrations/)[0];
    expect(upsert.sql).toContain("status = 'pending'");
  });

  it('organizer requesting own show → 400', async () => {
    db.seed('vendors', [VENDOR, ORGANIZER]).seed('shows', [SHOW]);
    const res = await post(await tokenFor('user-org'));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Organizer already owns this show');
  });

  it('inactive show → 400 (returned path — contrast with inventory 403)', async () => {
    db.seed('vendors', [VENDOR, ORGANIZER]).seed('shows', [mkShow({ is_active: 0 })]);
    const res = await post(await tokenFor('user-1'));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Show is not active');
  });

  it('missing show → 404', async () => {
    db.seed('vendors', [VENDOR]);
    const res = await callWorker('/vendor/shows/ghost/request', {
      method: 'POST',
      token: await tokenFor('user-1'),
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Show not found');
  });

  it('any authenticated user may request — no paid-vendor gate', async () => {
    db.setConfig('payments_live', '1')
      .seed('vendors', [VENDOR, ORGANIZER])
      .seed('shows', [SHOW]);
    const res = await post(await tokenFor('user-1'));
    expect(res.status).toBe(200);
  });
});

// ==========================================================================

describe('organizer routes', () => {
  const orgSeeds = () => db.seed('vendors', [VENDOR, ORGANIZER]);

  it('POST /shows creates an active show under the organizer’s id', async () => {
    orgSeeds();
    const res = await callWorker('/shows', {
      method: 'POST',
      token: await tokenFor('user-org'),
      body: { name: 'Regionals', start_date: '2027-01-10', location: 'Hall B', table_count: '25', pay_instructions: 'Cash' },
    });
    expect(res.status).toBe(200);
    expect(res.body.show).toMatchObject({
      id: expect.stringMatching(/^[0-9a-f]{32}$/),
      vendor_id: 'org-v',
      name: 'Regionals',
      is_active: 1,
      table_count: 25,
      pay_instructions: 'Cash',
    });
    expect(db.table('shows')[0].vendor_id).toBe('org-v');
  });

  it('POST /shows without is_organizer → 403', async () => {
    db.seed('vendors', [VENDOR]);
    const res = await callWorker('/shows', {
      method: 'POST',
      token: await tokenFor('user-1'),
      body: { name: 'Regionals' },
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('not authorized: organizer flag required');
  });

  // quirk: getOrCreateVendor runs before the organizer check, so a brand-new
  // user who hits POST /shows gets a vendors row created and *then* a 403.
  it('POST /shows as a first-time user still materializes the vendor row', async () => {
    const res = await callWorker('/shows', {
      method: 'POST',
      token: await tokenFor('user-new'),
      body: { name: 'Regionals' },
    });
    expect(res.status).toBe(403);
    expect(db.table('vendors').map((v) => v.user_id)).toContain('user-new');
  });

  it('POST /shows missing name → 400', async () => {
    orgSeeds();
    const res = await callWorker('/shows', {
      method: 'POST',
      token: await tokenFor('user-org'),
      body: { name: '  ' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing name');
  });

  it('PATCH /shows/{id} owner updates, non-owner 403, missing 404', async () => {
    orgSeeds().seed('shows', [SHOW]);
    const res = await callWorker('/shows/show-1', {
      method: 'PATCH',
      token: await tokenFor('user-org'),
      body: { name: 'Renamed Fest', is_active: false },
    });
    expect(res.status).toBe(200);
    expect(res.body.show).toMatchObject({ id: 'show-1', name: 'Renamed Fest', is_active: 0, location: 'Hall A' });

    const forbidden = await callWorker('/shows/show-1', {
      method: 'PATCH',
      token: await tokenFor('user-1'),
      body: { name: 'Hijack' },
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toBe('not authorized: not the show organizer');

    const missing = await callWorker('/shows/ghost', {
      method: 'PATCH',
      token: await tokenFor('user-org'),
      body: { name: 'X' },
    });
    expect(missing.status).toBe(404);
  });

  it('percent-encoded show ids decode before dispatch', async () => {
    orgSeeds().seed('shows', [mkShow({ id: 'special show' })]);
    const res = await callWorker('/shows/special%20show', {
      method: 'PATCH',
      token: await tokenFor('user-org'),
      body: { name: 'Works' },
    });
    expect(res.status).toBe(200);
    expect(res.body.show.id).toBe('special show');
  });

  it('GET /vendors excludes the manual: namespace; non-organizer → 403', async () => {
    orgSeeds()
      .seed('shows', [SHOW])
      .seed('vendors', [mkVendor({ id: 'manual:legacy', user_id: 'x', name: 'Legacy Manual' })]);
    const res = await callWorker('/vendors', { token: await tokenFor('user-org') });
    expect(res.status).toBe(200);
    expect(res.body.vendors.map((v: Row) => v.id)).toEqual(['org-v', 'vend']);

    const forbidden = await callWorker('/vendors', { token: await tokenFor('user-1') });
    expect(forbidden.status).toBe(403);
  });

  it('GET /shows/{id}/registrations returns sanitized rows with is_manual flag', async () => {
    orgSeeds()
      .seed('shows', [SHOW])
      .seed('vendor_show_registrations', [
        mkReg({ created_at: 1000 }),
        mkReg({ vendor_id: 'manual:abc', status: 'approved', manual_name: 'Cash Carl', created_at: 2000 }),
      ]);
    const res = await callWorker('/shows/show-1/registrations', { token: await tokenFor('user-org') });
    expect(res.status).toBe(200);
    expect(res.body.registrations).toHaveLength(2);
    // newest first
    expect(res.body.registrations[0].vendor_id).toBe('manual:abc');
    expect(res.body.registrations[0].is_manual).toBe(1);
    expect(res.body.registrations[1].is_manual).toBe(0);
    expect(Object.keys(res.body.registrations[0]).sort()).toEqual([
      'created_at',
      'is_manual',
      'manual_name',
      'manual_phone',
      'paid_amount',
      'status',
      'table_number',
      'total_due',
      'vendor_id',
      'vendor_name',
      'vendor_table',
    ]);
  });

  it('GET /shows/{id}/registrations as non-owner → 403', async () => {
    orgSeeds().seed('shows', [SHOW]);
    const res = await callWorker('/shows/show-1/registrations', { token: await tokenFor('user-1') });
    expect(res.status).toBe(403);
  });

  it('POST registrations with vendor_id → approved row seeded from vendors table', async () => {
    orgSeeds().seed('shows', [SHOW]);
    const res = await callWorker('/shows/show-1/registrations', {
      method: 'POST',
      token: await tokenFor('user-org'),
      body: { vendor_id: 'vend', table_number: '5', total_due: 60 },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, vendor_id: 'vend', status: 'approved' });
    expect(db.table('vendor_show_registrations')[0]).toMatchObject({
      vendor_id: 'vend',
      status: 'approved',
      vendor_name: 'Vend Co',
      table_number: '5',
      total_due: 60,
      paid_amount: 0,
    });
  });

  it('POST registrations with manual_name → manual:<hex> approved row', async () => {
    orgSeeds().seed('shows', [SHOW]);
    const res = await callWorker('/shows/show-1/registrations', {
      method: 'POST',
      token: await tokenFor('user-org'),
      body: { manual_name: 'Cash Carl', manual_phone: '555-0100', table_number: '7', total_due: 25 },
    });
    expect(res.status).toBe(200);
    expect(res.body.vendor_id).toMatch(/^manual:[0-9a-f]{32}$/);
    expect(db.table('vendor_show_registrations')[0]).toMatchObject({
      vendor_id: res.body.vendor_id,
      status: 'approved',
      vendor_name: 'Cash Carl',
      manual_name: 'Cash Carl',
      manual_phone: '555-0100',
    });
  });

  it('POST registrations with neither → 400; unknown vendor_id → 404', async () => {
    orgSeeds().seed('shows', [SHOW]);
    const token = await tokenFor('user-org');
    expect(
      (await callWorker('/shows/show-1/registrations', { method: 'POST', token, body: {} })).body.error
    ).toBe('Missing vendor_id or manual_name');
    expect(
      (await callWorker('/shows/show-1/registrations', { method: 'POST', token, body: { vendor_id: 'ghost' } })).status
    ).toBe(404);
  });

  it('PATCH registrations updates fields; invalid status 400; missing 404', async () => {
    orgSeeds().seed('shows', [SHOW]).seed('vendor_show_registrations', [mkReg({ status: 'pending' })]);
    const token = await tokenFor('user-org');
    const res = await callWorker('/shows/show-1/registrations/vend', {
      method: 'PATCH',
      token,
      body: { status: 'approved', table_number: '8', total_due: 90, paid_amount: 40 },
    });
    expect(res.status).toBe(200);
    expect(db.table('vendor_show_registrations')[0]).toMatchObject({
      status: 'approved',
      table_number: '8',
      total_due: 90,
      paid_amount: 40,
    });

    expect(
      (await callWorker('/shows/show-1/registrations/vend', { method: 'PATCH', token, body: { status: 'bogus' } })).body.error
    ).toBe('Invalid status');
    expect(
      (await callWorker('/shows/show-1/registrations/ghost', { method: 'PATCH', token, body: {} })).body.error
    ).toBe('Registration not found');
  });

  it('manual: vendor ids round-trip through percent-encoded path params', async () => {
    orgSeeds()
      .seed('shows', [SHOW])
      .seed('vendor_show_registrations', [mkReg({ vendor_id: 'manual:99ff', manual_name: 'Cash Carl' })]);
    const res = await callWorker('/shows/show-1/registrations/manual%3A99ff', {
      method: 'PATCH',
      token: await tokenFor('user-org'),
      body: { paid_amount: 30 },
    });
    expect(res.status).toBe(200);
    expect(db.table('vendor_show_registrations')[0].paid_amount).toBe(30);
  });
});

// ==========================================================================

describe('team routes', () => {
  it('GET /vendor/team with no team → {team:null}', async () => {
    db.seed('vendors', [VENDOR]);
    const res = await callWorker('/vendor/team', { token: await tokenFor('user-1') });
    expect(res.body).toEqual({ ok: true, team: null });
  });

  it('owner sees invite_code; member view omits it', async () => {
    db.seed('vendors', [VENDOR])
      .seed('teams', [mkTeam({ owner_user_id: 'user-1' })])
      .seed('team_members', [{ team_id: 'user-1', member_user_id: 'user-2', created_at: 1 }]);
    const owner = await callWorker('/vendor/team', { token: await tokenFor('user-1') });
    expect(owner.body.team.invite_code).toBe('123456');
    expect(owner.body.team.is_owner).toBe(true);
    expect(owner.body.team.seats_used).toBe(1);

    const member = await callWorker('/vendor/team', { token: await tokenFor('user-2') });
    expect(member.body.team.is_owner).toBe(false);
    expect(member.body.team.invite_code).toBeUndefined();
  });

  it('redeem adds the caller as a member', async () => {
    db.seed('vendors', [VENDOR]).seed('teams', [mkTeam()]);
    const res = await callWorker('/vendor/team/redeem', {
      method: 'POST',
      token: await tokenFor('user-1'),
      body: { code: '123456' },
    });
    expect(res.status).toBe(200);
    expect(db.table('team_members')[0]).toMatchObject({ team_id: 'boss', member_user_id: 'user-1' });
    expect(res.body.team.is_owner).toBe(false);
  });

  it('redeem: bad code 404, expired 403, full 403, owner echo, already-member echo', async () => {
    const token = await tokenFor('user-1');
    db.seed('vendors', [VENDOR]);
    expect(
      (await callWorker('/vendor/team/redeem', { method: 'POST', token, body: { code: '000000' } })).body.error
    ).toBe('Team not found');

    db.seed('teams', [mkTeam({ expires_at: Math.floor(Date.now() / 1000) - 10 })]);
    expect(
      (await callWorker('/vendor/team/redeem', { method: 'POST', token, body: { code: '123456' } })).body.error
    ).toBe('Team subscription expired');

    db.table('teams')[0].expires_at = null;
    db.seed('team_members', [
      { team_id: 'boss', member_user_id: 'm1', created_at: 1 },
      { team_id: 'boss', member_user_id: 'm2', created_at: 2 },
      { team_id: 'boss', member_user_id: 'm3', created_at: 3 },
    ]);
    expect(
      (await callWorker('/vendor/team/redeem', { method: 'POST', token, body: { code: '123456' } })).body.error
    ).toBe('no seats available');

    const ownerRes = await callWorker('/vendor/team/redeem', {
      method: 'POST',
      token: await tokenFor('boss'),
      body: { code: '123456' },
    });
    expect(ownerRes.status).toBe(200);
    expect(db.table('team_members').filter((m) => m.member_user_id === 'boss')).toHaveLength(0);

    db.table('team_members').push({ team_id: 'boss', member_user_id: 'user-1', created_at: 4 });
    const again = await callWorker('/vendor/team/redeem', {
      method: 'POST',
      token,
      body: { code: '123456' },
    });
    expect(again.status).toBe(200);
    expect(again.body.team.owner_user_id).toBe('boss');
  });

  it('rename: 200 ok, empty 400, >80 chars 400, no team → subscription_required 403', async () => {
    db.seed('vendors', [VENDOR]).seed('teams', [mkTeam({ owner_user_id: 'user-1' })]);
    const token = await tokenFor('user-1');
    const ok = await callWorker('/vendor/team/rename', {
      method: 'POST',
      token,
      body: { name: 'New Name' },
    });
    expect(ok.status).toBe(200);
    expect(db.table('teams')[0].name).toBe('New Name');
    expect(
      (await callWorker('/vendor/team/rename', { method: 'POST', token, body: { name: ' ' } })).body.error
    ).toBe('Team name is required');
    expect(
      (await callWorker('/vendor/team/rename', { method: 'POST', token, body: { name: 'x'.repeat(81) } })).body.error
    ).toBe('Team name must be 80 characters or less');
  });

  it('remove: owner removes a member; member attempt → 403; self → 400', async () => {
    db.seed('vendors', [VENDOR])
      .seed('teams', [mkTeam({ owner_user_id: 'user-1' })])
      .seed('team_members', [{ team_id: 'user-1', member_user_id: 'user-2', created_at: 1 }]);
    const token = await tokenFor('user-1');
    const res = await callWorker('/vendor/team/remove', {
      method: 'POST',
      token,
      body: { member_user_id: 'user-2' },
    });
    expect(res.status).toBe(200);
    expect(db.table('team_members')).toHaveLength(0);

    const self = await callWorker('/vendor/team/remove', {
      method: 'POST',
      token,
      body: { member_user_id: 'user-1' },
    });
    expect(self.body.error).toBe('Cannot remove owner');

    const member = await callWorker('/vendor/team/remove', {
      method: 'POST',
      token: await tokenFor('user-2'),
      body: { member_user_id: 'user-3' },
    });
    expect(member.status).toBe(403);
  });

  it('leave: member departs; non-member is a harmless ok', async () => {
    db.seed('vendors', [VENDOR])
      .seed('teams', [mkTeam()])
      .seed('team_members', [{ team_id: 'boss', member_user_id: 'user-1', created_at: 1 }]);
    const res = await callWorker('/vendor/team/leave', {
      method: 'POST',
      token: await tokenFor('user-1'),
    });
    expect(res.status).toBe(200);
    expect(db.table('team_members')).toHaveLength(0);

    const again = await callWorker('/vendor/team/leave', {
      method: 'POST',
      token: await tokenFor('user-2'),
    });
    expect(again.body).toEqual({ ok: true });
  });

  it('regenerate-code rotates the invite; no team + no RC key → 500', async () => {
    db.seed('vendors', [VENDOR]).seed('teams', [mkTeam({ owner_user_id: 'user-1' })]);
    const res = await callWorker('/vendor/team/regenerate-code', {
      method: 'POST',
      token: await tokenFor('user-1'),
    });
    expect(res.status).toBe(200);
    expect(res.body.team.invite_code).toMatch(/^\d{6}$/);
    expect(res.body.team.invite_code).not.toBe('123456');

    const none = await callWorker('/vendor/team/regenerate-code', {
      method: 'POST',
      token: await tokenFor('user-2'),
    });
    expect(none.status).toBe(500);
    expect(none.body.error).toBe('RevenueCat secret API key not configured');
  });
});

// ==========================================================================

describe('POST /revenuecat-webhook', () => {
  const env = (over: Row = {}) => makeEnv({ REVENUECAT_WEBHOOK_SECRET: 'whsec', ...over });
  const evt = (over: Row = {}) => ({
    event: {
      type: 'INITIAL_PURCHASE',
      app_user_id: 'u-web',
      product_id: 'cc_pro_monthly',
      entitlement_ids: ['Cardcache_pro'],
      expiration_at_ms: 1893456000000,
      ...over,
    },
  });
  const post = (rawBody: string, headers: Row, e: Row) =>
    callWorker('/revenuecat-webhook', { method: 'POST', rawBody, headers, env: e });

  it('no webhook secret configured → 500', async () => {
    const res = await callWorker('/revenuecat-webhook', {
      method: 'POST',
      rawBody: '{}',
      env: makeEnv(),
    });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Webhook secret not configured');
  });

  it('no signature or auth header → 401', async () => {
    const res = await post(JSON.stringify(evt()), {}, env());
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid signature');
  });

  it('wrong static Authorization secret → 401', async () => {
    const res = await post(JSON.stringify(evt()), { Authorization: 'Bearer wrong' }, env());
    expect(res.status).toBe(401);
  });

  it('valid static Authorization secret accepts the event', async () => {
    const res = await post(JSON.stringify(evt()), { Authorization: 'Bearer whsec' }, env());
    expect(res.status).toBe(200);
    expect(db.table('vendor_subscriptions')[0]).toMatchObject({
      user_id: 'u-web',
      entitlement_id: 'Cardcache_pro',
      product_id: 'cc_pro_monthly',
      is_active: 1,
    });
  });

  it('valid v2 HMAC signature accepts the event', async () => {
    const raw = JSON.stringify(evt());
    const sig = await hmacHex('whsec', raw);
    const res = await post(raw, { 'X-RevenueCat-Signature': sig }, env());
    expect(res.status).toBe(200);
  });

  it('EXPIRATION deactivates the sub and clears the founder flag', async () => {
    db.seed('vendors', [mkVendor({ user_id: 'u-web', is_founder: 1, founder_seat_number: 7 })])
      .seed('vendor_subscriptions', [mkSub({ user_id: 'u-web' })]);
    const res = await post(
      JSON.stringify(evt({ type: 'EXPIRATION' })),
      { Authorization: 'Bearer whsec' },
      env()
    );
    expect(res.status).toBe(200);
    expect(db.table('vendor_subscriptions')[0].is_active).toBe(0);
    expect(db.table('vendors')[0].is_founder).toBe(0);
    expect(db.table('vendors')[0].founder_seat_number).toBe(7); // seat kept
  });

  it('entitlement_ids lacking Cardcache_pro → ok, writes nothing', async () => {
    const res = await post(
      JSON.stringify(evt({ entitlement_ids: ['Cardcache_scan'] })),
      { Authorization: 'Bearer whsec' },
      env()
    );
    expect(res.status).toBe(200);
    expect(db.writesTo('vendor_subscriptions')).toHaveLength(0);
  });

  it('cc_scan_* product without entitlement_ids → skipped via denylist', async () => {
    const res = await post(
      JSON.stringify(evt({ product_id: 'cc_scan_unlimited_monthly', entitlement_ids: undefined })),
      { Authorization: 'Bearer whsec' },
      env()
    );
    expect(res.status).toBe(200);
    expect(db.writesTo('vendor_subscriptions')).toHaveLength(0);
  });

  it('missing app_user_id → 400', async () => {
    const res = await post(
      JSON.stringify(evt({ app_user_id: undefined, original_app_user_id: undefined })),
      { Authorization: 'Bearer whsec' },
      env()
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing app_user_id');
  });

  it('with REVENUECAT_SECRET_API_KEY, reconciles from the subscribers API and drops cc_scan_*', async () => {
    installFetch(db, {
      jwks: [key.jwk],
      revenueCat: (url) => {
        expect(url).toBe('https://api.revenuecat.com/v1/subscribers/u-web');
        return Response.json({
          subscriber: {
            entitlements: {
              Cardcache_pro: { product_identifier: 'cc_pro_team_base_monthly', expires_date: '2027-01-01T00:00:00Z' },
            },
            subscriptions: {
              cc_pro_team_base_monthly: { expires_date: '2027-01-01T00:00:00Z' },
              cc_scan_unlimited_monthly: { expires_date: '2027-01-01T00:00:00Z' },
            },
          },
        });
      },
    });
    const res = await post(
      JSON.stringify(evt()),
      { Authorization: 'Bearer whsec' },
      env({ REVENUECAT_SECRET_API_KEY: 'rc-key' })
    );
    expect(res.status).toBe(200);
    const subs = db.table('vendor_subscriptions');
    expect(subs.map((s) => s.product_id)).toEqual(['cc_pro_team_base_monthly']);
    expect(subs[0].is_active).toBe(1);
    // team product → seats recalculated into a team row
    expect(db.table('teams')[0]).toMatchObject({
      owner_user_id: 'u-web',
      product_id: 'cc_pro_team_base_monthly',
      seats_total: 3,
    });
  });
});

// ==========================================================================

describe('POST /vendor/sync-subscription + /vendor/delete-account', () => {
  it('sync-subscription reconciles RevenueCat state and returns team', async () => {
    db.seed('vendors', [VENDOR]);
    installFetch(db, {
      jwks: [key.jwk],
      revenueCat: () =>
        Response.json({
          subscriber: {
            entitlements: {
              Cardcache_pro: { product_identifier: 'cc_pro_monthly', expires_date: '2027-01-01T00:00:00Z' },
            },
            subscriptions: {
              cc_pro_monthly: { expires_date: '2027-01-01T00:00:00Z' },
            },
          },
        }),
    });
    const res = await callWorker('/vendor/sync-subscription', {
      method: 'POST',
      token: await tokenFor('user-1'),
      env: makeEnv({ REVENUECAT_SECRET_API_KEY: 'rc-key' }),
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, is_vendor: 1, product_id: 'cc_pro_monthly' });
    expect(db.table('vendor_subscriptions')[0].is_active).toBe(1);
  });

  it('sync-subscription without RC key → 500', async () => {
    db.seed('vendors', [VENDOR]);
    const res = await callWorker('/vendor/sync-subscription', {
      method: 'POST',
      token: await tokenFor('user-1'),
    });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('RevenueCat secret API key not configured');
  });

  it('delete-account wipes every Turso row then deletes the Supabase user', async () => {
    const seen: string[] = [];
    db.seed('vendors', [mkVendor({ founder_seat_number: 3, is_founder: 1 })])
      .seed('public_show_inventory', [mkInvRow()])
      .seed('vendor_subscriptions', [mkSub()])
      .seed('teams', [mkTeam({ owner_user_id: 'user-1' })])
      .seed('team_members', [{ team_id: 'user-1', member_user_id: 'user-2', created_at: 1 }]);
    installFetch(db, {
      jwks: [key.jwk],
      onRequest: (url, init) => seen.push(`${init?.method ?? 'GET'} ${url}`),
    });
    const res = await callWorker('/vendor/delete-account', {
      method: 'POST',
      token: await tokenFor('user-1'),
      env: makeEnv({ SUPABASE_SERVICE_ROLE_KEY: 'srk' }),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, deleted: true });
    expect(db.table('vendors')).toHaveLength(0);
    expect(db.table('public_show_inventory')).toHaveLength(0);
    expect(db.table('vendor_subscriptions')).toHaveLength(0);
    expect(db.table('teams')).toHaveLength(0);
    expect(db.table('team_members')).toHaveLength(0);
    expect(seen).toContain('DELETE https://supabase.test/auth/v1/admin/users/user-1');
    // founder seat was held → counter decrement issued
    expect(db.matching(/^UPDATE founder_counter SET claimed = claimed - 1/)).toHaveLength(1);
  });

  // quirk: all Turso deletes run before the Supabase admin call, so a missing
  // service key still destroys the vendor data while the auth user survives.
  it('delete-account without service key → 500 but Turso rows already gone', async () => {
    db.seed('vendors', [VENDOR]).seed('public_show_inventory', [mkInvRow()]);
    const res = await callWorker('/vendor/delete-account', {
      method: 'POST',
      token: await tokenFor('user-1'),
    });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Supabase service role key not configured');
    expect(db.table('vendors')).toHaveLength(0);
    expect(db.table('public_show_inventory')).toHaveLength(0);
  });
});
