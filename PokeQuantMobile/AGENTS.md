# PokeQuantMobile Agent Rules (Headless-First Architecture)

PokeQuantMobile is the offline-first Expo / React Native companion to the PokeQuant PWA, now released on Apple TestFlight as **Card Cache by Totees Mart**.
**CURRENT MANDATE:** Phase 1 (Headless Sync) and Phase 2 (UI Construction) are complete. The 2026-09-04 build is a stable TestFlight beta. All UI components must adhere to the UI Integrity Protocol, source reactive global state from Zustand stores (`useInventoryStore`, `useVendorStore`, `useProgressStore`, `useCartStore`), and preserve the catalog/offline flows documented below.

## Core Database & Sync Engineering
- **SQLite Engine:** All local persistence uses `expo-sqlite` wrapped with `drizzle-orm/expo-sqlite`. Multi-row writes are executed as single batched `insert().values()` statements or inside `db.transaction()` callbacks (the installed `expo-sqlite` Drizzle driver is synchronous, so callbacks must not be async).
- **UUID Schema Constraint:** The local and cloud `inventory` tables MUST use `id TEXT PRIMARY KEY`. Use `expo-crypto.randomUUID().replace(/-/g, '')` for ID generation. Never use an `INTEGER PRIMARY KEY` rowid alias. These are standard UUIDs stripped of dashes to guarantee collision-free offline row creation, NOT encrypted hashes.
- **Type-Safe Data Normalization (Drizzle):** The Turso edge JSON payloads return dynamic types. All values bound to SQLite are normalized through a single `coerceInventoryRow()` helper and the Drizzle schema:
  - Booleans (`is_sold`, `is_deleted`, `is_bulk_deal`) use `integer({ mode: 'boolean' })` — JS `true`/`false` are stored as `1`/`0`.
  - Integers (`product_id`) are parsed with `Number.parseInt(String(val), 10)` and are null when missing or zero.
  - Floats (`purchase_price`, `sticker_price`, `sold_price`) are parsed with `Number()` and default to `0.0`.
- **Last-Write-Wins (LWW) Resolution:** Remote pulls must never blindly overwrite local rows. Use an Upsert LWW statement:
  `INSERT INTO inventory (...) VALUES (...) ON CONFLICT(id) DO UPDATE SET ... WHERE excluded.updated_at > inventory.updated_at;`
- **Pushing Local Changes:** Instead of maintaining a fragile queue of raw SQL strings, push local mutations by querying `SELECT * FROM inventory WHERE updated_at > (SELECT last_updated FROM sync_metadata LIMIT 1)`. Chunk these rows into `SYNC_BATCH_SIZE = 500` and send as `INSERT OR REPLACE` payloads to the Cloudflare Worker.
- **Edge Cryptography (ES256 JWTs):** The project uses ECC (P-256) asymmetric keys, which issue tokens using the ES256 algorithm. The Cloudflare Worker proxy strictly verifies these using the Web Crypto API (ECDSA and SHA-256) against the Supabase JWKS endpoint, caching the JWKS public key in-memory for 5 minutes. Agents must NEVER revert the worker to use HS256, RS256, or symmetric HMAC `SUPABASE_JWT_SECRET` verification.
- **Turso Pipeline Protocol (HTTPS Only):** The Cloudflare Worker communicates with Turso's `/v2/pipeline` endpoint using the standard Web `fetch()` API. All Turso database URLs configured in environment variables must use the `https://` protocol scheme (e.g., `https://<db-name>.turso.io`). Agents must NEVER use `libsql://` for edge worker environment variables, as the fetch API cannot resolve it.
- **Native Extraction Mandate:** Never use JavaScript-based unzippers (e.g. `fflate`, `jszip`, or `pako`) for offline catalog asset bundles. All catalog zip extractions MUST use `react-native-zip-archive` so decompression runs off the JavaScript thread. Extraction progress is bridged through `useProgressStore` and must not be polled from the UI render tree.

## Tooling & Constraints
- **Terminal (Windows):** Always bypass execution policies and use explicit paths:
  `Set-ExecutionPolicy Bypass -Scope Process -Force`
  `& "C:\Program Files\nodejs\npm.cmd" <command>`
