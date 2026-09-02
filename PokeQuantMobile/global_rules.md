# PokeQuantMobile Global UI/UX & Component Standards

PokeQuantMobile is the offline-first Expo / React Native companion app to the PokeQuant PWA. It shares the same Turso cloud schema and Cloudflare Worker edge proxy, but uses `expo-sqlite` for local storage and React Native for rendering.

## Core Architecture

- **Frontend / Runtime:** React Native 0.81.5 + Expo 54, TypeScript 5.9.
- **Navigation:** React Navigation bottom-tabs (`src/navigation/AppNavigator.tsx`) with Home, Search & Buy, Inventory, and Settings.
- **Local Storage:** `expo-sqlite` (`pokequant.db`), initialized in `src/db/database.ts`.
- **Cloud Sync:** `src/api/cloudSync.ts` batches inventory `INSERT OR REPLACE` statements to the Cloudflare Worker, authenticated by the `X-Beta-Key: userId` header.
- **Offline-First:** The app works without network; cloud sync is explicit via the header `SyncButton`.
- **State:** React Contexts in `src/context/` (`Auth`, `VendorSettings`, `Inventory`, `Cart`).

## Theme Strictness

Canonical dark palette from `src/constants/colors.ts`:

- Background: `#0e1117`
- Surface: `#161b22`
- Surface light: `#1f242c`
- Border: `#30363d`
- Primary: `#3b82f6`
- Text: `#c9d1d9`
- Muted: `#8b949e`
- Success: `#22c55e`
- Error: `#ef4444`

Borders are low-contrast, shadows are subtle, and pure-white / light gray page surfaces are avoided.

## Component Strategy

- Use `FlatList` for long vertical and horizontal lists.
- Use `FlatList` with `pagingEnabled` and `snapToInterval` / `snapToAlignment` for horizontal carousels; do not calculate tile positions manually.
- Keep component trees shallow; extract repeated UI into small, memoized presentational components.
- Use `React.memo` and `useMemo` for expensive render paths, especially inventory rows, sale metrics, and chart data.
- No heavy chart libraries. Charts are `View`-based bars and points inside `PerformanceAnalytics.tsx`.

## Form Inputs

All numeric inputs use controlled React Native `TextInput`:

- Reject non-numeric characters in `onChangeText`.
- Parse with `Number.parseFloat` / `Number.isNaN` before saving.
- Clamp and step values where appropriate.
- Use `NumericStepper` for settings that require stepped numeric values.
- Never mirror the web app's `st.number_input` pattern; the mobile app has no Streamlit dependency.

## Navigation

Use React Navigation paradigms for all user flows:

- Open card management and data entry in modal screens or bottom sheets.
- Use `navigation.navigate()` / `navigation.push()` for drill-down views.
- Maintain a single source of truth in React Navigation, not parallel `session_state` flags.
- Do not recreate Streamlit conditional popovers, sidebars, or hidden panels inside the Expo app.

## File Registry & Component Map

