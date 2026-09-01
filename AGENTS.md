# PokeQuant

PokeQuant is a local-first, offline-capable Progressive Web Application (PWA) and vendor trading terminal engineered for Pokémon TCG market analytics, automated cash offer valuation, and inventory reconciliation.

## System Architecture & Topology

The platform executes natively inside browser WebAssembly (Pyodide via Stlite) on mobile devices while maintaining parity with a desktop Python runtime.

<architecture>
- **Frontend / Core App:** Streamlit UI Layer (`app.py`). Runs locally or inside the browser client thread via Pyodide.
- **Offline Persistence & Hard-Disk Bridge:** Service Worker (`sw.js`). Intercepts custom REST endpoints (`/offline-db/save` and `/offline-db/load`) to read/write persistent JSON payloads directly to an IndexedDB store (`PokeQuantDB`). Serves as a persistent local hard-disk storage across browser reloads.
- **Virtual Database Streaming:** Serves the compressed SQLite database to Pyodide via a `ReadableStream` intercepting `GET /offline-db/mobile_catalog.db`.
- **Edge API Gateway:** Cloudflare Worker (`worker.js`). An edge reverse proxy enforcing tenant header authentication (`X-Beta-Key`), handling Cross-Origin Resource Sharing (CORS), and forwarding batch pipeline requests to Turso.
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
- `inventory`: id (UUID string PK), user_id (tenant key), product_id, purchase_price, sticker_price, date_bought, is_sold, sold_price, date_sold, custom_image_data, is_deleted, updated_at.
- `vendor_settings`: user_id (PK), settings_json, updated_at.
</database_schema>

<data_logic>
- **Primary Keys & Conflict Resolution:** Inventory records use hexadecimal UUID strings (`uuid.uuid4().hex`). Synchronization uses a Last-Write-Wins (LWW) distributed reconciliation model based on Unix timestamps (`updated_at`) and soft-deletion flags (`is_deleted`).
- **Valuation Rules:** Cash offers apply percentage margins against condition-adjusted market prices based on configured bracket tiers. Floor sticker calculations utilize customizable cutoff thresholds to round fractional cents to the nearest dollar.
- **Data Scraping:** Always use `curl_cffi` over standard `requests` to bypass basic bot protection when scraping TCG data or completed eBay listings (`ebay_tool.py`).
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
- **Tenant Isolation Integrity:** Never commit local operations that bypass the `user_id` tenant identifier column. Every `turso_execute_sync` payload must validate the `X-Beta-Key` header.
- **Streamlit Widget Session-State Binding:** Never write to `st.session_state.<key>` after a widget with that `key` has been instantiated in the same script run; it raises `StreamlitAPIException`. To update a widget-bound navigation or selection key programmatically, write the desired value to a separate pending key (e.g., `pending_nav_page`), call `st.rerun()`, and apply the pending value to the widget key at the very top of the next run before the widget is rendered.
- **Streamlit Widget Version Compatibility (Pyodide/Stlite):** The Streamlit wheel bundled with Pyodide/Stlite lags the desktop wheel, so newer widget APIs (e.g., `st.segmented_control(width=...)`) may be missing or unstable. Detect support at import time via `inspect.signature(widget).parameters`, or prefer mature widgets (`st.button`, `st.radio`, `st.selectbox`) for shared navigation and fragment-triggering paths. Provide a robust fallback UI for older runtimes to avoid TypeError and known frontend instabilities.
- **Catalog Hydration & R2 Caching:** The app now hydrates the local catalog autonomously on startup from a public R2 `latest_delta.json` patch. Always use the virtualized `mobile_catalog.db` path inside the browser; `pokemon_tcg.db` is not shipped to the PWA. Append cache-busting query parameters and `Cache-Control` / `pragma` anti-cache headers when fetching live delta data so stale CDN objects are not reused. Upload pipeline artifacts to R2 with explicit `Cache-Control` headers.
- **Cloud Sync Re-entrancy & Login Flow:** After a vendor ID login, the app automatically pulls remote inventory once. A background JavaScript sync-time poller and an in-memory/IndexedDB layered cache feed the sidebar status without blocking on synchronous XHR. Cloud sync (`sync_with_cloud`) and delta application (`apply_daily_catalog_delta`) are guarded by busy flags to prevent re-entrant work. Pending Turso pushes are chunked to reduce network round-trips and GC pressure.
- **Mobile DOM & Rendering Optimizations:** `app.py` uses a Home screen plus a top `st.segmented_control` (with a `st.button` 2x2 fallback on older Pyodide wheels). Active inventory renders as a 2-column CSS grid on narrow screens. Per-card manage popovers are flattened into a conditional manage panel. The Live Spreadsheet Editor is paginated. Buy-tier lists use native `st.number_input` fields instead of `st.data_editor`/grid widgets. Keep the sidebar hamburger visible, sidebar z-index above the lot drawer, and sidebar width responsive (60vw-85vw).
- **Inventory Price Insight Window:** To keep mobile inventory hydration fast, the active inventory view uses a minimal 1/3/7-day price window helper instead of the full 90-day analysis window.
- **Delta Pipeline Memory Hardening:** During `apply_daily_catalog_delta`, aggressively release chunk/batch/list references and call `gc.collect()` between 500-item slices. Restrict internal `_get_price_map` lookups to the last 90 days and truncate Sentry envelope payloads to 2048 characters to reduce mobile heap pressure.
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