# PokeQuantMobile Agent Rules

PokeQuantMobile is the live, offline-first Expo / React Native product released on Apple TestFlight as **Card Cache by Totees Mart**. The repo root Streamlit/Pyodide PWA is a prototype and is no longer being maintained; active work stays in this directory and the show-vendor workers.

**Deep docs (read on demand, not always loaded):** `docs/REGISTRY.md` (per-file orientation), `docs/DEAL_ENGINE.md` (deal module map + regression harness), `docs/SUBSCRIPTIONS.md` (RevenueCat SKUs, team seats, paywall detail), `docs/RELEASE.md` (App Store config, asset tools, privacy links), `docs/design/UI_PRINCIPLES.md` (visual system).

**Work queue:** `.devin/WORK_QUEUE.md` lists gated investments — one item per session, land it green + committed, check the box, stop. If a session's task is queued there, work only that item.

## Codebase Shape

Screens are composition shells; store/async wiring lives in `src/hooks/` (`src/scanner/hooks/` for scanner); leaf components are `memo()`'d; shared styles live in a sibling `*Styles.ts` module. Shared hooks: `useAnalysisSheet` (name-tap → deal-analysis plumbing, scanner-owned), `useVendorFeatures` (reactive vendor gating — do NOT substitute the store's imperative `canUseVendorFeatures()`, its `getState()` read isn't reactive).

## Release Identity

- App name: **Card Cache**.
- iOS bundle ID: `com.toteesmart.PokeQuantMobile`; Android package: `com.toteesmart.PokeQuantMobile`.
- `eas.json` production submit profile targets App Store Connect `ascAppId` `6808830780` with `credentials/AuthKey_4CGR6RY3XZ.p8`.
- Do not change `app.json` name/owner or `eas.json` submit config without an explicit release-planning reason.

## Core Database & Sync Engineering

- **SQLite engine:** All local persistence uses `expo-sqlite`.
  - `pokequant.db` (tenant DB) is managed with `drizzle-orm/expo-sqlite` and contains `inventory`, `vendor_settings`, `sync_metadata`, `tour_state`.
  - `pokequant_catalog.db` (catalog DB) is a pre-built read-only SQLite file downloaded from R2 and queried through raw `expo-sqlite` APIs under `src/db/`. Do not run Drizzle Kit or migrations against it. The `catalogDb.ts` module is a facade over three layers: `catalogSession.ts` (handle `sqliteDb`/`db` live bindings, `withCatalogGuard`, open/close/table validation — true leaf), `catalogPrices.ts` (variant resolution, series, market data/velocity, analytics cache), `catalogSignals.ts` (quant tables: CardSignal/CardDeep/PatternStat/scout, `DEEP_STALE_DAYS`). catalogDb keeps the card-search builders (`searchCatalogCards*`, `buildSearchClause`, `buildOrderBy`) and `setCatalogDatabase`; new code may import the domain module directly.
  - `event_catalog.db` (show DB) is a raw SQLite file for per-show public inventory, managed in `src/db/eventCatalogDb.ts`.
- **Drizzle migrations:** `drizzle/migrations.js` registers the migration set. `drizzle/20260905000000_split_sync_watermark` added `last_pushed_local_updated_at` to `sync_metadata` and seeded it from `last_updated`. Migrations run inside `initializeDatabase()`.
- **Catalog DB self-healing:** `openCatalogDatabase()` validates that `cards` and `price_history` exist and re-downloads the catalog if they do not. `downloadLatestMarketPrices()` closes the active handle, deletes stale `-wal`/`-shm` sidecars, downloads a fresh catalog, validates tables, and re-initializes the Drizzle catalog handle before returning.
- **UUID schema constraint:** Local and cloud `inventory` use `id TEXT PRIMARY KEY`. Generate IDs with `expo-crypto.randomUUID().replace(/-/g, '')`. They are standard UUIDs with dashes stripped, not encrypted hashes. Never use `INTEGER PRIMARY KEY` rowid aliases.
- **Type-safe sync coercion:** Turso edge JSON is normalized through `coerceInventoryRow()` and the Drizzle schema.
  - Booleans (`is_sold`, `is_deleted`, `is_bulk_deal`) use `integer({ mode: 'boolean' })`.
  - `product_id` is parsed with `Number.parseInt(String(val), 10)` and is `null` when missing or zero.
  - Prices are parsed with `Number()` and default to `0.0`.
