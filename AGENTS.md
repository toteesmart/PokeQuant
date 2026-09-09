# PokeQuant

PokeQuant has two tracks:

1. **PokeQuantMobile** (`PokeQuantMobile/`) — the live, shipping product, released on Apple TestFlight as **Card Cache by Totees Mart**. This is the active codebase.
2. **PokeQuant Web / PWA** (repo root `app.py`, `card_tool.py`, `worker.js`, `sw.js`, `index.html`, etc.) — a Streamlit/Pyodide prototype. It is **no longer being maintained or shipped**, but the core files are retained for reference.

> Rule of thumb: if a change only touches the root PWA, do not spend effort on it unless explicitly asked. All active feature work happens in `PokeQuantMobile` and the show-vendor workers.

## Active Product: PokeQuantMobile

The authoritative mobile rules live in `PokeQuantMobile/AGENTS.md` and `PokeQuantMobile/global_rules.md`. The high-level architecture is:

- **Runtime:** Expo SDK 57 / React Native 0.86.3. Custom native clients or EAS builds only; `Expo Go` is not supported.
- **State:** Zustand stores are the single source of truth: `useAuthStore`, `useInventoryStore`, `useVendorStore`, `useProgressStore`, `useCartStore`, `useShowVendorStore`, `useSubscriptionStore`. React Context for global state is obsolete.
- **Local DB:** `expo-sqlite` + `drizzle-orm/expo-sqlite` for the tenant DB (`pokequant.db`: `inventory`, `vendor_settings`, `sync_metadata`, `tour_state`). Raw `expo-sqlite` is used for the read-only catalog DB (`pokequant_catalog.db`) and the event catalog DB (`event_catalog.db`).
- **Drizzle migrations:** `drizzle/migrations.js` registers the migration set; the `split_sync_watermark` migration added `last_pushed_local_updated_at` to `sync_metadata`.
- **Auth:** Supabase client with `persistSession: false`; `expo-secure-store` session cache; `authStore` guards against spurious `SIGNED_OUT` events and supports offline session restoration.
- **Catalog DB self-healing:** `openCatalogDatabase()` in `src/db/catalogDb.ts` validates that `cards` and `price_history` exist and re-downloads the catalog from R2 if not. `downloadLatestMarketPrices()` in `src/services/CatalogDownloadService.ts` closes the old handle, deletes stale WAL/SHM sidecars, validates tables, and re-initializes the Drizzle catalog handle on every swap.
- **Image URL fix:**
  - `src/services/CatalogImageService.ts` parses `product_id` as a base-10 integer, serves a local `catalog_images/{id}.jpg` URI when images have been extracted, and falls back to TCGPlayer CDN `https://tcgplayer-cdn.tcgplayer.com/product/{id}_400w.jpg` otherwise.
  - `getLocalCatalogImageUri(productId)` is used for event/show rows and only returns local extracted images (no CDN).
  - `eventCatalogDb.ts` performs a fuzzy name/set/number lookup against `pokequant_catalog.db` when an event card has no local image, with a minimum confidence score of 150.
- **File system:** All file I/O uses `expo-file-system/next` (`Directory`, `File`, `Paths`).
- **Compression:** Catalog and event ZIPs are extracted with `react-native-zip-archive`. JavaScript unzippers (`fflate`, `jszip`, `pako`) are banned.
- **Lists:** `@shopify/flash-list` v2 with `React.memo()` row components, `useRecyclingState`, no `estimatedItemSize`, and no `key` props on recycled items. Containers must have explicit block dimensions.
- **Sync / edge:** Manual-only. Supabase Auth ES256 JWTs verified in the Cloudflare Worker via Web Crypto (ECDSA + SHA-256). Turso `/v2/pipeline` is reached over `https://`; `libsql://` is forbidden in edge env vars.
- **UUIDs:** Inventory `id` is `TEXT PRIMARY KEY`, a standard UUID with dashes stripped (`expo-crypto.randomUUID().replace(/-/g, '')`). It is not an encrypted hash.
- **LWW:** Remote pulls use `INSERT ... ON CONFLICT(id) DO UPDATE SET ... WHERE excluded.updated_at > inventory.updated_at`.

## Legacy PWA (unmaintained)

The root PWA files (`app.py`, `card_tool.py`, `worker.js`, `sw.js`, `index.html`, `manifest.json`, `requirements.txt`) are a prototype. Do not delete them, but do not refactor, fix, or extend them without explicit approval. Helper scripts and data files around the PWA pipeline have been moved out of the git index and ignored.

## Track 3: Multi-Vendor Show Model

The show system lets vendors publish inventory for a specific event and lets attendees browse it offline.

### Turso Schema

