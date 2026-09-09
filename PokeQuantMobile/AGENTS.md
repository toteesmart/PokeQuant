# PokeQuantMobile Agent Rules

PokeQuantMobile is the live, offline-first Expo / React Native product released on Apple TestFlight as **Card Cache by Totees Mart**. The repo root Streamlit/Pyodide PWA is a prototype and is no longer being maintained; active work stays in this directory and the show-vendor workers.

## Release Identity

- App name: **Card Cache**.
- iOS bundle ID: `com.toteesmart.PokeQuantMobile`; Android package: `com.toteesmart.PokeQuantMobile`.
- `eas.json` production submit profile targets App Store Connect `ascAppId` `6808830780` with `AuthKey_4CGR6RY3XZ.p8`.
- Do not change `app.json` name/owner or `eas.json` submit config without an explicit release-planning reason.

## Core Database & Sync Engineering

- **SQLite engine:** All local persistence uses `expo-sqlite`.
  - `pokequant.db` (tenant DB) is managed with `drizzle-orm/expo-sqlite` and contains `inventory`, `vendor_settings`, `sync_metadata`, `tour_state`.
  - `pokequant_catalog.db` (catalog DB) is a pre-built read-only SQLite file downloaded from R2 and queried through raw `expo-sqlite` APIs in `src/db/catalogDb.ts`. Do not run Drizzle Kit or migrations against it.
  - `event_catalog.db` (show DB) is a raw SQLite file for per-show public inventory, managed in `src/db/eventCatalogDb.ts`.
- **Drizzle migrations:** `drizzle/migrations.js` registers the migration set. `drizzle/20260905000000_split_sync_watermark` added `last_pushed_local_updated_at` to `sync_metadata` and seeded it from `last_updated`. Migrations run inside `initializeDatabase()`.
- **Catalog DB self-healing:** `openCatalogDatabase()` validates that `cards` and `price_history` exist and re-downloads the catalog if they do not. `downloadLatestMarketPrices()` closes the active handle, deletes stale `-wal`/`-shm` sidecars, downloads a fresh catalog, validates tables, and re-initializes the Drizzle catalog handle before returning.
- **UUID schema constraint:** Local and cloud `inventory` use `id TEXT PRIMARY KEY`. Generate IDs with `expo-crypto.randomUUID().replace(/-/g, '')`. They are standard UUIDs with dashes stripped, not encrypted hashes. Never use `INTEGER PRIMARY KEY` rowid aliases.
- **Type-safe sync coercion:** Turso edge JSON is normalized through `coerceInventoryRow()` and the Drizzle schema.
  - Booleans (`is_sold`, `is_deleted`, `is_bulk_deal`) use `integer({ mode: 'boolean' })`.
  - `product_id` is parsed with `Number.parseInt(String(val), 10)` and is `null` when missing or zero.
  - Prices are parsed with `Number()` and default to `0.0`.
- **LWW resolution:** Remote pulls use `INSERT ... ON CONFLICT(id) DO UPDATE SET ... WHERE excluded.updated_at > inventory.updated_at`.
- **Pushing local changes:** Query `SELECT * FROM inventory WHERE updated_at > (SELECT last_pushed_local_updated_at FROM sync_metadata LIMIT 1)`, chunk into `SYNC_BATCH_SIZE = 500`, and send `INSERT OR REPLACE` payloads to the worker.
- **Manual sync only:** Sync is intentionally manual-only via the `SyncButton` / `triggerSync()`. Foreground/mutation auto-sync was removed because it froze the UI for large inventories.
- **Edge cryptography (ES256):** Supabase issues ES256 (ECC P-256) tokens. The Cloudflare Worker verifies them via Web Crypto (ECDSA + SHA-256) against the Supabase JWKS endpoint and caches the key set for 5 minutes. Never revert to HS256, RS256, or symmetric HMAC.
- **Turso pipeline (HTTPS only):** The worker calls Turso's `/v2/pipeline` over `fetch()`. Edge `TURSO_DATABASE_URL` must use `https://`; `libsql://` cannot be resolved.
- **Native extraction:** Catalog and event ZIPs must be extracted with `react-native-zip-archive`. JavaScript unzippers (`fflate`, `jszip`, `pako`) are banned.

## State Management (Zustand)

React Context is obsolete. All global state lives in Zustand stores:

- `src/store/authStore.ts` (`useAuthStore`) — session lifecycle, offline session restoration, `SIGNED_OUT` guard, sign in/up/out.
- `src/store/inventoryStore.ts` (`useInventoryStore`) — active inventory, completed sales, sync status, pending sync count, cloud sync actions.
- `src/store/vendorStore.ts` (`useVendorStore`) — vendor settings, buy tiers, sticker rules, cash/sticker offer helpers.
- `src/store/progressStore.ts` (`useProgressStore`) — catalog DB download, image ZIP download/extraction, event catalog download/extraction, `catalogLastUpdated`.
- `src/store/cartStore.ts` (`useCartStore`) — lot cart, totals, drawer visibility.
- `src/store/showVendorStore.ts` (`useShowVendorStore`) — vendor profile, show access, show setup (vendor name/table), card selections, listings, upload/publish state, team actions.
- `src/store/subscriptionStore.ts` (`useSubscriptionStore`) — RevenueCat config, customer info, offerings, purchases, restore, `hasSeenPricingPreview`.

Components subscribe through granular selectors and call store actions. The stores coordinate database writes and network sync; do not call the DB directly from components.

## Authentication & Session

- `src/api/supabaseClient.ts` creates the Supabase client with `persistSession: false` and `autoRefreshToken: true`.
- `src/api/sessionStorage.ts` persists the `Session` object in `expo-secure-store` under `pq-supabase-session`.
- `src/hooks/useAuth.ts` is a thin re-export of `useAuthStore`.
- `authStore.initialize()` restores the session from `SecureStore`, calls `supabase.auth.setSession()`, and on network failures falls back to the stored session so the app stays usable offline.
- `authStore` guards against `SIGNED_OUT` events from failed background token refreshes: only an explicit `logout()` tears the session down. `lastLoadedUserId` prevents repeated user-store reloads during token refresh churn.

## High-Performance Rendering

- Use `@shopify/flash-list` v2 for any unbounded or image-heavy list.
- Do **not** pass `estimatedItemSize`.
- Wrap rendered rows in `React.memo()`.
- Use `useRecyclingState` from `@shopify/flash-list` for per-item UI state.
- Do **not** put a `key` prop on recycled item components.
- Lists must live in a container with explicit block dimensions (`flex: 1` or rigid `height`).
- Follow the UI Integrity Protocol: containers need explicit height, `minHeight`, or properly bounded flex. Never use `position: 'absolute'` inside a flex grid unless overriding a zero-height collapse.

## Catalog & Image Handling

- `CatalogDownloadService.ts` downloads `mobile_catalog.db` from R2 into `pokequant_catalog.db` in the `expo-file-system` `SQLite` documents directory. Catalog downloads are coalesced through `catalogDownloadPromise` so concurrent calls do not race over a half-written file.
- `CatalogImageService.ts` downloads `catalog_images.zip` from R2, deletes stale files, extracts with `react-native-zip-archive`, writes a `catalog_images.ready` marker, and writes `catalog_images.manifest` containing the extracted directory and image IDs for fast warm-up.
- **Image URL helpers:**
  - `getCatalogImageUri(productId)` parses `product_id` as a base-10 integer. If `catalog_images.ready` exists and `catalog_images/{productId}.jpg` is present, it returns the local file URI; otherwise it falls back to `https://tcgplayer-cdn.tcgplayer.com/product/{productId}_400w.jpg`. Use this helper everywhere an image is rendered; do not pass raw strings or uncast IDs.
  - `getLocalCatalogImageUri(productId)` returns local extracted images only and is used by `EventSearchCard` so show browsing never falls back to the CDN.
- **Image rendering:** Use `expo-image` (`<Image>`) with `cachePolicy="memory-disk"` for persistent disk caching of CDN fallback images.
- **Catalog search:** `searchCatalogCards()` in `src/db/catalogDb.ts` supports punctuation-insensitive search, rarity filter, `maxPrice`, `productType`, and sort (`Newest`, `Name A-Z`, `Price: Low to High`, `Price: High to Low`). Price sort uses a canonical subtype expression (normal → holofoil → lowest positive) with a lookahead row to compute accurate `hasMore`. `productType` post-filters (e.g. "Sealed Only") collapse to empty and cards-only retains all.
- **Search & Buy:** `SearchBuyScreen` auto-initiates `ensureCatalogDownloaded()` when the catalog is missing, opens the catalog DB, and paginates paired `FlashList` rows.
- **Market data:** `getProductMarketData()` and `getCardMarketAnalytics()` resolve the latest price for a requested variant with a canonical subtype fallback, plus 1d/3d/7d/30d and 90d high/low.
- **Settings:** exposes `downloadLatestMarketPrices()` to refresh market data (only swaps `pokequant_catalog.db`, never images) and "Download Offline Images" → `ensureCatalogImagesDownloaded()` for users who skipped the pack during setup.
- All catalog requests use cache-busting query parameters and `Cache-Control: no-cache, no-store, must-revalidate` / `Pragma: no-cache` headers.