- **LWW resolution:** Remote pulls use `INSERT ... ON CONFLICT(id) DO UPDATE SET ... WHERE excluded.updated_at > inventory.updated_at`.
- **Pushing local changes:** Query `SELECT * FROM inventory WHERE updated_at > (SELECT last_pushed_local_updated_at FROM sync_metadata LIMIT 1)`, chunk into `SYNC_BATCH_SIZE = 500`, and send `INSERT OR REPLACE` payloads to the worker. `last_pushed_local_updated_at` is also advanced on every successful pull to the maximum pulled `updated_at`, so rows that came from the server are not counted as local pending changes.
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
- `src/scanner/store/scanQueueStore.ts` (`useScanQueueStore`) — scanned-card queue: condition/quantity/finish/offer updates, `replaceCard`, `applyDealTotal`.

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
- Lists must live in a bounded container (`flex: 1` or explicit dimensions); FlashList v2 cannot measure inside an unbounded parent and a vertical list must never nest in a vertical `ScrollView`.
- Layout *mechanisms* are the implementer's choice; layout *outcomes* are verified by `lint:ui` + Maestro screenshots. See `docs/design/UI_PRINCIPLES.md` §1 for what remains invariant.

## UI Design System & Verification

- `docs/design/UI_PRINCIPLES.md` is the source of truth for the visual system: tokens, layout/chrome conventions, the card interaction contract (image → viewer, name → analysis, no long-press-only features), IA rules (4 tabs + header gear), per-surface state contract, and the verification loop.
- **The house style is deliberate, not default Expo.** §8 codifies the identity ("Card Cache glass"): frosted-glass floating chrome (`BlurView`+`overlay3`+hairline+shadow), glossy lifted modules (overlay3 + sheen), soft `overlay2` tiles, **badge-pill actions** (`{color}Tint` + hairline + label — never solid blocks or bare text links), accent-bar stat rows, hero number + delta pill, glass-circle global actions, peek decks. §9 is the default-style audit recipe — grep seeds for boxed surfaces, text-link actions, `●` glyph dots, hand-rolled bars, bare chevrons, ad-hoc Modal overlays. To find where default styling still lives: run the §9 sweeps (or ask `ui-verifier` in audit mode) and migrate each hit into a §8 family. New surfaces must land in an existing family or extend one — never introduce unstyled/default chrome.
- Style values come from `src/constants/colors.ts` + `src/constants/theme.ts` only. `npm run lint:ui` (`tools/check-ui-tokens.mjs`) fails on raw hex/rgba/named colors, off-scale `fontSize`/`borderRadius`, and `fontWeight: 'bold'`. Justified exceptions carry `// token-ok <reason>`.
- `tools/codemod-tokens.mjs` is the deterministic literal→token codemod (`--dry` to preview); safe to re-run.
- Visual verification: Maestro flows in `maestro/flows/` run via `tools/ui-screenshots.ps1` (boots `Pixel_10_Pro` if no device, needs a dev-client build installed). PNGs land in `artifacts/ui-screens/` (gitignored).
- The `ui-verifier` subagent (canonical profile at repo-root `.devin/agents/ui-verifier.md`, mirrored at `PokeQuantMobile/.devin/agents/`) reviews UI diffs against the principles doc + interaction contract — read/exec only, never edits; reports violations with `file:line` + screenshot refs. The `.devin/skills/mobile-ui` skill hydrates this workflow automatically.

## Catalog & Image Handling

