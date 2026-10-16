# Work Queue — gated investments, one per session

Session contract: take **exactly one unchecked item**, work it to green
(`npm test` + `npm run typecheck` + `npm run lint` inside `PokeQuantMobile/`),
commit it (single-line message per AGENTS.md), check the box with the
commit hash, end the session. Do not start a second item — accumulated
context is the cost we're avoiding.

Each brief carries the exploration already done; trust it, don't re-derive.
If a brief turns out wrong, fix the brief in the same commit.

Reviewer gate (AGENTS.md tiered policy): test-only items = reviewer optional;
anything touching `src/`, `worker_*.js`, deal engine, sync, or auth = required.

---

## [x] 17. Latest-only market hydration for inventory paths — HIGHEST VALUE (0a8171c)

`getProductMarketData` (catalogPrices.ts:350) always runs
`getVariantHistories` — an OR'd `(product_id = ? AND sub_type = ?)` query
that returns **every price_history row per pair**. But the inventory
paths only read `marketPrice` + `matchedSubType`: `resolveCardMarket`
(pricing.ts:84-112) ignores price1d/3d/7d/30d/90d entirely. So
`hydrateCatalogPrices` (persistence.ts:34-61 — every inventory load,
refresh, and post-sync reload) and `lookupMarketData` callers
(`addInventoryCard`, `addScannedCards`, `updateInventoryCard` in
cardActions.ts) pull full history for every owned product and throw it
away. This is the heaviest per-launch query in the app — N products ×
full history, run twice on the inventory screen alongside
`useInventorySignals`' own full fetch.

**Approach:** add `getProductMarketPrices()` to catalogPrices.ts — a
latest-only twin returning `{marketPrice, matchedSubType, date}` per
product built on `getLatestSubTypePrices` + `resolveVariantPrice` (zero
history reads — same canonical-resolution path the scanner's
`mapRowsToCards` uses). Swap `lookupMarketData` (pricing.ts:73) to it.
`resolveCardMarket` destructures only marketPrice/matchedSubType — widen
its param to `Pick<ProductMarketData, 'marketPrice' | 'matchedSubType'>`
so both maps satisfy it, or emit a compatible slim type.

**Do NOT touch:** `useInventorySignals` (buildVelocityWindows consumes
price1d/3d/7d), `searchCatalogCards` hydration (velocities display),
`getCardMarketAnalytics`, `getMarketVelocity` — they keep the full path.

**Pins:** existing store suites pin the write contract (inventoryHeld,
actionAudit) — keep them green unedited. New pins: latest-only output
equals `getProductMarketData`'s marketPrice/matchedSubType/date fields
on fixtures covering variant fallbacks (requested → Normal → holofoil →
lowest-positive → first, 1st-edition base fallback, empty map → zeros);
the lite path issues no `FROM price_history` scan — spy the
`sqliteDb.getAllAsync` SQL string (expo-sqlite is setup-mocked).

**Scope guard:** if a consumer turns out to read a window field, leave
it on the full path and note it — do not shrink what it gets. Reviewer
gate: required (src/).

---

## [x] 18. Bound `getVariantHistories` to the read window (e485e0c)

catalogPrices.ts:299-336 — after item 17, the remaining
`getProductMarketData` callers still pull unbounded history:
`useInventorySignals` (all held + watched productIds, 500ms-debounced),
`searchCatalogCards` hydration (up to fetchLimit rows per keystroke),
`getCardMarketAnalytics` (single). The reads only need: the newest row
≤ each `liveTime − {1,3,7,30}d` target, plus all rows inside
`[liveTime−90d, liveTime]` for the high/low.

**Approach:** per-pair date bounds in the existing batched query —
`date <= liveTime AND date >= cutoff` with cutoff = liveTime − 95d
('YYYY-MM-DD' strings compare lexically). Plus the newest row per pair
**before** cutoff so `findPriceForDate`'s stale-fallback path survives a
>95d coverage gap — second batched query or a `MAX(date) < cutoff`
branch per pair, implementer's call, pin both semantics. liveTime is
already resolved per pair (`data.date` from the latest row).

**Pins:** identical price1d/3d/7d/30d/high/low on fixtures including a
>95d gap (boundary row supplies the fallback) and post-liveTime rows
(excluded); the emitted SQL carries a `date` bound per pair — assert via
the mocked query args.

**Scope guard:** dates assumed 'YYYY-MM-DD' — if fixtures show other
shapes (ISO datetimes), normalize before bounding or bail and report.
Reviewer gate: required (src/db).

---

