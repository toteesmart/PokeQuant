// Deploy via Wrangler CLI

const TENANT_TABLES = new Set(["inventory", "vendor_settings", "sync_metadata"]);

const ALLOWLISTED_SQL_PATTERNS = [
  /^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(?:vendor_settings|sync_metadata)\b.*\bVALUES\s*\(.*\)\s*$/is,
  /^\s*INSERT\s+INTO\s+inventory\b.*ON\s+CONFLICT\b.*DO\s+UPDATE\b.*$/is,
  /^\s*SELECT\s+.*\s+FROM\s+(?:inventory|vendor_settings|sync_metadata)\b.*WHERE\s+user_id\s*=\s*\?.*$/is,
  /^\s*DELETE\s+FROM\s+(?:inventory|vendor_settings|sync_metadata)\b.*WHERE\s+user_id\s*=\s*\?.*$/is,
];
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_SUPABASE_URL = "https://jglvrozjhfooohkbmmwe.supabase.co";
// Legit sync traffic is a few chunks of SYNC_BATCH_SIZE=500 statements; these
// caps bound per-request Turso cost without affecting real clients.
const MAX_PIPELINE_BODY_BYTES = 1024 * 1024; // 1 MB
const MAX_PIPELINE_REQUESTS = 2000;

let jwksCache = null;
let jwksCacheUrl = "";
let jwksFetchPromise = null;

