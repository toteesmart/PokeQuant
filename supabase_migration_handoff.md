# Supabase Auth Migration Handoff

**Status:** Temporarily rolled back to the legacy `X-Beta-Key` gateway.  
**Branch:** `react-native-v2`  
**Date:** 2026-09-02

## What worked

- The new Cloudflare Worker was successfully deployed to `https://pokequant.totees-mart.workers.dev`.
- The Turso `/v2/pipeline` HTTP request/response syntax and tenant isolation logic were corrected and validated against the edge proxy.
- Expo SDK 57 was cleanly bumped in `PokeQuantMobile`, with component shims (`expo-file-system/legacy`, `StyleSheet.absoluteFillObject` expansions) landed in `BulkImportWizard.tsx`, `CartDrawer.tsx`, and `Dropdown.tsx`.
- Legacy gateway URLs in the mobile client were hunted down and consolidated.
- Fresh Supabase test accounts were generated and confirmed to mint valid-looking JWTs.

## The Blocker

The Supabase JWT could not be cryptographically verified inside the Cloudflare Worker. Every `Authorization: Bearer <token>` request hit a `401 Unauthorized` wall. The worker used the Web Crypto API:

```js
const key = await crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(secret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["verify"]
);
const valid = await crypto.subtle.verify(
  { name: "HMAC", hash: "SHA-256" },
  key,
  signature,
  data
);
```

Even after:
- wiping Expo `SecureStore` on the device,
- manually forcing the exact `SUPABASE_JWT_SECRET` value into both the worker and the Supabase project,
- confirming the token was an `alg: "HS256"` / `typ: "JWT"` structure,

`crypto.subtle.verify` consistently returned `false`.

The most likely root causes are:

1. **Secret encoding mismatch** between the base64-encoded Supabase JWT secret and the raw bytes imported into Web Crypto.
2. **Subtle payload whitespace / base64url padding** differences between the signed data (`${header}.${payload}`) and what Supabase actually signed.
3. The Supabase project is signing with a different secret or key than the one being imported (e.g. an `auto-generated` project secret vs. a manually set `JWT_SECRET`).

## Next Attempt Strategy

Before re-enabling `crypto.subtle.verify`, we must add raw, non-throwing logging of the decoded JWT in the worker so we can compare exactly what Supabase mints versus what the edge is trying to validate.

Minimum debug additions in `worker.js`:

```js
console.log("JWT header:", JSON.stringify(header));
console.log("JWT payload:", JSON.stringify(payload));
console.log("Secret length:", secret.length);
console.log("Signature bytes length:", signature.byteLength);
console.log("Data to verify:", new TextDecoder().decode(data));
```

Then, independently verify the same token + secret in a local Node/Browser script using the same Web Crypto path. Do **not** switch to asymmetric (`RS256`) or a different algorithm until the HMAC path is proven correct end-to-end.

Keep the legacy `X-Beta-Key` worker as the active deployment while the Supabase verification is being debugged in a separate staging worker (e.g. `pokequant-staging.totees-mart.workers.dev`) or in local Wrangler dev. Only swap the production `pokequant` worker back to JWT once a single token can be verified both locally and on the edge.

## Files intentionally left in pre-Supabase state

- `worker.js` — reverted to `X-Beta-Key` gate.
- `PokeQuantMobile/src/constants/api.ts` — points back at the legacy gateway URL.
- `PokeQuantMobile/src/api/cloudSync.ts` — sends `X-Beta-Key` header.
- `PokeQuantMobile/src/context/AuthContext.tsx` — simple in-memory beta-key context.
- `PokeQuantMobile/src/screens/LoginScreen.tsx` — beta-key login screen.
- `PokeQuantMobile/App.tsx` — mounts `AppNavigator` once `userId` is set.
- `PokeQuantMobile/package.json` — Expo SDK 57 retained; `@supabase/supabase-js` and `expo-secure-store` removed.

## Notes for the next attempt

- Do not delete the Supabase project or existing test users; the migration is paused, not abandoned.
- Keep the `expo-secure-store` and `@supabase/supabase-js` installs off the rollback branch until JWT verification is fixed.
- Re-verify the worker CORS headers allow `Authorization` before switching back, and keep `X-Beta-Key` as a fallback header for graceful migration.