- `App.tsx`: Root component. Wraps providers and renders `LoginScreen` or `AppNavigator`.
- `index.ts`: Registers the root component and enables `react-native-screens`.
- `src/navigation/AppNavigator.tsx`: Bottom-tab navigator with custom header `SyncButton` and `LogoutButton`.
- `src/screens/HomeScreen.tsx`: Vendor command center. Hero dock, session pulse, market watch, recent activity, and modals for quick cash offer and rapid add card.
- `src/screens/SearchBuyScreen.tsx`: Catalog search with filters (rarity, product type, max price, sort), horizontal `FlatList` of `SearchResultCard`, velocity pills, 90-day range, "Log to Inventory" / "Log to Cart", and the `CartDrawer`.
- `src/screens/InventoryScreen.tsx`: Uses `SegmentedTabBar` to switch between Active Inventory and Performance Analytics. Active tab contains `InventoryActionTrays`, `QuickViewPanel`, a paginated 2x2 floating-card carousel (4 cards per page), and `VelocityBreakdown`. Analytics tab renders `PerformanceAnalytics`.
- `src/screens/SettingsScreen.tsx`: Buy tier editing, sticker price rules (rounding method, cutoff threshold, minimum sticker), and tour relaunch.
- `src/screens/LoginScreen.tsx`: Closed-beta login with profile-name confirmation and social links.
- `src/components/AddAssetForm.tsx` / `AddAssetModal.tsx`: Manual inventory entry form with validation.
- `src/components/EditAssetModal.tsx`: Inline modal for editing an active asset.
- `src/components/QuickCashOfferModal.tsx`: Computes the vendor cash offer from a raw market price.
- `src/components/InventoryActionTrays.tsx`: Collapsible Add Asset and Bulk Import accordion trays.
- `src/components/PerformanceAnalytics.tsx`: Time-horizon filter pills, 2x2 hero KPI grid, horizontally-paged `View`-based chart carousel (revenue/cost velocity, margin waterfall, price-tier breakdown), and paginated Completed Sales stream with undo.
- `src/components/SegmentedTabBar.tsx`: Two-option tab switch (`active` | `analytics`).
- `src/components/NumericStepper.tsx`: Controlled stepped numeric input with `[-]` / `[+]` buttons and `onBlur` / `onChange` validation.
- `src/components/Dropdown.tsx`: Custom expandable dropdown for form selects.
- `src/components/Slider.tsx`: Custom pan-responder slider for range inputs.
- `src/components/SyncButton.tsx`: Header sync button with fatal-error alert and pending-count badge.
- `src/components/CartDrawer.tsx`: Right-side lot cart drawer with totals, offer percent, and remove.
- `src/context/AuthContext.tsx`: Login state and `userId`.
- `src/context/VendorSettingsContext.tsx`: Buy tiers, `stickerRules`, `getCashOffer`, `getStickerPrice`, and tour state.
- `src/context/InventoryContext.tsx`: Active inventory, completed sales, pending sync, `triggerSync`, `clearPendingSyncs`, add/update/remove/sell/undo.
- `src/context/CartContext.tsx`: In-memory lot cart with `addToCart`, `removeFromCart`, totals.
- `src/db/database.ts`: `expo-sqlite` init, schema, `generateId()`, tour/settings helpers.
- `src/db/inventoryDb.ts`: Active and completed inventory queries and upserts.
- `src/db/syncDb.ts`: Pending sync count, `last_updated`, `clearPendingSyncs`.
- `src/api/cloudSync.ts`: Worker / Turso batch sync, `SyncFatalError`, fatal-message detection, and placeholder validation.
- `src/constants/colors.ts`: Canonical dark palette.
- `src/constants/api.ts`: Worker URL and `SYNC_BATCH_SIZE = 500`.

## Technical Stack

- **Languages:** TypeScript, SQL, JavaScript
- **Frameworks:** React Native, Expo
- **Databases:** SQLite (`expo-sqlite`), Turso LibSQL (cloud)
- **Key Libraries:** `expo-crypto`, `expo-sqlite`, `@react-navigation/bottom-tabs`, `@react-navigation/native`, `react-native-safe-area-context`, `react-native-screens`

## Critical Cloud-Sync & Schema Constraints

- **Tenant Isolation:** Every Worker request must send the `X-Beta-Key` header set to the current `userId` from `AuthContext`.
- **Sync Queue Parity:** `cloudSync.ts` validates SQL placeholder / argument counts and throws `SyncFatalError` on mismatch. Corrupted queue items must not be retried forever; the UI offers a "Clear Stuck Queue" action.
- **Turso `inventory.id` Type:** Local and cloud `inventory` must use `id TEXT PRIMARY KEY` to match the UUID hex IDs from `expo-crypto`. Never use an `INTEGER PRIMARY KEY` rowid alias.
- **Sync Failure Recovery:** Fatal SQLite / Turso errors (`datatype mismatch`, `syntax error`, `wrong number of arguments`, etc.) set `syncFatalError` and log to console. The queue is not auto-flushed; the user must explicitly clear it.
- **Pending Syncs:** Rows with `updated_at > sync_metadata.last_updated` are pending. `clearPendingSyncs` sets `last_updated` to `MAX(updated_at)` so the app can continue syncing.
- **Batch Size:** `SYNC_BATCH_SIZE = 500`. Each chunk is sent with a final `sync_metadata` update and a `close` statement.