## [x] 19. `searchCatalogCards` fetch-limit discipline + Sealed-Only fix (bb25f35)

catalogDb.ts:287 — non-price sorts always fetch `max(limit*4, 200)` rows
and hydrate market data for **all** of them, then post-filters +
`slice(0, pageLimit)` keep ~50. When no JS post-filter can drop rows —
`productType` ∈ {All, Cards Only} and `maxPrice` undefined — the 4×
buffer is pure waste: fetch `limit`, hydrate only those. (Price sorts
already use `limit`.) `language`/`rarity`/query are SQL-side, so they
don't need the buffer.

**Bonus — real bug:** non-price `'Sealed Only'` currently hydrates the
200-row buffer then discards to `cards = []` — and `hasMore` still comes
back true from the lookahead row, so the list can "load more" empty
pages forever. Extend the price-sort early return (catalogDb.ts:257) to
all sorts: `{cards: [], hasMore: false}` kills the phantom pagination
and the wasted hydration.

**Pins:** useCatalogSearch suite stays green; new SQL-args pins on
fetchLimit across the post-filter matrix (no post-filter → `limit`;
variant-filter or maxPrice → `limit*4`/200; Sealed Only → early return,
zero hydration queries). `hasMore`/`nextOffset` math at :391-411 must
stay exact — pin offset advance on both buffer and non-buffer paths.

**Scope guard:** lookahead-row convention (`fetchLimit + 1`) is part of
the hasMore contract — keep it. Reviewer gate: required (src/db).

---

## [x] 20. Canonical-price TEMP table for price sorts — BIGGEST SQL WIN (ee8aef2)

`buildLivePriceExpression` (catalogDb.ts:107-148) is a correlated
subquery — GROUP BY canon over price_history + join-back — evaluated
**per candidate card row**, and it appears up to 3× in one price-sort
query (WHERE maxPrice, SELECT live_market, ORDER BY — twice for
low→high). 'Price: High to Low' across the full catalog runs it for
every matching card (~60k rows) — multi-second keystrokes.

**Approach:** materialize once per catalog handle —
`CREATE TEMP TABLE canon_price(product_id INTEGER PRIMARY KEY,
price REAL)` — populated by a single scan expressing the same selection
(canon normalization → latest date per canon → normal / holofoil /
lowest-positive / most-recent precedence → one row per product). The
WHERE/ORDER BY/SELECT then reference a `canon_price` join instead of the
correlated expression. Build lazily on the first price sort behind a
`canonPricePromise` keyed to the current `sqliteDb` handle — TEMP lives
on the connection, so `assignCatalogDb`/`closeCatalogDatabase` reset is
automatic; just don't let a stale promise outlive a swap.

**Correctness bar:** the materialized per-product price must equal the
subquery's for every product. Pin against fixtures spanning: multiple
canon buckets with distinct max_dates; the alias collapse ('1st ed' /
'first edition' / 'holo' / 'rev' / 'regular' / 'common' / 'uncommon'
→ shared buckets); zero/negative prices in the other-bucket ordering;
a product with no price rows → COALESCE 0.

**Scope guard:** TEMP tables only — zero writes to the read-only
catalog file. If a single-pass materialization can't express the canon
ordering exactly, fall back to hydrating the table through the existing
`getLatestSubTypePrices` + `resolveVariantPrice` JS path and report the
trade-off. Reviewer gate: required (src/db).

---

## [x] 21. Image-pack absent-state memoization (5b5e620)

`ensureIndexed` (CatalogImageService.ts:210-216): when a pack is absent,
every `getCatalogImageUri`/`getLocalCatalogImageUri` call pays
`pack.readyFile.exists` — a synchronous native FS stat — for **both**
packs. Callers: `mapRowToInventory` per row on every inventory load,
`toListingItem` per vendor row, event/search rows per page,
`buildInventoryImageUrl`, `resolveCardImageUri` per candidate. With EN
installed and JP absent, every lookup still stats the JP ready file
forever.

**Approach:** per-pack tri-state. `extractedIds != null` already
short-circuits; add a `readyCheckedAbsent` flag set when the stat
returns false so later lookups skip it. Invalidation stays inside this
module — readyFile is only written at :150-157 (manifest restore —
extractedIds is set anyway) and :346-347 (post-download — extractedIds
set); `cleanImageWorkspace` nulls extractedIds → reset the flag there.

**Fold-in:** `warmCatalogImageIndex` (:174-177) awaits en then jp
sequentially → `Promise.all`.

**Pins:** `File.prototype.exists` spy (the established pattern from the
useEventSearch suite) — after the first absence check, N further URI
resolutions issue 0 stats; flag reset verified through
cleanImageWorkspace.

