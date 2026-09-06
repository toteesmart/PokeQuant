# PokeQuantMobile Global Architecture & Topology

PokeQuantMobile is an offline-first Expo / React Native companion syncing with a multi-tenant Turso cloud database via a Cloudflare Worker edge proxy. Authentication is handled by Supabase Auth.

## Headless Data Topology (V3)

Phase 1 (The Headless Sync Engine) and Phase 2 (UI Construction) are complete. The 2026-09-04 build was submitted to Apple TestFlight as a stable beta under the name **Card Cache by Totees Mart**. All UI components must source reactive state from Zustand stores and adhere to the UI Integrity Protocol.

1. **Local Storage (`pokequant.db`)**
   - Managed via `expo-sqlite`.
   - Tables: `inventory`, `vendor_settings`, `sync_metadata`.
2. **Supabase Auth**
   - `supabaseClient.ts` initializes the Supabase client with the project publishable key.
   - `sessionStorage.ts` persists the Supabase `Session` to `expo-secure-store` and exposes `getAccessToken()`.
   - `AuthContext.tsx` mirrors the Supabase session lifecycle, restores sessions on app start, and provides `signIn`, `signUp`, `resetPassword`, and `logout`.
   - **Edge Cryptography (ES256 JWTs):** Supabase uses ECC (P-256) asymmetric keys issuing ES256 tokens. The Cloudflare Worker verifies them via the Web Crypto API (ECDSA + SHA-256) against the Supabase JWKS endpoint, caching the JWKS public key in-memory for 5 minutes. NEVER revert the worker to HS256, RS256, or symmetric HMAC `SUPABASE_JWT_SECRET` verification.
3. **Zustand Store Layer** (Single Source of Truth)
   - `src/store/inventoryStore.ts` exports `useInventoryStore`: reactive active inventory, completed sales, sync status, pending sync count, and cloud sync actions. Replaces any legacy `InventoryContext`.
   - `src/store/vendorStore.ts` exports `useVendorStore`: reactive vendor settings, buy tiers, sticker rules, and cash/sticker offer helpers. Replaces any legacy `VendorSettingsContext`.
   - `src/store/progressStore.ts` exports `useProgressStore`: reactive catalog image zip download and `react-native-zip-archive` extraction progress.
   - `src/store/cartStore.ts` exports `useCartStore`: reactive lot cart, item totals, offer percentage, and `CartDrawer` visibility.
   - The headless sync engine (`cloudSync.ts`, `inventoryDb.ts`, `database.ts`) performs Drizzle + SQLite reads/writes and feeds the resulting state directly into these Zustand stores. React components must not perform database writes; they call store actions, and the store coordinates persistence and sync. This decouples database writes entirely from the React component tree.
4. **Cloud Sync Pipeline (`cloudSync.ts`)**
   - Authenticated via `Authorization: Bearer <access_token>` from the active Supabase session.
   - Endpoint: Cloudflare Worker (`https://pokequant.totees-mart.workers.dev`) relaying Turso `/v2/pipeline` via the standard Web `fetch()` API.
   - **Turso HTTPS Protocol:** All Turso database URLs configured in edge environment variables must use the `https://` scheme (e.g., `https://<db-name>.turso.io`). NEVER use `libsql://` for edge worker environment variables — `fetch()` cannot resolve it.
   - Operations are bidirectional: Push pending local mutations (`updated_at > sync_metadata.last_updated`), then pull remote mutations.
   - Network failures must be caught gracefully and return safely without crashing the headless engine.
5. **Data Parity with PWA:**
   - The Turso HTTP payload format requires mapping values explicitly to `{"type": "text", "value": "..."}`, `{"type": "integer", "value": "..."}`, or `{"type": "null"}`.
6. **Expo Go Deprecation:**
   - Expo Go is permanently deprecated. Because the app depends on native modules (`react-native-zip-archive`), all local execution requires a custom native development client (`npx expo run:android`, `npx expo run:ios`) or an EAS development build. Running the project in the Expo Go client will crash at the native boundary.

## File Registry & Component Map

