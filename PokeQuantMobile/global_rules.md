# PokeQuantMobile Global Architecture & Topology

PokeQuantMobile is the live, offline-first Expo / React Native product released on Apple TestFlight as **Card Cache by Totees Mart**. The repo root Streamlit/Pyodide PWA is an unmaintained prototype.

## Release Identity

- App name: **Card Cache**.
- Expo owner: `toteesmart`.
- iOS bundle ID: `com.toteesmart.PokeQuantMobile`.
- Android package: `com.toteesmart.PokeQuantMobile`.
- `eas.json` production submit profile targets App Store Connect `ascAppId` `6808830780` with `AuthKey_4CGR6RY3XZ.p8`.
- Do not change `app.json` name/owner or `eas.json` submit config without an explicit release-planning reason.

## Headless Data Topology

1. **Tenant DB (`pokequant.db`)**
   - `expo-sqlite` + `drizzle-orm/expo-sqlite`.
   - Tables: `inventory`, `vendor_settings`, `sync_metadata`, `tour_state`.
   - Migrations live in `drizzle/` and are registered in `drizzle/migrations.js`.
2. **Catalog DB (`pokequant_catalog.db`)**
   - Pre-built SQLite file downloaded from R2.
   - Queried through raw `expo-sqlite` in `src/db/catalogDb.ts`.
   - `openCatalogDatabase()` validates `cards` and `price_history` and re-downloads if the file is corrupt or missing.
3. **Event Catalog DB (`event_catalog.db`)**
   - Raw SQLite file for per-show public inventory.
   - Hydrated by `EventCatalogDownloadService.ts` from R2 ZIP snapshots.
4. **Supabase Auth**
   - `src/api/supabaseClient.ts` and `src/api/sessionStorage.ts` for the client and secure token storage.
   - `authStore.ts` mirrors the session lifecycle and guards against spurious `SIGNED_OUT` events.
5. **Cloud Sync**
   - `src/api/cloudSync.ts` talks to `https://pokequant.totees-mart.workers.dev` (inventory sync) and `https://pokequant-vendor.totees-mart.workers.dev` (show inventory/team).
   - Manual sync only; auto foreground/mutation sync was removed to eliminate UI freezes.
- `last_pushed_local_updated_at` advances on every successful pull to the maximum pulled `updated_at`, so pulled rows (including soft-deleted history) are not counted as local pending changes.
   - ES256 JWT verification in the worker; JWKS cached for 5 minutes.
   - Turso `/v2/pipeline` over `https://`; never `libsql://`.
6. **State Layer**
   - Zustand stores: `useAuthStore`, `useInventoryStore`, `useVendorStore`, `useProgressStore`, `useCartStore`, `useShowVendorStore`, `useSubscriptionStore`.
   - Components call store actions; stores coordinate DB writes and network sync.
   - React Context for global state is obsolete.

## Core Constraints

- **Native zip only:** `react-native-zip-archive` for catalog and event bundles. No `fflate`, `jszip`, `pako`.
- **File I/O:** `expo-file-system/next` (`Directory`, `File`, `Paths`); delete stale WAL/SHM sidecars before catalog swaps.
- **FlashList v2:** `@shopify/flash-list`, no `estimatedItemSize`, `React.memo()` rows, `useRecyclingState`, no `key` props on recycled items, explicit container dimensions.
- **UUIDs:** `id TEXT PRIMARY KEY`, `expo-crypto.randomUUID().replace(/-/g, '')`.
- **LWW sync:** `INSERT ... ON CONFLICT(id) DO UPDATE SET ... WHERE excluded.updated_at > inventory.updated_at`.
- **Image URLs:**
  - `getCatalogImageUri(productId)` for general use: local extracted image or TCGPlayer `_400w.jpg` CDN.
  - `getLocalCatalogImageUri(productId)` for show/event rows: local extracted only, no CDN.
  - Use `expo-image` with `cachePolicy="memory-disk"`.
- **No Expo Go:** custom native clients or EAS builds only.
- **Do not commit secrets.** `.env*`, `*.p8`, `secrets.toml`, tokens, and EAS credentials are gitignored and must stay out of the index.

## Track 3: Show-Vendor & Offline Event Catalog

- **Vendor gating:** `showVendorStore.canUseVendorFeatures()` is true when `paymentsLive` is false, or the user has `isVendor`, `isTeamMember`, or RevenueCat `Cardcache_pro` entitlement. `isFounder` is a founder seat/discount label and does not grant access without an active subscription or active team membership.
- **Vendor upload:** `ShowVendorScreen` → `useShowVendorStore` → `showVendorService.ts` → `worker_show_vendor.js` `POST /vendor/inventory`.
- **Publish snapshot:** `showVendorService.triggerShowSnapshot()` → `worker_pre_show.js` `POST /trigger/{showId}`.
- **R2 artifact:** `shows/{showId}/event_catalog.json.zip` (raw deflate ZIP of `event_catalog.json`).
- **Attendee download:** `ShowsScreen` → `EventListScreen` → `EventSearchScreen` → `EventCatalogDownloadService.ts` extracts to `event_catalog.db`.
- **Show images:** Strictly local `catalog_images/` only. Fuzzy `attachEventImages()` only binds at score ≥ 150.
- **Show list:** `ShowListService.ts` fetches live shows, caches in `AsyncStorage`, and falls back to `src/constants/shows.ts`.
- **Show model:** `shows.vendor_id` is the organizer; `vendors.id` is the vendor slug; `vendor_show_registrations` controls access; `public_show_inventory` holds listings.

