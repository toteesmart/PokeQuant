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

## [x] 1. `worker_show_vendor.js` characterization suite — HIGHEST VALUE (40abe80)

2,586-line authenticated worker, **zero tests**, money-adjacent (balances,
table dues, vendor gating). Lives at `PokeQuant/worker_show_vendor.js` —
repo root, OUTSIDE this package.

**Approach:** plain Node seams — worker is `export default { fetch }`-style;
check the export shape first. Options: (a) jest suite at
`PokeQuantMobile/__tests__/workerShowVendor.test.ts` importing
`../../worker_show_vendor.js` (verify jest `roots`/`transformIgnorePatterns`
reach it), or (b) a standalone `node --test` suite beside the worker —
zero config, no RN mocks. Pick (b) if (a) fights the preset.

**Mock seam:** global `fetch` (Turso `/v2/pipeline` calls + Supabase JWKS
fetch) via `jest.fn`/manual stub; `crypto.subtle` is native in Node ≥18 —
generate a real ES256 keypair for test JWTs rather than stubbing verify.
`env` = plain object `{TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, SUPABASE_URL}`.

**Contracts to pin (in priority order):**
- Route table: `GET /vendor/me` (creates vendor row on first hit),
  `GET /vendor/shows`, `GET /vendor/balances`, `POST /vendor/shows/{id}/request`,
  `POST /vendor/inventory` (+`/update`, `/delete`), organizer-only
  `POST /shows`, `PATCH /shows/{id}`, `GET /vendors`,
  `GET/POST /shows/{id}/registrations`, `PATCH .../registrations/{vendorId}`.
- Gating truth tables: `is_organizer` required for organizer routes;
  `approved` registration (or organizer-of-show) required for inventory
  writes; `pending`/`rejected` rejected with correct status codes;
  re-request allowed after rejection.
- `NON_VENDOR_PRODUCTS` keeps `cc_scan_*` out of `vendor_subscriptions`;
  webhook skips entitlement events lacking `Cardcache_pro`.
- `manual:{uuid}` vendor namespace for non-app vendors.
- URL params are `decodeURIComponent`'d (pathname stays percent-encoded).

**Scope guard:** tests only. If a test reveals a real worker bug, STOP and
report it — do not fix production behavior in this pass.

---

## [x] 2. `useEventSearch.test.ts` (7cd68d4)

`src/hooks/useEventSearch.ts` (336 lines — largest untested hook). Event
browsing brain: queries `eventCatalogDb`, punctuation-insensitive search,
filters/sort, fuzzy image backfill via `catalogDb` (min score 150 — pin the
threshold boundary).

**Harness:** `__tests__/helpers/renderHook.ts` + `builders.ts` (mkShow,
mkInventoryCard exist; add builders to helpers if shared).
**Mocks:** `../src/db/eventCatalogDb` partial-spread — jest.fn the four
fns the hook calls (`openEventCatalogDatabase`, `closeEventCatalogDatabase`,
`getDistinctEventValues`, `searchEventInventory`), keep `attachEventImages` +
cache helpers real so the score-150 boundary is pinned at the implementation.
Correction vs original brief: the hook never imports `catalogDb` — the fuzzy
lookup opens `pokequant_catalog.db` via raw `openDatabaseSync` (mocked in
`jest.setup.js`) gated on a `File.exists` check (spy `File.prototype.exists`).
Full-mock `EventCatalogDownloadService` + `CatalogImageService`; the
never-downloads-the-image-pack pin is `ensure*/warmCatalogImageIndex` not
called. No `useFocusEffect` in this hook — debounce is 250ms real time,
flush with a 300ms `setTimeout` inside `act`.
**Pin:** normalized query (apostrophe/dash strip) reaches the DB layer,
filter/sort params pass through, loading/error transitions, empty-result
shape, image fallback never triggers the image-pack download.

---

## [x] 3. `useBulkImport.test.ts` (b5bffce)

