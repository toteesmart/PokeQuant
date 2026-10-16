// Turso /v2/pipeline client and row decoding. Only this module knows the wire
// shape; everything above it speaks plain JS objects.

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

function resultAt(results, index = 0) {
  if (!Array.isArray(results)) return null;
  return results[index] ?? null;
}

export function rowAt(results, index) {
  const r = resultAt(results, index);
  if (!r || r.type !== "ok" || r.response?.type !== "execute") return null;
  const rows = rowsToObjects(r.response.result);
  return rows[0] ?? null;
}

export function firstRow(results) {
  return rowAt(results, 0);
}

export function allRowsAt(results, index) {
  const r = resultAt(results, index);
  if (!r || r.type !== "ok" || r.response?.type !== "execute") return [];
  return rowsToObjects(r.response.result);
}

export function allRows(results) {
  return allRowsAt(results, 0);
}

export async function tursoPipeline(env, statements) {
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

export function buildExecute(sql, args = []) {
  return { type: "execute", stmt: { sql, args: args.map(toTursoArg) } };
}
