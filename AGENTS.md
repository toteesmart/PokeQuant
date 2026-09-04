# PokeQuant

PokeQuant is a local-first, offline-capable Progressive Web Application (PWA) and vendor trading terminal engineered for Pokémon TCG market analytics, automated cash offer valuation, and inventory reconciliation.

## System Architecture & Topology

The platform executes natively inside browser WebAssembly (Pyodide via Stlite) on mobile devices while maintaining parity with a desktop Python runtime.

<architecture>
- **Frontend / Core App:** Streamlit UI Layer (`app.py`). Runs locally or inside the browser client thread via Pyodide.
- **Offline Persistence & Hard-Disk Bridge:** Service Worker (`sw.js`). Intercepts custom REST endpoints (`/offline-db/save` and `/offline-db/load`) to read/write persistent JSON payloads directly to an IndexedDB store (`PokeQuantDB`). Serves as a persistent local hard-disk storage across browser reloads.
- **Virtual Database Streaming:** Serves the compressed SQLite database to Pyodide via a `ReadableStream` intercepting `GET /offline-db/mobile_catalog.db`.
- **Edge API Gateway:** Cloudflare Worker (`worker.js`). An edge reverse proxy verifying Supabase ES256 JWTs (ECC P-256 asymmetric keys) via the Web Crypto API (ECDSA + SHA-256) against the project JWKS endpoint — the fetched JWKS key set is cached in-memory for 5 minutes — with a legacy `X-Beta-Key` fallback during migration, handling Cross-Origin Resource Sharing (CORS), and forwarding batch pipeline requests to Turso's `/v2/pipeline` endpoint over standard `fetch()` (edge Turso URLs must use the `https://` scheme).
- **Cloud Database:** Turso Cloud SQL (`libsql-client`). Serves multi-tenant inventory tables and settings.
- **Data Collection (Automated ETL):** `daily_delta_pipeline.py`. Runs scheduled scrapers, computes daily price deltas, packages lightweight JSON patches (`latest_delta.json`), and pushes them to Cloudflare R2 storage for on-device catalog hydration.
</architecture>

## Database Schema & Data Logic

The project relies on a highly optimized local SQLite catalog and a multi-tenant Turso cloud schema. Do not modify table schemas without explicitly updating the SQL extraction tools.

<database_schema>
**1. Local Catalog (pokemon_tcg.db / mobile_catalog.db)**
- `cards`: product_id (PK), card_name, card_number, set_name, rarity, image_base64
- `price_history`: product_id, sub_type, date, market_price. PK is (product_id, sub_type, date).
- `latest_prices` (View): Joins cards and price_history to project active pricing.

**2. Multi-Tenant Cloud Store (Turso)**
- `inventory`: id (TEXT/UUID string PK), user_id (TEXT, tenant key), product_id (INTEGER), card_name (TEXT), card_number (TEXT), set_name (TEXT), variant (TEXT), condition (TEXT), purchase_price (REAL), sticker_price (REAL), date_bought (TEXT), is_bulk_deal (INTEGER), is_sold (INTEGER), sold_price (REAL), date_sold (TEXT), custom_image_data (TEXT), is_deleted (INTEGER), updated_at (REAL).
- `vendor_settings`: user_id (PK), settings_json, updated_at.
- `sync_metadata`: user_id (PK), last_updated (REAL).
</database_schema>

<data_logic>
- **Primary Keys & Conflict Resolution:** Inventory records use 32-character hexadecimal UUID strings — standard UUIDs with dashes stripped, generated offline via `expo-crypto.randomUUID().replace(/-/g, '')` in the Expo app and `uuid.uuid4().hex` in the PWA. They are NOT encrypted hashes; the format guarantees collision-free offline row creation. Synchronization uses a Last-Write-Wins (LWW) distributed reconciliation model based on Unix timestamps (`updated_at`) and soft-deletion flags (`is_deleted`).
- **Valuation Rules:** Cash offers apply percentage margins against condition-adjusted market prices based on configured bracket tiers. Floor sticker calculations utilize customizable cutoff thresholds to round fractional cents to the nearest dollar.
- **Data Scraping:** Always use `curl_cffi` over standard `requests` to bypass basic bot protection when scraping TCG data or completed eBay listings (`ebay_tool.py`).
- **Delta Idempotency (VFS Overrides):** Because the Service Worker does not persist Pyodide in-memory VFS changes back to IndexedDB, `mobile_catalog.db` reverts on page reload. `apply_daily_catalog_delta` in `card_tool.py` MUST query the mounted SQLite catalog directly (e.g., `SELECT MAX(date) FROM price_history`) to decide whether a patch is needed, rather than relying exclusively on IndexedDB cache keys.
</data_logic>

## Agent Rules, Boundaries & Constraints

