# PokeQuantMobile Agent Rules

## Monorepo Isolation

When working on the React Native / Expo mobile app, your scope is strictly confined to the `PokeQuantMobile/` directory. Never modify files in the monorepo root such as `app.py`, `sw.js`, `card_tool.py`, `index.html`, `worker.js`, or the root `AGENTS.md` / `global_rules.md`. If a mobile task requires changes to shared cloud or web infrastructure, surface the dependency to the user instead of editing root files.

## UI Thread Performance

You must never block the React Native JavaScript thread with synchronous, long-running work. Heavy inventory formatting, price calculations, or catalog hydration must be:

- Chunked into small batches (e.g., 50–100 items at a time).
- Deferred to `requestIdleCallback`/`setTimeout` or native module threads where appropriate.
- Avoided inside render methods and `useEffect` cleanup that would re-trigger during navigation.

## Database Architecture

All local data persistence in the Expo app must use `expo-sqlite`. The mobile app will connect to a local `pokequant.db` bundled or created on first launch. Data should be read through a thin SQLite wrapper and streamed to the UI via React hooks (`useState`, `useEffect`, custom `useQuery` hooks) so the interface remains responsive during large reads.

## No Web Hacking

The mobile app is a native iOS/Android build. Do not use WebAssembly, IndexedDB, Pyodide, browser Service Workers, or Streamlit/JS bridging workarounds inside the Expo app. Use native Expo and React Native primitives for storage, networking, and rendering.

## Verification Commands

After running `npm install` (or using the full-path `npm` equivalent), `node` and `npm` are not on the system `PATH` in this environment. Use the following command from `PokeQuantMobile/` to run the TypeScript type checker:

```powershell
& "C:\Program Files\nodejs\node.exe" node_modules\typescript\bin\tsc --noEmit
```

## New Component & State Conventions

The following modules have been added and should be maintained by future mobile work:

- `src/components/NumericStepper.tsx`: controlled numeric input with [-] / [+] buttons and `onBlur`/`onChange` validation. Use it for settings that require stepped numeric values.
- `src/components/SegmentedTabBar.tsx`: two-option segmented tab switch. Use `InventoryTab` (`'active' | 'analytics'`) for inventory screen sub-navigation.
- `src/components/InventoryActionTrays.tsx`: collapsible Add Asset and Bulk Import trays on the Active Inventory tab.
- `src/components/PerformanceAnalytics.tsx`: analytics dashboard with a time-horizon filter pill selector, 2x2 hero KPI grid, swipeable `View`-based chart carousel (revenue/profit velocity, margin waterfall, and price-tier breakdown), paginated Completed Sales stream with relative timestamps, and undo-to-inventory behavior.
- `src/context/VendorSettingsContext.tsx`: now stores `stickerRules` (`roundingMethod`, `cutoff`, `minSticker`) and exposes `getStickerPrice()`. Use `ROUNDING_METHODS` for the rounding-method dropdown.
- `src/context/InventoryContext.tsx`: now tracks `completedSales` and provides `undoCompletedSale()` to move a completed sale back into active inventory.

When editing these modules, keep the existing dark theme colors and avoid adding external native chart dependencies.

## Onboarding Tour Conventions

The onboarding flow is driven by `src/components/OnboardingTour.tsx` with shared simulation state in `src/context/TourContext.tsx`. Future tour work should follow these patterns:

- **Compact, bottom-anchored tooltips:** Tour guide cards should stay compact (e.g., `width: 80%`, reduced padding and type sizes) and anchor near the bottom of the screen so the focal UI at the top remains fully visible. CSS-in-JS triangle pointers should only render where intended and must point in the correct direction for the card's placement (e.g., `pointerAlignment: 'top'` for a bottom-anchored card, pointing up at the highlighted content).
- **Dominant z-index/elevation for the tour layer:** Give the tour `Modal`, overlay, and card `zIndex: 9999` and `elevation: 99` so the pointer/overlay renders above underlying screens such as `InventoryActionTrays`.
- **Simulated Search & Buy typing:** Do not mutate the real search query instantly. Use the split TourContext search state:
  - `tourSearchInput` drives the visible `TextInput` text.
  - `tourSearchFilter` is the committed catalog filter.
  - `tourSearchTyping` gates filtering off while the typing animation is in progress.
  - Characters are appended one-by-one (e.g., `setTimeout` per character). The catalog only filters and reveals result cards after typing completes and `tourSearchFilter` is set.
- **Smooth tray animations:** Use React Native `Animated` (e.g., `maxHeight` and `opacity` interpolation) for collapsible trays. Avoid instant conditional rendering that snaps open/closed. The `tourAddAssetOpen` flag in `TourContext` should trigger a smooth tray open during the Inventory tour step.
- **Settings scroll-to-focus:** When the tour reaches `SettingsScreen`, use `useFocusEffect` with a `ScrollView` ref to scroll the Tier Margins / focal content into view so it is visible above the bottom-anchored guide box.
- **No mock bubble artifacts:** Avoid rendering extraneous mock-action bubbles or random pointer artifacts. Simulated actions should be visible inside the actual UI (search bar, expanding tray) rather than in floating mock labels.
