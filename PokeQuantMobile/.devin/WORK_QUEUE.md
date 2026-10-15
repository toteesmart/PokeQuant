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

## [ ] 8. Medium hooks — one session, drop whichever resist mocking

`useInventorySignals` (200), `useTradeEntryOps` (195), `useDealAnalysis`
(152), `useCatalogDb` (126). If a hook needs production changes to be
testable, note it and move on — do not refactor to test.

## [ ] 9. Small-hooks batch — one session for all

`useShowForm` (100), `useBulkSelection` (99), `useVendorAdd` (97),
`useScanMeter` (74 — has meter store test already; check overlap),
`useOrganizerShows` (74), `useBuyScout` (70), `useAnalyticsLookups` (56).
Cheap truth-table-style suites; skip any that's pure pass-through.

---

## [ ] 10. `worker_show_vendor.js` structural split — refactor only, zero behavior change

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

## [ ] 11. `ensureSchema` warm-isolate flag — optimization, DEPENDS ON item 10

`ensureSchema` currently emits ~18–22 sequential Turso round-trips on
every authenticated request: 11 isolated `ALTER TABLE`s, founder-drift
SELECTs, dedupe backfill UPDATE + cleanup DELETE (real scans of
`public_show_inventory`/`vendors`). All idempotent by design → a
module-level `schemaEnsured` flag collapses them to once per isolate
lifetime (~90% of request latency eliminated; cold requests still pay
the full burst, which is correct).

**Fold in while there:** batch the 3 founder-drift SELECTs into one
pipeline, the 2 grandfather SELECTs into one.

**Test seam required:** module state persists across tests in a jest
file — need `jest.resetModules`/`isolateModules` per test or an
exported reset. Update pins to encode the new contract: first-request
burst vs subsequent-request skip. Reviewer gate: required.

---

## Deferred (verified acceptable gaps, do not expand scope)

- `environment.yaml` for Devin Cloud (was item 6) — user runs local-only
  sessions; the blueprint only pays off if cloud workers get used.
  Resurrect the `declarative-repo-setup` skill approach if that changes.
- `closeOffer`/`closeDeal`/`closeAnalysis` one-liner assertions (trivial).
- `balances` passthrough in `useEventList`.
- `useInventorySignals` gated-ON path (signalMap populated) — needs
  catalog-signal fixtures; revisit if deal-engine logic moves in there.
- `worker_pre_show.js` (362) — fold into item 1 if the harness lands
  cheaply; else leave.
- Splitting `inventoryStore` (877) / `dealClassify` (822) — already covered
  by deep suites; split only if churn actually hurts.
