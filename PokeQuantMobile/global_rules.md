# PokeQuantMobile Global Architecture & Topology

PokeQuantMobile is the live, offline-first Expo / React Native product released on Apple TestFlight as **Card Cache by Totees Mart**. The repo root Streamlit/Pyodide PWA is an unmaintained prototype.

## Release Identity

- App name: **Card Cache by Totees Mart**.
- Expo owner: `toteesmart`.
- iOS bundle ID: `com.toteesmart.PokeQuantMobile`.
- `eas.json` production submit profile targets App Store Connect `ascAppId` `6808830780` with `AuthKey_4CGR6RY3XZ.p8`.
- Do not change `app.json` name/owner or `eas.json` submit config without an explicit release-planning reason.

## Headless Data Topology

1. **Tenant DB (`pokequant.db`)**
   - `expo-sqlite` + `drizzle-orm/expo-sqlite`.
   - Tables: `inventory`, `vendor_settings`, `sync_metadata`, `tour_state`.
2. **Catalog DB (`pokequant_catalog.db`)**
   - Pre-built SQLite file downloaded from R2.
   - Queried through raw `expo-sqlite` in `src/db/catalogDb.ts`.
   - `openCatalogDatabase()` validates `cards` and `price_history` and re-downloads if the file is corrupt or missing.
3. **Event Catalog DB (`event_catalog.db`)**
   - Raw SQLite file for per-show public inventory.
   - Hydrated by `EventCatalogDownloadService.ts` from R2 ZIP snapshots.
4. **Supabase Auth**
   - `src/api/supabaseClient.ts` and `src/api/sessionStorage.ts` for the client and secure token storage.
   - `AuthContext.tsx` mirrors the session lifecycle.
5. **Cloud Sync**
   - `src/api/cloudSync.ts` talks to `https://pokequant.totees-mart.workers.dev` (inventory sync) and `https://pokequant-vendor.totees-mart.workers.dev` (show inventory).
   - ES256 JWT verification in the worker; JWKS cached for 5 minutes.
   - Turso `/v2/pipeline` over `https://`; never `libsql://`.
6. **State Layer**
   - Zustand stores: `useInventoryStore`, `useVendorStore`, `useProgressStore`, `useCartStore`, `useShowVendorStore`.
   - Components call store actions; stores coordinate DB writes and network sync.
   - React Context for global state is obsolete.

## Core Constraints

- **Native zip only:** `react-native-zip-archive` for catalog and event bundles. No `fflate`, `jszip`, `pako`.
- **File I/O:** `expo-file-system/next` (`Directory`, `File`, `Paths`); delete stale WAL/SHM sidecars before catalog swaps.
- **FlashList v2:** `@shopify/flash-list`, no `estimatedItemSize`, `React.memo()` rows, `useRecyclingState`, no `key` props on recycled items, explicit container dimensions.
- **UUIDs:** `id TEXT PRIMARY KEY`, `expo-crypto.randomUUID().replace(/-/g, '')`.
- **LWW sync:** `INSERT ... ON CONFLICT(id) DO UPDATE SET ... WHERE excluded.updated_at > inventory.updated_at`.
- **Image URLs:** `getCatalogImageUri(productId)` parses `product_id` as an integer and returns a local file URI or TCGPlayer `_400w.jpg` CDN URL. Use it for every image.
- **No Expo Go:** custom native clients or EAS builds only.
- **Do not commit secrets.** `.env*`, `*.p8`, `secrets.toml`, tokens, and EAS credentials are gitignored and must stay out of the index.

## Track 3: Show-Vendor & Offline Event Catalog

- **Vendor upload:** `ShowVendorScreen` → `useShowVendorStore` → `showVendorService.ts` → `worker_show_vendor.js` `POST /vendor/inventory`.
- **Publish snapshot:** `showVendorService.triggerShowSnapshot()` → `worker_pre_show.js` `POST /trigger/{showId}`.
- **R2 artifact:** `shows/{showId}/event_catalog.json.zip` (raw deflate ZIP of `event_catalog.json`).
- **Attendee download:** `ShowsScreen` → `EventListScreen` → `EventSearchScreen` → `EventCatalogDownloadService.ts` extracts to `event_catalog.db`.
- **Show model:** `shows.vendor_id` is the organizer; `vendors.id` is the vendor slug; `vendor_show_registrations` controls access; `public_show_inventory` holds listings.

## File Registry

- `src/api/*` — Supabase, session, sync.
- `src/db/database.ts`, `src/db/inventoryDb.ts`, `src/db/catalogDb.ts`, `src/db/eventCatalogDb.ts`, `src/db/schema.ts`.
- `src/store/*` — Zustand stores, including `showVendorStore.ts`.
- `src/services/CatalogDownloadService.ts`, `CatalogImageService.ts`, `EventCatalogDownloadService.ts`, `ShowListService.ts`, `showVendorService.ts`.
- `src/screens/ShowVendorScreen.tsx`, `ShowsScreen.tsx`, `EventListScreen.tsx`, `EventSearchScreen.tsx`.
- `src/components/EventSearchCard.tsx`, `ShowVendorInventoryRow.tsx`, `ShowVendorListingRow.tsx`, `PricingPreview.tsx`, `SubscriptionGate.tsx`.
- `src/screens/SettingsScreen.tsx`, `ShowVendorScreen.tsx`, `ShowsScreen.tsx`, `EventListScreen.tsx`, `EventSearchScreen.tsx`.
- `worker_show_vendor.js` + `wrangler.show_vendor.jsonc`, `worker_pre_show.js` + `wrangler.pre_show.jsonc`.

## Team Subscriptions & Founder Model

- `vendors.is_founder` and `vendors.founder_seat_number` enforce the first-50 founder seats. New `vendors` rows claim the next open seat automatically while seats remain; `founder_seat_number` is permanent and `is_founder` is restored on resubscribe.
- `teams` and `team_members` tables support multi-seat plans. `worker_show_vendor.js` exposes `GET/POST /vendor/team/*` routes, including `POST /vendor/team/rename`. `recalculateTeamSeats` sums active team products and updates `seats_total`; `formatTeam` returns `name`, `owner_name`, and a numbered `members` roster for both owners and teammates.
- `PricingPreview` gates plans by active product, founder eligibility, and active team ownership for the extra-seat product. `SettingsScreen` shows the Team card in all modes, lets owners rename the team and remove members, and displays a roster (`Owner:`, `Team member 1:`, etc.).