- **Git Commits:** Single-line messages only (`git commit -m "..."`). No multi-line blocks.
- **Expo Go Deprecation:** Expo Go is permanently deprecated for this project. Because the app depends on native modules (`react-native-zip-archive`), all local execution requires a custom native development client (`npx expo run:android`, `npx expo run:ios`) or a development build via EAS. Running the project in the Expo Go client will crash at the native boundary.

## Master Mobile Architecture Ledger

- **State Management Mandate (Zustand):** React Context must NOT be used for global state. All global data (inventory, vendor settings, sync status, catalog-download progress, and lot cart) is managed strictly via Zustand stores (`useInventoryStore`, `useVendorStore`, `useProgressStore`, `useCartStore`). Components must subscribe through granular selectors; never read the entire store object or cause parent re-renders that thrash child lists. Any references to `InventoryContext.tsx`, `VendorSettingsContext.tsx`, or `CartContext.tsx` are obsolete and must be removed.
- **Headless Sync Engine to Zustand Bridge:** `cloudSync.ts` remains the edge-facing sync engine, but local reactive state lives in Zustand. The Drizzle + SQLite engine writes to `pokequant.db` and then hydrates `useInventoryStore` and `useVendorStore`. Database writes and network sync are decoupled from the React component tree; components call store actions, and the stores coordinate persistence and sync.
- **Type-Safe Sync Coercion:** Turso JSON payloads are normalized through `coerceInventoryRow()` and Drizzle's schema types before SQLite insertion. UUIDs must be generated via `expo-crypto` (hex string, no dashes).
- **Core Topology:**
  - `pokequant.db` (Tenant DB): Stores `inventory`, `vendor_settings`, `sync_metadata`.
  - `src/store/inventoryStore.ts` (`useInventoryStore`): Single source of truth for the React UI tree. Holds active inventory, completed sales, sync status, pending sync count, and cloud sync actions.
  - `src/store/vendorStore.ts` (`useVendorStore`): Single source of truth for buy tiers, sticker rules, vendor settings, and cash/sticker offer helpers.
  - `src/store/progressStore.ts` (`useProgressStore`): Tracks the catalog image zip download and `react-native-zip-archive` extraction progress.
  - `SyncButton.tsx`: The global header component that must react strictly to `useInventoryStore` selectors, not to context or rogue device events.
- **High-Performance Rendering (FlashList v2):** `FlatList` and bounded `ScrollView.map()` are banned for unbounded or image-heavy arrays. Use `@shopify/flash-list` (v2 API).
  - *FlashList Gotchas:* Do NOT pass an `estimatedItemSize` prop (v2 auto-measures). You MUST wrap rendered items in `React.memo()`. You MUST manage internal UI state using `useRecyclingState` from `@shopify/flash-list`. Do NOT use `key` props on recycled item components, as this breaks recycling.
  - *List Container Bounds:* Lists must be wrapped in a parent container with explicit block dimensions (e.g., `flex: 1` or rigid height) per the UI Integrity Protocol.
- **UI Integrity Protocol (The Overlap Rule):** Before committing any layout change, verify that containers use rigid block models (explicit height, `minHeight`) or properly bounded flex properties. Never use `position: 'absolute'` inside a flex grid unless explicitly overriding a zero-height collapse.
- **Future Feature Data Sourcing (Graphs/Analytics):** ALL future visual modules (charts, velocity tracking, portfolio tables) MUST source their data strictly by querying the local `pokequant.db` SQLite tables (`inventory`, `price_history`) or from the Zustand store layer. Never fetch analytics directly from the network.

## TestFlight Beta Build Addendum (2026-09-04)

The 2026-09-04 commit stream stabilized PokeQuantMobile for Apple TestFlight beta. The following constraints and architecture are now in effect.

### App Identity & Release Configuration
- The shipping app name is **Card Cache by Totees Mart** (`PokeQuantMobile` slug remains for EAS).
- Expo owner is `toteesmart`; iOS bundle identifier is `com.toteesmart.PokeQuantMobile`.
- `eas.json` production submit profile targets App Store Connect `ascAppId` `6808830780` with the `AuthKey_4CGR6RY3XZ.p8` API key. The `.env.eas` file is gitignored for secrets.
- Do not revert `app.json` name, owner, or `eas.json` submit configuration; these are required for the live TestFlight pipeline.

