# PokeQuantMobile Agent Rules

PokeQuantMobile is the live, offline-first Expo / React Native product released on Apple TestFlight as **Card Cache by Totees Mart**. The repo root Streamlit/Pyodide PWA is a prototype and is no longer being maintained; active work stays in this directory and the show-vendor workers.

## Core Database & Sync Engineering

- **SQLite engine:** All local persistence uses `expo-sqlite`.
  - `pokequant.db` (tenant DB) is managed with `drizzle-orm/expo-sqlite` and contains `inventory`, `vendor_settings`, `sync_metadata`, `tour_state`.
  - `pokequant_catalog.db` (catalog DB) is a pre-built read-only SQLite file downloaded from R2 and queried through raw `expo-sqlite` APIs in `src/db/catalogDb.ts`. Do not run Drizzle Kit or migrations against it.
  - `event_catalog.db` (show DB) is a raw SQLite file for per-show public inventory, managed in `src/db/eventCatalogDb.ts`.
- **Catalog DB self-healing:** `openCatalogDatabase()` validates that `cards` and `price_history` exist and re-downloads the catalog if they do not. `downloadLatestMarketPrices()` closes the active handle, deletes stale `-wal`/`-shm` sidecars, downloads a fresh catalog, and re-initializes the Drizzle catalog handle before returning.
- **UUID schema constraint:** Local and cloud `inventory` use `id TEXT PRIMARY KEY`. Generate IDs with `expo-crypto.randomUUID().replace(/-/g, '')`. They are standard UUIDs with dashes stripped, not encrypted hashes. Never use `INTEGER PRIMARY KEY` rowid aliases.
- **Type-safe sync coercion:** Turso edge JSON is normalized through `coerceInventoryRow()` and the Drizzle schema.
  - Booleans (`is_sold`, `is_deleted`, `is_bulk_deal`) use `integer({ mode: 'boolean' })`.
  - `product_id` is parsed with `Number.parseInt(String(val), 10)` and is `null` when missing or zero.
  - Prices are parsed with `Number()` and default to `0.0`.
- **LWW resolution:** Remote pulls use `INSERT ... ON CONFLICT(id) DO UPDATE SET ... WHERE excluded.updated_at > inventory.updated_at`.
- **Pushing local changes:** Query `SELECT * FROM inventory WHERE updated_at > (SELECT last_updated FROM sync_metadata LIMIT 1)`, chunk into `SYNC_BATCH_SIZE = 500`, and send `INSERT OR REPLACE` payloads to the worker.
- **Edge cryptography (ES256):** Supabase issues ES256 (ECC P-256) tokens. The Cloudflare Worker verifies them via Web Crypto (ECDSA + SHA-256) against the Supabase JWKS endpoint and caches the key set for 5 minutes. Never revert to HS256, RS256, or symmetric HMAC.
- **Turso pipeline (HTTPS only):** The worker calls Turso's `/v2/pipeline` over `fetch()`. Edge `TURSO_DATABASE_URL` must use `https://`; `libsql://` cannot be resolved.
- **Native extraction:** Catalog and event ZIPs must be extracted with `react-native-zip-archive`. JavaScript unzippers (`fflate`, `jszip`, `pako`) are banned.

## State Management (Zustand)

React Context is obsolete. All global state lives in Zustand stores:

- `src/store/inventoryStore.ts` (`useInventoryStore`) — active inventory, completed sales, sync status, pending sync count, cloud sync actions.
- `src/store/vendorStore.ts` (`useVendorStore`) — vendor settings, buy tiers, sticker rules, cash/sticker offer helpers.
- `src/store/progressStore.ts` (`useProgressStore`) — catalog DB download, image ZIP download/extraction, event catalog download/extraction, `catalogLastUpdated`.
- `src/store/cartStore.ts` (`useCartStore`) — lot cart, totals, drawer visibility.
- `src/store/showVendorStore.ts` (`useShowVendorStore`) — vendor profile, show access, show setup (vendor name/table), card selections, listings, upload/publish state.

Components subscribe through granular selectors and call store actions. The stores coordinate database writes and network sync; do not call the DB directly from components.

## High-Performance Rendering

