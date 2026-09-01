# PokeQuantMobile Global UI/UX & Component Standards

## Theme Strictness

All styling in the Expo app must adhere to a strict dark mode theme. The canonical background color is `#0e1117`. Ensure that:

- Borders use low-contrast tones (e.g., `#30363d`) so they do not visually shout against the dark canvas.
- Shadows are subtle and do not assume a light-mode elevation model.
- Text colors provide strong contrast against `#0e1117`: primary text `#c9d1d9`, secondary text `#8b949e`, and accent/brand colors (e.g., `#58a6ff`) for interactive elements.
- Avoid pure white (`#ffffff`) backgrounds and light gray page surfaces.

## Component Strategy

Avoid deep DOM-style nesting and complex manual grid math. Prefer React Native primitives and layout helpers:

- Use `FlatList` for long vertical and horizontal lists.
- For horizontal carousels (e.g., featured cards, set highlights), use `FlatList` with `pagingEnabled={true}` and `snapToInterval`/`snapToAlignment` instead of calculating tile positions manually.
- Keep component trees shallow; extract repeated UI into small, memoized presentational components.
- Use `React.memo` and `useMemo` for expensive render paths, especially inventory rows and price calculations.

## Form Inputs

All numeric inputs—such as valuation tiers, margins, purchase price, sticker price, and bulk deal settings—must use controlled React Native `TextInput` components. Apply strict numeric validation:

- Reject non-numeric characters at the `onChangeText` handler.
- Parse and clamp values with `Number.parseFloat` / `Number.isNaN` before saving.
- Never mirror the web app's `st.number_input` pattern; the mobile app has no Streamlit dependency.
- Provide inline error text when a value is out of range or malformed.

## Navigation

State transitions and user flows must use React Navigation paradigms. Use stack pushes, modal opens, and tab switches for moving between screens. Do not recreate Streamlit's conditional popover or sidebar rendering inside the Expo app. For example:

- Open a card's manage options in a modal screen or bottom sheet, not a hidden conditional panel.
- Use `navigation.navigate()` or `navigation.push()` for drill-down views.
- Keep a single source of truth for the active route in React Navigation, not parallel `session_state` flags.

## New UI Modules

The inventory screen now uses a local `SegmentedTabBar` to switch between:

- **Active Inventory** — contains collapsible `InventoryActionTrays` (Add Asset & Bulk Import), the Quick View metrics panel, and the paginated 2x2 floating card carousel.
- **Performance Analytics** — shows a time-horizon filter (Today / 7D / 30D / All), a 2x2 hero KPI grid, a horizontally-paged `View`-based chart carousel (revenue/profit velocity, margin waterfall, price-tier breakdown), and a paginated Completed Sales stream with `Undo` that pushes the transaction back into active inventory.

Charts must remain lightweight: use `View`-based bars/points, not `react-native-svg` or heavy chart libraries. The Performance carousel uses `FlatList` with `pagingEnabled={true}` and dot indicators.

Action trays are collapsible accordion sections at the top of the Active Inventory tab. The Add Asset tray collects manual card inputs and appends to `inventory` via `addInventoryCard()`. The Bulk Import tray renders a dashed dropzone and simulates a spreadsheet import for immediate testing.

The Sticker Price Rules settings (in `SettingsScreen.tsx`) drive `getStickerPrice()` in `VendorSettingsContext.tsx`; default rounding is `Custom Cutoff` with cutoff `0.30` and minimum sticker `1.00`.