### Completed UI Surface (TestFlight Stable)
- **HomeScreen** (`src/screens/HomeScreen.tsx`): Dashboard with Quick Quote, Live Session analytics, Resticker Radar, and Catalog Timestamp. All data is computed from `useInventoryStore` and `useVendorStore`; no network analytics calls.
- **InventoryScreen** (`src/screens/InventoryScreen.tsx`): Horizontal 2-card carousel (`FlashList` `horizontal`, `pagingEnabled`, `showsHorizontalScrollIndicator={false}`) using `InventoryRow` and `InventoryCard`. Includes Quick View stats, search, `InventoryActionTrays`, and `VelocityBreakdown`.
- **SearchBuyScreen** (`src/screens/SearchBuyScreen.tsx`): Auto-initiates catalog download when no local catalog exists, renders a 2-column grid via `SearchCatalogRow`, and drives the floating `CartDrawer` through `useCartStore`.
- **SettingsScreen** (`src/screens/SettingsScreen.tsx`): Dynamic buy tiers with `@miblanchard/react-native-slider`, margin inputs with validation, manual offline market-price refresh (`downloadLatestMarketPrices`), and account deletion.
- **LoginScreen** (`src/screens/LoginScreen.tsx`): `Card Cache by Totees Mart` branding, `toteesmartlogo.jpg` logo, and Instagram/Discord social link footer.

### Catalog Download & Offline Price Flow
- `CatalogDownloadService.ts` downloads `pokequant_catalog.db` into the `expo-file-system` `SQLite` documents directory.
- Before a fresh download, stale WAL/SHM sidecars are deleted and the Drizzle catalog DB handle is closed to avoid locked-file races.
- Requests use cache-busting query parameters and `Cache-Control: no-cache, no-store, must-revalidate` / `Pragma: no-cache` headers.
- Progress is published through `useProgressStore` (`isExtracting`, `catalogDownloadProgress`, `catalogDownloadPhase`, `catalogLastUpdated`, `isCatalogReady`).
- `SearchBuyScreen` auto-initiates `ensureCatalogDownloaded()` when `isCatalogReady` is false.
- `SettingsScreen` provides a manual `downloadLatestMarketPrices()` refresh that re-initializes the catalog Drizzle instance on every DB swap so stale handles do not crash searches.

### State Management Additions
- `useCartStore` (`src/store/cartStore.ts`) is the single source of truth for the lot cart. `CartContext` is obsolete; do not reintroduce it. Cart drawer state (`isDrawerOpen`), item totals, and offer percentage are derived in the store.
- `useProgressStore` now tracks both catalog DB download and catalog image zip extraction. It is persisted via `zustand/middleware` + `AsyncStorage`, storing only `catalogLastUpdated`.
- `useInventoryStore` and `useVendorStore` remain the authoritative sources for inventory and vendor settings.

### FlashList Row Extraction
- `InventoryRow` (`src/screens/InventoryScreen.tsx`) and `SearchCatalogRow` (`src/screens/SearchBuyScreen.tsx`) are `React.memo()`-wrapped row components rendered by `FlashList`. They receive layout dimensions and pass them to `InventoryCard` / `SearchCard` to prevent zero-height collapses.
- `InventoryCard` receives a `minHeight` of at least `460` from the carousel row and uses `justifyContent: 'space-between'` between the card body and action buttons to prevent overlap. Images use `resizeMode="contain"` and a safe fallback width.

### TestFlight Stability Constraints
- Do not use `Expo Go` for testing; the app depends on `react-native-zip-archive` and custom dev clients (`expo run:ios` / `expo run:android` or EAS builds).
- Do not use JavaScript unzippers (`fflate`, `jszip`, `pako`) for catalog assets; always use `react-native-zip-archive`.
- Do not reintroduce React Context for global state; use Zustand stores with granular selectors.
- Do not pass `estimatedItemSize` to `FlashList` v2; wrap items in `React.memo()`, use `useRecyclingState` for item-level state, and never add `key` props to recycled row components.
- Do not render unbounded lists; all list containers must have explicit block dimensions (`flex: 1` or rigid `height`).