Reviewer gate: required (src/services). Small.
**Model:** SWE-2 Max — small; invalidation sites enumerated in brief.

---

## [x] 22. `catalogHasTable` per-handle memoization (a617472)

catalogSession.ts:37-48 — a `sqlite_master` COUNT probe per call, an
async round-trip each time: `getCardSignals` ×2, `getScoutRows` ×2,
`getPriceSeriesBulk`, `getPriceSeries`, `getCardDeep`,
`getPatternStats`. `useInventorySignals` fires getCardSignals on every
product-id-set change; the scout pass and deal sheets chain on these.

**Approach:** `Map<string, boolean>` in catalogSession, populated on
miss, cleared in `assignCatalogDb` and `closeCatalogDatabase` — the
handle lifecycle already has a single owner. Do NOT cache across handle
swaps: a catalog that lacked `card_deep` can gain it after a
market-price refresh.

**Pins:** probe count per (table, handle generation) = 1; after a swap
the next call re-probes; present → absent and absent → present
transitions both re-probe correctly.

Reviewer gate: required (src/db). Small.
**Model:** SWE-2 Max — small; handle-swap re-probe pins carry the risk.

---

## [x] 23. Sync push — multi-row upsert statements (41655eb)

cloudSync.ts:297-324 — `pushLocalChanges` emits one `execute` per row:
500 rows = 500 statements, each repeating the ~500-char
`INVENTORY_UPSERT_SQL` — ~250 KB of JSON per batch plus per-statement
parse cost on the worker/Turso side.

**Approach:** multi-row `INSERT INTO inventory (cols) VALUES (...),
(...)` upsert — the existing `ON CONFLICT(id) DO UPDATE ... WHERE
excluded.updated_at > inventory.updated_at` applies per row unchanged.
Chunk ~45 rows per statement (18 cols × 45 = 810 args, safely under
SQLite's 999 host-variable floor). `EXPECTED_PLACEHOLDER_COUNT` scales
× rows — keep the count guard.

**Correction (discovered while working):** the worker does NOT pass
statements through verbatim — `worker.js` runs `validateTenantStatement`
(allowlist — multi-row upsert passes pattern [1] unchanged) and
`injectAndValidateUserId`, which force-overwrites each bound `user_id`
arg with the JWT subject. `extractUserIdBindings` only parsed the
**first** `VALUES (...)` group, so multi-row upserts would have left
rows 2+ unbound — a tenant-isolation weakening (honest clients send the
right user_id anyway, so no flag-day ordering requirement). Fix shipped
in the same commit: iterate every `(...)` group and bind each row's
user_id slot.

**Fold-ins (same file, same contract):** hoist `getAuthToken()` out of
the chunk loop (a `supabase.auth.getSession()` per batch → once);
`pullRemoteChanges`' trailing `getLastPush` + `setLastPush` round-trips
→ one `INSERT OR REPLACE INTO sync_metadata ...` statement using the
`MAX(last_pushed_local_updated_at, ?)` shape that preserves
INSERT-when-absent semantics from `setLastPush`/`setLastSync`.

**Pins:** wire-granularity pins like the worker suites — emitted
statement count vs row count (0/1/45/46/500 rows), arg ordering across
the 18 columns, LWW WHERE preserved verbatim, single-statement
watermark write.

**Scope guard:** `pullRemoteChanges`' unbounded SELECT stays — note it,
don't implement pagination here. Reviewer gate: required (sync).
**Model:** Fusion — Fable lead (Medium) + SWE-2 sidekick — statement-count
pins cover wire shape, but a missed LWW/chunk bug corrupts cloud data
silently.

---

## [x] 24. `worker_pre_show.js` hygiene leftovers (760fa83)

- `POST /trigger/{id}` path param is never `decodeURIComponent`'d —
  mirror the vendor worker's decode (show ids are slugs so it's latent,
  not live).
- `{type:'error'}` results lacking `.error` throw
  `Turso pipeline error: undefined` — default the message. The vendor
  worker's identical check shares the edge — fix both or pin vendor's
  quirk deliberately.
- CORS: documented unneeded (native fetch only) — do NOT add; a comment
  is fine if the file is touched anyway.

**Pins:** update workerPreShow.test.ts — a `%20`-bearing showId pin and
an error-message pin covering missing `.error`.

Reviewer gate: required (worker_*.js). Small.
**Model:** SWE-2 Max — two mechanical pins.

---

## [ ] 25. Janitorial batch — LOW VALUE, one session