- `CatalogDownloadService.ts` downloads `mobile_catalog.db` from R2 into `pokequant_catalog.db` in the `expo-file-system` `SQLite` documents directory. Catalog downloads are coalesced through `catalogDownloadPromise` so concurrent calls do not race over a half-written file.
- `CatalogImageService.ts` manages two independent image packs. The English pack downloads `catalog_images.zip` from R2 into `catalog_images/` (`catalog_images.ready` marker + `catalog_images.manifest` ID index). The optional Japanese pack downloads `catalog_images_jp.zip` into `catalog_images_jp/` (`catalog_images_jp.ready`/`catalog_images_jp.manifest`) via `ensureJpImagesDownloaded()`; `catalogJpImagesReady()` reports its state. Each pack cleans only its own workspace, so reinstalling one never deletes the other.
- **Japanese cards:** tcgcsv category 85 is ingested into the same catalog with `set_name` prefixed `JP · `. `src/utils/jp.ts` (`isJpSet`) detects them and `JpBadge` renders the marker on search, event, inventory, and scan-queue rows. No schema migration — `product_id`s share the global TCGplayer namespace.
- **Image URL helpers:**
  - `getCatalogImageUri(productId)` parses `product_id` as a base-10 integer. If the product is in either pack's extracted index (JP checked first), it returns the local file URI; otherwise it falls back to `https://tcgplayer-cdn.tcgplayer.com/product/{productId}_400w.jpg`. Use this helper everywhere an image is rendered; do not pass raw strings or uncast IDs.
  - `getLocalCatalogImageUri(productId)` returns local extracted images only (both packs) and is used by `EventSearchCard` so show browsing never falls back to the CDN.
- **Image rendering:** Use `expo-image` (`<Image>`) with `cachePolicy="memory-disk"` for persistent disk caching of CDN fallback images.
- **Catalog search:** `searchCatalogCards()` in `src/db/catalogDb.ts` supports punctuation-insensitive search, rarity filter, `maxPrice`, `productType`, and sort (`Newest`, `Name A-Z`, `Price: Low to High`, `Price: High to Low`). Price sort uses a canonical subtype expression (normal → holofoil → lowest positive) with a lookahead row to compute accurate `hasMore`. "Sealed Only" short-circuits to an empty page on every sort (no query, hasMore=false); cards-only retains all. Non-price sorts over-fetch a 4x buffer (min 200) only when a JS post-filter (variant productType or maxPrice) can drop rows — otherwise they fetch exactly limit.
- **Search normalization:** `normalizeSearch` has one owner: `src/utils/search.ts` (strips `'`, `’`, `-`, `.`, collapses whitespace — JS and SQL layers must agree). `normalizeSearchTerm` (no whitespace collapse, ASCII `'` only) is a *different* function also exported from `src/utils/search.ts` — keep both.
- **Market data:** `getProductMarketData()` and `getCardMarketAnalytics()` resolve the latest price for a requested variant with a canonical subtype fallback, plus 1d/3d/7d/30d and 90d high/low. `getProductMarketPrices()` is the latest-only twin (same canonical resolution, no history scan) used by the inventory hydration/write paths — callers that read window fields stay on `getProductMarketData()`.
- **Settings:** exposes `downloadLatestMarketPrices()` to refresh market data (only swaps `pokequant_catalog.db`, never images) and "Download Offline Images" → `ensureCatalogImagesDownloaded()` for users who skipped the pack during setup.
- All catalog requests use cache-busting query parameters and `Cache-Control: no-cache, no-store, must-revalidate` / `Pragma: no-cache` headers.

## Startup, Setup Gate & Subscription Gate

