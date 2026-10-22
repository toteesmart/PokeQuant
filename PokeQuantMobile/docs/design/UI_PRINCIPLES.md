# Card Cache — UI Principles

The shared context for every agent that touches the mobile UI. Read this
before changing anything the user sees. It separates **invariants**
(engine/platform physics — never negotiable) from **conventions**
(our design system — follow, or flag with evidence).

> If a convention fights the work, don't silently break it — propose the
> change with a screenshot or measurement. Conventions evolve on evidence;
> invariants don't.

---

## 1. Invariants (physics, not style)

These protect runtime correctness. The verifier treats violations as FAIL.

- **FlashList v2 discipline** — `React.memo()` row components,
  `useRecyclingState` for recycled state, no `estimatedItemSize`, no `key`
  props on recycled items, **bounded containers** (a FlashList needs a
  flex-bounded or fixed-dimension parent; never nest a vertical list
  inside a vertical `ScrollView`).
- **`expo-image` everywhere** with `cachePolicy="memory-disk"`. No RN
  `Image`, no other caching policy.
- **Manual sync only** — UI may show sync state but never auto-trigger it.
- **No image-pack downloads from show screens** — the ~1.8 GB pack is an
  explicit choice in Setup/Settings only.
- Touch targets ≥ **44×44 pt** on all interactive elements.

## 2. Tokens (enforced by `npm run lint:ui`)

All color, font-size, radius, and weight values come from
`src/constants/colors.ts` + `src/constants/theme.ts`. The linter fails on
raw hex/`rgba()`/named colors, off-scale `fontSize`/`borderRadius`, and
`fontWeight: 'bold'` outside the token files.

- **Colors** — semantic names only (`colors.text`, `colors.surface`,
  `colors.primary`, tints/overlays/scrims). Tint families: `primary{Soft,
  Tint,Strong}`, `success{Tint,TintStrong,Highlight}`, `error{...}`,
  `warning{...}`, `pro{...}`, `overlay1–5|Strong|Bright`, scrims
  (`backdrop`, `backdropHeavy`, `scrimDark`, `scrimDeep`, `scrimOpaque`).
- **Type scale** (`type_`): 9/10/11/12/13/14/15/16/18/24. Weights
  (`weight`): 500/600/700/800 — `'700'`, never `'bold'`.
- **Radius** (`radius`): badge 4 · thumb 6 · control 8/10 · card 12 ·
  cardLg 16 · sheet 20 · pill 999. A circle is `999`, not `width/2`.
- **Controls**: input 44, button 46, chip 28, min touch 44.
- **Escape hatch**: a justified literal gets `// token-ok <reason>` on the
  line — the linter skips it, the verifier reads the reason.

### Snap policy (the codemod's rounding law)

`tools/codemod-tokens.mjs` maps off-scale values to the nearest scale
step: sizes drift ±2 pt, radii snap to the nearest named step, `Radius ≥
29` on circle-shaped elements becomes `999` (identical render). Known
intentional deltas from the 2026-02 codemod: Login CTA `#238636` green →
`colors.primary` blue (brand unification); SearchCard CTA `#1f6feb` →
`colors.primary`; `rgba(255,255,255,0.05)` → `overlay2`; scrim alphas
0.55–0.96 consolidated into the five scrim tokens.

## 3. Layout & chrome

- **Screen padding**: 16 horizontal, 12 top, 8 bottom. Card-grid gutters
  align to the same 16 — a card edge always lines up with the screen
  title above it.
- **No nav header** — the app header is gone. Global actions live in
  `ui/TopChrome`: a floating frosted-glass row (`BlurView` + `overlay3`
  + hairline `border`, same recipe as the pill rail and tab bar).
  `left`/`right` take action circles (`SyncButton`/`SettingsGear` with
  `variant="glass"`); `center` takes an optional centered label or the
  segmented rail. Content pads itself with
  `insets.top + TOP_CHROME_CLEARANCE`. The image-pack
  download progress surfaces as a transient glass pill at top-center,
  mounted at nav level (hidden on Scan, whose camera HUD owns the top).
