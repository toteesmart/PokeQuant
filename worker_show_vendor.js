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
          user_id TEXT PRIMARY KEY,
          entitlement_id TEXT NOT NULL,
          product_id TEXT,
          is_active INTEGER NOT NULL DEFAULT 0,
          expires_at INTEGER,
          updated_at INTEGER NOT NULL DEFAULT 0
        )
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
  const data = await tursoPipeline(env, [
    buildExecute("SELECT claimed FROM founder_counter WHERE id = 'founder'"),
    { type: "close" },
  ]);
  const counter = firstRow(data.results);
  const claimed = counter ? Number(counter.claimed) : 0;
  const limit = await getFounderSeatLimit(env);
  return Math.max(0, limit - claimed);
}

async function tryClaimFounderSeat(env, vendor) {
  const already = Number(vendor?.is_founder);
  if (already) return vendor;

  const limit = await getFounderSeatLimit(env);
  const result = firstRow((await tursoPipeline(env, [
    buildExecute(
      `UPDATE founder_counter SET claimed = claimed + 1 WHERE id = 'founder' AND claimed < ? RETURNING claimed`,
      [limit]
    ),
    { type: "close" },
  ])).results);

  if (result) {
    await tursoPipeline(env, [
      buildExecute(
        "UPDATE vendors SET is_founder = 1, founder_seat_number = ? WHERE id = ?",
        [Number(result.claimed), vendor.id]
      ),
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
      "SELECT is_active, expires_at FROM vendor_subscriptions WHERE user_id = ? AND entitlement_id = ?",
      [userId, "Cardcache_pro"]
    ),
    { type: "close" },
  ]);
  const row = firstRow(data.results);
  if (!row) return false;
  if (Number(row.is_active) !== 1) return false;
  if (row.expires_at && Number(row.expires_at) < now) return false;
  return true;
}

async function assertIsPaidVendor(env, userId) {
  if (!(await isPaymentsLive(env))) return true;
  if (await isVendorActive(env, userId)) return true;
  throw new Error("subscription_required");
}

async function upsertVendorSubscription(env, userId, entitlementId, productId, isActive, expiresAt, updatedAt) {
  await tursoPipeline(env, [
    buildExecute(
      `
        INSERT INTO vendor_subscriptions (user_id, entitlement_id, product_id, is_active, expires_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          entitlement_id = excluded.entitlement_id,
          product_id = excluded.product_id,
          is_active = excluded.is_active,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
      `,
      [userId, entitlementId, productId, isActive ? 1 : 0, expiresAt, updatedAt]
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

async function syncVendorSubscriptionFromRevenueCat(env, userId) {
  const subscriber = await fetchRevenueCatSubscriber(env, userId);
  const entitlements = subscriber?.entitlements || subscriber?.entitlement_infos || {};
  const entitlement = entitlements["Cardcache_pro"];

  if (entitlement) {
    const productId = entitlement.product_identifier || null;
    const isActive = entitlement.is_active === true;
    const expiresAt = typeof entitlement.expires_date === "number"
      ? Math.floor(entitlement.expires_date / 1000)
      : null;
    const updatedAt = Math.floor(Date.now() / 1000);
    await upsertVendorSubscription(env, userId, "Cardcache_pro", productId, isActive, expiresAt, updatedAt);

    // A churned founder loses the founder discount eligibility.
    if (!isActive) {
      await tursoPipeline(env, [
        buildExecute("UPDATE vendors SET is_founder = 0 WHERE user_id = ? AND is_founder = 1", [userId]),
        { type: "close" },
      ]);
    }

    return { isActive, productId, expiresAt };
  }

  // No entitlement found: clear the cached subscription.
  await tursoPipeline(env, [
    buildExecute("DELETE FROM vendor_subscriptions WHERE user_id = ?", [userId]),
    buildExecute("UPDATE vendors SET is_founder = 0 WHERE user_id = ? AND is_founder = 1", [userId]),
    { type: "close" },
  ]);

  return { isActive: false, productId: null, expiresAt: null };
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
  if (existing) return existing;

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
  const active = paymentsLive ? await isVendorActive(env, userId) : false;
  return {
    payments_live: paymentsLive ? 1 : 0,
    is_vendor: paymentsLive ? (active ? 1 : 0) : 0,
    is_founder: Number(vendor?.is_founder) || 0,
    founder_seat_number: vendor?.founder_seat_number ?? null,
    founder_seats_remaining: await getFounderSeatsRemaining(env),
  };
}

async function handleGetMe(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  const vendor = await getOrCreateVendor(env, user);
  const status = await getVendorStatus(env, user.userId, vendor);
  return jsonResponse({
    ok: true,
    vendor: {
      id: vendor.id,
      user_id: vendor.user_id,
      name: vendor.name,
      table_default: vendor.table_default || "",
      ...status,
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

  return jsonResponse({
    ok: true,
    is_vendor: isActive ? 1 : 0,
    product_id: productId,
    expires_at: expiresAt,
  });
}

async function handleRevenueCatWebhook(request, env) {
  if (!env.REVENUECAT_WEBHOOK_SECRET) {
    return errorResponse("Webhook secret not configured", 500);
  }

  const signature = request.headers.get("X-RevenueCat-Signature");
  if (!signature) {
    return errorResponse("Missing signature", 401);
  }

  const bodyText = await request.text();
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.REVENUECAT_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  const isValid = await crypto.subtle.verify(
    "HMAC",
    key,
    hexToBytes(signature),
    encoder.encode(bodyText)
  );

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

  if (eventType === "INITIAL_PURCHASE" || eventType === "RENEWAL") {
    await upsertVendorSubscription(env, userId, "Cardcache_pro", productId, true, expiresAt, Math.floor(Date.now() / 1000));
  } else if (eventType === "CANCELLATION" || eventType === "EXPIRATION" || eventType === "TRANSFER") {
    await upsertVendorSubscription(env, userId, "Cardcache_pro", productId, false, expiresAt, Math.floor(Date.now() / 1000));
    await tursoPipeline(env, [
      buildExecute("UPDATE vendors SET is_founder = 0 WHERE user_id = ? AND is_founder = 1", [userId]),
      { type: "close" },
    ]);
  } else {
    await syncVendorSubscriptionFromRevenueCat(env, userId);
  }

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