## Startup, Setup Gate & Subscription Gate

- `src/components/SetupGate.tsx` wraps `AppNavigator` in `App.tsx` after auth. Before any screen renders it: (1) verifies/downloads the catalog DB, (2) warms the extracted-image index via `warmCatalogImageIndex()` — which reads `catalog_images.manifest` as a fast path and otherwise scans the directory — and (3) if `catalog_images.ready` is absent, offers the ~1.8 GB offline image pack as an explicit, skippable step. All state is device-scoped and idempotent, so returning launches and re-logins pass through in milliseconds. Do not move image-index warming back onto per-screen lazy paths.
- `src/components/SubscriptionGate.tsx` renders `PricingPreview` as a full-screen overlay until the user subscribes or presses skip. It guards against Zustand rehydration flipping `hasSeenPricingPreview` after a skip by tracking a local `hasSkippedThisSession` flag. It configures RevenueCat on mount and loads the vendor profile so team/payment status is available for the paywall.
- `App.tsx` mounts `StoreInitializer` to configure RevenueCat and initialize auth. No automatic sync is triggered on foreground/mutation.

## Track 3: Show-Vendor & Pre-Show Catalog

### Vendor flow

- `ShowVendorScreen` uses `useShowVendorStore`.
- It has two tabs: **Select Cards** (picks from active inventory with search) and **My Listings** (shows already-uploaded rows).
- Vendor enters `vendor_name` and `vendor_table`; the defaults come from `useShowVendorStore.profile` / `setups[showId]`.
- **Feature gating:** `canUseVendorFeatures()` returns true when `paymentsLive` is false, or when the profile has `isVendor`, `isFounder`, `isTeamMember`, or the RevenueCat `Cardcache_pro` entitlement is active. Show reporting/publishing is gated by this function.
- **Upload to show** calls `showVendorService.uploadShowInventory()` → `worker_show_vendor.js` `POST /vendor/inventory`.
- **Publish to show catalog** calls `showVendorService.triggerShowSnapshot()` → `worker_pre_show.js` `POST /trigger/{showId}`.

### Pre-show worker snapshot

- `worker_pre_show.js` (`https://pokequant-pre-show.totees-mart.workers.dev`) is public and fetch-only.
- `GET /shows` returns active shows metadata.
- `POST /trigger` and `POST /trigger/{showId}` query `shows` and `public_show_inventory`, sanitize rows, build a raw deflate ZIP of `event_catalog.json`, and upload to R2 at `shows/{showId}/event_catalog.json.zip`.

### Attendee flow