- `src/components/SetupGate.tsx` wraps `AppNavigator` in `App.tsx` after auth. Before any screen renders it: (1) verifies/downloads the catalog DB, (2) warms the extracted-image index via `warmCatalogImageIndex()` — which reads `catalog_images.manifest` as a fast path and otherwise scans the directory — and (3) if `catalog_images.ready` is absent, offers the ~1.8 GB offline image pack as an explicit, skippable step. All state is device-scoped and idempotent, so returning launches and re-logins pass through in milliseconds. Do not move image-index warming back onto per-screen lazy paths.
- `src/components/SubscriptionGate.tsx` renders `PricingPreview` as a full-screen overlay until the user subscribes or presses skip. It guards against Zustand rehydration flipping `hasSeenPricingPreview` after a skip by tracking a local `hasSkippedThisSession` flag. It configures RevenueCat on mount and loads the vendor profile so team/payment status is available for the paywall.
- `App.tsx` mounts `StoreInitializer` to configure RevenueCat and initialize auth. No automatic sync is triggered on foreground/mutation.

## Monetization & Feature Gating

- **Entitlements:** `Cardcache_pro` (all vendor features + unlimited scans) and `Cardcache_scan` (unlimited scans only — never unlocks vendor features). `subscriptionStore` exposes `hasVendorEntitlement()`/`hasScanEntitlement()`; reactive gating for components is `useVendorFeatures()`. SKU/offering/team detail: `docs/SUBSCRIPTIONS.md`.
- **Scan meter:** `src/scanner/store/scanMeterStore.ts` — `FREE_DAILY_SCAN_LIMIT = 15`, `SCAN_TRIAL_DAYS = 7`. Trial stamps `installedAt` on first Scan-tab visit; count increments per successful `processPhoto` only. Device-local (AsyncStorage) — reinstall resets. Fail-open by contract: meter errors must never block a scan.
- **Hard-block UX:** over-limit shutter presses open `ScanLimitSheet` without taking a photo; "Not now" keeps the shutter gated until local-midnight rollover or an entitlement. The counter pill shows trial days, then daily scans left; entitled/vendor/team users never see it.
- **`payments_live` semantics:** the Turso `app_config` flag gates vendor features only; it does NOT control the scan meter or the ability to purchase. Keep it `0` during launch — vendor surfaces show the "free during launch" banner instead of a wall.
- **Worker product hygiene:** `worker_show_vendor.js` `NON_VENDOR_PRODUCTS` keeps `cc_scan_*` out of `vendor_subscriptions`, and the webhook skips events whose `entitlement_ids` lack `Cardcache_pro`. Never map a scan product to `Cardcache_pro`.

## Track 3: Show-Vendor & Pre-Show Catalog

### Vendor flow

- `ShowVendorScreen` uses `useShowVendorStore`; brain in `hooks/useShowVendor.ts`.
- It has two tabs: **Pick Cards** (selects from active inventory with search) and **My Listings** (already-uploaded rows).
- Vendor enters `vendor_name` and `vendor_table`; the defaults come from `useShowVendorStore.profile` / `setups[showId]`.
- **Feature gating:** vendor features are available when `paymentsLive` is false, or when the profile has `isVendor`, `isTeamMember`, or the RevenueCat `Cardcache_pro` entitlement is active (`useVendorFeatures()` for reactive reads). `isFounder` is a founder seat/discount label and does not grant access without an active subscription or active team membership. Show reporting/publishing is gated by this.
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

## Card Scanner (Scan tab)

The standalone `CardCacheScanner` pipeline is integrated as a dedicated `Scan` bottom tab (`src/screens/ScannerScreen.tsx` + `src/scanner/*`), ported in commit `fa9fe67`.

