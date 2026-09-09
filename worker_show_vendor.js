// Cloudflare Worker: show-vendor inventory upload and management
// Routes (all authenticated via Supabase JWT):
//   GET  /vendor/me
//   GET  /vendor/inventory?show_id=...
//   POST /vendor/inventory         (batch create/upsert)
//   POST /vendor/inventory/update  (edit a row)
//   POST /vendor/inventory/delete  (remove a row)

const DEFAULT_SUPABASE_URL = "https://jglvrozjhfooohkbmmwe.supabase.co";
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;

let jwksCache = null;
let jwksCacheUrl = "";
let jwksFetchPromise = null;
let schemaPromise = null;

function toLowerAsciiOnly(text) {
  return String(text || "").replace(/[A-Z]/g, (ch) => ch.toLowerCase());
}

function buildDedupeKey(productId, name, setName, number) {
  if (productId > 0) {
    return `p:${productId}`;
  }
  const n = toLowerAsciiOnly(String(name || ""));
  const s = toLowerAsciiOnly(String(setName || ""));
  const num = toLowerAsciiOnly(String(number || ""));
  if (n === "" && s === "" && num === "") {
    return `n:row:${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  }
  return `n:${n}|${s}|${num}`;
}

function getIndexInfo(rows, indexName) {
  return rows.find((r) => r.name === indexName) || null;
}

async function ensureUniqueIndex(env) {
  const indexList = await tursoPipeline(env, [
    buildExecute(`PRAGMA index_list('public_show_inventory')`),
    { type: "close" },
  ]);
  const rows = allRows(indexList.results);
  const existing = getIndexInfo(rows, "ux_public_show_inventory");

  if (existing) {
    if (Number(existing.unique)) {
      return;
    }
    await tursoPipeline(env, [
      buildExecute(`DROP INDEX IF EXISTS ux_public_show_inventory`),
      { type: "close" },
    ]);
  }

  try {
    await tursoPipeline(env, [
      buildExecute(`
        CREATE UNIQUE INDEX IF NOT EXISTS ux_public_show_inventory
        ON public_show_inventory(show_id, vendor_id, condition, dedupe_key)
      `),
      { type: "close" },
    ]);
  } catch (idxErr) {
    console.error("Creating unique index on public_show_inventory failed:", idxErr.message);
    throw idxErr;
  }
}

function base64UrlDecode(str) {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function base64UrlToString(str) {
  return new TextDecoder().decode(base64UrlDecode(str));
}

function getSupabaseUrl(env) {
  if (env && env.SUPABASE_URL) return env.SUPABASE_URL;
  if (env && env.SUPABASE_JWKS_URL) {
    const m = env.SUPABASE_JWKS_URL.match(/^https?:\/\/[^/]+/);
    if (m) return m[0];
  }
  return DEFAULT_SUPABASE_URL;
}

function getSupabaseJwksUrl(env) {
  if (env && env.SUPABASE_JWKS_URL) return env.SUPABASE_JWKS_URL;
  const base = getSupabaseUrl(env).replace(/\/$/, "");
  const m = base.match(/^https?:\/\/([^.]+)\.supabase\.co$/);
  if (m) {
    return `https://${m[1]}.supabase.co/auth/v1/.well-known/jwks.json`;
  }
  return `${base}/auth/v1/.well-known/jwks.json`;
}

async function fetchJwks(url) {
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`JWKS fetch failed: HTTP ${response.status}`);
  }
  const data = await response.json();
  if (!Array.isArray(data.keys)) {
    throw new Error("JWKS response missing keys array");
  }
  return data.keys;
}

async function getJwksKeys(env) {
  const url = getSupabaseJwksUrl(env);
  const now = Date.now();

  if (jwksCache && jwksCacheUrl === url && now - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
    return jwksCache.keys;
  }

  if (jwksFetchPromise) {
    try {
      await jwksFetchPromise;
    } catch (e) {
      // ignore, retry below
    }
    if (jwksCache && jwksCacheUrl === url && Date.now() - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
      return jwksCache.keys;
    }
  }

  jwksFetchPromise = fetchJwks(url)
    .then((keys) => {
      jwksCache = { keys, fetchedAt: Date.now() };
      jwksCacheUrl = url;
      return keys;
    })
    .finally(() => {
      jwksFetchPromise = null;
    });

  return jwksFetchPromise;
}

function findEcJwk(keys, kid) {
  return keys.find((k) => k.kid === kid && k.kty === "EC" && k.alg === "ES256" && k.crv === "P-256" && k.x && k.y);
}

async function importEcKey(jwk) {
  const publicJwk = {
    kty: jwk.kty,
    crv: jwk.crv,
    x: jwk.x,
    y: jwk.y,
    alg: jwk.alg,
    ext: true,
  };
  return crypto.subtle.importKey(
    "jwk",
    publicJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"]
  );
}

async function verifyJwt(token, env) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format");
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  let header;
  let payload;
  try {
    header = JSON.parse(base64UrlToString(headerB64));
    payload = JSON.parse(base64UrlToString(payloadB64));
  } catch (e) {
    throw new Error("Invalid JWT payload or header");
  }

  if (header.alg !== "ES256") {
    throw new Error("Unsupported JWT algorithm");
  }
  if (header.typ && header.typ !== "JWT") {
    throw new Error("Unsupported JWT type");
  }
  if (!header.kid) {
    throw new Error("JWT header missing kid");
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp !== undefined && payload.exp < now) {
    throw new Error("JWT expired");
  }
  if (payload.nbf !== undefined && payload.nbf > now) {
    throw new Error("JWT not yet valid");
  }

  const supabaseUrl = getSupabaseUrl(env).replace(/\/$/, "");
  if (payload.iss && !String(payload.iss).startsWith(supabaseUrl)) {
    throw new Error("JWT issuer mismatch");
  }

  const keys = await getJwksKeys(env);
  const jwk = findEcJwk(keys, header.kid);
  if (!jwk) {
    throw new Error("No matching JWKS key found");
  }

  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlDecode(signatureB64);

  const key = await importEcKey(jwk);
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    key,
    signature,
    data
  );

  if (!valid) {
    throw new Error("Invalid JWT signature");
  }

  return payload;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json", ...extraHeaders },
  });
}

function errorResponse(message, status = 400) {
  return jsonResponse({ ok: false, error: message }, status);
}

function getAuthToken(request) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader && authHeader.trim().toLowerCase().startsWith("bearer ")) {
    return authHeader.trim().slice(7).trim();
  }
  return null;
}

async function getAuthenticatedUser(request, env) {
  const token = getAuthToken(request);
  if (!token) {
    throw new Error("Missing Authorization header");
  }
  const payload = await verifyJwt(token, env);
  const userId = payload && payload.sub;
  if (!userId) {
    throw new Error("JWT missing sub");
  }
  const username = payload.user_metadata?.username ?? payload.email?.split("@")[0] ?? "";
  const email = payload.email ?? "";
  return { userId, username, email, raw: payload };
}

function toTursoArg(value) {
  if (value === null || value === undefined) return { type: "null" };
  if (typeof value === "boolean") return { type: "integer", value: value ? "1" : "0" };
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { type: "integer", value: String(value) };
    return { type: "float", value };
  }
  return { type: "text", value: String(value) };
}

function rowsToObjects(result) {
  const cols = (result?.cols || []).map((c) => c.name);
  const rows = result?.rows || [];
  return rows.map((row) => {
    const obj = {};
    for (let i = 0; i < cols.length; i++) {
      let value = row[i];
      if (typeof value === "object" && value !== null && "value" in value) {
        value = value.value;
      }
      obj[cols[i]] = value;
    }
    return obj;
  });
}

function firstResult(results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  return results[0];
}