`src/hooks/useBulkImport.ts` (275). Bulk-add path into `useInventoryStore` —
silent data corruption surface. Pin: row→InventoryCard mapping/coercion,
dedupe behavior, error collection per-row vs abort, store write contract
(which action, what payload shape), progress/result reporting.

---

## [x] 4. `useRegActions.test.ts` (c67a5ac)

`src/hooks/useRegActions.ts` (233). Organizer actions on registrations
(approve/reject/table/due/paid/remind + unpublish alert). Pin: each
action → correct worker call, error → notice not crash, modal stays
open on failure, SMS body format.
Correction vs original brief: the hook never touches `showVendorStore` —
`selected`/`setSelected`/`setError`/`loadShows`/`refreshSelected` are
injected by `OrganizerScreen`'s `useOrganizerShows`, so the suite passes
jest.fns for all five. Mocks: `showVendorService` (`updateShow` +
`updateShowRegistration`), `organizerText.sendReminderSms` (keep
`displayName` real), `Alert.alert` spy to press the Unpublish button.
Reject with plain strings — they survive `toErrorMessage` verbatim;
`Error('x')` joins to `'x Error Error: x'`.

---

## [x] 5. `useCatalogSearch.test.ts` (f5503ea)

`src/hooks/useCatalogSearch.ts` (223). Search wiring into
`searchCatalogCards*`. Pin: normalization applied, filters/rarity/maxPrice/
productType passed through, sort mapping, pagination/`hasMore` contract,
debounce if present. `catalogDb` partial-mock (see useInventoryScreen
pattern).

---

## [x] 7. `.devin/skills/testing/SKILL.md` (2efbdd8)

Encode the harness: renderHook usage, `act`/`flushAsync`, real-timer
debounce flush (`setTimeout` inside `act`), per-suite jest.mock patterns
(full-mock vs requireActual-spread + `requireActual` handles for
SQL-layer pins), which modules need setup-level mocks
(`react-native-purchases`, `@expo/vector-icons`,
`@react-navigation/native useFocusEffect`), `File.prototype.exists` spy
for catalog-file gates, builders convention, auto-unmount invariant.
Future test tasks become a procedure, not re-discovery. Patterns proven
across items 1–5.

---

## [x] 8. Medium hooks — all 4 landed (755aa97)

`useInventorySignals` (200), `useTradeEntryOps` (195), `useDealAnalysis`
(152), `useCatalogDb` (126). If a hook needs production changes to be
testable, note it and move on — do not refactor to test.

## [x] 9. Small-hooks batch — one session for all (5f38b92)

`useShowForm` (100), `useBulkSelection` (99), `useVendorAdd` (97),
`useScanMeter` (74 — has meter store test already; check overlap),
`useOrganizerShows` (74), `useBuyScout` (70), `useAnalyticsLookups` (56).
Cheap truth-table-style suites; skip any that's pure pass-through.

Landed: all 7 — none were pure pass-through. useScanMeter pins stay at the
hook layer (entitlement/profile truth table, reactivity, mount stamp);
meter math is already covered by scanMeterStore.test.ts. Found quirk,
pinned not fixed: on a fresh install `trialDaysLeft` reads 8 for a 7-day
trial — `installedAt` is stamped in the mount effect a tick after the
frozen `nowMs`, so `ceil(7d + ε)` = 8. Display-only (the pill); revisit if
it annoys.

---

## [x] 10. `worker_show_vendor.js` structural split — refactor only, zero behavior change (59a557d)

~2.6k-line godfile → ES modules (auth/JWT verify, turso pipeline helpers,
`ensureSchema`, vendor handlers, organizer handlers, teams, webhook,
dispatch). Verify `wrangler.toml`/deploy entry accepts a multi-module
worker first (workerd bundles ES modules natively — normally fine).