- **Camera lifecycle:** bottom tabs keep the screen mounted, so `useIsFocused()` + `AppState` drive `<CameraPreview isActive>` — the session stops when another tab is selected or the app backgrounds. The shutter is also gated on VisionCamera `onStarted`/`onStopped` callbacks (`sessionRunning`); `capturePhoto` before session start throws `AVFoundationErrorDomain -11800`. A `camEpoch` remount + permission retry covers stuck first-run states.
- **Assets:** `ScannerAssetService.ts` checks/downloads detector + MobileCLIP models and the embedding sidecar from R2 `pokequant-db` `scanner/*` into `Documents/scanner/`; missing assets route to `ScannerDownloadGate` (~140 MB explicit download). Fully offline afterward. When `catalogJpImagesReady()` is true it also fetches the optional JP sidecar (`scanner/catalog_embeddings_jp/*`, marked `optional` — failures never block the base bundle and partial pairs are cleaned up for retry). `EmbeddingCache` merges the JP sidecar into the same `productId → Float32Array` map; product IDs are globally unique so EN/JP rows cannot collide.
- **Pipeline (`processPhoto.ts`):** photo → 1280px resize → TFLite detector (`CardDetector.ts`; on miss, crop falls back to the guide rect) → top/bottom focus crops → OCR → catalog text match (`catalogMatcher.ts`) → MobileCLIP embedding (`VisualEmbedder.ts`) → cosine against the sidecar (`EmbeddingCache.ts`) → `confidenceFusion.ts` → `MatchReviewSheet` or auto-confirm.
- **OCR must stay serialized.** `TextRecognition.ts` queues `recognizeText` calls — the native library stores one shared callback, so concurrent invocations overwrite it and abort the process.
- **Catalog warm-up:** `loadScannerCatalog()` loads card metadata only — never `price_history` (the full-table GROUP BY cost ~20 s on device). `hydrateVariantPrices(cards)` resolves latest prices for just the ~30 visible candidates via `getLatestSubTypePricesForProducts`; `addScannedCards` re-resolves authoritative prices via `getProductMarketPrices` at write time.
- **Embedding sidecar:** manifest `{dimension, floatBytes, count, productIds[], offsets[]}` + `embeddings.bin`; `loadBinarySidecar()` builds `Float32Array` views per row. It loads in the background on tab entry — scans `await loadBinarySidecar()` to join the in-flight promise rather than skipping visual matching. `startPrecompute` is a kept-for-parity no-op.
- **Variants vs finishes:** catalog variants are different `productId`s (printings); finishes are `price_history.sub_type` (Normal / Holofoil / Reverse Holofoil / promos). `hydrateVariantPrices` stores *all* subtype prices on `card.variants` with the Normal-resolved default first; the review sheet and queue switcher expose finish chips, and `updateSubType` records the pick.
- **Pricing:** `src/scanner/utils/pricing.ts` mirrors `addScannedCards` — `priceForCondition` uses vendorStore `CONDITION_MODIFIERS`; `autoOffer`/`offerBreakdown` compute offer = tier % of conditioned market, sticker, profit. `customOffer` on a queued card passes through `toInventoryInput` as `amountPaid` (a preset `amountPaid` is honored verbatim at write); `applyDealTotal` prorates one negotiated total across the queue quantity-weighted and reconciles rounding cents on the biggest line. `replaceCard` clears `customOffer`; `updateSubType` keeps it.
- **Models:** TFLite interpreters are promise-cached on `globalThis` (`__cardDetectorModelPromise`, `__visualEmbedderModelPromise`); `warm*Model()` preloads them in the background so the first scan doesn't pay the parse cost. `react-native-fast-tflite` 3.0.1 runs through `patches/react-native-fast-tflite+3.0.1.patch` (patch-package).
- **NaN fp16 quirk:** MobileCLIP occasionally emits NaN on device; `VisualEmbedder` retries with dampened input (0.95, 0.85) — expected, not a bug.
- **Palette:** scanner UI uses `colors.*` tokens; the standalone's teal accent (`#2dd4bf`) was replaced by `colors.primary`. Keep new scanner UI on tokens.
- **Do not bundle** the ~140 MB of models/sidecar into the app binary; they are runtime downloads from R2. The matching build tool is `CardCacheScanner/tools/build_embeddings.py`.

### Multi-vendor model