function firstRow(results) {
  const r = firstResult(results);
  if (!r || r.type !== "ok" || r.response?.type !== "execute") return null;
  const rows = rowsToObjects(r.response.result);
  return rows[0] ?? null;
}

function allRows(results) {
  const r = firstResult(results);
  if (!r || r.type !== "ok" || r.response?.type !== "execute") return [];
  return rowsToObjects(r.response.result);
}

async function tablePrimaryKeyColumnCount(env, tableName) {
  const data = await tursoPipeline(env, [
    buildExecute(`PRAGMA table_info('${tableName}')`),
    { type: "close" },
  ]);
  const rows = allRows(data.results);
  return rows.reduce((sum, row) => sum + (Number(row.pk) || 0), 0);
}

async function migrateVendorSubscriptionsIfNeeded(env) {
  try {
    const pkCount = await tablePrimaryKeyColumnCount(env, "vendor_subscriptions");
    if (pkCount > 1) return;

    await tursoPipeline(env, [
      buildExecute(`DROP TABLE IF EXISTS _vendor_subscriptions_old`),
      buildExecute(`ALTER TABLE vendor_subscriptions RENAME TO _vendor_subscriptions_old`),
      buildExecute(`
        CREATE TABLE vendor_subscriptions (
          user_id TEXT NOT NULL,
          entitlement_id TEXT NOT NULL,
          product_id TEXT NOT NULL DEFAULT '',
          is_active INTEGER NOT NULL DEFAULT 0,
          expires_at INTEGER,
          updated_at INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, product_id)
        )
      `),
      buildExecute(`
        INSERT INTO vendor_subscriptions (user_id, entitlement_id, product_id, is_active, expires_at, updated_at)
        SELECT user_id, entitlement_id, COALESCE(product_id, '') AS product_id, is_active, expires_at, updated_at
        FROM _vendor_subscriptions_old
      `),
      buildExecute(`DROP TABLE _vendor_subscriptions_old`),
      { type: "close" },
    ]);
    console.log("Migrated vendor_subscriptions to composite primary key.");
  } catch (err) {
    console.warn("vendor_subscriptions migration check/failed:", err.message);
  }
}