- `showVendorService.ts` — `postAuth`/`patchAuth`/`getAuth` are one
  function with a method/body flag (~90 duplicated lines).
- `dealGradeDb.recordDealGrades` — per-row `runAsync` loop → one
  multi-row INSERT (rows are <20; 13 cols × 20 = 260 args).
- `useBuyScout` — `getScoutRows` then `getCardSignals` await
  sequentially but are independent → `Promise.all`.
- Dead exports: `getMarketVelocity` (catalogPrices.ts:481) and
  `getEventInventoryCount` (eventCatalogDb.ts:402) have zero call
  sites — delete them or justify them in the lint:dead baseline.
- Optional: `getDistinctEventValues`' four sequential DISTINCT scans —
  leave unless trivially combinable.

**Scope guard:** each change lands only if the suite stays green — skip
anything that fights back rather than expanding scope. Reviewer gate:
required (src/ touched).
**Model:** SWE-2 Max — janitorial; suite-stays-green is the gate.

---

## [ ] 26. CartDrawer — move the lot-write into a store action

CartDrawer.tsx:13-14 imports `initializeDatabase` + `logCartItemsToInventory`
and `handleLogToInventory` (:40-61) performs the last component→DB write in
the app: initializeDatabase → write → refreshInventoryState → clearCart →
closeDrawer, all inside the component. Every other inventory write flows
through a store action; this is the one remaining boundary violation.

**Approach:** add `logLotToInventory()` to cardActions.ts — a bulk inventory
write, sibling of `addInventoryCard`/`addScannedCards`. Inside: resolve
`inventorySession.db` + `inventorySession.userId` (the sibling pattern at
cardActions.ts:108-109 — NOT a fresh `initializeDatabase`), keep the
`cartItems.length === 0 || !userId` early-return reading cartItems via
`useCartStore.getState()` (cartStore is a leaf — no cycle; cross-store
getState is the established pattern at cardActions.ts:376), call
`logCartItemsToInventory(db, userId, cartItems)` verbatim, then
`get().refreshInventoryState()`, then `.clearCart()` + `.closeDrawer()` on
the cartStore state. `InventoryActions` type + facade wiring get the new
member. CartDrawer keeps `isLogging` and both Alert strings verbatim
('Lot added' / "Couldn't add the lot") and drops both db imports.