Failure to adhere to these constraints will result in catastrophic failure of the Pyodide WebAssembly runtime or the Cloudflare routing logic.

<agent_rules>
- **WebAssembly Network Execution Lock:** Pyodide runs inside a WebWorker where standard asynchronous Python `asyncio` networking against Javascript `fetch()` promises causes event loop deadlocks during Streamlit script reruns. Cloud synchronization (`card_tool.py`) **must** use synchronous `XMLHttpRequest` via the JS bridging engine (e.g., `req = js.XMLHttpRequest.new(); req.open("POST", endpoint, False)`).
- **Mobile Memory Optimization (OOM Prevention):** Downloading and executing large batch SQL insertions inside Pyodide on low-memory mobile devices causes heap allocations to exceed browser memory limits. When executing bulk inserts (like the daily delta hydration), you must disable SQLite journaling (`PRAGMA journal_mode = OFF`, `PRAGMA synchronous = OFF`), batch operations into 500-item slices, and explicitly invoke Python garbage collection (`gc.collect()`).
- **Offline Asset Caching & Preloading:** Streamlit lazy-loads Javascript and WebAssembly chunks for complex interactive widgets (e.g., `st.date_input`, `st.file_uploader`) only when first displayed on screen. If a user loads the app online and navigates to an unvisited tab while offline, the app will crash. Do not remove the hidden preloader widgets inside `app.py` (rendered with zero dimensions and visibility hidden) as they force Stlite to fetch and cache all supporting UI dependencies during initial startup.
- **Pandas Data Type Casting (Image URL Integrity):** When loading inventory arrays into Pandas DataFrames, integer `product_id` columns containing null values are automatically upcast to floating-point numbers (e.g., `12345.0`). This breaks generated CDN image URLs, returning HTTP 404s. You must explicitly cast product IDs to integers across all UI image render paths (e.g., `int(card['product_id'])`).
- **Pandas Avoidance in UI Hot-Paths:** `app.py` has been refactored to eliminate Pandas from high-frequency Streamlit rendering paths to reduce Pyodide/Stlite memory bloat and rerender lag. The Active Inventory "Floating Cards View", Performance Analytics timeline, Velocity Breakdown table, and Live Spreadsheet Editor must build payloads with native Python (`dict`, `list`, `collections.defaultdict`, standard loops, and the `csv` module). Pandas may still be used for Excel parsing in the Bulk Import wizard and for the required `sys_preload_data_editor` (`st.data_editor(pd.DataFrame({"A": []}), key="sys_preload_data_editor")`) because those depend on DataFrame-specific APIs or are explicitly permitted legacy compatibility points.
- **Punctuation-Agnostic Search Validation:** Database search functionality must remain insensitive to apostrophes, hyphens, and periods (e.g., matching "Farfetch'd" or "M-Gardevoir-EX"). When modifying SQL queries, maintain nested `REPLACE()` string normalization logic.
- **Tenant Isolation Integrity:** Never commit local operations that bypass the `user_id` tenant identifier column. Every `turso_execute_sync` payload must validate the authenticated identity (Supabase `Authorization: Bearer <JWT>` header, with legacy `X-Beta-Key` fallback), and the worker must bind or validate the `user_id` argument against that identity.
- **Edge Cryptography (ES256 JWT Verification):** Supabase issues access tokens signed with ECC P-256 asymmetric keys using the ES256 algorithm. `worker.js` MUST verify them via the Web Crypto API (`crypto.subtle` with ECDSA + SHA-256) against the Supabase JWKS endpoint (`/auth/v1/.well-known/jwks.json`), matching the JWT `kid` header to an `EC`/`P-256` JWK. NEVER revert the worker to HS256, RS256, or symmetric `SUPABASE_JWT_SECRET` HMAC verification. The worker caches the fetched JWKS in-memory for 5 minutes (`JWKS_CACHE_TTL_MS`) so batch Turso syncs do not rate-limit against the Supabase API.
- **Turso Pipeline Protocol (HTTPS Only):** The Cloudflare Worker forwards batch requests to Turso's `/v2/pipeline` endpoint using the standard Web `fetch()` API. Therefore `TURSO_DATABASE_URL` (and any Turso URL configured in edge environment variables) MUST use the `https://` scheme (e.g., `https://<db-name>.turso.io`). NEVER configure `libsql://` URLs in edge worker environment variables — `fetch()` cannot resolve the `libsql://` scheme.
- **Streamlit Widget Session-State Binding:** Never write to `st.session_state.<key>` after a widget with that `key` has been instantiated in the same script run; it raises `StreamlitAPIException`. To update a widget-bound navigation or selection key programmatically, write the desired value to a separate pending key (e.g., `pending_nav_page`), call `st.rerun()`, and apply the pending value to the widget key at the very top of the next run before the widget is rendered.
- **Streamlit Widget Version Compatibility (Pyodide/Stlite):** The Streamlit wheel bundled with Pyodide/Stlite lags the desktop wheel, so newer widget APIs (e.g., `st.segmented_control(width=...)`) may be missing or unstable. Detect support at import time via `inspect.signature(widget).parameters`, or prefer mature widgets (`st.button`, `st.radio`, `st.selectbox`) for shared navigation and fragment-triggering paths. Provide a robust fallback UI for older runtimes to avoid TypeError and known frontend instabilities.
- **Catalog Hydration & R2 Caching:** The app now hydrates the local catalog autonomously on startup from a public R2 `latest_delta.json` patch. Always use the virtualized `mobile_catalog.db` path inside the browser; `pokemon_tcg.db` is not shipped to the PWA. Append cache-busting query parameters and `Cache-Control` / `pragma` anti-cache headers when fetching live delta data so stale CDN objects are not reused. Upload pipeline artifacts to R2 with explicit `Cache-Control` headers.
- **Cloud Sync Re-entrancy & Login Flow:** After a vendor ID login, the app automatically pulls remote inventory once. A background JavaScript sync-time poller and an in-memory/IndexedDB layered cache feed the sidebar status without blocking on synchronous XHR. Cloud sync (`sync_with_cloud`) and delta application (`apply_daily_catalog_delta`) are guarded by busy flags to prevent re-entrant work. Pending Turso pushes are chunked to reduce network round-trips and GC pressure.
- **Mobile DOM & Rendering Optimizations:** `app.py` uses a Home screen plus a top `st.segmented_control` (with a `st.button` 2x2 fallback on older Pyodide wheels). Active inventory renders as a 2-column CSS grid on narrow screens. Per-card manage popovers are flattened into a conditional manage panel. The Live Spreadsheet Editor is paginated. Buy-tier lists use native `st.number_input` fields instead of `st.data_editor`/grid widgets. Keep the sidebar hamburger visible, sidebar z-index above the lot drawer, and sidebar width responsive (60vw-85vw).
- **Inventory Price Insight Window:** To keep mobile inventory hydration fast, the active inventory view uses a minimal 1/3/7-day price window helper instead of the full 90-day analysis window.
- **Delta Pipeline Memory Hardening:** During `apply_daily_catalog_delta`, aggressively release chunk/batch/list references and call `gc.collect()` between 500-item slices. Restrict internal `_get_price_map` lookups to the last 90 days and truncate Sentry envelope payloads to 2048 characters to reduce mobile heap pressure.
- **Pending Sync Queue Parity & Hardening:** `get_pending_syncs` and `_normalize_pending_sync` must validate that SQL placeholder counts match argument counts before mutating statements. Corrupted queue items (e.g. double-appended `beta_key`, shifted argument lists, mismatched placeholders) must be marked and filtered out, not retried forever. `sync_with_cloud` must detect fatal SQLite errors (`datatype mismatch`, `syntax error`, etc.) and, through `app.py`, offer a "Clear Stuck Sync Queue" button that calls `clear_pending_syncs()` to flush the local queue.
- **Turso Inventory `id` Type Migration:** `_ensure_turso_schema` must inspect `pragma_table_info('inventory')` and, if the existing `id` column is `INTEGER PRIMARY KEY` (a rowid alias), recreate the table with `id TEXT PRIMARY KEY` so the UUID hex ids generated by `add_inventory_item` no longer trigger a `datatype mismatch`. Existing data must be preserved via `INSERT ... SELECT CAST(id AS TEXT), ...`.
- **Service Worker & SQLite VFS Mounts:** Pyodide/Emscripten requires a known file size to mount a chunked virtual database. `sw.js` MUST always include a valid `Content-Length` header derived from the `metadata.totalBytes` IndexedDB record when streaming `mobile_catalog.db`.
- **IndexedDB File Buffering (OOM Prevention):** Never accumulate massive file downloads into a single `Uint8Array`. `index.html` must use a pre-allocated, fixed-size buffer (e.g., 10 MB) when chunking the database to prevent O(n²) memory reallocation and heap blowouts on iOS/Android devices.
- **DOM Flattening & Pagination:** Never render unbounded lists in `app.py`. All inventory arrays and logs (Active Inventory, Completed Log) MUST be paginated (e.g., 20-25 items per page).
- **Popover Bans in Loops:** Never place `st.popover` inside a loop (such as search results). Streamlit renders hidden DOM nodes for every popover, causing exponential bloat. Use standard buttons that toggle an `st.session_state` variable to conditionally render a single inline `st.container` panel instead.
- **Pandas & Arrow Avoidance:** Never pass native lists of dictionaries to `st.dataframe` in UI hot-paths (such as the Velocity Breakdown). This forces Streamlit to allocate PyArrow memory, crashing mobile browsers. Use paginated native Streamlit columns or GitHub-flavored Markdown tables (`st.markdown(..., unsafe_allow_html=True)`) for tabular data.
- **Widget State Lifecycle (The "Delete-After-Render" Crash):** Never execute `del st.session_state[key]` for a widget that has already rendered in the current script run. To add/remove dynamic inputs (such as pricing tiers), update a `pending_state` dictionary, call `st.rerun()`, and apply the changes at the top of the script before the inputs are rendered.
- **Static Keys for Navigation:** Do not use dynamic keys (e.g., `key=f"nav_{page}"`) for persistent UI components like `st.segmented_control`. Use static keys (e.g., `key="global_top_nav"`) and `on_change` callbacks to prevent unmounting and loss of internal state.
- **Data Editor Navigation Locks:** Paginated `st.data_editor` instances lose unsaved edits (adds/edits/deletes) upon page turn. You MUST check the session state for the editor key before rendering pagination buttons, and disable the Prev/Next buttons with a warning if unsaved changes exist.
</agent_rules>

