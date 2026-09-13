# PokeQuant AI Context Map

PokeQuant has two tracks:

- **PokeQuantMobile** (`PokeQuantMobile/`) — the live, shipping product, released on Apple TestFlight as **Card Cache by Totees Mart**. This is the active codebase.
- **PokeQuant Web / PWA** (repo root `app.py`, `card_tool.py`, `worker.js`, `sw.js`, `index.html`) — an unmaintained prototype. Do not spend effort fixing or improving it unless explicitly asked.

## Active Mobile Architecture

- **Runtime:** Expo SDK 57 / React Native 0.86.3. Native builds required; no `Expo Go`.
- **Release identity:** App name **Card Cache**; iOS bundle ID `com.toteesmart.PokeQuantMobile`; Android package `com.toteesmart.PokeQuantMobile`; EAS submit profile uses App Store `ascAppId` `6808830780` with `AuthKey_4CGR6RY3XZ.p8`.
- **Local DBs:**
  - `pokequant.db` — tenant DB (`expo-sqlite` + Drizzle): `inventory`, `vendor_settings`, `sync_metadata`, `tour_state`.
  - `pokequant_catalog.db` — read-only catalog DB downloaded from R2, queried raw.
  - `event_catalog.db` — per-show public inventory, hydrated from R2 ZIP.
- **Migrations:** `drizzle/migrations.js` registers the migration set; recent `split_sync_watermark` migration added `last_pushed_local_updated_at`.
- **State:** Zustand stores only (`useAuthStore`, `useInventoryStore`, `useVendorStore`, `useProgressStore`, `useCartStore`, `useShowVendorStore`, `useSubscriptionStore`). React Context is banned.
- **Auth:** Supabase client (`persistSession: false`, `autoRefreshToken: true`), `expo-secure-store` session cache, `authStore` with offline session restoration and `SIGNED_OUT` guard.
- **Sync:** Manual-only. Cloudflare Worker edge proxy verifies Supabase ES256 JWTs and forwards to Turso `/v2/pipeline` over `https://`.
- **File I/O:** `expo-file-system/next` (`Directory`, `File`, `Paths`).
- **Compression:** `react-native-zip-archive` only; no JS unzippers.
- **Lists:** `@shopify/flash-list` v2, `React.memo()` rows, `useRecyclingState`, no `estimatedItemSize`, no `key` props on recycled items, bounded containers.
- **Image URL fix:**
  - `getCatalogImageUri(productId)` parses `product_id` as integer and returns local file URI or TCGPlayer `_400w.jpg` fallback.
  - `getLocalCatalogImageUri(productId)` returns local extracted images only (used for show/event rows, never CDN).
  - Use `expo-image` (`cachePolicy="memory-disk"`) for all image rendering.
- **Catalog self-healing:** `openCatalogDatabase()` validates required tables and re-downloads from R2 if missing; `downloadLatestMarketPrices()` closes old handle, deletes stale WAL/SHM, validates tables, and re-initializes.
- **Setup gate:** `SetupGate.tsx` downloads/validates catalog, warms image index from `catalog_images.manifest` or directory scan, and offers the ~1.8 GB offline image pack.
- **Subscription gate:** `SubscriptionGate.tsx` renders `PricingPreview` as an overlay; supports skip/complete with local session guard against rehydration flip.
- **Card scanner:** `src/scanner/` module + `ScannerScreen.tsx` behind a dedicated `Scan` bottom tab — TFLite detection → serialized OCR → catalog text match → MobileCLIP sidecar visual match → confidence fusion → review queue → `inventoryStore.addScannedCards`. Models/embeddings (~140 MB) download from R2 `scanner/*` at runtime; fully offline after. Catalog prices hydrate per-candidate (never `price_history` at warm-up); print finishes (`sub_type`) and negotiated offers (`customOffer` → `amountPaid`, `applyDealTotal`) are user-editable in the review queue. See `PokeQuantMobile/AGENTS.md` "Card Scanner (Scan tab)" for the full contract.

## Show-Vendor & Pre-Show (Track 3)

- `shows.vendor_id` is the organizer; `vendors.id` is the vendor slug; `vendor_show_registrations` controls access; `public_show_inventory` holds listings.
- `worker_show_vendor.js` (`pokequant-vendor.totees-mart.workers.dev`) — authenticated vendor CRUD and team operations.
- `worker_pre_show.js` (`pokequant-pre-show.totees-mart.workers.dev`) — public snapshot worker that builds R2 ZIPs.
- Offline flow: vendor uploads → publish → R2 ZIP → attendee downloads/extracts to `event_catalog.db`.
- Show images are strictly local; fuzzy `attachEventImages()` only binds at score ≥ 150.
- `ShowListService` caches shows in `AsyncStorage` with a static `src/constants/shows.ts` fallback.
- Multi-seat team subscriptions are live: `teams`/`team_members` tables, `/vendor/team/*` routes (including rename), `PricingPreview`/`SettingsScreen` team UI with owner and numbered member roster.
- Vendor feature gating: `canUseVendorFeatures()` uses `paymentsLive`, `isVendor`, `isFounder`, `isTeamMember`, or RevenueCat `Cardcache_pro` entitlement.
- Organizer mode: `vendors.is_organizer` (manual Turso flag, independent of paid-vendor gating) unlocks `OrganizerScreen` (Shows tab) — create/edit shows, attach app or manual vendors (`vendor_id = 'manual:{uuid}'`), approve/reject requests, table numbers, deposit/balance ledger (`total_due`/`paid_amount` on `vendor_show_registrations`), sms: reminders. Vendors: `POST /vendor/shows/{id}/request` → pending; `GET /vendor/balances` → unpaid-balance banner. Worker path params are `decodeURIComponent`'d.