- `ShowsScreen` → `EventListScreen` → `EventSearchScreen`.
- `ShowListService.ts` fetches `GET /shows`, caches in `AsyncStorage`, and falls back to `src/constants/shows.ts`.
- `EventCatalogDownloadService.ts` downloads the per-show ZIP with cache-busting/anti-cache headers, extracts with `react-native-zip-archive`, hydrates `event_catalog.db` (`show_inventory` table), and cleans up transient ZIP/JSON after hydration. It coalesces in-flight downloads per `showId` so concurrent calls do not corrupt the shared DB file.
- `EventSearchScreen` uses a horizontal paged `FlashList` with a 2x2 layout, punctuation-insensitive search, filters (vendor, set, rarity, condition, price buckets), and sort. It supports offline fallback to an existing local show catalog.
- `EventSearchCard` displays image, name, number, set, rarity, condition, vendor/table, quantity, and sticker price.
- **Show browsing is strictly local-only for images.** Event rows resolve images via `getLocalCatalogImageUri()` (extracted `catalog_images/` only — never the CDN), and the fuzzy `attachEventImages()` fallback in `eventCatalogDb.ts` only binds when the catalog match is high-confidence (score ≥ 150: exact normalized name + exact card number, or exact name + exact set). Missing/uncertain matches render the name placeholder — a blank image is better than a wrong or online image.
- `eventCatalogDb.ts` caches fuzzy catalog match resolutions (`eventImageMatchCache`) keyed by normalized `name|set|number` so repeat searches skip the catalog lookup. The cache is cleared when the event DB handle is swapped.
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
- `src/api/cloudSync.ts` — Turso edge sync engine; `getAuthToken()` falls back to stored session.
- `src/db/database.ts` — tenant SQLite init and Drizzle.
- `src/db/inventoryDb.ts` — headless CRUD for `inventory`, image URL sanitization, remote-row coercion.
- `src/db/catalogDb.ts` — catalog DB queries, market velocity, self-healing, price-sort pagination.
- `src/db/eventCatalogDb.ts` — raw SQLite for per-show event inventory, fuzzy image matching.
- `src/db/schema.ts` — Drizzle schema for `pokequant.db`.
- `src/store/*` — Zustand stores.
- `src/services/CatalogDownloadService.ts` — catalog DB download and price refresh.
- `src/services/CatalogImageService.ts` — image ZIP download and native extraction.
- `src/services/EventCatalogDownloadService.ts` — per-show event catalog download and extraction.
- `src/services/ShowListService.ts` — active show list with cache/fallback.
- `src/services/showVendorService.ts` — vendor inventory and team CRUD worker client.
- `src/services/revenueCat.ts` — RevenueCat wrapper and helpers.
- `src/screens/ShowVendorScreen.tsx` — vendor upload/publish UI.
- `src/screens/ShowsScreen.tsx`, `src/screens/EventListScreen.tsx`, `src/screens/EventSearchScreen.tsx` — attendee show browsing.
- `src/screens/HomeScreen.tsx` — dashboard with Quick Quote, Live Session, Resticker Radar, Sync badge.
- `src/screens/InventoryScreen.tsx` — active inventory carousel, velocity breakdown, PerformanceAnalytics tab.
- `src/screens/SearchBuyScreen.tsx` — catalog search, filters, cart lot.
- `src/screens/SettingsScreen.tsx` — tiers, sticker rules, bulk import, offline downloads, subscription/team, delete account.
- `src/components/SetupGate.tsx`, `src/components/SubscriptionGate.tsx`, `src/components/PricingPreview.tsx`, `src/components/PerformanceAnalytics.tsx`, `src/components/CartDrawer.tsx`, `src/components/BulkImportWizard.tsx`.
- `src/components/ShowVendorInventoryRow.tsx`, `src/components/ShowVendorListingRow.tsx`, `src/components/EventSearchCard.tsx`.
- `worker_show_vendor.js` and `wrangler.show_vendor.jsonc` — vendor CRUD worker.
- `worker_pre_show.js` and `wrangler.pre_show.jsonc` — pre-show snapshot worker.

## Tooling & Stability Constraints

- **Terminal (Windows):** `Set-ExecutionPolicy Bypass -Scope Process -Force` and use `& "C:\Program Files\nodejs\npm.cmd" <command>` when PowerShell blocks npm.
- **Git commits:** single-line messages only: `git commit -m "..."`.
- **Expo Go is deprecated.** Local runs require a custom native client (`npx expo run:android` / `npx expo run:ios`) or an EAS build because of `react-native-zip-archive` and `react-native-purchases`.
- **Do not reintroduce React Context** for global state; use Zustand.
- **Do not use JavaScript unzippers** for catalog or event assets.
- **Do not pass `estimatedItemSize`** to `FlashList` v2.
- **Do not render unbounded lists;** all list containers need explicit block dimensions.
- **All future analytics/charts** must source data from `pokequant.db` / Zustand, not the network.
- **Do not commit secrets.** `.env*`, `AuthKey_*.p8`, `secrets.toml`, EAS creds, and tokens are gitignored and must never be in the index.
- **Do not trigger the offline image pack download** from show screens; it is an explicit setup/Settings action.

## Verification Commands

Run these from `PokeQuantMobile/` before committing changes:

- `npx tsc --noEmit` — TypeScript type check.
- `npx jest` — Jest unit-test suite.
- `npx expo-doctor` — Expo SDK dependency / environment validation.

## RevenueCat / Subscription Integration

