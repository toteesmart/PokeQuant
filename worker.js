// Deploy via Wrangler CLI

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

function argValue(arg) {
  if (arg === null || arg === undefined) return null;
  if (typeof arg === "object") {
    if (arg.type === "null" || arg.value === undefined || arg.value === null) return null;
    return String(arg.value);
  }
  return String(arg);
}

function validateStatement(stmt, betaKey) {
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

  const args = Array.isArray(stmt.args) ? stmt.args : [];
  for (const binding of bindings) {
    if (binding.type === "literal") {
      if (String(binding.value) !== String(betaKey)) {
        return { ok: false, error: "user_id literal does not match X-Beta-Key" };
      }
    } else {
      const arg = args[binding.index];
      if (argValue(arg) !== String(betaKey)) {
        return { ok: false, error: "user_id argument does not match X-Beta-Key" };
      }
    }
  }

  return { ok: true };
}

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Beta-Key, Authorization"
    };

    // Handle CORS preflight before any method validation.
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    // Validate the access gate key
    const betaKey = request.headers.get("X-Beta-Key");
    if (!betaKey || !betaKey.trim()) {
      return new Response("Missing Beta Key", { status: 401, headers: corsHeaders });
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
      const validation = validateStatement(stmt, betaKey);
      if (!validation.ok) {
        return new Response(JSON.stringify({ error: validation.error, sql: stmt.sql }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (!env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN) {
      return new Response(JSON.stringify({ error: "Turso environment not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const tursoUrl = `${env.TURSO_DATABASE_URL}/v2/pipeline`;

    const tursoReq = new Request(tursoUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.TURSO_AUTH_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: body
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