async function tursoPipeline(env, statements) {
  if (!env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN) {
    throw new Error("Turso environment not configured");
  }
  const url = `${env.TURSO_DATABASE_URL.replace(/\/$/, "")}/v2/pipeline`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.TURSO_AUTH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requests: statements }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Turso pipeline failed: HTTP ${res.status} ${text}`);
  }

  const data = await res.json();
  const errorResult = (data?.results || []).find((r) => r.type === "error");
  if (errorResult) {
    const message = errorResult.error?.message || JSON.stringify(errorResult.error);
    throw new Error(`Turso pipeline error: ${message}`);
  }
  return data;
}

function buildExecute(sql, args = []) {
  return { type: "execute", stmt: { sql, args: args.map(toTursoArg) } };
}

async function ensureSchema(env) {
  if (schemaPromise) {
    const ok = await schemaPromise;
    if (!ok) throw new Error("Schema not ready");
    return ok;
  }

  schemaPromise = (async () => {
    await tursoPipeline(env, [
      buildExecute(`
        CREATE TABLE IF NOT EXISTS shows (
          id TEXT PRIMARY KEY,
          vendor_id TEXT NOT NULL,
          name TEXT,
          start_date TEXT,
          location TEXT,
          is_active INTEGER NOT NULL DEFAULT 1
        )
      `),
      buildExecute(`
        CREATE TABLE IF NOT EXISTS public_show_inventory (
          id TEXT PRIMARY KEY,
          show_id TEXT NOT NULL,
          vendor_id TEXT NOT NULL,
          product_id INTEGER,
          name TEXT,
          set_name TEXT,
          number TEXT,
          rarity TEXT,
          condition TEXT,
          sticker_price NUMERIC,
          quantity INTEGER,
          vendor_name TEXT,
          vendor_table TEXT,
          dedupe_key TEXT,
          updated_at INTEGER DEFAULT 0
        )
      `),
      buildExecute(`
        CREATE TABLE IF NOT EXISTS vendors (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL UNIQUE,
          name TEXT,
          table_default TEXT,
          created_at INTEGER
        )
      `),
      buildExecute(`
        CREATE TABLE IF NOT EXISTS vendor_show_registrations (
          vendor_id TEXT NOT NULL,
          show_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          vendor_name TEXT,
          vendor_table TEXT,
          created_at INTEGER,
          PRIMARY KEY (vendor_id, show_id)
        )
      `),
      buildExecute(`
        CREATE INDEX IF NOT EXISTS idx_vendors_user_id ON vendors(user_id)
      `),
      buildExecute(`
        CREATE INDEX IF NOT EXISTS idx_public_show_inventory_show ON public_show_inventory(show_id)
      `),
      buildExecute(`
        CREATE INDEX IF NOT EXISTS idx_public_show_inventory_vendor ON public_show_inventory(vendor_id)
      `),
      buildExecute(`
        CREATE INDEX IF NOT EXISTS idx_public_show_inventory_lookup ON public_show_inventory(show_id, vendor_id, product_id, condition)
      `),
      buildExecute(`
        CREATE TABLE IF NOT EXISTS app_config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `),
      buildExecute(`
        INSERT OR IGNORE INTO app_config (key, value) VALUES ('payments_live', '0')
      `),
      buildExecute(`
        INSERT OR IGNORE INTO app_config (key, value) VALUES ('founder_seat_limit', '50')
      `),
      buildExecute(`
        CREATE TABLE IF NOT EXISTS founder_counter (
          id TEXT PRIMARY KEY,
          claimed INTEGER NOT NULL DEFAULT 0
        )
      `),
      buildExecute(`
        INSERT OR IGNORE INTO founder_counter (id, claimed) VALUES ('founder', 0)
      `),
      buildExecute(`
        CREATE TABLE IF NOT EXISTS vendor_subscriptions (
          user_id TEXT NOT NULL,
          entitlement_id TEXT NOT NULL,
          product_id TEXT NOT NULL DEFAULT '',
          is_active INTEGER NOT NULL DEFAULT 0,
          expires_at INTEGER,
          updated_at INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, product_id)
        )
      `),
      buildExecute(`
        CREATE TABLE IF NOT EXISTS teams (
          owner_user_id TEXT PRIMARY KEY,
          product_id TEXT,
          seats_total INTEGER NOT NULL DEFAULT 0,
          expires_at INTEGER,
          invite_code TEXT UNIQUE,
          updated_at INTEGER,
          created_at INTEGER
        )
      `),
      buildExecute(`
        CREATE TABLE IF NOT EXISTS team_members (
          team_id TEXT NOT NULL,
          member_user_id TEXT NOT NULL,
          created_at INTEGER,
          PRIMARY KEY (team_id, member_user_id)
        )
      `),
      buildExecute(`
        CREATE INDEX IF NOT EXISTS idx_team_members_member ON team_members(member_user_id)
      `),
      { type: "close" },
    ]);

    try {
      await tursoPipeline(env, [
        buildExecute(`ALTER TABLE vendors ADD COLUMN is_founder INTEGER NOT NULL DEFAULT 0`),
        { type: "close" },
      ]);
    } catch (err) {
      if (!String(err.message).toLowerCase().includes("duplicate column")) {
        console.warn("Adding is_founder to vendors failed:", err.message);
      }
    }

    try {
      await tursoPipeline(env, [
        buildExecute(`ALTER TABLE vendors ADD COLUMN founder_seat_number INTEGER`),
        { type: "close" },
      ]);
    } catch (err) {
      if (!String(err.message).toLowerCase().includes("duplicate column")) {
        console.warn("Adding founder_seat_number to vendors failed:", err.message);
      }
    }

    // Grandfather existing vendors into the first 50 founder seats once.
    try {
      const counter = firstRow((await tursoPipeline(env, [
        buildExecute(`SELECT claimed FROM founder_counter WHERE id = 'founder'`),
        { type: "close" },
      ])).results);
      const vendorCount = firstRow((await tursoPipeline(env, [
        buildExecute(`SELECT COUNT(*) AS c FROM vendors`),
        { type: "close" },
      ])).results);

      if (counter && Number(counter.claimed) === 0 && vendorCount && Number(vendorCount.c) > 0) {
        await tursoPipeline(env, [
          buildExecute(`
            WITH ranked AS (
              SELECT
                id,
                ROW_NUMBER() OVER (ORDER BY COALESCE(created_at, 0) ASC, id ASC) AS n
              FROM vendors
            )
            UPDATE vendors
            SET
              is_founder = 1,
              founder_seat_number = ranked.n
            FROM ranked
            WHERE vendors.id = ranked.id AND ranked.n <= 50
          `),
          { type: "close" },
        ]);

        await tursoPipeline(env, [
          buildExecute(`
            DELETE FROM founder_counter WHERE id = 'founder'
          `),
          buildExecute(`
            INSERT INTO founder_counter (id, claimed)
            SELECT 'founder', COUNT(*) FROM vendors WHERE is_founder = 1
          `),
          { type: "close" },
        ]);
      }
    } catch (err) {
      console.warn("Grandfathering existing vendors failed:", err.message);
    }

    // Repair founder_counter drift and backfill any unclaimed vendors. A seat
    // is claimed once and stays claimed (churn does not refill), so we count
    // by founder_seat_number rather than the current is_founder flag.
    try {
      const counter = firstRow((await tursoPipeline(env, [
        buildExecute(`SELECT claimed FROM founder_counter WHERE id = 'founder'`),
        { type: "close" },
      ])).results);
      const claimedCount = firstRow((await tursoPipeline(env, [
        buildExecute(`SELECT COUNT(*) AS c FROM vendors WHERE founder_seat_number IS NOT NULL`),
        { type: "close" },
      ])).results);
      const unclaimedCount = firstRow((await tursoPipeline(env, [
        buildExecute(`SELECT COUNT(*) AS c FROM vendors WHERE founder_seat_number IS NULL`),
        { type: "close" },
      ])).results);

      const counterClaimed = counter ? Number(counter.claimed) : 0;
      const limit = await getFounderSeatLimit(env);
      const currentClaimed = claimedCount ? Number(claimedCount.c) : 0;
      const currentUnclaimed = unclaimedCount ? Number(unclaimedCount.c) : 0;

      const needsRecompute = counterClaimed !== currentClaimed;
      const canBackfill = currentUnclaimed > 0 && currentClaimed < limit;

      if (needsRecompute || canBackfill) {
        if (canBackfill) {
          const seatsToBackfill = Math.min(limit - currentClaimed, currentUnclaimed);
          await tursoPipeline(env, [
            buildExecute(
              `
                WITH ranked AS (
                  SELECT
                    id,
                    ROW_NUMBER() OVER (ORDER BY COALESCE(created_at, 0) ASC, id ASC) AS n
                  FROM vendors
                  WHERE founder_seat_number IS NULL
                ),
                max_seat AS (
                  SELECT COALESCE(MAX(founder_seat_number), 0) AS m FROM vendors
                )
                UPDATE vendors
                SET
                  is_founder = 1,
                  founder_seat_number = max_seat.m + ranked.n
                FROM ranked, max_seat
                WHERE vendors.id = ranked.id AND ranked.n <= ?
              `,
              [seatsToBackfill]
            ),
            { type: "close" },
          ]);
        }

        await tursoPipeline(env, [
          buildExecute(`DELETE FROM founder_counter WHERE id = 'founder'`),
          buildExecute(`INSERT INTO founder_counter (id, claimed) SELECT 'founder', COUNT(*) FROM vendors WHERE founder_seat_number IS NOT NULL`),
          { type: "close" },
        ]);
      }
    } catch (err) {
      console.warn("Repairing founder_counter failed:", err.message);
    }

    try {
      await tursoPipeline(env, [
        buildExecute(`ALTER TABLE public_show_inventory ADD COLUMN updated_at INTEGER DEFAULT 0`),
        { type: "close" },
      ]);
    } catch (err) {
      if (!String(err.message).toLowerCase().includes("duplicate column")) {
        console.warn("Adding updated_at to public_show_inventory failed:", err.message);
      }
    }

    try {
      await tursoPipeline(env, [
        buildExecute(`ALTER TABLE public_show_inventory ADD COLUMN dedupe_key TEXT`),
        { type: "close" },
      ]);
    } catch (err) {
      if (!String(err.message).toLowerCase().includes("duplicate column")) {
        console.warn("Adding dedupe_key to public_show_inventory failed:", err.message);
      }
    }

    // Backfill identity keys: rows with a real TCGplayer id key off it; rows
    // without one key off name|set|number so unrelated "product_id = 0" cards
    // stop collapsing into a single listing. Empty/NULL keys fall back to
    // rowid so they cannot slip past the unique index.
    try {
      await tursoPipeline(env, [
        buildExecute(`
          UPDATE public_show_inventory
          SET dedupe_key = CASE
            WHEN product_id > 0 THEN 'p:' || product_id
            WHEN COALESCE(name, '') = '' AND COALESCE(set_name, '') = '' AND COALESCE(number, '') = '' THEN 'row:' || rowid
            ELSE 'n:' || LOWER(COALESCE(name, '')) || '|' || LOWER(COALESCE(set_name, '')) || '|' || LOWER(COALESCE(number, ''))
          END
          WHERE dedupe_key IS NULL OR dedupe_key = ''
        `),
        { type: "close" },
      ]);
    } catch (err) {
      console.warn("Backfilling dedupe_key failed:", err.message);
    }

    try {
      await tursoPipeline(env, [
        buildExecute(`
          DELETE FROM public_show_inventory
          WHERE rowid NOT IN (
            SELECT MAX(rowid) FROM public_show_inventory
            GROUP BY show_id, vendor_id, condition, COALESCE(NULLIF(dedupe_key, ''), 'row:' || rowid)
          )
        `),
        { type: "close" },
      ]);
    } catch (err) {
      console.warn("Deduplicating public_show_inventory failed:", err.message);
    }

    await migrateVendorSubscriptionsIfNeeded(env);

    await ensureUniqueIndex(env);

    return true;
  })();

  try {
    return await schemaPromise;
  } catch (err) {
    console.error("Schema ensure failed:", err.message);
    schemaPromise = null;
    throw err;
  }
}

async function getAppConfig(env, key) {
  const data = await tursoPipeline(env, [
    buildExecute("SELECT value FROM app_config WHERE key = ?", [key]),
    { type: "close" },
  ]);
  const row = firstRow(data.results);
  return row ? row.value : null;
}

async function isPaymentsLive(env) {
  return (await getAppConfig(env, "payments_live")) === "1";
}

async function getFounderSeatLimit(env) {
  const value = await getAppConfig(env, "founder_seat_limit");
  return value ? Number(value) : 50;
}

async function getFounderSeatsRemaining(env) {
  // A founder seat is claimed once and stays claimed even if the vendor churns
  // (churn does not refill seats). Count by founder_seat_number, not the
  // current is_founder flag.
  const [countData, limit] = await Promise.all([
    tursoPipeline(env, [
      buildExecute("SELECT COUNT(*) AS c FROM vendors WHERE founder_seat_number IS NOT NULL"),
      { type: "close" },
    ]),
    getFounderSeatLimit(env),
  ]);
  const row = firstRow(countData.results);
  const claimed = row ? Number(row.c) : 0;
  return Math.max(0, limit - claimed);
}

async function getFounderCount(env) {
  const data = await tursoPipeline(env, [
    buildExecute("SELECT COUNT(*) AS c FROM vendors WHERE founder_seat_number IS NOT NULL"),
    { type: "close" },
  ]);
  const row = firstRow(data.results);
  return row ? Number(row.c) : 0;
}

async function tryClaimFounderSeat(env, vendor) {
  // A founder seat is assigned once per vendor and is never reassigned. If the
  // vendor row already has a founder_seat_number, do not claim again (and do
  // not increment the seat number when is_founder is toggled off/on by churn).
  if (vendor?.founder_seat_number != null) return vendor;

  const limit = await getFounderSeatLimit(env);

  // Atomically claim the next available seat if any remain. The seat number
  // uses MAX+1 so deleted rows leave gaps and churn does not refill seats.
  const result = await tursoPipeline(env, [
    buildExecute(
      `
        UPDATE vendors
        SET is_founder = 1,
            founder_seat_number = (SELECT COALESCE(MAX(founder_seat_number), 0) + 1 FROM vendors)
        WHERE id = ?
          AND founder_seat_number IS NULL
          AND (SELECT COUNT(*) FROM vendors WHERE founder_seat_number IS NOT NULL) < ?
      `,
      [vendor.id, limit]
    ),
    buildExecute("SELECT changes() AS changes"),
    { type: "close" },
  ]);
  const changed = firstRow(result.results[1]);

  if (changed && Number(changed.changes) > 0) {
    await tursoPipeline(env, [
      buildExecute("DELETE FROM founder_counter WHERE id = 'founder'"),
      buildExecute("INSERT INTO founder_counter (id, claimed) SELECT 'founder', COUNT(*) FROM vendors WHERE founder_seat_number IS NOT NULL"),
      { type: "close" },
    ]);
  }

  const data = await tursoPipeline(env, [
    buildExecute("SELECT * FROM vendors WHERE id = ?", [vendor.id]),
    { type: "close" },
  ]);
  return firstRow(data.results);
}

async function getVendorByUserId(env, userId) {
  const data = await tursoPipeline(env, [
    buildExecute("SELECT * FROM vendors WHERE user_id = ?", [userId]),
    { type: "close" },
  ]);
  return firstRow(data.results);
}

async function isVendorActive(env, userId) {
  const now = Math.floor(Date.now() / 1000);
  const data = await tursoPipeline(env, [
    buildExecute(
      "SELECT 1 FROM vendor_subscriptions WHERE user_id = ? AND entitlement_id = ? AND is_active = 1 AND (expires_at IS NULL OR expires_at > ?) LIMIT 1",
      [userId, "Cardcache_pro", now]
    ),
    { type: "close" },
  ]);
  return !!firstRow(data.results);
}

async function isActiveTeamMember(env, userId) {
  const now = Math.floor(Date.now() / 1000);
  const data = await tursoPipeline(env, [
    buildExecute(
      `
        SELECT t.owner_user_id
        FROM team_members tm
        JOIN teams t ON tm.team_id = t.owner_user_id
        WHERE tm.member_user_id = ?
          AND (t.expires_at IS NULL OR t.expires_at > ?)
        LIMIT 1
      `,
      [userId, now]
    ),
    { type: "close" },
  ]);
  return !!firstRow(data.results);
}

async function assertIsPaidVendor(env, userId) {
  if (!(await isPaymentsLive(env))) return true;
  if (await isVendorActive(env, userId)) return true;
  if (await isActiveTeamMember(env, userId)) return true;
  // Grandfathered/founder vendors keep access even if they never purchased.
  const vendor = await getVendorByUserId(env, userId);
  if (Number(vendor?.is_founder)) return true;
  throw new Error("subscription_required");
}

async function upsertVendorSubscription(env, userId, entitlementId, productId, isActive, expiresAt, updatedAt) {
  const product = productId || "";
  await tursoPipeline(env, [
    buildExecute(
      `
        INSERT INTO vendor_subscriptions (user_id, entitlement_id, product_id, is_active, expires_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, product_id) DO UPDATE SET
          entitlement_id = excluded.entitlement_id,
          is_active = excluded.is_active,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
      `,
      [userId, entitlementId, product, isActive ? 1 : 0, expiresAt, updatedAt]
    ),
    { type: "close" },
  ]);
}

async function fetchRevenueCatSubscriber(env, userId) {
  if (!env.REVENUECAT_SECRET_API_KEY) {
    throw new Error("RevenueCat secret API key not configured");
  }
  const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${userId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${env.REVENUECAT_SECRET_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RevenueCat subscriber fetch failed: ${res.status} ${text}`);
  }
  return res.json();
}

