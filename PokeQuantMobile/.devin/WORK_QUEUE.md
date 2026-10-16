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

## [ ] 18. Bound `getVariantHistories` to the read window

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

## [ ] 19. `searchCatalogCards` fetch-limit discipline + Sealed-Only fix

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

## [ ] 20. Canonical-price TEMP table for price sorts — BIGGEST SQL WIN

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

## [ ] 21. Image-pack absent-state memoization

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

---

## [ ] 22. `catalogHasTable` per-handle memoization

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

---

## [ ] 23. Sync push — multi-row upsert statements

cloudSync.ts:297-324 — `pushLocalChanges` emits one `execute` per row:
500 rows = 500 statements, each repeating the ~500-char
`INVENTORY_UPSERT_SQL` — ~250 KB of JSON per batch plus per-statement
parse cost on the worker/Turso side.

**Approach:** multi-row `INSERT INTO inventory (cols) VALUES (...),
(...)` upsert — the existing `ON CONFLICT(id) DO UPDATE ... WHERE
excluded.updated_at > inventory.updated_at` applies per row unchanged.
Chunk ~45 rows per statement (18 cols × 45 = 810 args, safely under
SQLite's 999 host-variable floor — the worker passes statements through
verbatim so that's the only gate). `EXPECTED_PLACEHOLDER_COUNT` scales
× rows — keep the count guard.

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

---

## [ ] 24. `worker_pre_show.js` hygiene leftovers (from item-13 pins)

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
