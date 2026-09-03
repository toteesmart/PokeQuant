// Deploy via Wrangler CLI

const SUPABASE_JWT_SECRET = "BDxmvPQQN2D2LuYNDmNkkRQMh65C5mQJ4QD7SUF/IAAg54LY+gCbDEYBYS1ojIU78MtelVw+azDDxWzsJyZekg==";

const TENANT_TABLES = new Set(["inventory", "vendor_settings", "sync_metadata"]);

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

async function importHmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

async function verifyJwt(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format");
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  const header = JSON.parse(base64UrlToString(headerB64));
  if (header.alg !== "HS256") {
    throw new Error("Unsupported JWT algorithm");
  }
  if (header.typ && header.typ !== "JWT") {
    throw new Error("Unsupported JWT type");
  }

  const payload = JSON.parse(base64UrlToString(payloadB64));

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp !== undefined && payload.exp < now) {
    throw new Error("JWT expired");
  }

  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlDecode(signatureB64);

  const key = await importHmacKey(secret);
  const valid = await crypto.subtle.verify(
    { name: "HMAC", hash: "SHA-256" },
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
    if (/^DROP\s+TABLE\b/i.test(sql.trim()) && referencesTenantTable(sql)) {
      return { ok: false, error: "DROP TABLE on tenant tables is not allowed" };
    }
    return { ok: true };
  }

  const bindings = extractUserIdBindings(sql);
  if (bindings.length === 0) {
    return { ok: false, error: "Tenant table statement missing user_id binding" };
  }

  if (!Array.isArray(stmt.args)) stmt.args = [];

  for (const binding of bindings) {
    if (binding.type === "literal") {
      if (String(binding.value) !== String(userId)) {
        return { ok: false, error: "user_id literal does not match authorized user" };
      }
    } else {
      if (binding.index < 0 || binding.index >= stmt.args.length) {
        return { ok: false, error: "user_id placeholder argument missing" };
      }
      stmt.args[binding.index] = { type: "text", value: String(userId) };
    }
  }

  return { ok: true };
}

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    };

    // Handle CORS preflight before any method validation.
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    // Extract and validate the Supabase JWT from the Authorization header.
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.trim().toLowerCase().startsWith("bearer ")) {
      return new Response("Unauthorized", { status: 401, headers: corsHeaders });
    }

    const token = authHeader.trim().slice(7).trim();
    if (!token) {
      return new Response("Unauthorized", { status: 401, headers: corsHeaders });
    }

    const secret = (env && env.SUPABASE_JWT_SECRET) ? env.SUPABASE_JWT_SECRET : SUPABASE_JWT_SECRET;

    let jwtPayload;
    try {
      jwtPayload = await verifyJwt(token, secret);
    } catch (e) {
      return new Response("Unauthorized", { status: 401, headers: corsHeaders });
    }

    const userId = jwtPayload && jwtPayload.sub;
    if (!userId) {
      return new Response("Unauthorized", { status: 401, headers: corsHeaders });
    }

    let body;
    try {
      body = await request.text();
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let pipeline;
    try {
      pipeline = JSON.parse(body);
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const requests = Array.isArray(pipeline.requests) ? pipeline.requests : [];
    for (const req of requests) {
      const stmt = req && req.stmt ? req.stmt : null;
      if (!stmt) continue;
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