- `shows.vendor_id` is the organizer's vendor slug.
- `vendors.id` is the vendor slug (auto-generated from username). `vendors.is_organizer` is a manually-set Turso flag that grants organizer routes (`/shows`, `/vendors`, `/shows/{id}/registrations`); it is independent of paid-vendor gating.
- `vendor_show_registrations` controls access with `pending` / `approved` / `rejected` and doubles as the organizer ledger: `table_number`, `total_due`, `paid_amount`, `manual_name`, `manual_phone`. Manual (non-app) vendors use synthetic `vendor_id` = `manual:{uuid}`.
- `public_show_inventory` holds per-vendor, per-show listings.
- `worker_show_vendor.js` enforces that only the show owner or an approved vendor can read/write listings, and only the owning vendor can update/delete a row.

### Organizer mode

- `OrganizerScreen` (`Shows` tab → "Organize" entry, gated on `profile.isOrganizer`) manages the organizer's shows: create/edit/unpublish (`POST`/`PATCH /shows`), attach app vendors or manual vendors (`POST /shows/{id}/registrations`), approve/reject requests with table + total due, record payments (`paid_amount`), assign tables, and send `sms:` deep-link balance reminders (iOS uses `&body=`).
- Vendors see **Request a table** on shows they don't own (`POST /vendor/shows/{id}/request` → `pending`); `GET /vendor/shows` returns `my_status`/`my_table` — only `owner`/`approved` count as access for publishing.
- `GET /vendor/balances` powers the unpaid-balance banner on the Shows tab for approved vendors owing money.
- Worker route params MUST be `decodeURIComponent`'d — `url.pathname` stays percent-encoded (`manual:` ids arrive as `manual%3A…`).

## Deal Engine & Analysis (1.2)

All deal logic lives in `src/scanner/services/deal/`; `DealAnalysisSheet.tsx` is the per-card surface and `SearchBuyScreen.tsx` hosts the buy scout. **Module map, sheet internals, trade evaluator, and the regression-harness inventory are in `docs/DEAL_ENGINE.md`** — the invariants below are the load-bearing contract and stay here.

### Two data surfaces — keep them coherent

