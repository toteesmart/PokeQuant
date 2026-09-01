# PokeQuant AI Context Map

PokeQuant is a local-first, offline-capable Progressive Web Application (PWA) and vendor trading terminal for the Pokémon TCG. It is engineered to execute natively inside browser WebAssembly (Pyodide via Stlite) on mobile devices.

## Core Architecture
- **Frontend/Runtime:** Python (Streamlit) compiled to WebAssembly running in client browser threads.
- **Streamlit UI State Binding:** Widgets with `key="..."` are bound to `st.session_state`. Never write to that key after the widget has been rendered in the same run; use a pending-state indirection and apply it before the widget on the next run.
- **Widget Version Parity:** The Pyodide/Stlite Streamlit wheel lags the desktop wheel. Detect new widget parameters at import time and provide mature-widget fallbacks for navigation/fragment controls; do not assume new APIs like `st.segmented_control(width=...)` are stable in the browser.
- **Offline Storage (Hard-Disk Bridge):** Local SQLite catalogs and IndexedDB chunking managed by a custom Service Worker REST bridge.
- **Cloud Sync:** Multi-tenant Turso (LibSQL) database routed securely through a Cloudflare Worker edge proxy.
- **Data ETL:** GitHub Actions pipeline pushing lightweight JSON price deltas to Cloudflare R2.
- **Autonomous Catalog Hydration:** On startup the app downloads the latest delta patch from a public R2 URL and applies it to the local `mobile_catalog.db`; the browser path is always `mobile_catalog.db` (the service worker virtualizes it). Requests use cache-busting query parameters and anti-cache headers to avoid stale CDN objects.
- **Cloud Sync Layering:** Automatic inventory pull after login, a background JavaScript sync-time poller, an in-memory/IndexedDB cache, and busy-flag guards on `sync_with_cloud` / `apply_daily_catalog_delta` prevent blocking UI threads and re-entrant sync. Pending Turso pushes are chunked to reduce round-trips.
- **Mobile UI Rendering:** `app.py` uses a Home screen plus a top module navigator. Active inventory renders as a responsive 2-column grid with a `st.segmented_control` top nav (falling back to a 2x2 `st.button` grid on older Pyodide wheels). Per-card popovers are flattened into a conditional manage panel, the spreadsheet editor is paginated, and buy-tier lists use native `st.number_input` fields.
- **Pandas Avoidance in UI Hot-Paths:** `app.py` UI rendering paths (Active Inventory grouping, Performance Analytics, Velocity/Spreadsheet) now use native Python data structures instead of Pandas DataFrames to avoid Pyodide/Stlite mobile memory bloat. Pandas remains only for the Bulk Import Excel wizard and the `sys_preload_data_editor` preloader.

## File Registry & Component Map
- `app.py`: Primary Streamlit UI, point-of-sale terminal, and PWA entry point. Renders a Home screen, top module navigator (`st.segmented_control` with a `st.button` fallback), responsive 2-column inventory grid, paginated live spreadsheet, conditional per-card manage panels, and native buy-tier number inputs. Installs a patched `streamlit.error_util` global exception hook so red error boxes are reported to Sentry.
- `card_tool.py`: Core analytical engine, offline SQLite search, buy offer logic, synchronous Turso REST sync pipeline, shared Sentry envelope sender (`log_to_sentry` / `log_exception_to_sentry`), autonomous R2 delta/catalog hydration, background sync-time poller support, lightweight 1/3/7-day inventory price insights, and delta pipeline memory hardening (chunked GC, 90-day `_get_price_map` window, truncated Sentry envelopes) for browser and desktop.
- `sw.js`: Service worker handling offline caching, IndexedDB bridging (`/offline-db/save`), virtual SQLite streaming for `mobile_catalog.db`, cache-bypass for live delta requests, and worker crash forwarding (`PQ_SW_ERROR`).
- `worker.js`: Cloudflare Edge proxy validating `X-Beta-Key` tenant headers and relaying LibSQL pipelines.
- `index.html`: PWA bootstrap, Sentry browser SDK init, DOM observer for Streamlit error boxes, main-thread error handlers, and background sync-time poller registration.
- `build_mobile_db.py`: Compresses SQLite catalogs and embeds Base64 thumbnails to fit mobile memory constraints.
- `daily_delta_pipeline.py` & `tcg_scraper.py`: Automated CI/CD market scrapers and R2 JSON patch generators. Delta uploads set `Cache-Control` headers and the pipeline uses `curl_cffi` for bot-resistant scraping.
- `chat_engine.py` & `ebay_tool.py`: Gemini AI valuation assistant and `curl_cffi` anti-bot eBay scraper.

## Technical Stack
- **Languages:** Python 3, JavaScript, SQL
- **Environment:** Stlite / Pyodide (Browser WebWorkers)
- **Databases:** SQLite (Local VFS), Turso LibSQL (Cloud)
- **Key Libraries:** `beautifulsoup4`, `curl_cffi`, `openpyxl`, `google-genai`, `boto3`

## Critical Cloud-Sync & Schema Constraints

- **Sync Queue Parity:** `card_tool.py` validates SQL placeholder/argument counts in `_normalize_pending_sync`. Corrupted queue items are dropped and the UI exposes a `Clear Stuck Sync Queue` fallback via `clear_pending_syncs()`.
- **Turso `inventory.id` Migration:** The cloud `inventory` table must use `id TEXT PRIMARY KEY` to accept the UUID hex strings produced by `uuid.uuid4().hex`. `_ensure_turso_schema` recreates the table if it finds a legacy `INTEGER PRIMARY KEY` rowid-alias column, preserving existing rows.
- **Sync Failure Recovery:** Fatal SQLite errors (`datatype mismatch`, `syntax error`, `wrong number of arguments`, etc.) from `sync_with_cloud` set `st.session_state._pq_sync_fatal_error` and log to Sentry. The sync pipeline does not auto-flush the queue unless the user explicitly clears it.

**CRITICAL:** For strict coding rules regarding Pyodide WebWorker networking limitations, mobile OOM prevention, and conflict resolution logic, you must parse `AGENTS.md` before executing code changes.