- **Segmented view switching** uses `ui/SegmentedPills` (TimeframeChips
  family: `radius.pill` chips, subtle `surface` fill on the active
  pill, optional icon). In-page segments render inline (`overlay2`
  rail); Inventory's rail floats in `TopChrome`'s `center` slot between
  the sync and settings circles (`glass`, tightened chips). Chips
  ellipsize rather than collide on narrow widths.
  Never a hand-rolled local tab bar.
- **Back affordances**: in-screen headers use `ui/GlassBackButton` —
  the frosted-circle back pill, not a bare chevron.
- **Cards**: soft-tint tiles, not boxes — `overlay2` bg, no border,
  `radius.card`/`cardLg`, `layout.cardPadding` (12). A `transparent`
  1 px border on the base keeps geometry constant when a selected state
  draws its `primary` border.
- **Signature patterns** (extracted from `DealAnalysisSheet`, the
  reference-quality surface — reuse before inventing new ones):
  - *Hero number pair*: `type_.display`/`title` figure + `DeltaPill`
    (`formatSignedCurrency`, caret icon, velocity tint).
  - *Module stat card*: `overlay2` tile → title + 24×3 accent bar
    (`radius.pill`, metric-colored) + label/value stat rows.
  - *Verdict badge row*: `DealClassBadge` + `ExplainChip`s, tappable
    glosses, `zIndex` above siblings so tips draw on top.
  - *Peek deck*: horizontal `FlashList`, `snapToInterval` +
    `decelerationRate="fast"`, ~2/3-width tiles with next-card peek —
    the browse idiom for picklists (`ScoutDeck`).
- **Sheets/modals**: `colors.sheet` bg, `radius.sheet` (20), scrim
  `backdrop`/`scrimDeep`. One canonical bottom-sheet idiom — conditional
  full-screen swaps and ad-hoc absolute overlays are legacy; new surfaces
  are routes or sheets, not `mode` state machines.
- **Destructive actions**: `error`/`errorTint` + an explicit confirm step
  (inline two-tap "Sure?" or Alert) — never a bare delete icon.

## 4. Interaction contract

Every card-like surface obeys the same tap matrix. A first-time user must
find every action **without being told**.

| Target | Action |
|---|---|
| Card **image/thumb** | Opens `CardImageViewer` (full-bleed, tap-to-dismiss) |
| Card **name / verdict row** | Opens deal analysis sheet (underline + `analytics-outline` glyph = the affordance) |
| Card **body/row** | The row's primary job (select, navigate, edit) |

Rules:

- **Nothing reachable only by long-press.** Gestures may exist as
  shortcuts, never as the sole entry. Bulk-select has a visible "Select"
  affordance; long-press still works.
- Nested touchables: the inner control wins (image inside a tappable row
  opens the viewer, not the row action).
- Every icon-only control carries `accessibilityLabel` + a ≥44 pt target.
- Agent/agentic surfaces: agent output renders **inline** in standard
  components (badges, rows, sheets) — no bespoke "AI" chrome; reasoning is
  always visible (ExplainChip / evidence rows); agent-driven state changes
  are reversible (undo/dismiss affordances).

## 5. Information architecture

- **4 tabs**: Inventory (Cards / Resticker / Stats segments), Scan,
  Search & Buy, Shows. Settings lives behind the header gear — a utility,
  not a destination.
- **Feature placement follows the data it operates on**: radar repricing
  lives in Inventory, not a separate dashboard; session analytics merge
  into the Stats segment.
- Tabs are working surfaces, not content buckets — if a tab is opened
  less than daily, it's a segment or a sheet, not a tab.
- Android hardware back must never exit the app from an internal state —
  sub-screens and sheets dismiss first (full stack-nav migration will
  formalize this).

## 6. State contract (per list/grid surface)

Every data surface renders all four states deliberately:

- **Loading** — `ActivityIndicator` in `colors.primary`, centered.
- **Empty** — icon + one-line copy in `textMuted`, actionable where
  possible.
- **Error** — `error` text + retry affordance, never silent.
- **Refresh** — pull-to-refresh where the data is user-refreshable.

## 7. Verification loop (what "done" means for UI work)

1. `npm run lint:ui` — zero violations.
2. `npx tsc --noEmit` + `npx jest` — green.
3. Maestro flows (`maestro/flows/*.yaml` via `tools/ui-screenshots.ps1`)
   on the emulator — read the PNGs in `artifacts/ui-screens/`.
