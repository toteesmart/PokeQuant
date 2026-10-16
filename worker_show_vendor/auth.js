// Supabase auth: ES256 JWT verification against the cached JWKS key set, the
// authenticated-user payload shape, and the service-role admin delete.
// ES256 only — never HS256/RS256/symmetric HMAC (see AGENTS.md).

import { getAuthToken } from "./http.js";

const DEFAULT_SUPABASE_URL = "https://jglvrozjhfooohkbmmwe.supabase.co";
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;

let jwksCache = null;
let jwksCacheUrl = "";
let jwksFetchPromise = null;

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

export async function deleteSupabaseAuthUser(env, userId) {
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRole) {
    throw new Error("Supabase service role key not configured");
  }
  const supabaseUrl = getSupabaseUrl(env).replace(/\/$/, "");
  const apiKey = env.SUPABASE_ANON_KEY || serviceRole;
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${serviceRole}`,
    },
  });
  // 404 means the user was already deleted; treat it as success.
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Supabase user delete failed: ${res.status} ${text}`);
  }
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

export async function getAuthenticatedUser(request, env) {
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
