# PokeQuant AI Context Map

PokeQuant has two tracks:

- **PokeQuantMobile** (`PokeQuantMobile/`) — the live, shipping product, released on Apple TestFlight as **Card Cache by Totees Mart**. This is the active codebase.
- **PokeQuant Web / PWA** (repo root `app.py`, `card_tool.py`, `worker.js`, `sw.js`, `index.html`) — an unmaintained prototype. Do not spend effort fixing or improving it unless explicitly asked.

## Active Mobile Architecture

- **Runtime:** Expo SDK 57 / React Native 0.86.3.
- **Local DBs:**
  - `pokequant.db` — tenant DB (`expo-sqlite` + Drizzle): `inventory`, `vendor_settings`, `sync_metadata`, `tour_state`.
  - `pokequant_catalog.db` — read-only catalog DB downloaded from R2, queried raw.
  - `event_catalog.db` — per-show public inventory, hydrated from R2 ZIP.
- **State:** Zustand stores only (`useInventoryStore`, `useVendorStore`, `useProgressStore`, `useCartStore`, `useShowVendorStore`). React Context is banned.
- **Sync:** Cloudflare Worker edge proxy verifies Supabase ES256 JWTs and forwards to Turso `/v2/pipeline` over `https://`.
- **File I/O:** `expo-file-system/next` (`Directory`, `File`, `Paths`).
- **Compression:** `react-native-zip-archive` only; no JS unzippers.
- **Lists:** `@shopify/flash-list` v2, `React.memo()` rows, `useRecyclingState`, no `estimatedItemSize`, no `key` props on recycled items, bounded containers.
- **Image URL fix:** `getCatalogImageUri(productId)` parses `product_id` as integer and returns local file URI or TCGPlayer `_400w.jpg` fallback.
- **Catalog self-healing:** `openCatalogDatabase()` validates required tables and re-downloads from R2 if missing.

## Show-Vendor & Pre-Show (Track 3)

- `shows.vendor_id` is the organizer; `vendors.id` is the vendor slug; `vendor_show_registrations` controls access; `public_show_inventory` holds listings.
- `worker_show_vendor.js` (`pokequant-vendor.totees-mart.workers.dev`) — authenticated vendor CRUD.
- `worker_pre_show.js` (`pokequant-pre-show.totees-mart.workers.dev`) — public snapshot worker that builds R2 ZIPs.
- Offline flow: vendor uploads → publish → R2 ZIP → attendee downloads/extracts to `event_catalog.db`.
- Multi-seat team subscriptions are live: `teams`/`team_members` tables, `/vendor/team/*` routes, and `PricingPreview`/`SettingsScreen` team UI.

## Critical Constraints

- ES256 JWT verification only; never HS256/RS256/symmetric HMAC.
- Turso URLs in edge env must be `https://`; `libsql://` is forbidden.
- Native zip extraction only (`react-native-zip-archive`).
- No JavaScript unzippers (`fflate`, `jszip`, `pako`).
- No `Expo Go`; use custom native clients or EAS builds.
- Do not commit secrets (`.env*`, `*.p8`, `secrets.toml`, tokens).
- For full mobile rules see `PokeQuantMobile/AGENTS.md` and `PokeQuantMobile/global_rules.md`.
- For multi-vendor show details see `AGENTS.md`.
