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
  if (schemaPromise) return schemaPromise;
  schemaPromise = tursoPipeline(env, [
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
        vendor_table TEXT
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
    { type: "close" },
  ]).then(() => true).catch((err) => {
    console.error("Schema ensure failed:", err.message);
    return false;
  });
  return schemaPromise;
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
      return { id: vendorId, user_id: userId, name, table_default: "" };
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

async function findExistingRow(env, showId, vendorId, productId, condition) {
  const data = await tursoPipeline(env, [
    buildExecute(
      "SELECT id FROM public_show_inventory WHERE show_id = ? AND vendor_id = ? AND product_id = ? AND condition = ?",
      [showId, vendorId, productId, condition]
    ),
    { type: "close" },
  ]);
  const row = firstRow(data.results);
  return row ? String(row.id) : null;
}

async function insertOrUpdateRow(env, showId, vendor, vendorName, vendorTable, input) {
  const productId = Number(input.product_id) || 0;
  const name = String(input.name || "");
  const setName = String(input.set_name || input.set || "");
  const number = String(input.number || "");
  const rarity = String(input.rarity || input.productType || "");
  const condition = String(input.condition || "NM");
  const stickerPrice = Number(input.sticker_price) || Number(input.stickerPrice) || 0;
  const quantity = Number(input.quantity) || 1;

  const existingId = await findExistingRow(env, showId, vendor.id, productId, condition);

  if (existingId) {
    await tursoPipeline(env, [
      buildExecute(
        `UPDATE public_show_inventory SET
          name = ?, set_name = ?, number = ?, rarity = ?, condition = ?,
          sticker_price = ?, quantity = ?, vendor_name = ?, vendor_table = ?
        WHERE id = ?`,
        [name, setName, number, rarity, condition, stickerPrice, quantity, vendorName, vendorTable, existingId]
      ),
      { type: "close" },
    ]);
    return existingId;
  }

  const newId = crypto.randomUUID().replace(/-/g, "");
  await tursoPipeline(env, [
    buildExecute(
      `INSERT INTO public_show_inventory
        (id, show_id, vendor_id, product_id, name, set_name, number, rarity, condition, sticker_price, quantity, vendor_name, vendor_table)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId, showId, vendor.id, productId, name, setName, number, rarity, condition, stickerPrice, quantity, vendorName, vendorTable]
    ),
    { type: "close" },
  ]);
  return newId;
}

async function handleGetMe(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  const vendor = await getOrCreateVendor(env, user);
  return jsonResponse({ ok: true, vendor });
}

async function handleGetVendorShows(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  const vendor = await getOrCreateVendor(env, user);

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

  const rowIds = [];
  for (const row of rows) {
    const id = await insertOrUpdateRow(env, showId, vendor, vendorName, vendorTable, row);
    rowIds.push(id);
  }

  return jsonResponse({ ok: true, row_ids: rowIds });
}

async function handleUpdateInventory(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  const vendor = await getOrCreateVendor(env, user);

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
  if (String(row.vendor_id) !== String(vendor.id)) return errorResponse("Not authorized to edit this row", 403);

  const updates = [];
  const args = [];

  if (body.name !== undefined) { updates.push("name = ?"); args.push(String(body.name)); }
  if (body.set_name !== undefined) { updates.push("set_name = ?"); args.push(String(body.set_name)); }
  if (body.number !== undefined) { updates.push("number = ?"); args.push(String(body.number)); }
  if (body.rarity !== undefined) { updates.push("rarity = ?"); args.push(String(body.rarity)); }
  if (body.condition !== undefined) { updates.push("condition = ?"); args.push(String(body.condition)); }
  if (body.sticker_price !== undefined) { updates.push("sticker_price = ?"); args.push(Number(body.sticker_price) || 0); }
  if (body.quantity !== undefined) { updates.push("quantity = ?"); args.push(Number(body.quantity) || 0); }
  if (body.vendor_name !== undefined) { updates.push("vendor_name = ?"); args.push(String(body.vendor_name)); }
  if (body.vendor_table !== undefined) { updates.push("vendor_table = ?"); args.push(String(body.vendor_table)); }

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