- `src/api/supabaseClient.ts`: Supabase client initialization.
- `src/api/sessionStorage.ts`: SecureStore-backed session persistence and access-token retrieval.
- `src/api/cloudSync.ts`: The Turso edge-proxy fetch engine, HTTP REST translation, and chunking logic.
- `src/db/database.ts`: SQLite initialization, strictly mirroring the PWA schema.
- `src/db/inventoryDb.ts`: Headless CRUD operations for local inventory, enforcing strict LWW SQL statements.
- `src/store/inventoryStore.ts`: Zustand store for active inventory, completed sales, sync status, and cloud sync operations.
- `src/store/vendorStore.ts`: Zustand store for vendor settings, buy tiers, sticker rules, and cash/sticker offer computation.
- `src/store/progressStore.ts`: Zustand store for catalog image zip download and native extraction progress.
- `src/engine/SyncTestRunner.ts`: A logic-based execution script to instantiate the DB, mock a local change, push, pull, and log results.
- `src/store/cartStore.ts`: Zustand store for the floating lot cart. Replaces any legacy `CartContext`.
- `src/services/CatalogDownloadService.ts`: Downloads the remote `mobile_catalog.db` catalog from R2 and saves it locally as `pokequant_catalog.db`, deletes stale WAL/SHM sidecars, and publishes progress to `useProgressStore`.
- `src/screens/HomeScreen.tsx`: Dashboard with Quick Quote, Live Session, Resticker Radar, and Catalog Timestamp.
- `src/screens/InventoryScreen.tsx`: Horizontal 2-card carousel with `InventoryRow`, `InventoryCard`, and `VelocityBreakdown`.
- `src/screens/SearchBuyScreen.tsx`: Catalog search, auto catalog download, 2-column grid via `SearchCatalogRow`, and `CartDrawer` integration.
- `src/screens/SettingsScreen.tsx`: Dynamic buy tiers, slider, manual price refresh, and account deletion.
- `src/components/InventoryCard.tsx`: Memoized card for active inventory carousel with rigid `minHeight` and action buttons.

## Master Mobile Architecture Ledger

- **State Management Mandate (Zustand):** React Context must NOT be used for global state. All global data (inventory, vendor settings, sync status, catalog-download progress, and lot cart) is managed strictly via Zustand stores (`useInventoryStore`, `useVendorStore`, `useProgressStore`, `useCartStore`). Components must subscribe through granular selectors; never read the entire store object or cause parent re-renders that thrash child lists. Any references to `InventoryContext.tsx`, `VendorSettingsContext.tsx`, or `CartContext.tsx` are obsolete and must be removed.
- **The Headless Sync Engine to Zustand Bridge:** `cloudSync.ts` pushes local mutations (`updated_at > sync_metadata.last_updated`) to Turso via the Cloudflare edge and pulls remote rows using a strict Last-Write-Wins (LWW) `ON CONFLICT(id)` resolution. The headless Drizzle + SQLite engine feeds the resulting state directly into `useInventoryStore` and `useVendorStore`, decoupling database writes from the React component tree.
- **Type-Safe Sync Coercion:** Turso JSON payloads are normalized through `coerceInventoryRow()` and Drizzle's schema types before SQLite insertion. UUIDs must be generated via `expo-crypto` (hex string, no dashes).
- **Core Topology:**
  - `pokequant.db` (Tenant DB): Stores `inventory`, `vendor_settings`, `sync_metadata`.
  - `src/store/inventoryStore.ts` (`useInventoryStore`): Single source of truth for the React UI tree. Holds active inventory, completed sales, sync status, and pending sync count.
  - `src/store/vendorStore.ts` (`useVendorStore`): Single source of truth for vendor settings, buy tiers, sticker rules, and cash/sticker offer helpers.
  - `src/store/progressStore.ts` (`useProgressStore`): Tracks the catalog image zip download and `react-native-zip-archive` extraction progress.
  - `SyncButton.tsx`: The global header component that must react strictly to `useInventoryStore` selectors, not to context or rogue device events.
