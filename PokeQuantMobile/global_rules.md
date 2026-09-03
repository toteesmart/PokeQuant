# PokeQuantMobile Global Architecture & Topology

PokeQuantMobile operates as an offline-first client syncing with a multi-tenant Turso cloud database via a Cloudflare Worker edge proxy. 

## Headless Data Topology (V3)
We are currently in Phase 1: The Headless Sync Engine. The data pipeline must function entirely independent of React Native rendering lifecycles.

1. **Local Storage (`pokequant.db`)**
   - Managed via `expo-sqlite`.
   - Tables: `inventory`, `vendor_settings`, `sync_metadata`.
2. **Cloud Sync Pipeline (`cloudSync.ts`)**
   - Authenticated via the `Authorization: Bearer <JWT>` header.
   - Endpoint: Cloudflare Worker (`/v2/pipeline`).
   - Operations are bidirectional: Push pending local mutations (`updated_at > sync_metadata.last_updated`), then pull remote mutations.
   - Network failures must be caught gracefully and return safely without crashing the headless engine.
3. **Data Parity with PWA:**
   - The Turso HTTP payload format requires mapping values explicitly to `{"type": "text", "value": "..."}`, `{"type": "integer", "value": "..."}`, or `{"type": "null"}`. 

## File Registry & Component Map
- `src/db/database.ts`: SQLite initialization, strictly mirroring the PWA schema.
- `src/db/inventoryDb.ts`: Headless CRUD operations for local inventory, enforcing strict LWW SQL statements.
- `src/api/cloudSync.ts`: The Turso edge-proxy fetch engine, HTTP REST translation, and chunking logic.
- `src/engine/SyncTestRunner.ts`: A logic-based execution script to instantiate the DB, mock a local change, push, pull, and log results.

## Master Mobile Architecture Ledger

- **The Headless Sync Engine:** `cloudSync.ts` pushes local mutations (`updated_at > sync_metadata.last_updated`) to Turso via the Cloudflare edge and pulls remote rows using a strict Last-Write-Wins (LWW) `ON CONFLICT(id)` resolution.
- **Strict Pyodide Parity (Coercion):** Turso JSON payloads must be mathematically coerced before SQLite insertion (e.g., `Math.trunc(Number(product_id))`, `Number(Boolean(is_sold))`). UUIDs must be generated via `expo-crypto` (hex string, no dashes).
- **Core Topology:**
  - `pokequant.db` (Tenant DB): Stores `inventory`, `vendor_settings`, `sync_metadata`.
  - `InventoryContext.tsx`: The single source of truth for the React UI tree. It calculates portfolio totals, listens to SQLite mutations, and feeds the UI.
  - `SyncButton.tsx`: The global header component that must react strictly to `InventoryContext` state changes, not rogue device events.
- **UI Integrity Protocol (The Overlap Rule):** Before committing any layout change, verify that containers use rigid block models (explicit height, `minHeight`) or properly bounded flex properties. Never use `position: 'absolute'` inside a flex grid unless explicitly overriding a zero-height collapse.
- **Future Feature Data Sourcing (Graphs/Analytics):** ALL future visual modules (charts, velocity tracking, portfolio tables) MUST source their data strictly by querying the local `pokequant.db` SQLite tables (`inventory`, `price_history`). Never fetch analytics directly from the network.