## Telemetry & Crash Reporting

All application and runtime crashes — browser, Pyodide WebWorker, and desktop — are sent to Sentry. This layer is intentionally dependency-free to run under Pyodide's WebWorker and desktop Python without adding `sentry-sdk`.

<telemetry>
- **Shared Sentry Bridge:** `card_tool.py` owns `log_to_sentry` and `log_exception_to_sentry`. They build a Sentry envelope and POST it to the ingest endpoint derived from the project DSN. Use these helpers for all explicit error logging.
- **WebAssembly Network Rule (Telemetry):** Inside the Pyodide WebWorker, telemetry must use the same synchronous `js.XMLHttpRequest` bridge as cloud sync (`req.open("POST", url, False)`). Do not switch to `asyncio`/`fetch` because Streamlit reruns will deadlock.
- **Desktop Network Rule (Telemetry):** On desktop, `log_to_sentry` falls back to `urllib.request.urlopen` with a short timeout. Do not import or require `sentry-sdk`.
- **Global Streamlit Exception Hook:** `app.py` patches `streamlit.error_util.handle_uncaught_app_exception` (and the older `streamlit.runtime.scriptrunner.script_runner` location) so any red `stException` / `st.error` box ships the exception + traceback to Sentry before the normal Streamlit UI appears.
- **Browser / PWA Error Capture:** `index.html` initializes Sentry, captures `window.onerror` and `unhandledrejection`, mounts a `MutationObserver` for `data-testid="stException"` and `data-testid="stAlert"` boxes, and listens for `PQ_SW_ERROR` messages from the service worker.
- **Service Worker Forwarding:** `sw.js` has `error` and `unhandledrejection` listeners that post `PQ_SW_ERROR` to controlled browser windows; the main page forwards those to Sentry.
- **Fail-Safe Rule:** Every telemetry call is wrapped in `try/except` and must never throw, block the UI, or become a new source of crashes. Do not remove the hidden preloader widgets in `app.py`; they are unrelated to telemetry but necessary for offline widget stability.
</telemetry>