**Approach:** invoke the `refactor-structure` skill. Move code, don't
restructure logic. Definition of done: all 97 characterization tests
green with **zero test edits** — the suite pins emitted SQL, so even
correctly reordering statements trips red and that's the intent.

**Scope guard:** if a move forces a behavior change, stop and note it —
do not ship the change inside the refactor. Reviewer gate: required
(worker_*.js).

## [x] 11. `ensureSchema` probe batching + warm-isolate pins (0c13087)

Brief premise was stale: `schemaPromise` has memoized the burst per
isolate since the worker's first commit — nothing re-emitted per request.
What landed: the grandfather probe pair and the drift triple +
`founder_seat_limit` read each collapse into one pipeline (5 → 2
round-trips inside the burst; the 11 isolated `ALTER TABLE`s stay —
each needs its own duplicate-column error boundary that a shared
pipeline can't express).

Test seam: exported `resetSchemaCache()` from `schema.js` (module state
survives across a jest file). Pins: cold-burst shape, both batched
probes at wire granularity, warm-request silence, concurrent dedup,
failure unlatching. Reviewer gate: required (worker_*.js).

---

## [x] 12. Gate-context request batch — collapse per-request Turso probes (f906282)

Warm `GET /vendor/me` fires ~7 sequential pipelines (vendor row →
`payments_live` → `isVendorActive` → `isActiveTeamMember` → founder
`COUNT(*)` + `founder_seat_limit` → own-team); team users pay ~10
(`getTeamForMember` + `formatTeam`'s sequential owner-name/members).
Every gated route prepends `assertIsPaidVendor` = up to 3 more
sequential probes, all keyed on the same `userId`. Item 11 proved the
pattern on schema probes; this applies it to the request path.

**Approach:** one request-scoped batch (e.g. `loadGateContext(env,
userId)`) issuing a single pipeline with the independent reads:
`SELECT key, value FROM app_config WHERE key IN ('payments_live',
'founder_seat_limit')` (one statement replaces two call-site reads),
`vendors` row, active `vendor_subscriptions` row, the
`team_members JOIN teams` row (membership check AND `getTeamForMember`
are the same query — fetch `t.*` once and drop the second call), own
`teams` row, founder `COUNT(*)`. Gates/status become pure reads over the
result. `formatTeam`'s owner-name + members are independent → fold into
the same batch or one follow-up pipeline. When `payments_live = 0` the
batch reads a couple of tiny unused rows vs today's early-return — same
RTT count, no regression.

**Founder-seat tax:** unseated vendors run `getFounderSeatLimit` + no-op
UPDATE + unconditional re-SELECT on every `/vendor/me` forever once the
50 seats are exhausted. With the count already in context, skip the
UPDATE when exhausted; when `changes() = 0` return the existing row —
the UPDATE is the only writer in that call, so nothing changed.
`getFounderSeatsRemaining` reads `founder_counter` (1 row) instead of
`COUNT(*)` on `vendors` — the counter is already maintained
incrementally (claim rebuilds it, delete-account decrements it). This is
the piece that shrinks rows-read billing linearly as vendors grow.

**`handleDeleteAccount`:** ~7 sequential single-statement pipelines, all
keyed on `vendorId`/`userId` computed upfront with no inter-statement
data deps → one pipeline.

**Definition of done:** warm `/vendor/me` ≤ 2 pipelines (gate batch +
conditional team follow-up); gated routes ≤ 1 gate pipeline; response
JSON byte-identical — body pins must stay green **unedited**.
Wire-granularity pins WILL need deliberate edits this time (request
counts change); update them explicitly, don't weaken them. Reviewer
gate: required (worker_*.js).

Landed: `loadGateContext` in gates.js (7-statement batch; gates/status
now pure reads). `/vendor/me` = 1 pipe seated-no-team, 2 with a team
(formatTeam's owner-name+members folded into one follow-up — also
adopted by `handleGetTeam`, 4→2). Gated routes = 1 gate pipe + data.
`handleDeleteAccount` = vendor select + single 7-statement delete pipe.
Founder tax killed: ctx holds COUNT(*) (authoritative claim guard) and
the maintained counter (what seats-remaining reports); exhausted →
UPDATE skipped, changes()=0 → held row returned. **Bug fixed, not just
pinned:** `firstRow(result.results[1])` mis-indexed changes() so the
counter rebuild never fired — the brief's "counter is maintained by
claims" only holds with the fix; the quirk pin was rewritten.
`handleGetTeam` also takes ctx (4→2 pipes); other team/organizer
handlers keep plain vendor reads (post-write re-reads must not use
stale ctx). Reviewer gate: required (worker_*.js).

---

## [x] 13. `worker_pre_show.js` characterization suite (8cfc963)

362-line public worker, zero tests, writes the R2 artifact every
attendee downloads. Last unpinned money-adjacent surface — the deferred
note's "fold into item 1 if the harness lands cheaply" is now true.

**Approach:** same jest harness as `workerShowVendor.test.ts` —
`__tests__/workerPreShow.test.ts` importing `../../worker_pre_show.js`.
No JWT needed (public worker). Mock seams: global `fetch` (Turso
pipelines only), `env.EVENT_CATALOG_BUCKET = { put: jest.fn() }`.
`CompressionStream` is native in Node ≥18 so zips build for real —
decode the deflate member with Node `zlib.inflateRawSync` inside the
test (the JS-unzipper ban is app-runtime only) and diff against expected
JSON.

**Contracts to pin:** `GET /shows` returns active shows sanitized (no
`is_active` leak); `POST /trigger/{id}` → 404 unknown, 400 inactive,
happy path calls `put('shows/{id}/event_catalog.json.zip', …)` with
`cacheControl: max-age=0, no-cache, no-store, must-revalidate`;
`POST /trigger` iterates all active shows, per-show failure lands in
`results[]` as `{ok:false}` without aborting siblings; `sanitizeInventory`
strips `show_id`/`vendor_id` and coerces types; Turso error → 500;
unmatched route → `ok` 200.

Reviewer gate: test-only = optional; if a test reveals a real bug, STOP
and report — do not fix in this pass.

Landed: 24 pins green. Harness grew `callerFor(worker)` (shared request
plumbing for non-vendor workers) + 3 column-projected FakeTurso routes;
jest env's polyfilled `ReadableStream` needed swapping for
`node:stream/web` natives so undici `Response` accepts the deflate
pipeline. **Bug pinned, not fixed:** `tursoPipeline` checks
`results[0].response.error` but Turso errors arrive as `{type:'error'}`
with no `response` — every statement-level failure is swallowed.
`GET /shows` → `{ok:true, shows:[]}`, show-lookup error → fake 404, and
worst: an inventory-read error uploads an **empty** `event_catalog.json`
artifact with `ok:true` (both trigger routes). Fix is a one-liner
(`r.type === 'error'` like vendor's turso.js) — flagged for a follow-up.
Also pinned: `/trigger/{id}` path param is not percent-decoded (vendor
worker decodes; show ids are slugs so harmless in practice), and there
is no CORS handling anywhere — fine for native fetch.

---

## [x] 14. `inventoryStore` split — refactor only, zero behavior change (fd3a2d0)

877 lines, `src/store/inventoryStore.ts`. Same play as item 10: invoke
the `refactor-structure` skill, move code don't restructure logic.
Originally deferred because churn didn't justify it — the promo makes it
free.

**Pins:** `syncWatermark`, `inventoryHeld`, `useBulkImport` (store-write
contract), `actionAudit`, plus every hook suite that exercises store
actions. Definition of done: all green with **zero test edits**. If the
split exposes a slice nothing pins, stop and note it — do not ship a
blind move. Reviewer gate: required (src/).

Landed: facade (31 lines: `create()` + re-exports) over
`src/store/inventory/` — `types.ts`, `session.ts` (the four module
`let`s became one `inventorySession` object; ES `let` exports can't be
assigned across modules), `pricing.ts`, `persistence.ts`,
`syncActions.ts`, `cardActions.ts`. Bodies verbatim except two declared
rewrites: `dbRef`/`currentUserId`/`syncQueueTail`/`syncDebounceTimer` →
`inventorySession.*`, and `recalculatePendingCount(set)` (was
`useInventoryStore.setState` — same fn, kills the helper→store cycle).
Pin reality vs the brief: no test executes a real action body — the
net is store-shape/action-name pins (suites seed via `setState` and mock
actions), exported types via builders, `buildInventoryImageUrl` via
`useInventoryScreen`, plus typecheck + verbatim moves; reviewer verified
all 14 actions/12 helpers line-by-line. lint:dead: de-exported the 4
module-internal symbols I'd added; 7 flagged entries are pre-existing
drift from items 1–13 (worker vendors.js, test helpers). One
`useScanMeter` red under parallel load was the documented trialDaysLeft
ms-race flake — green in isolation and on suite re-run. Reviewer gate:
required (src/) — SAFE TO COMMIT.

---

## [ ] 15. `dealClassify` split — refactor only, zero behavior change

822 lines, `src/scanner/services/deal/dealClassify.ts`. Deepest harness
in the repo already pins it: `dealClassify`, `classifySweep`,
`lifecycleSim`, `surfaceCoherence`, `fuzzSweep`, `realCards` snapshots;
`docs/DEAL_ENGINE.md` is the module map. `refactor-structure` skill,
zero test edits.

**Scope guard:** taxonomy stays closed — a pure move introduces no
classes and changes no thresholds. If a move forces a behavior change,
stop and note it. Reviewer gate: required (deal engine).

---

## [ ] 16. `worker_pre_show.js` tursoPipeline error check — real fix

Bug surfaced by item 13's pins. `tursoPipeline` checks
`data?.results?.[0]?.response?.error`, but Turso returns failed
statements as `{type:'error', error:{message}}` — no `response` field —
so **every statement-level error is swallowed**:

- `GET /shows` → `{ok:true, shows:[]}` (silent empty)
- `POST /trigger/{id}` show-lookup error → fake 404
- `POST /trigger/{id}` inventory error → uploads an **empty**
  `event_catalog.json` to R2 and returns `ok:true` — a transient blip
  silently wipes the artifact every attendee downloads
- `POST /trigger` shows error → fake `"no active shows"`; per-show
  inventory error → `{ok:true}` after uploading `[]`

**Fix:** mirror `worker_show_vendor/turso.js` — find
`(data?.results || []).find((r) => r.type === 'error')` and throw.
Check the whole results array, not just `[0]`. Keep the HTTP `!res.ok`
branch as-is. Scope: the check only — don't touch routes/sanitize/zip.

**Test updates (deliberate, not weakened):** the five quirk pins in
`workerPreShow.test.ts` invert — `/shows` → 500, show-lookup → 500,
inventory → 500 with `put` never called (the money fix: no more empty
artifact), per-show inventory error → `{ok:false, showId, error}` in
`results[]` while siblings still succeed, `/trigger` shows error → 500.
Pin the exact error message emitted. Reviewer gate: required
(`worker_*.js`, and the fix changes a deployed error path).

---

## Deferred (verified acceptable gaps, do not expand scope)

- `environment.yaml` for Devin Cloud (was item 6) — user runs local-only
  sessions; the blueprint only pays off if cloud workers get used.
  Resurrect the `declarative-repo-setup` skill approach if that changes.
- `closeOffer`/`closeDeal`/`closeAnalysis` one-liner assertions (trivial).
- `balances` passthrough in `useEventList`.
- `useInventorySignals` gated-ON path (signalMap populated) — needs
  catalog-signal fixtures; revisit if deal-engine logic moves in there.