## RevenueCat & Subscriptions

- Public API keys in `app.json` `extra.revenuecat`; `getRevenueCatApiKey()` prefers `EXPO_PUBLIC_REVENUECAT_*_API_KEY` env, then `Constants.expoConfig.extra`.
- Entitlement `Cardcache_pro`; offerings `founders`, `pro`, `teams_extra_seat`.
- Server-side gating via `app_config.payments_live` (default `0`) and `vendor_subscriptions`. Do not flip `payments_live` to `1` until App Store products and RevenueCat webhook are verified.
- Founder seats: first 50 `vendors` rows; permanent `founder_seat_number`; `is_founder` restored on resubscribe.
- `PricingPreview` includes fallback pricing, legal links, Restore Purchases, and team invite-code redemption.

## Monetization

- Two RevenueCat entitlements: `Cardcache_pro` (everything: vendor tools + unlimited scans) and `Cardcache_scan` (unlimited scans only, $4.99/mo or $29.99/yr — never vendor features).
- Scan meter (`src/scanner/store/scanMeterStore.ts`): 7-day unlimited trial from first Scan-tab visit, then 15 successful scans/day; device-local AsyncStorage; fail-open on errors; over-limit shows `ScanLimitSheet` hard block.
- Pro Individual yearly = $119.99 (`cc_pro_individual_yearly`); teams stay monthly-only.
- `payments_live = 0` during launch: vendor tools free for all (launch banner shown); scan meter and purchases still work. Flip only after production IAP + webhook round-trip verified and ~10-15 vendors depend on publishing.
- Worker keeps `cc_scan_*` products out of `vendor_subscriptions` (`NON_VENDOR_PRODUCTS` + webhook `entitlement_ids` guard).
- Full details: `.devin/pricing-plan.md`.

## Critical Constraints

- ES256 JWT verification only; never HS256/RS256/symmetric HMAC.
- Turso URLs in edge env must be `https://`; `libsql://` is forbidden.
- Native zip extraction only (`react-native-zip-archive`).
- No JavaScript unzippers (`fflate`, `jszip`, `pako`).
- No `Expo Go`; use custom native clients or EAS builds.
- Do not commit secrets (`.env*`, `*.p8`, `secrets.toml`, tokens).
- Do not trigger image-pack downloads from show screens; keep it an explicit setup/Settings action.
- All analytics/charts source from `pokequant.db` / Zustand, not the network.
- For full mobile rules see `PokeQuantMobile/AGENTS.md` and `PokeQuantMobile/global_rules.md`.
- For multi-vendor show details see `AGENTS.md`.

## Privacy & Legal

- `PRIVACY_POLICY.md` at repo root is the live policy linked in the app. Ensure it is committed/pushed to `main` before App Store submission.
- `src/constants/legal.ts` points to the GitHub-rendered policy and Apple's standard EULA.
- No analytics/tracking SDKs; RevenueCat device-identifier collection is disabled.

## Asset Tools

- `PokeQuantMobile/tools/Make-AppIcon.ps1` — 1024x1024 App Store icons from `logo.png`.
- `PokeQuantMobile/tools/Make-StoreScreenshots.ps1` — 6.5" and 13" App Store screenshot sizing.
- Final `assets/icon.png` must be an opaque 24-bit RGB PNG (no alpha channel) for App Store Connect.

## App Store Release Notes (2026-09-10)

- Release branch: `react-native-v2`. `main` contains `PRIVACY_POLICY.md` for the live privacy URL. Do not merge `react-native-v2` into `main` to avoid deleting the root PWA prototype.
- `app.json` now has `expo-splash-screen` config, `ios.privacyManifests`, and `expo.install.exclude` for `expo-dev-client`.
- `expo-dev-client` is a `devDependency`; `expo-splash-screen` `57.0.5` is installed.
- Account deletion goes through `worker_show_vendor.js` `POST /vendor/delete-account` and requires `SUPABASE_SERVICE_ROLE_KEY` in the worker environment.
- Verification (`tsc`, `jest`, `expo-doctor`) passes and an EAS `production` iOS build succeeded.