**Pins:** existing store suites stay green unedited. New pins — call order
(logCartItemsToInventory → refreshInventoryState → clearCart → closeDrawer);
failure path (write rejects → no clear/close, error propagates so the
component's catch still alerts and resets isLogging); early-return
(0 items or no user → zero db/store calls); grep boundary pin —
CartDrawer.tsx contains zero `db/` imports.

**Scope guard:** cartStore internals untouched; alert strings verbatim; do
not reshape CartItem. isLogging + disabled props stay component-local.
Reviewer gate: required (src/ + store boundary).
**Model:** SWE-2 Max — single-action move; order/failure/early-return pins
carry it.

---

## [ ] 27. SearchBuyScreen — wiring to a hook, filter card to a leaf

Screens are composition shells with store/async wiring in src/hooks/ — this
one (441 lines, 41 commits/90d, the hottest screen) carries three inline
wirings: `handleLogToInventory` (:152-182) builds an InventoryInput and
awaits two store calls, and `handleScoutSelect` (:110-126) +
`handleAnalyze` (:130-150) map row shapes into useAnalysisSheet's match
object. The Disclosure filter card (:243-284) is ~40 lines of pure-view JSX
with load-bearing zIndex ordering (3/2/1 — dropdown overlap) living in the
screen.

**Approach:** new `src/hooks/useSearchBuyActions.ts` returning
`{ handleLogToInventory, handleAnalyze, handleScoutSelect }` — move the
three callbacks verbatim, alerts included (the alert strings are the
contract; RN Alert is callable from hooks). New `React.memo` leaf
`src/components/SearchFiltersCard.tsx` receiving the five filter values +
five setters as props; the filterRow zIndex values move verbatim. Screen
keeps the search row, results count, list-wrapper branches, both Modals,
TopChrome, and its three visibility states.

**Pins:** pin what it does, not what it should do — the payload map sets
BOTH `rarity` and `productType` from `payload.variant` (:164-165); pin that
literally, do not "fix". Call order: addInventoryCard resolves before
refreshInventoryState is invoked. Failure: addInventoryCard rejects →
refreshInventoryState NOT called → "Couldn't add card" alert fires.
Not-signed-in: `!userId` → 'Not signed in' alert + zero store calls.
Filter leaf: each Dropdown's onSelect wired to its matching setter
(rarity→setRarity etc.); zIndex 3/2/1 preserved verbatim. useCatalogSearch
suite stays green unedited.

**Scope guard:** zero behavior/style changes — lint:ui + existing suites
are the net. useCatalogSearch/useBuyScout/useAnalysisSheet internals
untouched; ScoutDeck/ScoutPage props stay. Reviewer gate: required (src/).
**Model:** SWE-2 Max — mechanical cuts + one leaf extraction; quirk and
zIndex pins carry it.

---

## [ ] 28. catalogDb → catalogSearch.ts — finish the facade split

catalogDb.ts's own header (:1-5) describes the end state — lifecycle in
catalogSession, prices in catalogPrices, quant reads in catalogSignals —
but the card-search block still lives in the facade: types (:18-55),
getCatalogCardCount (:63-68), escapeLikePattern (:70-77),
buildSearchClause (:79-104), the canon-price block (normSubType :118,
canonSubType :123, buildCanonPriceSql :131, CANON_PRICE_* + LIVE_PRICE
:172-175, canonPriceBuild + ensureCanonPriceTable :181-191), buildOrderBy
(:194-208), searchCatalogCardsByNames (:211-279), and searchCatalogCards
(:282-473). ~410 of 473 lines. Pure move — existing suites pin behavior,
one `export *` keeps every call site.

**Approach:** create `src/db/catalogSearch.ts`; move the type block and
every search function verbatim — whatever shape they're in when this item
is worked (items 21-25 land first, so the block may shift further).
Imports the new file needs: `sqliteDb`/`withCatalogGuard` from
'./catalogSession', `getLatestSubTypePrices`/`getProductMarketData`/
`normalizeSubType` from './catalogPrices', `getCatalogImageUri` from
'../services/CatalogImageService' (verified: that service has zero db
imports — no cycle), `JP_SET_PREFIX`, `normalizeSearch`, the SQLiteDatabase
type. catalogDb.ts keeps `setCatalogDatabase` (:58-61) and becomes pure
facade: `export *` for all four modules. Inside-out order: leaf helpers
first (escapeLikePattern → buildSearchClause → canon-price block →
buildOrderBy), then the two query functions, re-export last.

**Pins:** zero behavior change — the net is useCatalogSearch +
catalogSearchPagination + canonPrice (item-20 real-engine equivalence) +
every suite importing through '../db/catalogDb' staying green UNEDITED.
New boundary pins: catalogSearch.ts has no `from './catalogDb'` import
(one dependency direction); catalogDb.ts contains no `FROM cards`/
`FROM price_history`/`canon_price` SQL strings; `git diff --name-only`
touches only catalogDb.ts + catalogSearch.ts + (optionally) one pin-test
file.

**Scope guard:** do NOT modernize the moved code — no "while we're here"
edits to the canon-price SQL or the lookahead math. The underscore private
fns stay private — if a grep shows call sites reaching past the
withCatalogGuard-wrapped exports, fix the call site, don't re-export
internals. Reviewer gate: required (src/db).
**Model:** SWE-2 Max — pure move; unedited-suite green + boundary greps
carry it.

---

## Deferred (verified acceptable gaps, do not expand scope)

- `environment.yaml` for Devin Cloud (was item 6) — user runs local-only
  sessions; the blueprint only pays off if cloud workers get used.
  Resurrect the `declarative-repo-setup` skill approach if that changes.
- `closeOffer`/`closeDeal`/`closeAnalysis` one-liner assertions (trivial).
- `balances` passthrough in `useEventList`.
- `useInventorySignals` gated-ON path (signalMap populated) — needs
  catalog-signal fixtures; revisit if deal-engine logic moves in there.
- `useScanMeter` trialDaysLeft reads 8 on a fresh install (7-day trial)
  — mount-effect `installedAt` stamp lands a tick after the frozen
  `nowMs`; display-only flake under parallel jest load, pinned in item 9.
- `pullRemoteChanges` unbounded pull — single SELECT returns all changed
  rows; fine until a real user's inventory makes the response huge.
- `worker_pre_show.js` CORS — native-fetch clients only; documented in
  item 24's brief, do not add.
- Vendor settings LWW — `pushVendorSettings`/`pullVendorSettings` are
  unconditional INSERT OR REPLACE both directions; multi-device
  last-call-wins. Noted, not queued — behavior change, not optimization.
- `dealClassify` (552, ~50 commits/90d) — deliberate ordered decision list;
  reads/evidence/rotation/copy already extracted around it. Keep deferred —
  split only if gate edits start colliding.