- **Public API keys** live in `app.json` `extra.revenuecat.iosApiKey` / `androidApiKey` and are read at runtime via `src/constants/revenuecat.ts`. `getRevenueCatApiKey()` prefers `process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` / `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`, then falls back to `Constants.expoConfig.extra.revenuecat`. Do not commit real keys to the repo; set them in the EAS build environment before a native build.
- **Native builds required.** RevenueCat (`react-native-purchases`) and the existing `react-native-zip-archive` native dependency do not work in Expo Go. Use `npx expo run:ios --device` / `npx expo run:android` or an EAS development build.
- **Configuration:** `src/services/revenueCat.ts` configures `Purchases` once per install, with `automaticDeviceIdentifierCollectionEnabled: false`.
- **Entitlement:** `Cardcache_pro` is the paid-vendor entitlement. Offerings are `founders`, `pro`, and `teams_extra_seat`.
- **Products:** `cc_founder_individual_monthly`, `cc_founder_team3_monthly`, `cc_pro_individual_monthly`, `cc_pro_team_base_monthly`, `cc_pro_team_extra_seat_monthly`.
- **Turso gating:** The edge workers use `app_config.payments_live` (default `0`) and `vendor_subscriptions` to enforce paid-vendor status server-side. Do not flip `payments_live` to `1` until the App Store products and RevenueCat webhook are verified end-to-end.
- **Paywall:** `PricingPreview` supports fallback pricing when App Store products are not yet linked, and surfaces legal links (Privacy Policy, EULA/Terms of Use) and a Restore Purchases button required by App Store review. `SubscriptionGate` renders it as an overlay and uses a local session flag to prevent the persisted `hasSeenPricingPreview` from re-appearing immediately after skip.
- **Worker secrets:** `worker_show_vendor.js` needs `REVENUECAT_SECRET_API_KEY`; the `/revenuecat-webhook` route also needs `REVENUECAT_WEBHOOK_SECRET`.

## Team Subscriptions

Multi-seat team plans live alongside individual plans and are enforced server-side in `worker_show_vendor.js`.

- **Team products:** `cc_founder_team3_monthly` and `cc_pro_team_base_monthly` grant a base of 3 seats; `cc_pro_team_extra_seat_monthly` adds 1 seat and is only purchasable when the user already owns an active team base. App Store subscription groups are `CardCache Pro Individual`, `CardCache Pro Team`, and `CardCache Pro Team Extra` — one active product per group.
- **Worker routes:**
  - `GET /vendor/team`
  - `POST /vendor/team/regenerate-code`
  - `POST /vendor/team/rename` — owner sets `teams.name`.
  - `POST /vendor/team/redeem`
  - `POST /vendor/team/remove`
  - `POST /vendor/team/leave`
- **Team enforcement:** `assertIsPaidVendor` grants access when the user has a direct active subscription, is an active member of a non-expired team, or is a founder.
- **Mobile UI:** `PricingPreview` filters selectable plans by active product, founder eligibility (`isFounder`, `founderSeatNumber`, or `founderSeatsRemaining > 0`), and active team ownership for extra seats. `SettingsScreen` shows the Team card regardless of `paymentsLive`; owners see the team name input, invite code, seat usage, regenerate, and member list; members see the team name, owner, roster, and a Leave button; non-vendors see the redeem input. `Settings` and `PricingPreview` refresh `customerInfo` and the worker profile on mount to avoid stale state.
- **Member display:** `getTeamMembers` joins `vendors` to return `member_name`; `formatTeam` also returns `owner_name` and a `members` roster for both owners and teammates. `SettingsScreen` renders `Owner: <name>` and `Team member N: <name>`.
- **Founder seats:** `founder_counter` tracks the first 50 `vendors` rows. Existing vendors are grandfathered by `created_at` once during schema creation; new vendors claim the next open seat atomically. Churn does not refill seats; a churned founder retains `founder_seat_number` and `is_founder` is restored when any paid subscription becomes active again.

## Privacy & Legal

- `PRIVACY_POLICY.md` at the repo root is the live privacy policy surfaced in the app and App Store.
- `src/constants/legal.ts` provides `PRIVACY_POLICY_URL` (GitHub-rendered `PRIVACY_POLICY.md`) and `TERMS_OF_USE_URL` (Apple standard EULA).
- `PricingPreview` and `SettingsScreen` link to both. Ensure the policy file is committed and pushed to `main` before App Store submission or the link will 404.
- Do not add analytics, advertising identifiers, or non-essential tracking. `revenueCat.ts` explicitly disables RevenueCat device-identifier collection.

## Asset & Screenshot Tools

- `PokeQuantMobile/tools/Make-AppIcon.ps1` — generates 1024x1024 App Store icons from `logo.png` with transparent background flood-fill, outputs `icon-dark.png` and `icon-light.png` to `screenshots/`.
- `PokeQuantMobile/tools/Make-StoreScreenshots.ps1` — resizes raw iPhone screenshots into 6.5" (`1284x2778`, cover-fit) and 13" iPad (`2048x2732`, contain-fit) App Store screenshot sets.
- These are helper scripts for release assets; they are not part of the runtime build.