## Subscription & RevenueCat

- **Public keys:** `app.json` `extra.revenuecat` (iOS public key present, Android placeholder). `getRevenueCatApiKey()` prefers `EXPO_PUBLIC_REVENUECAT_*_API_KEY`, then `Constants.expoConfig.extra`.
- **Entitlement:** `Cardcache_pro`. Offerings: `founders`, `pro`, `teams_extra_seat`. Products include individual, team base, and extra seat monthly SKUs.
- **Gating:** Server-side `app_config.payments_live` (default `0`) plus `vendor_subscriptions`. Founder status requires an active subscription or active team membership; the seat label alone does not grant access. Do not flip `payments_live` to `1` until App Store products and the RevenueCat webhook are verified end-to-end.
- **Paywall:** `SubscriptionGate` renders `PricingPreview` as an overlay; supports skip, restore, and fallback pricing.
- **Team:** `teams` / `team_members` tables, `/vendor/team/*` routes, owner/member roster, invite-code redemption, team rename.

## File Registry

- `src/api/*` — Supabase, session, sync.
- `src/db/database.ts`, `src/db/inventoryDb.ts`, `src/db/catalogDb.ts`, `src/db/eventCatalogDb.ts`, `src/db/schema.ts`, `src/db/syncDb.ts`.
- `src/store/*` — Zustand stores, including `authStore.ts`, `showVendorStore.ts`, `subscriptionStore.ts`.
- `src/services/CatalogDownloadService.ts`, `CatalogImageService.ts`, `EventCatalogDownloadService.ts`, `ShowListService.ts`, `showVendorService.ts`, `revenueCat.ts`.
- `src/screens/ShowVendorScreen.tsx`, `ShowsScreen.tsx`, `EventListScreen.tsx`, `EventSearchScreen.tsx`, `HomeScreen.tsx`, `InventoryScreen.tsx`, `SearchBuyScreen.tsx`, `SettingsScreen.tsx`.
- `src/components/SetupGate.tsx`, `SubscriptionGate.tsx`, `PricingPreview.tsx`, `PerformanceAnalytics.tsx`, `CartDrawer.tsx`, `BulkImportWizard.tsx`, `EventSearchCard.tsx`, `ShowVendorInventoryRow.tsx`, `ShowVendorListingRow.tsx`.
- `worker_show_vendor.js` + `wrangler.show_vendor.jsonc`, `worker_pre_show.js` + `wrangler.pre_show.jsonc`.
- `drizzle/migrations.js` and `drizzle/*/migration.sql`.
- `PRIVACY_POLICY.md` at repo root; `src/constants/legal.ts`.

## Founder & Team Model

- `vendors.is_founder` and `vendors.founder_seat_number` enforce the first-50 founder seats. New `vendors` rows claim the next open seat automatically while seats remain; `founder_seat_number` is permanent and `is_founder` is restored on resubscribe. `is_founder` is a seat/discount label and does not grant vendor-feature access without an active subscription or active team membership.
- `teams` and `team_members` tables support multi-seat plans. `worker_show_vendor.js` exposes `GET/POST /vendor/team/*` routes, including `POST /vendor/team/rename`. `recalculateTeamSeats` sums active team products and updates `seats_total`; `formatTeam` returns `name`, `owner_name`, and a numbered `members` roster for both owners and teammates.
- `PricingPreview` gates plans by active product, founder eligibility, and active team ownership for the extra-seat product. `SettingsScreen` shows the Team card in all modes, lets owners rename the team and remove members, and displays a roster (`Owner:`, `Team member 1:`, etc.).

## Verification & Tooling

- Run from `PokeQuantMobile/` before committing: `npx tsc --noEmit`, `npx jest`, `npx expo-doctor`.
- Windows: `Set-ExecutionPolicy Bypass -Scope Process -Force` and `& "C:\Program Files\nodejs\npm.cmd" <command>`.
- Local runs: `npx expo run:android` / `npx expo run:ios` or EAS; no Expo Go.
- Asset helpers: `PokeQuantMobile/tools/Make-AppIcon.ps1`, `PokeQuantMobile/tools/Make-StoreScreenshots.ps1`.

## App Store Release Configuration (2026-09-10)

- **Release branch:** `react-native-v2`. `main` hosts `PRIVACY_POLICY.md`; do not merge `react-native-v2` into `main` to avoid deleting root PWA files.
- **Splash screen:** `expo-splash-screen` config plugin in `app.json` (`backgroundColor: #0e1117`, `image: ./assets/splash-icon.png`, `imageWidth: 200`).
- **iOS privacy manifest:** `app.json` `ios.privacyManifests` declares collected data types and required-reason APIs.
- **Dependencies:** `expo-dev-client` is a `devDependency` and excluded from `expo-doctor` checks. `expo-splash-screen` `57.0.5` is installed.
- **Account deletion:** `inventoryStore.deleteAccount()` calls `showVendorService.deleteVendorAccount()` → `worker_show_vendor.js` `POST /vendor/delete-account`, which removes the user's public listings, team data, vendor row, and Supabase auth identity. Requires `SUPABASE_SERVICE_ROLE_KEY` in the worker env.
- **App icon:** `assets/icon.png` must be an opaque 24-bit RGB PNG before submission.
- **Build readiness:** verification commands pass and an EAS `production` iOS build succeeded.
