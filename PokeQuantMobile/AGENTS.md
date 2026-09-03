# PokeQuantMobile Agent Rules (Headless-First Architecture)

PokeQuantMobile is the offline-first Expo / React Native companion to the PokeQuant PWA. 
**CURRENT MANDATE:** We are building a headless, UI-free SQLite engine and bidirectional Turso sync pipeline. Do NOT build, modify, or inject React Native UI components (e.g., Views, FlatLists, Modals) until the background sync is mathematically proven via a headless test runner.

## Core Database & Sync Engineering
- **SQLite Engine:** All local persistence uses `expo-sqlite`. Use `database.withTransactionAsync()` for multi-row writes.
- **UUID Schema Constraint:** The local and cloud `inventory` tables MUST use `id TEXT PRIMARY KEY`. Use `expo-crypto.randomUUID().replace(/-/g, '')` for ID generation. Never use an `INTEGER PRIMARY KEY` rowid alias.
- **Strict Data Coercion (The Pyodide Standard):** The Turso edge JSON payloads return dynamic types. Before binding ANY data to SQLite, you must strictly coerce types to prevent `datatype mismatch` errors:
  - Booleans (`is_sold`, `is_deleted`, `is_bulk_deal`): `Number(Boolean(val)) || 0`
  - Integers (`product_id`): `Math.trunc(Number(val)) || 0`
  - Floats (`purchase_price`, `sticker_price`, `sold_price`): `Number(val) || 0.0`
- **Last-Write-Wins (LWW) Resolution:** Remote pulls must never blindly overwrite local rows. Use an Upsert LWW statement:
  `INSERT INTO inventory (...) VALUES (...) ON CONFLICT(id) DO UPDATE SET ... WHERE excluded.updated_at > inventory.updated_at;`
- **Pushing Local Changes:** Instead of maintaining a fragile queue of raw SQL strings, push local mutations by querying `SELECT * FROM inventory WHERE updated_at > (SELECT last_updated FROM sync_metadata LIMIT 1)`. Chunk these rows into `SYNC_BATCH_SIZE = 500` and send as `INSERT OR REPLACE` payloads to the Cloudflare Worker.

## Tooling & Constraints
- **Terminal (Windows):** Always bypass execution policies and use explicit paths:
  `Set-ExecutionPolicy Bypass -Scope Process -Force`
  `& "C:\Program Files\nodejs\npm.cmd" <command>`
- **Git Commits:** Single-line messages only (`git commit -m "..."`). No multi-line blocks.

## Master Mobile Architecture Ledger

- **The Headless Sync Engine:** `cloudSync.ts` pushes local mutations (`updated_at > sync_metadata.last_updated`) to Turso via the Cloudflare edge and pulls remote rows using a strict Last-Write-Wins (LWW) `ON CONFLICT(id)` resolution.
- **Strict Pyodide Parity (Coercion):** Turso JSON payloads must be mathematically coerced before SQLite insertion (e.g., `Math.trunc(Number(product_id))`, `Number(Boolean(is_sold))`). UUIDs must be generated via `expo-crypto` (hex string, no dashes).
- **Core Topology:**
  - `pokequant.db` (Tenant DB): Stores `inventory`, `vendor_settings`, `sync_metadata`.
  - `InventoryContext.tsx`: The single source of truth for the React UI tree. It calculates portfolio totals, listens to SQLite mutations, and feeds the UI.
  - `SyncButton.tsx`: The global header component that must react strictly to `InventoryContext` state changes, not rogue device events.
- **UI Integrity Protocol (The Overlap Rule):** Before committing any layout change, verify that containers use rigid block models (explicit height, `minHeight`) or properly bounded flex properties. Never use `position: 'absolute'` inside a flex grid unless explicitly overriding a zero-height collapse.
- **Future Feature Data Sourcing (Graphs/Analytics):** ALL future visual modules (charts, velocity tracking, portfolio tables) MUST source their data strictly by querying the local `pokequant.db` SQLite tables (`inventory`, `price_history`). Never fetch analytics directly from the network.