function stripSqlStringLiterals(sql) {
  return sql.replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

function referencesTenantTable(sql) {
  const stripped = stripSqlStringLiterals(sql);
  const pattern = new RegExp(`\\b(?:${[...TENANT_TABLES].join("|")})\\b`, "i");
  return pattern.test(stripped);
}

function isDdl(sql) {
  const first = sql.trim().split(/[^a-zA-Z]+/i)[0].toUpperCase();
  return ["CREATE", "ALTER", "DROP", "PRAGMA"].includes(first);
}

function splitSqlList(text) {
  const parts = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      current += c;
      if (c === "'") {
        inQuote = false;
      }
      continue;
    }
    if (c === "'") {
      inQuote = true;
      current += c;
      continue;
    }
    if (c === ",") {
      parts.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  parts.push(current);
  return parts;
}

function extractUserIdBindings(sql) {
  const bindings = [];

  const insertMatch = sql.match(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(\w+)\s*\(([^)]+)\)/i);
  if (insertMatch) {
    const columns = insertMatch[2].split(",").map((c) => c.trim().toLowerCase());
    const userIdIdx = columns.indexOf("user_id");
    if (userIdIdx >= 0) {
      const valuesMatch = sql.match(/VALUES\s*\(([^)]+)\)/i);
      if (valuesMatch) {
        const values = splitSqlList(valuesMatch[1]);
        if (userIdIdx < values.length) {
          const val = values[userIdIdx].trim();
          if (val === "?") {
            let placeholderIndex = (sql.slice(0, valuesMatch.index).match(/\?/g) || []).length;
            for (let i = 0; i < userIdIdx; i++) {
              if (values[i].trim() === "?") placeholderIndex++;
            }
            bindings.push({ type: "placeholder", index: placeholderIndex });
          } else if (val.startsWith("'") && val.endsWith("'")) {
            bindings.push({ type: "literal", value: val.slice(1, -1) });
          }
        }
      }
    }
  }

  const pattern = /\buser_id\b\s*=\s*(\?|'(?:[^'\\]|\\.)*'|\d+(?:\.\d+)?)/gi;
  let m;
  while ((m = pattern.exec(sql)) !== null) {
    const token = m[1];
    if (token === "?") {
      const before = sql.slice(0, m.index);
      const index = (before.match(/\?/g) || []).length;
      bindings.push({ type: "placeholder", index });
    } else if (token.startsWith("'")) {
      bindings.push({ type: "literal", value: token.slice(1, -1).replace(/\\'/g, "'") });
    } else {
      bindings.push({ type: "literal", value: token });
    }
  }

  return bindings;
}

function isAllowlistedTenantSql(sql) {
  if (ALLOWLISTED_SQL_PATTERNS[0].test(sql) || ALLOWLISTED_SQL_PATTERNS[1].test(sql)) {
    return true;
  }
  const stripped = stripSqlStringLiterals(sql);
  if (/\bOR\b/i.test(stripped)) {
    return false;
  }
  return ALLOWLISTED_SQL_PATTERNS.slice(2).some((pattern) => pattern.test(sql));
}

function validateTenantStatement(sql, userId) {
  if (!referencesTenantTable(sql)) {
    return { ok: true };
  }
  if (isDdl(sql)) {
    console.warn(
      `[worker.js] Rejected DDL on tenant table for user ${userId}: ${sql}`
    );
    return { ok: false, error: "DDL is not allowed on tenant tables" };
  }
  if (!isAllowlistedTenantSql(sql)) {
    console.warn(
      `[worker.js] Non-allowlisted tenant SQL for user ${userId}: ${sql}`
    );
    return { ok: false, error: "Tenant SQL is not in the allowlist" };
  }
  return { ok: true };
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
  if (env && env.SUPABASE_URL) {
    return env.SUPABASE_URL;
  }
  if (env && env.SUPABASE_JWKS_URL) {
    const m = env.SUPABASE_JWKS_URL.match(/^https?:\/\/[^/]+/);
    if (m) return m[0];
  }
  return DEFAULT_SUPABASE_URL;
}

function getSupabaseJwksUrl(env) {
  if (env && env.SUPABASE_JWKS_URL) {
    return env.SUPABASE_JWKS_URL;
  }
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

  // Supabase access tokens carry aud="authenticated"; rejecting other or
  // missing audiences bounds token reuse across projects/flows.
  const audiences = Array.isArray(payload.aud)
    ? payload.aud
    : payload.aud === undefined || payload.aud === null
      ? []
      : [payload.aud];
  if (!audiences.includes("authenticated")) {
    throw new Error("JWT audience mismatch");
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

function injectAndValidateUserId(stmt, userId) {
  if (!stmt || typeof stmt !== "object") return { ok: true };
  const sql = stmt.sql || "";
  if (!referencesTenantTable(sql)) return { ok: true };
  if (isDdl(sql)) {
    return { ok: false, error: "DDL is not allowed on tenant tables" };
  }

  const bindings = extractUserIdBindings(sql);
  if (bindings.length === 0) {
    return { ok: false, error: "Tenant table statement missing user_id binding" };
  }

  for (const binding of bindings) {
    if (binding.type === "literal") {
      if (String(binding.value) !== String(userId)) {
        return { ok: false, error: "user_id literal does not match authorized user" };
      }
    } else {
      if (!Array.isArray(stmt.args) || binding.index < 0 || binding.index >= stmt.args.length) {
        return { ok: false, error: "user_id placeholder argument missing" };
      }
      stmt.args[binding.index] = { type: "text", value: String(userId) };
    }
  }

  return { ok: true };
}

async function tursoQuery(env, sql, args = []) {
  const tursoUrl = `${env.TURSO_DATABASE_URL}/v2/pipeline`;
  const body = JSON.stringify({
    requests: [
      { type: "execute", stmt: { sql, args: args.map((a) => ({ type: a.type, value: a.value })) } },
      { type: "close" },
    ],
  });
  const res = await fetch(tursoUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.TURSO_AUTH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Turso query failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  return data;
}

function firstResultRow(results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const first = results[0];
  if (first?.type !== "ok" || first?.response?.type !== "execute") return null;
  const rows = first.response.result?.rows;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const out = {};
  const cols = first.response.result?.cols || [];
  for (let i = 0; i < cols.length; i++) {
    const cell = rows[0][i];
    out[cols[i].name] = cell?.value;
  }
  return out;
}

async function ensureSyncSchema(env) {
  await tursoQuery(env, "CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  await tursoQuery(env, "INSERT OR IGNORE INTO app_config (key, value) VALUES ('payments_live', '0')");
  await tursoQuery(env, "INSERT OR IGNORE INTO app_config (key, value) VALUES ('founder_seat_limit', '50')");
  await tursoQuery(env, "CREATE TABLE IF NOT EXISTS founder_counter (id TEXT PRIMARY KEY, claimed INTEGER NOT NULL DEFAULT 0)");
  await tursoQuery(env, "INSERT OR IGNORE INTO founder_counter (id, claimed) VALUES ('founder', 0)");
  await tursoQuery(env, "CREATE TABLE IF NOT EXISTS vendor_subscriptions (user_id TEXT PRIMARY KEY, entitlement_id TEXT NOT NULL, product_id TEXT, is_active INTEGER NOT NULL DEFAULT 0, expires_at INTEGER, updated_at INTEGER NOT NULL DEFAULT 0)");

  // Vendor / team tables are also queried when checking sync access, so ensure
  // they exist here even if the show-vendor worker has not run yet.
  await tursoQuery(env, `
    CREATE TABLE IF NOT EXISTS vendors (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      name TEXT,
      table_default TEXT,
      created_at INTEGER,
      is_founder INTEGER NOT NULL DEFAULT 0,
      founder_seat_number INTEGER
    )
  `);
  await tursoQuery(env, "CREATE INDEX IF NOT EXISTS idx_vendors_user_id ON vendors(user_id)");

  await tursoQuery(env, `
    CREATE TABLE IF NOT EXISTS teams (
      owner_user_id TEXT PRIMARY KEY,
      product_id TEXT,
      seats_total INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER,
      invite_code TEXT UNIQUE,
      name TEXT,
      updated_at INTEGER,
      created_at INTEGER
    )
  `);

  await tursoQuery(env, `
    CREATE TABLE IF NOT EXISTS team_members (
      team_id TEXT NOT NULL,
      member_user_id TEXT NOT NULL,
      created_at INTEGER,
      PRIMARY KEY (team_id, member_user_id)
    )
  `);
  await tursoQuery(env, "CREATE INDEX IF NOT EXISTS idx_team_members_member ON team_members(member_user_id)");

  return true;
}

async function getAppConfigValue(env, key) {
  const data = await tursoQuery(env, "SELECT value FROM app_config WHERE key = ?", [
    { type: "text", value: key },
  ]);
  const row = firstResultRow(data.results);
  return row?.value ?? null;
}

async function isPaymentsLiveSync(env) {
  return (await getAppConfigValue(env, "payments_live")) === "1";
}

async function isVendorActiveSync(env, userId) {
  const now = Math.floor(Date.now() / 1000);
  const data = await tursoQuery(env, "SELECT is_active, expires_at FROM vendor_subscriptions WHERE user_id = ? AND entitlement_id = ?", [
    { type: "text", value: userId },
    { type: "text", value: "Cardcache_pro" },
  ]);
  const row = firstResultRow(data.results);
  if (!row) return false;
  if (Number(row.is_active) !== 1) return false;
  if (row.expires_at && Number(row.expires_at) < now) return false;
  return true;
}

async function isFounderSync(env, userId) {
  const now = Math.floor(Date.now() / 1000);
  const data = await tursoQuery(
    env,
    `
      SELECT 1
      FROM vendors v
      WHERE v.user_id = ?
        AND v.is_founder = 1
        AND EXISTS (
          SELECT 1 FROM vendor_subscriptions vs
          WHERE vs.user_id = v.user_id
            AND vs.entitlement_id = ?
            AND vs.is_active = 1
            AND (vs.expires_at IS NULL OR vs.expires_at > ?)
        )
      LIMIT 1
    `,
    [
      { type: "text", value: userId },
      { type: "text", value: "Cardcache_pro" },
      { type: "integer", value: String(now) },
    ]
  );
  return !!firstResultRow(data.results);
}

async function isActiveTeamMemberSync(env, userId) {
  const now = Math.floor(Date.now() / 1000);
  const data = await tursoQuery(
    env,
    `
      SELECT t.owner_user_id
      FROM team_members tm
      JOIN teams t ON tm.team_id = t.owner_user_id
      WHERE tm.member_user_id = ?
        AND (t.expires_at IS NULL OR t.expires_at > ?)
      LIMIT 1
    `,
    [
      { type: "text", value: userId },
      { type: "integer", value: String(now) },
    ]
  );
  return !!firstResultRow(data.results);
}

async function assertIsPaidVendorSync(env, userId) {
  if (!(await isPaymentsLiveSync(env))) return true;
  if (await isVendorActiveSync(env, userId)) return true;
  if (await isFounderSync(env, userId)) return true;
  if (await isActiveTeamMemberSync(env, userId)) return true;
  throw new Error("subscription_required");
}

export default {
  async fetch(request, env) {
    // Access-Control-Allow-Origin: * is deliberate: this worker is consumed only
    // by the native mobile app over Authorization-bearer fetch — no browser
    // cookies or credentialed CORS requests are involved, so a wildcard origin
    // grants nothing extra. If a web client is ever added, scope this to the
    // app's origin instead.
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    const contentLength = Number(request.headers.get("Content-Length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_PIPELINE_BODY_BYTES) {
      return new Response(JSON.stringify({ error: "Request body too large" }), { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let userId;
    const authHeader = request.headers.get("Authorization");

    if (authHeader && authHeader.trim().toLowerCase().startsWith("bearer ")) {
      const token = authHeader.trim().slice(7).trim();
      if (!token) {
        return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      }

      let jwtPayload;
      try {
        jwtPayload = await verifyJwt(token, env);
      } catch (e) {
        console.error("JWT verification failed:", e.message);
        return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      }

      userId = jwtPayload && jwtPayload.sub;
      if (!userId) {
        return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      }
    } else {
      return new Response("Unauthorized", { status: 401, headers: corsHeaders });
    }

    if (!env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN) {
      return new Response(JSON.stringify({ error: "Turso environment not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    try {
      await ensureSyncSchema(env);
      await assertIsPaidVendorSync(env, userId);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message === "subscription_required") {
        return new Response(JSON.stringify({ error: "subscription_required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      console.error("Subscription check failed:", message);
      return new Response(JSON.stringify({ error: "Service unavailable" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let bodyBuffer;
    try {
      bodyBuffer = await request.arrayBuffer();
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (bodyBuffer.byteLength > MAX_PIPELINE_BODY_BYTES) {
      return new Response(JSON.stringify({ error: "Request body too large" }), { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let pipeline;
    try {
      pipeline = JSON.parse(new TextDecoder().decode(bodyBuffer));
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const requests = Array.isArray(pipeline.requests) ? pipeline.requests : [];
    if (requests.length > MAX_PIPELINE_REQUESTS) {
      return new Response(JSON.stringify({ error: "Too many pipeline statements" }), { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    for (const req of requests) {
      const stmt = req && req.stmt ? req.stmt : null;
      if (!stmt) continue;
      const tenantValidation = validateTenantStatement(stmt.sql, userId);
      if (!tenantValidation.ok) {
        return new Response(JSON.stringify({ error: tenantValidation.error, sql: stmt.sql }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const validation = injectAndValidateUserId(stmt, userId);
      if (!validation.ok) {
        return new Response(JSON.stringify({ error: validation.error, sql: stmt.sql }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (!env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN) {
      return new Response(JSON.stringify({ error: "Turso environment not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const tursoUrl = `${env.TURSO_DATABASE_URL}/v2/pipeline`;
    const tursoBody = JSON.stringify(pipeline);

    const tursoReq = new Request(tursoUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.TURSO_AUTH_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: tursoBody
    });

    try {
      const response = await fetch(tursoReq);
      const responseHeaders = { ...corsHeaders };
      const contentType = response.headers.get("Content-Type");
      if (contentType) {
        responseHeaders["Content-Type"] = contentType;
      } else {
        responseHeaders["Content-Type"] = "application/json";
      }
      return new Response(response.body, {
        status: response.status,
        headers: responseHeaders
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  }
};