function parseExpiresAt(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") {
    return Math.floor(raw > 9999999999 ? raw / 1000 : raw);
  }
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
  }
  return null;
}

async function syncVendorSubscriptionFromRevenueCat(env, userId) {
  const body = await fetchRevenueCatSubscriber(env, userId);
  // v1 /subscribers responses nest data under a "subscriber" key; fall back to
  // the top-level object so either shape works.
  const subscriber = body?.subscriber ?? body ?? {};
  const entitlements = subscriber.entitlements || subscriber.entitlement_infos || {};
  const entitlement = entitlements["Cardcache_pro"];

  if (!entitlement) {
    // No entitlement found: clear the cached subscription.
    await tursoPipeline(env, [
      buildExecute("DELETE FROM vendor_subscriptions WHERE user_id = ?", [userId]),
      buildExecute("UPDATE vendors SET is_founder = 0 WHERE user_id = ? AND is_founder = 1", [userId]),
      { type: "close" },
    ]);
    return { isActive: false, productId: null, expiresAt: null, activeProductIds: [] };
  }

  const now = Math.floor(Date.now() / 1000);
  const updatedAt = now;
  const activeProductIds = new Set();
  const productExpires = new Map();

  // The entitlement points at one representative product, but a user may have
  // multiple active subscription products (e.g. Pro Team base + extra seats).
  const primaryProductId = entitlement.product_identifier || null;
  if (primaryProductId) {
    activeProductIds.add(primaryProductId);
    productExpires.set(primaryProductId, parseExpiresAt(entitlement.expires_date));
  }

  const subscriptions = subscriber.subscriptions || {};
  for (const [productId, info] of Object.entries(subscriptions)) {
    if (!info) continue;
    const expiresAt = parseExpiresAt(info.expires_date);
    if (expiresAt == null || expiresAt > now) {
      activeProductIds.add(productId);
      if (!productExpires.has(productId)) {
        productExpires.set(productId, expiresAt);
      }
    }
  }

  const statements = [];
  for (const productId of activeProductIds) {
    const expiresAt = productExpires.get(productId) ?? null;
    statements.push(buildExecute(
      `
        INSERT INTO vendor_subscriptions (user_id, entitlement_id, product_id, is_active, expires_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?)
        ON CONFLICT(user_id, product_id) DO UPDATE SET
          entitlement_id = excluded.entitlement_id,
          is_active = 1,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
      `,
      [userId, "Cardcache_pro", productId, expiresAt, updatedAt]
    ));
  }

  // Remove stale products that are no longer active.
  if (activeProductIds.size > 0) {
    const placeholders = Array.from(activeProductIds).map(() => "?").join(", ");
    statements.push(buildExecute(
      `DELETE FROM vendor_subscriptions WHERE user_id = ? AND product_id NOT IN (${placeholders})`,
      [userId, ...Array.from(activeProductIds)]
    ));
  } else {
    statements.push(buildExecute("DELETE FROM vendor_subscriptions WHERE user_id = ?", [userId]));
  }

  const primaryExpiresAt = productExpires.get(primaryProductId) ?? null;
  const isActive = activeProductIds.size > 0;

  // A churned founder loses the founder discount eligibility. A founder with an
  // active subscription (any paid product) keeps the founder flag.
  if (!isActive) {
    statements.push(buildExecute("UPDATE vendors SET is_founder = 0 WHERE user_id = ? AND is_founder = 1", [userId]));
  } else {
    statements.push(buildExecute("UPDATE vendors SET is_founder = 1 WHERE user_id = ? AND founder_seat_number IS NOT NULL AND is_founder = 0", [userId]));
  }

  statements.push({ type: "close" });
  await tursoPipeline(env, statements);

  return { isActive, productId: primaryProductId, expiresAt: primaryExpiresAt, activeProductIds: Array.from(activeProductIds) };
}

