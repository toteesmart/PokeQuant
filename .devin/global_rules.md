# PokeQuant AI Context Map

PokeQuant is a local-first, offline-capable Progressive Web Application (PWA) and vendor trading terminal for the Pokémon TCG. It is engineered to execute natively inside browser WebAssembly (Pyodide via Stlite) on mobile devices.

## Core Architecture
- **Frontend/Runtime:** Python (Streamlit) compiled to WebAssembly running in client browser threads.
- **Offline Storage (Hard-Disk Bridge):** Local SQLite catalogs and IndexedDB chunking managed by a custom Service Worker REST bridge.
- **Cloud Sync:** Multi-tenant Turso (LibSQL) database routed securely through a Cloudflare Worker edge proxy.
- **Data ETL:** GitHub Actions pipeline pushing lightweight JSON price deltas to Cloudflare R2.

## File Registry & Component Map
- `app.py`: Primary Streamlit UI, point-of-sale terminal, and PWA entry point. Installs a patched `streamlit.error_util` global exception hook so red error boxes are reported to Sentry.
- `card_tool.py`: Core analytical engine, offline SQLite search, buy offer logic, synchronous Turso REST sync pipeline, and shared Sentry envelope sender (`log_to_sentry` / `log_exception_to_sentry`) for browser and desktop.
- `sw.js`: Service worker handling offline caching, IndexedDB bridging (`/offline-db/save`), virtual SQLite streaming, and worker crash forwarding (`PQ_SW_ERROR`).
- `worker.js`: Cloudflare Edge proxy validating `X-Beta-Key` tenant headers and relaying LibSQL pipelines.
- `index.html`: PWA bootstrap, Sentry browser SDK init, DOM observer for Streamlit error boxes, and main-thread error handlers.
- `build_mobile_db.py`: Compresses SQLite catalogs and embeds Base64 thumbnails to fit mobile memory constraints.
- `daily_delta_pipeline.py` & `tcg_scraper.py`: Automated CI/CD market scrapers and R2 JSON patch generators.
- `chat_engine.py` & `ebay_tool.py`: Gemini AI valuation assistant and `curl_cffi` anti-bot eBay scraper.

## Technical Stack
- **Languages:** Python 3, JavaScript, SQL
- **Environment:** Stlite / Pyodide (Browser WebWorkers)
- **Databases:** SQLite (Local VFS), Turso LibSQL (Cloud)
- **Key Libraries:** `beautifulsoup4`, `curl_cffi`, `openpyxl`, `google-genai`, `boto3`

**CRITICAL:** For strict coding rules regarding Pyodide WebWorker networking limitations, mobile OOM prevention, and conflict resolution logic, you must parse `AGENTS.md` before executing code changes.