- **Scalar path:** `CardSignal` stamps plus the `card_deep` join fields (`shelfPrice`, `shelfTests`, `cycleDays`, `medianBouncePct`, `targetPrice`). Drives badges, scout, shift tracker, and the first paint of stock health.
- **Deep path:** `buildSeriesFeatures` off `price_series` — analysis sheet and hydrated stock-health refinement. Features win over stamps once loaded (`features.ret*` > stamped `ret*`).
- **Every new classifier input must resolve on both paths through `resolveRangeEvidence(signal, features)`** — the shared evidence union in `evidence.ts` (re-exported via `dealClassify.ts`): series-fresh legs beat stamps; a window that resolves no floor is *blind* (the stamp's tests/cycle/bounce stand alone); on the same shelf (±8%) the better-resolved measure wins (max tests, in-band cycle, max bounce). Never read `features.*` raw when a stamped field exists too. Pipeline side: `quant/deep.py` (PokeQuant repo, `main` branch) computes `card_deep`; `ship.py` ships the whole table — adding a column = add it to the signal join in `catalogDb.ts`.
- **Deltas refresh data, not code.** The classifier is compiled into the app; `card_deep` stamps refresh with each catalog delta. Old catalogs without deep columns get `null` stamps and fall back to the series path — keep all deep fields nullable-tolerant.

### Invariants — each one fixed a real misread; do not regress

1. **New class only if the action changes.** Variants + notes carry the story when offer/bucket/trigger semantics are the same. The taxonomy is closed pending a proven action gap.
2. **Floor proximity is two-sided.** "At floor" ends ~3% under the shelf — below that is *through* the floor. A card deep through its shelf never counts as parked and never gets a pending `exit below` trigger (`triggerFor` distinguishes `floor ~$X` → `exit below $X` → `through ~$X — already cracked`).
3. **Suppression must be earned.** The `floorHeld` veto on `FREE_FALL` yields when the month still crashes (≤−10%): a dead bounce the floor *caught* stays `DEAD_STABLE`; a knife still falling on a dead floor is `FREE_FALL`.
4. **Weak floors aren't defended floors.** `medianBouncePct < 15` → "sell on the next bounce"/discount-out language, never "held".
5. **RANGE_PLAY needs a real range:** `floorTests ≥ 3`, cycle 21–180d, bounce ≥15%, price inside the range, **and ceiling ≥ ~60% of ATH** (a crater bottom on a launch crash is not a range — that's `BASE_FORMING`/slide). `failedBounce` inside a proven cycle is the down-leg completing — it does **not** disqualify.
6. **Revival veto:** `pctile1y ≥ 60` + `cagr > 10` = a compounder's dip being bought, not a quiet card waking → `STABLE_GROWER` (incl. the cagr 10–25 slow-climb band at pctile ≥60).
7. **Offer bands anchor to the vendor tier rate** — class factors adjust the tier (1.0 = tier rate); never stack two market discounts.
8. **Rounded-dollar economics:** sub-$3 swings and sub-$10 cards aren't inventory events — print dollars, not cent-percents; a $1.27 card is a $1 sticker either way.
9. **Honest language:** floors/ceilings are evidence ("held N×", "sat at this floor"), never forecasts ("will bounce").
10. **Cross-surface coherence:** badge = sheet headline = ownerNote = triggerRow = bucket = scout why-line = shift alert. The `cracked` ctx flows into `ownerNote`/`positionAction` so a note can never promise holding while the trigger says sell.
11. **RANGE_PLAY scout exposure is entry-only** — mid/exit positions never surface as buys. Floor-lane rows print floor/rhythm/room-to-ceiling so the ordering is legible.
12. **Young cards:** a launch decline isn't a lifecycle — `daysSinceAth` + a still-crashing `r30` keep a young card on a floor classified as a slide; `BASE_FORMING` requires a steadied month.
13. **The market base rate doesn't condition — don't fake "like this."** The `floor_hold` pattern pools every re-test (~53%, 341k cases): bucketing by test count gives 51–53% at every count, and by defense quality (next-peak ≥15%) only 53% vs 49% — same odds band. The engine line therefore says "Market-wide, floors:…" honestly; the per-card "like this" evidence is the analog line (`analogN`/`analogBounceN` = this card's own tests at THIS shelf). `pattern_stats` ships `floor_hold:defended`/`:soft` rows as the documented finding — app ignores them unless a future split actually moves the band.
14. **A fresh low is not a floor.** `low90d` is the card's own recent print — a falling card always sits near it (`price ≤ low90d × 1.05` is tautological for anything that dropped this week). Floor evidence means a shelf that was touched and left before: `onRealFloor(signal, features)` = series `atShelf`/`atFloor`/`floorPrice` proximity OR stamped `shelfPrice` proximity — never the raw low band. The same rule feeds `parkedOnFloor`, `onDefendedFloor`, `rotationBucket`'s `POST_SPIKE_BLEED` watch gate, and the floor-test badge. (Caught by the held-inventory audit: every low-based "floor" was a same-week fresh print; none was established.)
15. **Dead means flat — suppression is not flatness.** `DEAD_STABLE` requires `!stillBleeding && !possibleRange`. `possibleRange` (unproven cycler evidence, e.g. a stamped micro-chop cycle) benches the dump-family reads; it must never act as a flatness verdict — a suppressed bleeder lands `BASE_FORMING·testing` on a real floor or `DECLINER` otherwise. The spent-card floor test respects invariant 4: `medianBouncePct < 15` (feeble pops) demotes it back to `DECLINER`. (Caught by the same audit: the entire dead bucket was live knives.)

## Tooling & Stability Constraints

- **Terminal (Windows):** `Set-ExecutionPolicy Bypass -Scope Process -Force` and use `& "C:\Program Files\nodejs\npm.cmd" <command>` when PowerShell blocks npm.
- **Git commits:** single-line subject + body allowed; `git commit -m "..."`.
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

- `npm run typecheck` — TypeScript type check (`tsc --noEmit`).
- `npm test` — Jest unit-test suite.
- `npm run lint` — ESLint 9 flat config (`eslint-config-expo`): react-hooks compiler rules (refs-in-render, set-state-in-effect, purity), unused vars, import hygiene. Must exit clean before commit.
- `npm run lint:dead` — ts-prune unused-export sweep. Facade re-exports (`dealClassify.ts`, `catalogDb.ts`) produce expected hits; anything new beyond the baseline is rot — cut it. Regenerate baseline with `node tools/regen-dead-baseline.mjs` (never PowerShell `>` — it writes UTF-16).
- `npm run lint:ui` — design-token linter (required after any UI change).
- `npx expo-doctor` — Expo SDK dependency / environment validation.
- `tools/ui-screenshots.ps1` — Maestro flows + screenshot capture when a device/dev client is available (UI changes).

## Review workflow — tiered by change kind

Verification is the suite; review depth scales with risk:

- **Logic-only change inside a tested hook/service** (`useScanQueue`, `useEventList`, `useShowVendor`, `useVendorFeatures`, `useInventoryScreen`, `useAnalysisSheet`, deal services — anything pinned by `__tests__/`): `npm test` + `typecheck` + `lint` green is sufficient — the reviewer is optional. If the change dodges the tests' coverage, say so.
- **Structural refactor, moved code, or UI change:** run the `reviewer` subagent (canonical profile at repo-root `.devin/agents/reviewer.md`, mirrored at `PokeQuantMobile/.devin/agents/`) — it has exec access for `git diff`/`git show`, so the review is diff-aware, not vibes-aware. Custom agent profiles register at session build: a newly added/edited agent file is not usable until the next session. If `reviewer` fails to spawn, say so — do NOT silently substitute `subagent_explore` (it has no exec and cannot run git). UI diffs also run `lint:ui` + the `ui-verifier` agent + Maestro screenshots when a device is available.
- **Deal engine, sync/watermark, auth/crypto, scanner pipeline:** jest + reviewer are BOTH mandatory regardless of size — the blast radius justifies it.
- **Pure mechanical sweeps** (renames, dead-export cuts, lint fixes): `lint` + `typecheck` only; no subagent.

When the reviewer does run:

- Scope: only the files changed in the commit + their call sites. Read files directly; do not edit.
- Look for: DB write paths (upsert/dedupe/unique constraints, migrations needed), async/store races, read-check-write, dead code paths (zero-caller functions, unreachable UI), FlashList v2 discipline (memo'd rows, `useRecyclingState`, no `estimatedItemSize`, no `key` on recycled items, bounded containers), store-contract honesty (labels that lie), ES256/Turso/native-zip invariants, sync watermark handling, TZ/date math.
- Output: numbered [bug]/[edge]/[note] findings with file:line + fix, ending in a must-fix vs defer split.

Then: fix must-fixes (and cheap edges), update tests that encoded the bug, re-run the verification suite, and commit fixes as a separate "review fixes" commit. Defer list goes in the response, honestly.

## Session hygiene

A session's accumulated context is re-billed every turn — longer sessions cost progressively more per action, and correctness degrades as early context fades.

- **If the user's message starts a clearly different task** (different subsystem, different goal, or a new topic mid-flow), say so and suggest a fresh session — one line, then proceed with the answer. Sign: "the next thing would be its own commit/PR."
- **After a clean commit** is the natural session boundary — flag it when the next request is unrelated to what just landed.
- **If a correction has been given twice** on the same thing, recommend writing it into AGENTS.md and restarting rather than paying for the correction every future session.
- This is a heuristic nudge, not a sensor — fire on obvious task pivots, not on length anxiety.