## Agent Tooling Notes

- **Python Interpreter:** On Windows, invoke Python with the `py` launcher (e.g., `py card_tool.py` or `py -m pip install ...`). The plain `python` command is not reliable in this environment.
- **Git Commit Messages:** Use a single-line message: `git commit -m "message"`. Avoid multi-line Devin-generated signature blocks or `Co-Authored-By` trailers; they cause commit/rebase issues across Devin sessions.

## PokeQuantMobile (Expo) Companion Notes

- **Active Inventory Carousel:** `PokeQuantMobile/src/screens/InventoryScreen.tsx` renders active inventory as a single-card-per-page horizontal `FlatList` (`horizontal`, `pagingEnabled`, `showsHorizontalScrollIndicator={false}`). Card UI has been extracted to `PokeQuantMobile/src/components/InventoryCard.tsx`.
- **InventoryCard Layout:** `PokeQuantMobile/src/components/InventoryCard.tsx` enforces a `minHeight` of at least `320`, uses `Image` `resizeMode="contain"`, and uses `justifyContent: 'space-between'` flex spacing so the image, text/metrics, and action buttons do not overlap.
- **Cross-Database Market Velocity Fix:** `PokeQuantMobile/src/db/catalogDb.ts` no longer joins the local `inventory` table inside the catalog database. `getMarketVelocity(catalogDb, productIds)` queries `price_history` for the requested product IDs and returns a `MarketVelocityMap` of `{ delta1d, delta3d, delta7d }`. `InventoryScreen` aggregates these deltas in JavaScript against the active inventory array to compute total portfolio shifts and `VelocityWindow` movers, fixing the `no such table: inventory` crash.