const TEAM_3_SEAT_PRODUCTS = new Set([
  "cc_founder_team3_monthly",
  "cc_pro_team_base_monthly",
]);
const TEAM_1_SEAT_PRODUCTS = new Set([
  "cc_pro_team_extra_seat_monthly",
]);
const TEAM_PRODUCTS = new Set([...TEAM_3_SEAT_PRODUCTS, ...TEAM_1_SEAT_PRODUCTS]);

function isTeamProduct(productId) {
  return !!productId && TEAM_PRODUCTS.has(String(productId));
}

function seatsForProduct(productId) {
  const id = String(productId || "");
  if (TEAM_3_SEAT_PRODUCTS.has(id)) return 3;
  if (TEAM_1_SEAT_PRODUCTS.has(id)) return 1;
  return 0;
}

function generateInviteCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function recalculateTeamSeats(env, userId) {
  const now = Math.floor(Date.now() / 1000);

  const data = await tursoPipeline(env, [
    buildExecute(
      `SELECT product_id, is_active, expires_at FROM vendor_subscriptions WHERE user_id = ? AND is_active = 1`,
      [userId]
    ),
    { type: "close" },
  ]);
  const rows = allRows(data.results);

  let seatsTotal = 0;
  let farthestExpiresAt = null;
  let teamProductId = null;

  for (const row of rows) {
    const productId = row.product_id;
    const expiresAt = row.expires_at ? Number(row.expires_at) : null;

    if (expiresAt != null && expiresAt <= now) continue;

    const seats = seatsForProduct(productId);
    if (seats <= 0) continue;

    seatsTotal += seats;
    if (!teamProductId || seatsForProduct(teamProductId) < seats) {
      teamProductId = productId;
    }

    if (farthestExpiresAt === null || (expiresAt != null && expiresAt > farthestExpiresAt)) {
      farthestExpiresAt = expiresAt;
    }
  }

  if (seatsTotal === 0) {
    await tursoPipeline(env, [
      buildExecute("DELETE FROM team_members WHERE team_id = ?", [userId]),
      buildExecute("DELETE FROM teams WHERE owner_user_id = ?", [userId]),
      { type: "close" },
    ]);
    return null;
  }

  const updatedAt = now;
  const createdAt = now;

  await tursoPipeline(env, [
    buildExecute(
      `
        INSERT INTO teams (owner_user_id, product_id, seats_total, expires_at, invite_code, updated_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_user_id) DO UPDATE SET
          product_id = excluded.product_id,
          seats_total = excluded.seats_total,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at,
          invite_code = COALESCE(teams.invite_code, excluded.invite_code),
          created_at = COALESCE(teams.created_at, excluded.created_at)
      `,
      [userId, teamProductId, seatsTotal, farthestExpiresAt, generateInviteCode(), updatedAt, createdAt]
    ),
    { type: "close" },
  ]);

  return await getTeamByOwner(env, userId);
}

async function getTeamByOwner(env, userId) {
  const data = await tursoPipeline(env, [
    buildExecute("SELECT * FROM teams WHERE owner_user_id = ?", [userId]),
    { type: "close" },
  ]);
  return firstRow(data.results);
}

async function getTeamByCode(env, code) {
  const data = await tursoPipeline(env, [
    buildExecute("SELECT * FROM teams WHERE invite_code = ?", [code]),
    { type: "close" },
  ]);
  return firstRow(data.results);
}

async function getTeamMembers(env, teamId) {
  const data = await tursoPipeline(env, [
    buildExecute(
      `
        SELECT
          tm.member_user_id,
          v.name AS member_name,
          tm.created_at
        FROM team_members tm
        LEFT JOIN vendors v ON v.user_id = tm.member_user_id
        WHERE tm.team_id = ?
        ORDER BY tm.created_at
      `,
      [teamId]
    ),
    { type: "close" },
  ]);
  return allRows(data.results);
}

async function countTeamMembers(env, teamId) {
  const data = await tursoPipeline(env, [
    buildExecute("SELECT COUNT(*) AS c FROM team_members WHERE team_id = ?", [teamId]),
    { type: "close" },
  ]);
  const row = firstRow(data.results);
  return row ? Number(row.c) : 0;
}