- **`shows`** — `id`, `vendor_id` (organizer's vendor slug), `name`, `start_date`, `location`, `is_active`. `vendor_id` is the show organizer.
- **`vendors`** — `id` (vendor slug), `user_id` (Supabase user id), `name`, `table_default`, `created_at`. The slug is auto-generated from the Supabase username/email.
- **`vendor_show_registrations`** — `(vendor_id, show_id)` composite key with `status` (`pending` | `approved` | `rejected`). Controls which vendors can list inventory in a show.
- **`public_show_inventory`** — `id`, `show_id`, `vendor_id`, `product_id`, `name`, `set_name`, `number`, `rarity`, `condition`, `sticker_price`, `quantity`, `vendor_name`, `vendor_table`. Holds the public-facing, per-vendor, per-show listings.

### Workers

- **`worker_show_vendor.js`** — Deployed as `https://pokequant-vendor.totees-mart.workers.dev`. Authenticated vendor CRUD for show inventory and team subscriptions (`/vendor/team`, `/vendor/team/regenerate-code`, `/vendor/team/rename`, `/vendor/team/redeem`, `/vendor/team/remove`, `/vendor/team/leave`).
  - `GET /vendor/me` — returns/creates the `vendors` row for the JWT subject.
  - `GET /vendor/shows` — active shows the vendor owns or is approved for.
  - `GET /vendor/inventory?show_id=...` — the vendor's own listings for a show.
  - `POST /vendor/inventory` — batch upsert rows into `public_show_inventory`.
  - `POST /vendor/inventory/update` and `POST /vendor/inventory/delete` — edit or delete a row the vendor owns.
  - Access requires the show to be active and the vendor to be the organizer or `approved` in `vendor_show_registrations`.

- **`worker_pre_show.js`** — Deployed as `https://pokequant-pre-show.totees-mart.workers.dev`. Public, fetch-only snapshot worker.
  - `GET /shows` — returns active `shows` metadata.
  - `POST /trigger` — snapshots all active shows.
  - `POST /trigger/{showId}` — snapshots a single show.
  - It queries `public_show_inventory` for the show, sanitizes rows, builds a raw deflate ZIP containing `event_catalog.json`, and uploads it to R2 at `shows/{showId}/event_catalog.json.zip` with `Cache-Control: max-age=0, no-cache, no-store, must-revalidate`.

- **`worker.js`** — The legacy PWA edge gateway. It is unmaintained.

### Offline Event Catalog Flow

1. **Vendor upload:** In `ShowVendorScreen`, the vendor selects inventory, sets `vendor_name` and `vendor_table`, and uploads to `worker_show_vendor.js` (`POST /vendor/inventory`).
2. **Publish snapshot:** The vendor taps **Publish to show catalog**. `showVendorStore` calls `POST /trigger/{showId}` on `worker_pre_show.js`.
3. **R2 artifact:** `worker_pre_show.js` builds `shows/{showId}/event_catalog.json.zip` and uploads it.
4. **Attendee download:** `ShowsScreen` → `EventListScreen` → `EventSearchScreen`. `EventCatalogDownloadService.ts` downloads the per-show ZIP with cache-busting and anti-cache headers, extracts it with `react-native-zip-archive`, and hydrates `event_catalog.db` (`show_inventory` table).
5. **Attendee browse:** `EventSearchScreen` queries `show_inventory` by `show_id` with punctuation-insensitive search, filters, and sort. Images are resolved from the local `catalog_images/` directory; missing images are matched fuzzily against `pokequant_catalog.db` with a minimum score of 150. Never trigger the full image pack download from show screens.

## Critical Cross-Cutting Constraints

- **ES256 JWTs only.** Supabase issues ES256 (ECC P-256) tokens. Workers verify via Web Crypto (`crypto.subtle` + ECDSA + SHA-256) against the Supabase JWKS endpoint, caching the key set for 5 minutes. Never revert to HS256, RS256, or symmetric HMAC.
- **Turso over HTTPS only.** Edge worker Turso URLs must be `https://<db-name>.turso.io`; `libsql://` cannot be resolved by `fetch()`.
- **Native ZIP only.** Never use JavaScript unzippers for catalog or event bundles.
- **No JavaScript unzippers.** `react-native-zip-archive` is the only permitted extraction path.
- **FlashList v2 discipline.** `React.memo()` rows, `useRecyclingState`, no `estimatedItemSize`, no `key` props on recycled row components, and bounded containers.
- **Do not commit secrets.** `.env*`, `AuthKey_*.p8`, `secrets.toml`, tokens, and EAS credentials stay out of the repo and out of the index.
- **Do not trigger image-pack downloads from show screens.** The ~1.8 GB image archive is an explicit choice in `SetupGate` or Settings.

## Tooling Notes

- On Windows use `Set-ExecutionPolicy Bypass -Scope Process -Force` and call `& "C:\Program Files\nodejs\npm.cmd" <command>` when npm scripts are blocked.
- Use single-line commit messages: `git commit -m "..."`.
- Expo Go is deprecated; local runs require a custom native client (`npx expo run:android` / `npx expo run:ios`) or an EAS build because of `react-native-zip-archive` and `react-native-purchases`.
- For full mobile rules, verification commands, and screen/component registry see `PokeQuantMobile/AGENTS.md` and `PokeQuantMobile/global_rules.md`.
