# PokeQuantMobile Global Architecture & Topology

PokeQuantMobile is an offline-first Expo / React Native companion syncing with a multi-tenant Turso cloud database via a Cloudflare Worker edge proxy. Authentication is handled by Supabase Auth.

## Headless Data Topology (V3)

Phase 1 (The Headless Sync Engine) is complete — the data pipeline functions entirely independent of React Native rendering lifecycles. We are now in Phase 2: UI Construction. All UI components must strictly adhere to the UI Integrity Protocol and source data only from the local SQLite database.

1. **Local Storage (`pokequant.db`)**
   - Managed via `expo-sqlite`.
   - Tables: `inventory`, `vendor_settings`, `sync_metadata`.
2. **Supabase Auth**
   - `supabaseClient.ts` initializes the Supabase client with the project publishable key.
   - `sessionStorage.ts` persists the Supabase `Session` to `expo-secure-store` and exposes `getAccessToken()`.
   - `AuthContext.tsx` mirrors the Supabase session lifecycle, restores sessions on app start, and provides `signIn`, `signUp`, `resetPassword`, and `logout`.
   - **Edge Cryptography (ES256 JWTs):** Supabase uses ECC (P-256) asymmetric keys issuing ES256 tokens. The Cloudflare Worker verifies them via the Web Crypto API (ECDSA + SHA-256) against the Supabase JWKS endpoint, caching the JWKS public key in-memory for 5 minutes. NEVER revert the worker to HS256, RS256, or symmetric HMAC `SUPABASE_JWT_SECRET` verification.
3. **Cloud Sync Pipeline (`cloudSync.ts`)**
   - Authenticated via `Authorization: Bearer <access_token>` from the active Supabase session.
   - Endpoint: Cloudflare Worker (`https://pokequant.totees-mart.workers.dev`) relaying Turso `/v2/pipeline` via the standard Web `fetch()` API.
   - **Turso HTTPS Protocol:** All Turso database URLs configured in edge environment variables must use the `https://` scheme (e.g., `https://<db-name>.turso.io`). NEVER use `libsql://` for edge worker environment variables — `fetch()` cannot resolve it.
   - Operations are bidirectional: Push pending local mutations (`updated_at > sync_metadata.last_updated`), then pull remote mutations.
   - Network failures must be caught gracefully and return safely without crashing the headless engine.
4. **Data Parity with PWA:**
   - The Turso HTTP payload format requires mapping values explicitly to `{"type": "text", "value": "..."}`, `{"type": "integer", "value": "..."}`, or `{"type": "null"}`.

## File Registry & Component Map

- `src/api/supabaseClient.ts`: Supabase client initialization.
- `src/api/sessionStorage.ts`: SecureStore-backed session persistence and access-token retrieval.
- `src/db/database.ts`: SQLite initialization, strictly mirroring the PWA schema.
- `src/db/inventoryDb.ts`: Headless CRUD operations for local inventory, enforcing strict LWW SQL statements.
- `src/api/cloudSync.ts`: The Turso edge-proxy fetch engine, HTTP REST translation, and chunking logic.
- `src/engine/SyncTestRunner.ts`: A logic-based execution script to instantiate the DB, mock a local change, push, pull, and log results.

## Master Mobile Architecture Ledger

- **The Headless Sync Engine:** `cloudSync.ts` pushes local mutations (`updated_at > sync_metadata.last_updated`) to Turso via the Cloudflare edge and pulls remote rows using a strict Last-Write-Wins (LWW) `ON CONFLICT(id)` resolution.
- **Strict Pyodide Parity (Coercion):** Turso JSON payloads must be mathematically coerced before SQLite insertion (e.g., `Math.trunc(Number(product_id))`, `Number(Boolean(is_sold))`). UUIDs must be generated via `expo-crypto` (hex string, no dashes) — standard UUIDs stripped of dashes to guarantee collision-free offline row creation, NOT encrypted hashes.
- **Core Topology:**
  - `pokequant.db` (Tenant DB): Stores `inventory`, `vendor_settings`, `sync_metadata`.
  - `InventoryContext.tsx`: The single source of truth for the React UI tree. It calculates portfolio totals, listens to SQLite mutations, and feeds the UI.
  - `SyncButton.tsx`: The global header component that must react strictly to `InventoryContext` state changes, not rogue device events.
- **UI Integrity Protocol (The Overlap Rule):** Before committing any layout change, verify that containers use rigid block models (explicit height, `minHeight`) or properly bounded flex properties. Never use `position: 'absolute'` inside a flex grid unless explicitly overriding a zero-height collapse.
- **Future Feature Data Sourcing (Graphs/Analytics):** ALL future visual modules (charts, velocity tracking, portfolio tables) MUST source their data strictly by querying the local `pokequant.db` SQLite tables (`inventory`, `price_history`). Never fetch analytics directly from the network.