async function getTeamForMember(env, userId) {
  const data = await tursoPipeline(env, [
    buildExecute(
      `
        SELECT t.*
        FROM team_members tm
        JOIN teams t ON tm.team_id = t.owner_user_id
        WHERE tm.member_user_id = ?
        LIMIT 1
      `,
      [userId]
    ),
    { type: "close" },
  ]);
  return firstRow(data.results);
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function generateUniqueVendorId(username, attempt = 0) {
  const base = slugify(username);
  if (!base) return `vendor-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  if (attempt === 0) return base;
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
  return `${base}-${suffix}`;
}

async function getOrCreateVendor(env, { userId, username, email }) {
  const data = await tursoPipeline(env, [
    buildExecute("SELECT * FROM vendors WHERE user_id = ?", [userId]),
    { type: "close" },
  ]);
  const existing = firstRow(data.results);
  // Existing vendors who were never grandfathered (rows created between the
  // schema migration and now) still get a seat if any remain — same outcome as
  // a fresh sign-up claiming on first profile load.
  if (existing) return await tryClaimFounderSeat(env, existing);

  const now = Math.floor(Date.now() / 1000);
  const name = username || email.split("@")[0] || "vendor";

  for (let attempt = 0; attempt < 5; attempt++) {
    const vendorId = generateUniqueVendorId(username || email, attempt);
    try {
      await tursoPipeline(env, [
        buildExecute(
          "INSERT INTO vendors (id, user_id, name, table_default, created_at) VALUES (?, ?, ?, '', ?)",
          [vendorId, userId, name, now]
        ),
        { type: "close" },
      ]);

      const fresh = await getVendorByUserId(env, userId);
      if (!fresh) {
        throw new Error("Failed to read newly created vendor row");
      }
      return await tryClaimFounderSeat(env, fresh);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("UNIQUE") || message.toLowerCase().includes("duplicate")) {
        continue;
      }
      throw err;
    }
  }

  throw new Error("Failed to generate a unique vendor id after 5 attempts");
}

async function queryShowAccess(env, vendorId, showId) {
  const data = await tursoPipeline(env, [
    buildExecute(
      `
        SELECT
          s.id AS show_id,
          s.is_active AS is_active,
          s.vendor_id AS owner_vendor_id,
          COALESCE(vsr.status, '') AS registration_status
        FROM shows s
        LEFT JOIN vendor_show_registrations vsr
          ON s.id = vsr.show_id AND vsr.vendor_id = ?
        WHERE s.id = ?
      `,
      [vendorId, showId]
    ),
    { type: "close" },
  ]);
  return firstRow(data.results);
}

async function assertShowAccess(env, showId, vendor) {
  const row = await queryShowAccess(env, vendor.id, showId);
  if (!row) throw new Error("Show not found");
  if (row.registration_status === "rejected") {
    throw new Error("Vendor is not authorized for this show");
  }
  if (Number(row.is_active) !== 1) {
    throw new Error("Show is not active");
  }
  const isOwner = String(row.owner_vendor_id) === String(vendor.id);
  const isApproved = String(row.registration_status) === "approved";
  if (!isOwner && !isApproved) {
    throw new Error("Vendor is not authorized for this show");
  }
}

function sanitizeShowRow(row) {
  return {
    id: String(row.id ?? ""),
    show_id: String(row.show_id ?? ""),
    vendor_id: String(row.vendor_id ?? ""),
    product_id: Number(row.product_id) || 0,
    name: String(row.name ?? ""),
    set_name: String(row.set_name ?? ""),
    number: String(row.number ?? ""),
    rarity: String(row.rarity ?? ""),
    condition: String(row.condition ?? ""),
    sticker_price: Number(row.sticker_price) || 0,
    quantity: Number(row.quantity) || 0,
    vendor_name: String(row.vendor_name ?? ""),
    vendor_table: String(row.vendor_table ?? ""),
  };
}

function sanitizeInventoryRow(input) {
  const rawProductId = Number(input.product_id);
  const productId = Number.isNaN(rawProductId) ? 0 : Math.max(0, Math.floor(rawProductId));

  const rawQty = Number(input.quantity);
  const quantity = Number.isNaN(rawQty) ? 1 : Math.max(0, Math.floor(rawQty));

  const rawPrice = Number(input.sticker_price) || Number(input.stickerPrice);
  const stickerPrice = Number.isNaN(rawPrice) ? 0 : Math.max(0, rawPrice);

  // Identity key for dedupe/upsert. Rows that carry a real TCGplayer id key
  // off it; rows without one (matched by name/set/number) key off those fields
  // so unrelated "product_id = 0" cards never collapse into a single listing.
  const dedupeKey = buildDedupeKey(
    productId,
    input.name,
    input.set_name || input.set,
    input.number
  );

  return {
    productId,
    dedupeKey,
    name: String(input.name || ""),
    setName: String(input.set_name || input.set || ""),
    number: String(input.number || ""),
    rarity: String(input.rarity || input.productType || ""),
    condition: String(input.condition || "NM"),
    stickerPrice,
    quantity,
  };
}

async function batchInsertOrUpdateRows(env, showId, vendor, vendorName, vendorTable, rows) {
  if (rows.length === 0) return { results: [] };

  const sanitized = [];
  const keyToIndex = new Map();

  for (let i = 0; i < rows.length; i++) {
    const row = sanitizeInventoryRow(rows[i]);
    const key = `${row.condition}|${row.dedupeKey}`;
    if (!keyToIndex.has(key)) {
      keyToIndex.set(key, sanitized.length);
      sanitized.push({ ...row, originalIndexes: [i] });
    } else {
      sanitized[keyToIndex.get(key)].originalIndexes.push(i);
    }
  }

  const statements = [];
  const results = new Array(rows.length);

  for (const item of sanitized) {
    const newId = crypto.randomUUID().replace(/-/g, "");
    const updatedAt = Date.now();

    statements.push(buildExecute(
      `INSERT INTO public_show_inventory
        (id, show_id, vendor_id, product_id, name, set_name, number, rarity, condition, sticker_price, quantity, vendor_name, vendor_table, dedupe_key, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(show_id, vendor_id, condition, dedupe_key) DO UPDATE SET
        product_id = excluded.product_id,
        name = excluded.name,
        set_name = excluded.set_name,
        number = excluded.number,
        rarity = excluded.rarity,
        condition = excluded.condition,
        sticker_price = excluded.sticker_price,
        quantity = excluded.quantity,
        vendor_name = excluded.vendor_name,
        vendor_table = excluded.vendor_table,
        updated_at = excluded.updated_at
      WHERE excluded.updated_at > public_show_inventory.updated_at`,
      [newId, showId, vendor.id, item.productId, item.name, item.setName, item.number, item.rarity, item.condition, item.stickerPrice, item.quantity, vendorName, vendorTable, item.dedupeKey, updatedAt]
    ));
    for (const idx of item.originalIndexes) {
      results[idx] = { id: newId, status: "upserted" };
    }
  }

  statements.push({ type: "close" });
  await tursoPipeline(env, statements);

  return { results };
}

async function getVendorStatus(env, userId, vendor) {
  const paymentsLive = await isPaymentsLive(env);
  const isFounder = Number(vendor?.is_founder) || 0;
  const isDirectActive = paymentsLive ? await isVendorActive(env, userId) : false;
  const isTeamMember = await isActiveTeamMember(env, userId);
  const active = paymentsLive ? (isDirectActive || isFounder || isTeamMember) : false;
  const memberTeam = isTeamMember ? await getTeamForMember(env, userId) : null;
  return {
    payments_live: paymentsLive ? 1 : 0,
    is_vendor: paymentsLive ? (active ? 1 : 0) : 0,
    is_founder: isFounder,
    founder_seat_number: vendor?.founder_seat_number ?? null,
    founder_seats_remaining: await getFounderSeatsRemaining(env),
    is_team_member: isTeamMember ? 1 : 0,
    team_id: memberTeam ? memberTeam.owner_user_id : null,
  };
}

async function formatTeam(env, team, userId) {
  if (!team) return null;
  const isOwner = String(team.owner_user_id) === String(userId);
  const base = {
    team_id: team.owner_user_id,
    owner_user_id: team.owner_user_id,
    product_id: team.product_id || null,
    seats_total: Number(team.seats_total) || 0,
    expires_at: team.expires_at != null ? Number(team.expires_at) : null,
    updated_at: team.updated_at != null ? Number(team.updated_at) : null,
    created_at: team.created_at != null ? Number(team.created_at) : null,
  };
  if (isOwner) {
    const members = await getTeamMembers(env, team.owner_user_id);
    return {
      ...base,
      invite_code: team.invite_code || null,
      is_member: true,
      is_owner: true,
      members: members.map((m) => ({
        member_user_id: m.member_user_id,
        member_name: m.member_name || null,
        created_at: m.created_at != null ? Number(m.created_at) : null,
      })),
      seats_used: members.length,
    };
  }
  return {
    ...base,
    is_member: true,
    is_owner: false,
  };
}

async function handleGetMe(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  const vendor = await getOrCreateVendor(env, user);
  const status = await getVendorStatus(env, user.userId, vendor);
  // Owners always see their own team first, even if they also happen to be a
  // member of another team (e.g. manual data repair).
  const ownTeam = await getTeamByOwner(env, user.userId);
  const teamRow = ownTeam
    ? ownTeam
    : status.team_id
      ? await getTeamByOwner(env, status.team_id)
      : null;
  const team = teamRow ? await formatTeam(env, teamRow, user.userId) : null;
  return jsonResponse({
    ok: true,
    vendor: {
      id: vendor.id,
      user_id: vendor.user_id,
      name: vendor.name,
      table_default: vendor.table_default || "",
      ...status,
      team,
    },
  });
}

async function handleGetVendorShows(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  const vendor = await getOrCreateVendor(env, user);

  try {
    await assertIsPaidVendor(env, user.userId);
  } catch (err) {
    if (err.message === "subscription_required") {
      return jsonResponse({ ok: true, shows: [] });
    }
    throw err;
  }

  const data = await tursoPipeline(env, [
    buildExecute(
      `
        SELECT
          s.id,
          s.vendor_id,
          s.name,
          s.start_date,
          s.location,
          s.is_active
        FROM shows s
        LEFT JOIN vendor_show_registrations vsr
          ON s.id = vsr.show_id AND vsr.vendor_id = ?
        WHERE s.is_active = 1
          AND (s.vendor_id = ? OR vsr.status = 'approved')
        ORDER BY s.start_date
      `,
      [vendor.id, vendor.id]
    ),
    { type: "close" },
  ]);

  const rows = allRows(data.results).map((row) => ({
    id: String(row.id ?? ""),
    vendor_id: String(row.vendor_id ?? ""),
    name: String(row.name ?? ""),
    start_date: String(row.start_date ?? ""),
    location: String(row.location ?? ""),
    is_active: Number(row.is_active) || 0,
  }));
  return jsonResponse({ ok: true, shows: rows });
}

async function handleGetInventory(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  const vendor = await getOrCreateVendor(env, user);

  await assertIsPaidVendor(env, user.userId);

  const url = new URL(request.url);
  const showId = url.searchParams.get("show_id");
  if (!showId) return errorResponse("Missing show_id", 400);

  const data = await tursoPipeline(env, [
    buildExecute(
      "SELECT * FROM public_show_inventory WHERE vendor_id = ? AND show_id = ? ORDER BY name COLLATE NOCASE",
      [vendor.id, showId]
    ),
    { type: "close" },
  ]);

  const rows = allRows(data.results).map(sanitizeShowRow);
  return jsonResponse({ ok: true, show_id: showId, rows });
}

async function handlePostInventory(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  const vendor = await getOrCreateVendor(env, user);

  await assertIsPaidVendor(env, user.userId);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse("Invalid JSON body", 400);
  }

  const showId = body.show_id;
  const vendorName = String(body.vendor_name || "");
  const vendorTable = String(body.vendor_table || "");
  const rows = Array.isArray(body.rows) ? body.rows : [];

  if (!showId) return errorResponse("Missing show_id", 400);
  if (!vendorName) return errorResponse("Missing vendor_name", 400);
  if (!rows.length) return errorResponse("No rows provided", 400);

  await assertShowAccess(env, showId, vendor);

  const { results } = await batchInsertOrUpdateRows(env, showId, vendor, vendorName, vendorTable, rows);
  const rowIds = results.map((r) => r.id);

  return jsonResponse({ ok: true, row_ids: rowIds, results });
}

async function handleUpdateInventory(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  const vendor = await getOrCreateVendor(env, user);

  await assertIsPaidVendor(env, user.userId);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse("Invalid JSON body", 400);
  }

  const rowId = String(body.id || "");
  if (!rowId) return errorResponse("Missing id", 400);

  const existingResult = await tursoPipeline(env, [
    buildExecute(
      "SELECT vendor_id, product_id, name, set_name, number, condition, dedupe_key FROM public_show_inventory WHERE id = ?",
      [rowId]
    ),
    { type: "close" },
  ]);
  const row = firstRow(existingResult.results);
  if (!row) return errorResponse("Row not found", 404);
  if (String(row.vendor_id) !== String(vendor.id)) return errorResponse("Not authorized to edit this row", 403);

  const productId = Number(row.product_id) || 0;
  const name = body.name !== undefined ? String(body.name) : String(row.name || "");
  const setName = body.set_name !== undefined ? String(body.set_name) : String(row.set_name || "");
  const number = body.number !== undefined ? String(body.number) : String(row.number || "");
  const dedupeKey = buildDedupeKey(productId, name, setName, number);

  const updates = [];
  const args = [];

  if (body.name !== undefined) { updates.push("name = ?"); args.push(name); }
  if (body.set_name !== undefined) { updates.push("set_name = ?"); args.push(setName); }
  if (body.number !== undefined) { updates.push("number = ?"); args.push(number); }
  if (body.rarity !== undefined) { updates.push("rarity = ?"); args.push(String(body.rarity)); }
  if (body.condition !== undefined) { updates.push("condition = ?"); args.push(String(body.condition)); }
  if (body.sticker_price !== undefined) { updates.push("sticker_price = ?"); args.push(Math.max(0, Number(body.sticker_price) || 0)); }
  if (body.quantity !== undefined) { updates.push("quantity = ?"); args.push(Math.max(0, Math.floor(Number(body.quantity) || 0))); }
  if (body.vendor_name !== undefined) { updates.push("vendor_name = ?"); args.push(String(body.vendor_name)); }
  if (body.vendor_table !== undefined) { updates.push("vendor_table = ?"); args.push(String(body.vendor_table)); }

  if (dedupeKey !== row.dedupe_key) {
    updates.push("dedupe_key = ?");
    args.push(dedupeKey);
  }

  updates.push("updated_at = ?");
  args.push(Date.now());

  if (updates.length === 0) return errorResponse("No fields to update", 400);

  args.push(rowId);

  await tursoPipeline(env, [
    buildExecute(`UPDATE public_show_inventory SET ${updates.join(", ")} WHERE id = ?`, args),
    { type: "close" },
  ]);

  return jsonResponse({ ok: true, id: rowId });
}

async function handleDeleteInventory(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  const vendor = await getOrCreateVendor(env, user);

  await assertIsPaidVendor(env, user.userId);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse("Invalid JSON body", 400);
  }

  const rowId = String(body.id || "");
  if (!rowId) return errorResponse("Missing id", 400);

  const ownership = await tursoPipeline(env, [
    buildExecute("SELECT vendor_id FROM public_show_inventory WHERE id = ?", [rowId]),
    { type: "close" },
  ]);
  const row = firstRow(ownership.results);
  if (!row) return errorResponse("Row not found", 404);
  if (String(row.vendor_id) !== String(vendor.id)) return errorResponse("Not authorized to delete this row", 403);

  await tursoPipeline(env, [
    buildExecute("DELETE FROM public_show_inventory WHERE id = ?", [rowId]),
    { type: "close" },
  ]);

  return jsonResponse({ ok: true, id: rowId });
}

async function handleSyncSubscription(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  await getOrCreateVendor(env, user);

  const { isActive, productId, expiresAt } = await syncVendorSubscriptionFromRevenueCat(env, user.userId);
  const team = await recalculateTeamSeats(env, user.userId);

  return jsonResponse({
    ok: true,
    is_vendor: isActive ? 1 : 0,
    product_id: productId,
    expires_at: expiresAt,
    team,
  });
}

async function handleRevenueCatWebhook(request, env) {
  if (!env.REVENUECAT_WEBHOOK_SECRET) {
    return errorResponse("Webhook secret not configured", 500);
  }

  const signature = request.headers.get("X-RevenueCat-Signature");
  const authHeader = request.headers.get("Authorization");
  const bodyText = await request.text();

  let isValid = false;

  if (signature) {
    // RevenueCat v2 signed webhooks.
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(env.REVENUECAT_WEBHOOK_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );
    isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      hexToBytes(signature),
      encoder.encode(bodyText)
    );
  } else if (authHeader) {
    // RevenueCat "Authorization header value" static secret.
    const expected = String(env.REVENUECAT_WEBHOOK_SECRET).trim();
    const provided = String(authHeader).replace(/^Bearer\s+/i, "").trim();
    isValid = provided === expected;
  }

  if (!isValid) {
    return errorResponse("Invalid signature", 401);
  }

  let body;
  try {
    body = JSON.parse(bodyText);
  } catch (e) {
    return errorResponse("Invalid JSON body", 400);
  }

  const event = body.event || {};
  const userId = event.app_user_id || event.original_app_user_id;
  if (!userId) {
    return errorResponse("Missing app_user_id", 400);
  }

  await ensureSchema(env);

  const eventType = event.type;
  const productId = event.product_id || null;

  const rawExpires = event.expiration_at_ms ?? event.expires_date_ms ?? event.expiration_at;
  const expiresAt = rawExpires
    ? Math.floor(Number(rawExpires) / (Number(rawExpires) > 9999999999 ? 1000 : 1))
    : null;

  // When the secret API key is available, reconcile the full subscription
  // state from RevenueCat. Otherwise fall back to the single-event product.
  if (env.REVENUECAT_SECRET_API_KEY) {
    await syncVendorSubscriptionFromRevenueCat(env, userId);
  } else {
    const isActiveEvent = eventType === "INITIAL_PURCHASE" || eventType === "RENEWAL";
    await upsertVendorSubscription(env, userId, "Cardcache_pro", productId, isActiveEvent, expiresAt, Math.floor(Date.now() / 1000));
    if (!isActiveEvent) {
      await tursoPipeline(env, [
        buildExecute("UPDATE vendors SET is_founder = 0 WHERE user_id = ? AND is_founder = 1", [userId]),
        { type: "close" },
      ]);
    }
  }

  await recalculateTeamSeats(env, userId);

  return jsonResponse({ ok: true });
}

async function handleGetTeam(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  await getOrCreateVendor(env, user);

  const ownTeam = await getTeamByOwner(env, user.userId);
  if (ownTeam) {
    return jsonResponse({ ok: true, team: await formatTeam(env, ownTeam, user.userId) });
  }

  const memberTeam = await getTeamForMember(env, user.userId);
  if (memberTeam) {
    return jsonResponse({ ok: true, team: await formatTeam(env, memberTeam, user.userId) });
  }

  return jsonResponse({ ok: true, team: null });
}

async function handleRegenerateTeamCode(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  await getOrCreateVendor(env, user);

  let team = await getTeamByOwner(env, user.userId);
  if (!team) {
    await syncVendorSubscriptionFromRevenueCat(env, user.userId);
    await recalculateTeamSeats(env, user.userId);
    team = await getTeamByOwner(env, user.userId);
  }

  if (!team) {
    return errorResponse("subscription_required", 403);
  }

  for (let attempts = 0; attempts < 20; attempts++) {
    const code = generateInviteCode();
    try {
      await tursoPipeline(env, [
        buildExecute(
          "UPDATE teams SET invite_code = ? WHERE owner_user_id = ?",
          [code, user.userId]
        ),
        { type: "close" },
      ]);
      const updated = await getTeamByOwner(env, user.userId);
      if (updated && updated.invite_code === code) {
        return jsonResponse({ ok: true, team: await formatTeam(env, updated, user.userId) });
      }
    } catch (err) {
      // Unique constraint collision or other error — try another code.
      console.warn("Regenerate invite code attempt failed:", err.message);
    }
  }

  return errorResponse("Could not generate a unique invite code", 500);
}

async function handleRedeemTeamCode(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  await getOrCreateVendor(env, user);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse("Invalid JSON body", 400);
  }

  const code = String(body.code || "").trim();
  if (!code) return errorResponse("Missing code", 400);

  const team = await getTeamByCode(env, code);
  if (!team) return errorResponse("Team not found", 404);

  if (String(team.owner_user_id) === String(user.userId)) {
    return jsonResponse({ ok: true, team: await formatTeam(env, team, user.userId) });
  }

  const existingMemberTeam = await getTeamForMember(env, user.userId);
  if (existingMemberTeam) {
    if (String(existingMemberTeam.owner_user_id) === String(team.owner_user_id)) {
      return jsonResponse({ ok: true, team: await formatTeam(env, team, user.userId) });
    }
    return jsonResponse({ ok: true, team: await formatTeam(env, existingMemberTeam, user.userId) });
  }

  const ownTeam = await getTeamByOwner(env, user.userId);
  if (ownTeam) {
    return jsonResponse({ ok: true, team: await formatTeam(env, ownTeam, user.userId) });
  }

  const now = Math.floor(Date.now() / 1000);
  if (team.expires_at != null && Number(team.expires_at) <= now) {
    return errorResponse("Team subscription expired", 403);
  }

  const members = await getTeamMembers(env, team.owner_user_id);
  if (members.length >= Number(team.seats_total)) {
    return errorResponse("no seats available", 403);
  }

  await tursoPipeline(env, [
    buildExecute(
      "INSERT OR IGNORE INTO team_members (team_id, member_user_id, created_at) VALUES (?, ?, ?)",
      [team.owner_user_id, user.userId, now]
    ),
    { type: "close" },
  ]);

  const updatedTeam = { ...team };
  updatedTeam.members = await getTeamMembers(env, team.owner_user_id);
  return jsonResponse({ ok: true, team: await formatTeam(env, updatedTeam, user.userId) });
}

async function handleRemoveTeamMember(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  await getOrCreateVendor(env, user);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse("Invalid JSON body", 400);
  }

  const memberUserId = String(body.member_user_id || "");
  if (!memberUserId) return errorResponse("Missing member_user_id", 400);
  if (memberUserId === user.userId) return errorResponse("Cannot remove owner", 400);

  const team = await getTeamByOwner(env, user.userId);
  if (!team) return errorResponse("No team", 403);

  await tursoPipeline(env, [
    buildExecute(
      "DELETE FROM team_members WHERE team_id = ? AND member_user_id = ?",
      [team.owner_user_id, memberUserId]
    ),
    { type: "close" },
  ]);

  return jsonResponse({ ok: true });
}

async function handleLeaveTeam(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  await getOrCreateVendor(env, user);

  const team = await getTeamForMember(env, user.userId);
  if (!team) return jsonResponse({ ok: true });

  await tursoPipeline(env, [
    buildExecute(
      "DELETE FROM team_members WHERE team_id = ? AND member_user_id = ?",
      [team.owner_user_id, user.userId]
    ),
    { type: "close" },
  ]);

  return jsonResponse({ ok: true });
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/vendor/me" && request.method === "GET") {
        return await handleGetMe(request, env);
      }
      if (path === "/vendor/shows" && request.method === "GET") {
        return await handleGetVendorShows(request, env);
      }
      if (path === "/vendor/inventory" && request.method === "GET") {
        return await handleGetInventory(request, env);
      }
      if (path === "/vendor/inventory" && request.method === "POST") {
        return await handlePostInventory(request, env);
      }
      if (path === "/vendor/inventory/update" && request.method === "POST") {
        return await handleUpdateInventory(request, env);
      }
      if (path === "/vendor/inventory/delete" && request.method === "POST") {
        return await handleDeleteInventory(request, env);
      }
      if (path === "/vendor/sync-subscription" && request.method === "POST") {
        return await handleSyncSubscription(request, env);
      }
      if (path === "/vendor/team" && request.method === "GET") {
        return await handleGetTeam(request, env);
      }
      if (path === "/vendor/team/regenerate-code" && request.method === "POST") {
        return await handleRegenerateTeamCode(request, env);
      }
      if (path === "/vendor/team/redeem" && request.method === "POST") {
        return await handleRedeemTeamCode(request, env);
      }
      if (path === "/vendor/team/remove" && request.method === "POST") {
        return await handleRemoveTeamMember(request, env);
      }
      if (path === "/vendor/team/leave" && request.method === "POST") {
        return await handleLeaveTeam(request, env);
      }
      if (path === "/revenuecat-webhook" && request.method === "POST") {
        return await handleRevenueCatWebhook(request, env);
      }
      if (path === "/health") {
        return jsonResponse({ ok: true });
      }
      return errorResponse("Not found", 404);
    } catch (err) {
      console.error("worker_show_vendor error:", err.message);
      const msg = err.message;
      let status = 500;
      if (msg.includes("Missing Authorization") || msg.includes("JWT") || msg.includes("Invalid JWT") || msg.includes("JWT not yet valid") || msg.includes("JWT expired") || msg.includes("token")) {
        status = 401;
      } else if (msg.includes("not authorized") || msg.includes("Not authorized") || msg.includes("not active") || msg.includes("not registered")) {
        status = 403;
      } else if (msg.includes("not found")) {
        status = 404;
      }
      return errorResponse(msg, status);
    }
  },
};
