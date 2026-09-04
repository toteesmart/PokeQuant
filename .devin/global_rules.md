# PokeQuant AI Context Map

PokeQuant is a local-first, offline-capable Progressive Web Application (PWA) and vendor trading terminal for the Pokémon TCG. It is engineered to execute natively inside browser WebAssembly (Pyodide via Stlite) on mobile devices.

## Core Architecture
- **Frontend/Runtime:** Python (Streamlit) compiled to WebAssembly running in client browser threads.
- **Streamlit UI State Binding:** Widgets with `key="..."` are bound to `st.session_state`. Never write to that key after the widget has been rendered in the same run; use a pending-state indirection and apply it before the widget on the next run.
- **Widget Version Parity:** The Pyodide/Stlite Streamlit wheel lags the desktop wheel. Detect support at import time and provide mature-widget fallbacks for navigation/fragment controls; do not assume new APIs like `st.segmented_control(width=...)` are stable in the browser.
- **Offline Storage (Hard-Disk Bridge):** Local SQLite catalogs and IndexedDB chunking managed by a custom Service Worker REST bridge.
- **Cloud Sync:** Multi-tenant Turso (LibSQL) database routed securely through a Cloudflare Worker edge proxy that verifies Supabase ES256 (ECC P-256) JWTs against the project JWKS endpoint.
- **Data ETL:** GitHub Actions pipeline pushing lightweight JSON price deltas to Cloudflare R2.
- **Autonomous Catalog Hydration:** On startup the app downloads the latest delta patch from a public R2 URL and applies it to the local `mobile_catalog.db`; the browser path is always `mobile_catalog.db` (the service worker virtualizes it). Requests use cache-busting query parameters and anti-cache headers to avoid stale CDN objects.
- **Cloud Sync Layering:** Automatic inventory pull after login, a background JavaScript sync-time poller, an in-memory/IndexedDB layered cache, and busy-flag guards on `sync_with_cloud` / `apply_daily_catalog_delta` prevent blocking UI threads and re-entrant sync. Pending Turso pushes are chunked to reduce round-trips.
- **Mobile UI Rendering:** `app.py` uses a Home screen plus a top module navigator. Active inventory renders as a responsive 2-column grid with a `st.segmented_control` top nav (falling back to a 2x2 `st.button` grid on older Pyodide wheels). Per-card popovers are flattened into a conditional manage panel, the spreadsheet editor is paginated, and buy-tier lists use native `st.number_input` fields.
- **Pandas Avoidance in UI Hot-Paths:** `app.py` UI rendering paths (Active Inventory grouping, Performance Analytics, Velocity/Spreadsheet) now use native Python data structures instead of Pandas DataFrames to avoid Pyodide/Stlite mobile memory bloat. Pandas remains only for the Bulk Import Excel wizard and the `sys_preload_data_editor` preloader.

## File Registry & Component Map
- `app.py`: Primary Streamlit UI, point-of-sale terminal, and PWA entry point. Renders a Home screen, top module navigator (`st.segmented_control` with a `st.button` fallback), responsive 2-column inventory grid, paginated live spreadsheet, conditional per-card manage panels, and native buy-tier number inputs. Now features strict pagination for the Active Inventory and Completed Logs, PyArrow-free Markdown tables for the Velocity Breakdown, static `global_top_nav` keys, inline conditional log panels (no `st.popover` in loops), pending-state indirection for Vendor Settings tier management, and "Save Before Navigating" locks on the Live Spreadsheet editor. Installs a patched `streamlit.error_util` global exception hook so red error boxes are reported to Sentry.
- `card_tool.py`: Core analytical engine, offline SQLite search, buy offer logic, synchronous Turso REST sync pipeline, shared Sentry envelope sender (`log_to_sentry` / `log_exception_to_sentry`), autonomous R2 delta/catalog hydration, background sync-time poller support, lightweight 1/3/7-day inventory price insights, and delta pipeline memory hardening (chunked GC, 90-day `_get_price_map` window, truncated Sentry envelopes) for browser and desktop. Now includes `_get_catalog_max_date()` to verify the internal SQLite state before applying R2 JSON deltas, ensuring patches remain idempotent even when the local VFS reverts.
- `sw.js`: Service worker handling offline caching, IndexedDB bridging (`/offline-db/save`), virtual SQLite streaming for `mobile_catalog.db`, cache-bypass for live delta requests, and worker crash forwarding (`PQ_SW_ERROR`). Now injects a `Content-Length` header during the virtual database stream by reading `metadata.totalBytes` to satisfy Pyodide SQLite VFS mount requirements.
- `worker.js`: Cloudflare Edge proxy verifying Supabase ES256 JWTs (ECC P-256 asymmetric keys, Web Crypto ECDSA + SHA-256) via the project's JWKS endpoint (key set cached in-memory for 5 minutes), with a legacy `X-Beta-Key` fallback, handling CORS, and forwarding batch pipeline requests to Turso's `/v2/pipeline` endpoint via `fetch()` — edge Turso URLs must use `https://`, never `libsql://`.
- `index.html`: PWA bootstrap, Sentry browser SDK init, DOM observer for Streamlit error boxes, main-thread error handlers, and background sync-time poller registration. Now utilizes a fixed 10 MB chunk buffer for downloading `mobile_catalog.db` to prevent memory reallocation crashes, and records total bytes in the IndexedDB metadata.
- `build_mobile_db.py`: Compresses SQLite catalogs and embeds Base64 thumbnails to fit mobile memory constraints.
- `daily_delta_pipeline.py` & `tcg_scraper.py`: Automated CI/CD market scrapers and R2 JSON patch generators. Delta uploads set `Cache-Control` headers and the pipeline uses `curl_cffi` for bot-resistant scraping.
- `chat_engine.py` & `ebay_tool.py`: Gemini AI valuation assistant and `curl_cffi` anti-bot eBay scraper.