- **High-Performance Rendering (FlashList v2):** `FlatList` and bounded `ScrollView.map()` are banned for unbounded or image-heavy arrays. Use `@shopify/flash-list` (v2 API).
  - *FlashList Gotchas:* Do NOT pass an `estimatedItemSize` prop (v2 auto-measures). You MUST wrap rendered items in `React.memo()`. You MUST manage internal UI state using `useRecyclingState` from `@shopify/flash-list`. Do NOT use `key` props on recycled item components, as this breaks recycling.
  - *List Container Bounds:* Lists must be wrapped in a parent container with explicit block dimensions (e.g., `flex: 1` or rigid height) per the UI Integrity Protocol.
- **UI Integrity Protocol (The Overlap Rule):** Before committing any layout change, verify that containers use rigid block models (explicit height, `minHeight`) or properly bounded flex properties. Never use `position: 'absolute'` inside a flex grid unless explicitly overriding a zero-height collapse.
- **Future Feature Data Sourcing (Graphs/Analytics):** ALL future visual modules (charts, velocity tracking, portfolio tables) MUST source their data strictly by querying the local `pokequant.db` SQLite tables (`inventory`, `price_history`) or from the Zustand store layer. Never fetch analytics directly from the network.

## TestFlight Beta Build (2026-09-04)

The 2026-09-04 commit stream stabilized PokeQuantMobile for Apple TestFlight. The following architecture and constraints are now locked for the beta.

### Release Configuration
- `app.json` displays the app as **Card Cache** with the subtitle **by Totees Mart** on the login screen.
- Expo owner is `toteesmart`; bundle ID is `com.toteesmart.PokeQuantMobile`.
- `eas.json` production submit profile points to App Store Connect `ascAppId` `6808830780` using `AuthKey_4CGR6RY3XZ.p8`. The `.env.eas` file is ignored.
- Do not change the `app.json` name, owner, or `eas.json` submit block without an explicit release-planning reason.

### Catalog & Offline Markets
- `CatalogDownloadService.ts` downloads the remote `mobile_catalog.db` catalog from R2 and saves it locally as `pokequant_catalog.db` in `expo-file-system`'s `SQLite` directory, deletes stale `-wal`/`-shm` sidecars, and tracks progress in `useProgressStore`.
- Cache-busting query params and anti-cache headers (`Cache-Control`, `Pragma`) are required on every catalog download.
- `SearchBuyScreen` auto-initiates `ensureCatalogDownloaded()` when the catalog is missing.
- `SettingsScreen` exposes a manual `downloadLatestMarketPrices()` action that re-initializes the catalog Drizzle instance on every DB swap.
- `useProgressStore` is the single source of truth for `isCatalogReady`, `catalogDownloadProgress`, `catalogDownloadPhase`, `catalogLastUpdated`, and image extraction progress.

### UI Modules (TestFlight Stable)
- **HomeScreen**: Quick Quote, Live Session, Resticker Radar, Catalog Timestamp.
- **InventoryScreen**: Horizontal 2-card carousel with `InventoryRow`/`InventoryCard`, Quick View, search, action trays, and `VelocityBreakdown`.
- **SearchBuyScreen**: Auto catalog download, filter dropdowns, 2-column grid via `SearchCatalogRow`, floating cart bar, and `CartDrawer`.
- **SettingsScreen**: Dynamic buy tiers with `@miblanchard/react-native-slider`, validated margin inputs, manual price refresh, and account deletion.
- **LoginScreen**: `Card Cache by Totees Mart` branding, logo, and Instagram/Discord links.

### Cart & Lot Architecture
- `useCartStore` (`src/store/cartStore.ts`) owns the lot cart state, totals, and drawer visibility. `CartContext` is obsolete and must not be reintroduced.
- `CartDrawer` (`src/components/CartDrawer.tsx`) is toggled from the cart bar and any screen that adds to the lot.

### Stability Constraints
- No `Expo Go`; use custom dev clients or EAS builds.
- No JavaScript unzippers for catalog assets; use `react-native-zip-archive`.
- No React Context for global state; use Zustand with granular selectors.
- No `estimatedItemSize` on `FlashList` v2; use `React.memo()` rows and `useRecyclingState` for item state.
- No unbounded lists; containers must have explicit block dimensions.
- `InventoryCard` must receive a `minHeight` of at least `460` from the carousel row and use `justifyContent: 'space-between'` to prevent action-button cutoff.