4. `ui-verifier` subagent pass on the diff — it reports PASS/FAIL +
   violations with `file:line` + screenshot evidence; an `UNVERIFIABLE`
   bucket for anything needing a human/device eye.
5. Human approval for taste. The loop catches breaks; taste stays yours.

## 8. The Card Cache visual identity (house style)

The app's look in one place — the "not default Expo" bar. This app has a
deliberate identity: a dark glass finance-tool aesthetic. Anything you
build should land in one of these families; if none fits, extend a
family — never invent new chrome.

- **Frosted-glass chrome** (floating, over content): `BlurView`
  (`intensity={30}`, `tint="dark"`) + `overlay3` + 1px `colors.border` +
  `radius.pill` + shadow/elevation 8. Members: `TopChrome` row,
  `GlassCircle` (`SyncButton`/`SettingsGear` `variant="glass"`),
  `SegmentedPills` `glass`, `FloatingTabBar`, `DownloadProgressPill`.
- **Glossy lifted module** (in-flow feature panels): `overlay3` + 1px
  `border` + `radius.cardLg` + shadow/elevation 8 + top sheen
  (`LinearGradient` `overlay4`→`transparent`, locations `[0, 0.55]`).
  Member: `StockHealthPanel`.
- **Soft tiles** (cards, list rows): `overlay2` + `radius.card`/`cardLg`,
  no border — a `transparent` 1px border where a selected state draws a
  `primary` one, so geometry never shifts.
- **Badge-pill actions** — THE action idiom inside content:
  `radius.pill` + `{color}Tint` bg + `{color}` 1px border + `{color}`
  label, optional chevron. `primary` is the app's action color; verdict
  colors carry semantics (`DealClassBadge`/`DeltaPill` are the same
  family). Members: "Stock list", search-bar "Select" chip.
  Never a solid block, never a bare text link.
- **Accent-bar stats** (inside modules): 3×14 `radius.pill` bar in the
  metric's color + `flex:1` label + bold right-aligned value. Module
  titles get the 24×3 accent bar underneath.
- **Hero number + delta pill**: `type_.display` figure + `DeltaPill`
  (caret + signed amount + basis, "vs $X paid").
- **Universal inline button**: `surface` + 1px `border` +
  `radius.control` + 44pt — the recipe for *field-like* triggers
  (Dropdown, Disclosure rows). Not for actions — actions are badge pills.
- **Glass circle actions**: 44pt `GlassCircle` for floating/global
  actions; `GlassBackButton` for back navigation — never a bare chevron.
- **Peek deck**: browse idiom for picklists (`ScoutDeck`) — snap+peek
  art tiles, tail "See all" affordance, and the section header itself is
  the direct shortcut to the full list.

## 9. Default-style audit (finding the holes)

"Default" = the unstyled Expo/RN look: solid bordered boxes, bare text
links, unicode-glyph dots, hand-rolled bars, form-kit triggers used for
actions. It survives inside the app on surfaces that predate the system.
To audit: run the grep sweeps below over `src/`, then judge each hit
against §8's families — a hit isn't automatically wrong, but it should
land in a family deliberately.

Grep seeds:

| Pattern | Usually means |
|---|---|
| `backgroundColor: colors.surface` + `borderWidth` + `borderColor` on one block | Boxed card → soft tile or glossy module |
| `activeOpacity`/`onPress` on a bare `Text` action | Text link → badge pill |
| `●` / `•` unicode glyphs in JSX | Dot legends → accent-bar rows / badges |
| `headerLeft` / `headerRight` on a navigator screen | Retired nav header → `TopChrome` (`headerRight` on `GlassSheet` and `headerTitle` style names are fine) |
| bare `chevron-back` at a header's left edge | → `GlassBackButton` |
| `Modal` + `absoluteFill` overlay combinations | Legacy sheet → `GlassSheet` |
| local `tabBar`/`tabRow`/`segmented` styles | Hand-rolled tabs → `SegmentedPills` |
| `fontSize`/`borderRadius`/`padding` literals in unlinted files | → token scale |
| `surface` fill + `radius.control` on a *pressable action* (not a field) | → badge pill, or universal inline button if it's a field-like trigger |

Severity guide: **blocker** — a §1 invariant broken; **major** — a
daily-use surface wearing default chrome; **minor** — a buried or
internal-tooling surface.