## Technical Stack
- **Languages:** Python 3, JavaScript, SQL
- **Environment:** Stlite / Pyodide (Browser WebWorkers)
- **Databases:** SQLite (Local VFS), Turso LibSQL (Cloud)
- **Key Libraries:** `beautifulsoup4`, `curl_cffi`, `openpyxl`, `google-genai`, `boto3`

## Critical Cloud-Sync & Schema Constraints

- **Edge Cryptography (ES256 Only):** Supabase issues access tokens signed with ECC P-256 asymmetric keys using the ES256 algorithm. The worker verifies them via the Web Crypto API (ECDSA + SHA-256) against the Supabase JWKS endpoint, caching the fetched key set in-memory for 5 minutes to avoid rate-limiting during batch syncs. NEVER revert to HS256, RS256, or symmetric `SUPABASE_JWT_SECRET` verification.
- **Turso HTTPS Protocol:** The worker calls Turso's `/v2/pipeline` endpoint over the standard Web `fetch()` API, so all edge `TURSO_DATABASE_URL` environment variables must use `https://` URLs (e.g., `https://<db-name>.turso.io`); `fetch()` cannot resolve `libsql://`.
- **Sync Queue Parity:** `card_tool.py` validates SQL placeholder/argument counts in `_normalize_pending_sync`. Corrupted queue items are dropped and the UI exposes a `Clear Stuck Sync Queue` fallback via `clear_pending_syncs()`.
- **Turso `inventory.id` Migration:** The cloud `inventory` table must use `id TEXT PRIMARY KEY` to accept the UUID hex strings produced by `uuid.uuid4().hex`. `_ensure_turso_schema` recreates the table if it finds a legacy `INTEGER PRIMARY KEY` rowid-alias column, preserving existing rows.
- **Offline UUID Generation:** The 32-character `inventory.id` strings are standard UUIDs with dashes stripped — generated offline via `expo-crypto.randomUUID().replace(/-/g, '')` in the Expo app and `uuid.uuid4().hex` in the PWA — NOT encrypted hashes. This guarantees collision-free offline row creation.
- **Sync Failure Recovery:** Fatal SQLite errors (`datatype mismatch`, `syntax error`, `wrong number of arguments`, etc.) from `sync_with_cloud` set `st.session_state._pq_sync_fatal_error` and log to Sentry. The sync pipeline does not auto-flush the queue unless the user explicitly clears it.

**CRITICAL:** For strict coding rules regarding Pyodide WebWorker networking limitations, mobile OOM prevention, and conflict resolution logic, you must parse `AGENTS.md` before executing code changes.

## PokeQuantMobile (Expo) Refactors

- **Active Inventory Carousel:** `PokeQuantMobile/src/screens/InventoryScreen.tsx` now renders active inventory as a single-card-per-page horizontal `FlatList` (`horizontal`, `pagingEnabled`, `showsHorizontalScrollIndicator={false}`). The card UI has been extracted into `PokeQuantMobile/src/components/InventoryCard.tsx`.
- **InventoryCard Layout:** `InventoryCard.tsx` uses a `minHeight` of at least `320`, `Image` `resizeMode="contain"`, and `justifyContent: 'space-between'` flex spacing between the card body and action buttons to prevent text/button overlap.
- **Cross-Database Market Velocity:** `PokeQuantMobile/src/db/catalogDb.ts` no longer joins `inventory` inside the catalog database. `getMarketVelocity(catalogDb, productIds)` queries `price_history` for the requested product IDs and returns a `MarketVelocityMap` of `{ delta1d, delta3d, delta7d }`. `InventoryScreen` aggregates these deltas in JavaScript against the active inventory array to compute total portfolio shifts and `VelocityWindow` movers, eliminating the `no such table: inventory` crash.
- **Supabase Auth:** `PokeQuantMobile` authenticates with Supabase Auth. The Supabase client is initialized in `src/api/supabaseClient.ts`, sessions are cached in `expo-secure-store` via `src/api/sessionStorage.ts`, and the active `access_token` is sent as `Authorization: Bearer <token>` to the Cloudflare Worker.