- Use `@shopify/flash-list` v2 for any unbounded or image-heavy list.
- Do **not** pass `estimatedItemSize`.
- Wrap rendered rows in `React.memo()`.
- Use `useRecyclingState` from `@shopify/flash-list` for per-item UI state.
- Do **not** put a `key` prop on recycled item components.
- Lists must live in a container with explicit block dimensions (`flex: 1` or rigid `height`).
- Follow the UI Integrity Protocol: containers need explicit height, `minHeight`, or properly bounded flex. Never use `position: 'absolute'` inside a flex grid unless overriding a zero-height collapse.

## Catalog & Image Handling

- `CatalogDownloadService.ts` downloads `mobile_catalog.db` from R2 into `pokequant_catalog.db` in the `expo-file-system` `SQLite` documents directory.
- `CatalogImageService.ts` downloads `catalog_images.zip` from R2, deletes stale files, extracts with `react-native-zip-archive`, and writes a `catalog_images.ready` marker.
- **Image URL fix:** `getCatalogImageUri(productId)` parses `product_id` as a base-10 integer. If `catalog_images.ready` exists and `catalog_images/{productId}.jpg` is present, it returns the local file URI; otherwise it falls back to `https://tcgplayer-cdn.tcgplayer.com/product/{productId}_400w.jpg`. Use this helper everywhere an image is rendered; do not pass raw strings or uncast IDs.
- `SearchBuyScreen` auto-initiates `ensureCatalogDownloaded()` when the catalog is missing.
- `SettingsScreen` exposes `downloadLatestMarketPrices()` to refresh market data. This swaps only `pokequant_catalog.db`; it never touches the image archive.
- `SettingsScreen` also exposes "Download Offline Images" → `ensureCatalogImagesDownloaded()` for users who skipped the pack during setup.
- All catalog requests use cache-busting query parameters and `Cache-Control: no-cache, no-store, must-revalidate` / `Pragma: no-cache` headers.
- Catalog downloads are coalesced through a shared `catalogDownloadPromise` in `CatalogDownloadService.ts` — concurrent `ensureCatalogDownloaded()`/`downloadLatestMarketPrices()` calls join one in-flight download instead of racing over a mid-replacement file.

## Startup Setup Gate

`src/components/SetupGate.tsx` wraps `AppNavigator` in `App.tsx` after auth. Before any screen renders it must: (1) verify/download the catalog DB, (2) warm the extracted-image index via `warmCatalogImageIndex()` — which reads `catalog_images.manifest` (written at extraction time) as a fast path and otherwise scans the directory — and (3) if `catalog_images.ready` is absent, offer the ~1.8 GB offline image pack as an explicit, skippable step. All state is device-scoped and idempotent, so returning launches and re-logins pass through in milliseconds. Do not move image-index warming back onto per-screen lazy paths.

## Track 3: Show-Vendor & Pre-Show Catalog

### Vendor flow

- `ShowVendorScreen` uses `useShowVendorStore`.
- It has two tabs: **Select Cards** (picks from active inventory with search) and **My Listings** (shows already-uploaded rows).
- Vendor enters `vendor_name` and `vendor_table`; the defaults come from `useShowVendorStore.profile`.
- **Upload to show** calls `showVendorService.uploadShowInventory()` → `worker_show_vendor.js` `POST /vendor/inventory`.
- **Publish to show catalog** calls `showVendorService.triggerShowSnapshot()` → `worker_pre_show.js` `POST /trigger/{showId`.

### Pre-show worker snapshot

- `worker_pre_show.js` (`https://pokequant-pre-show.totees-mart.workers.dev`) is public and fetch-only.
- `GET /shows` returns active shows metadata.
- `POST /trigger` and `POST /trigger/{showId}` query `shows` and `public_show_inventory`, sanitize rows, build a raw deflate ZIP of `event_catalog.json`, and upload to R2 at `shows/{showId}/event_catalog.json.zip`.

### Attendee flow

- `ShowsScreen` → `EventListScreen` → `EventSearchScreen`.
- `ShowListService.ts` fetches `GET /shows`, caches in `AsyncStorage`, and falls back to `src/constants/shows.ts`.
- `EventCatalogDownloadService.ts` downloads the per-show ZIP, extracts with `react-native-zip-archive`, and hydrates `event_catalog.db` (`show_inventory` table).
- `EventSearchScreen` uses a horizontal paged `FlashList` with 2x2 layout, punctuation-insensitive search, filters (vendor, set, rarity, condition, price), and sort.
- `EventSearchCard` displays image, name, number, set, rarity, condition, vendor/table, quantity, and sticker price.
- **Show browsing is strictly local-only for images.** Event rows resolve images via `getLocalCatalogImageUri()` (extracted `catalog_images/` only — never the CDN), and the fuzzy `attachEventImages()` fallback in `eventCatalogDb.ts` only binds when the catalog match is high-confidence (score ≥ 150: exact normalized name + exact card number, or exact name + exact set). Missing/uncertain matches render the name placeholder — a blank image is better than a wrong or online image.
- Never kick `ensureCatalogImagesDownloaded()` from show screens; the image archive is an explicit choice in the setup gate or Settings.

### Multi-vendor model

- `shows.vendor_id` is the organizer's vendor slug.
- `vendors.id` is the vendor slug (auto-generated from username).
- `vendor_show_registrations` controls access with `pending` / `approved` / `rejected`.
- `public_show_inventory` holds per-vendor, per-show listings.
- `worker_show_vendor.js` enforces that only the show owner or an approved vendor can read/write listings, and only the owning vendor can update/delete a row.

## File & Worker Registry

- `src/api/supabaseClient.ts` — Supabase client.
- `src/api/sessionStorage.ts` — `expo-secure-store` session cache.
- `src/api/cloudSync.ts` — Turso edge sync engine.
- `src/db/database.ts` — tenant SQLite init and Drizzle.
- `src/db/inventoryDb.ts` — headless CRUD for `inventory`.
- `src/db/catalogDb.ts` — catalog DB queries, market velocity, and self-healing.
- `src/db/eventCatalogDb.ts` — raw SQLite for per-show event inventory.
- `src/db/schema.ts` — Drizzle schema for `pokequant.db`.
- `src/store/*` — Zustand stores.
- `src/services/CatalogDownloadService.ts` — catalog DB download.
- `src/services/CatalogImageService.ts` — image ZIP download and native extraction.
- `src/services/EventCatalogDownloadService.ts` — per-show event catalog download and extraction.
- `src/services/ShowListService.ts` — active show list.
- `src/services/showVendorService.ts` — vendor inventory CRUD worker client.
- `src/screens/ShowVendorScreen.tsx` — vendor upload/publish UI.
- `src/screens/ShowsScreen.tsx`, `src/screens/EventListScreen.tsx`, `src/screens/EventSearchScreen.tsx` — attendee show browsing.
- `src/components/ShowVendorInventoryRow.tsx`, `src/components/ShowVendorListingRow.tsx`, `src/components/EventSearchCard.tsx`.
- `worker_show_vendor.js` and `wrangler.show_vendor.jsonc` — vendor CRUD worker.
- `worker_pre_show.js` and `wrangler.pre_show.jsonc` — pre-show snapshot worker.

## Tooling & Stability Constraints

- **Terminal (Windows):** `Set-ExecutionPolicy Bypass -Scope Process -Force` and use `& "C:\Program Files\nodejs\npm.cmd" <command>` when PowerShell blocks npm.
- **Git commits:** single-line messages only: `git commit -m "..."`.
- **Expo Go is deprecated.** Local runs require a custom native client (`npx expo run:android` / `npx expo run:ios`) or an EAS build because of `react-native-zip-archive`.
- **Do not reintroduce React Context** for global state; use Zustand.
- **Do not use JavaScript unzippers** for catalog or event assets.
- **Do not pass `estimatedItemSize`** to `FlashList` v2.
- **Do not render unbounded lists;** all list containers need explicit block dimensions.
- **All future analytics/charts** must source data from `pokequant.db` / Zustand, not the network.
- **Do not commit secrets.** `.env*`, `AuthKey_*.p8`, `secrets.toml`, EAS creds, and tokens are gitignored and must never be in the index.

## Verification Commands

Run these from `PokeQuantMobile/` before committing changes:

- `npx tsc --noEmit` — TypeScript type check.
- `npx jest` — Jest unit-test suite.
- `npx expo-doctor` — Expo SDK dependency / environment validation.
