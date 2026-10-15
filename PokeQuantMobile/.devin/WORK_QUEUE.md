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

## [ ] 2. `useEventSearch.test.ts`

`src/hooks/useEventSearch.ts` (336 lines — largest untested hook). Event
browsing brain: queries `eventCatalogDb`, punctuation-insensitive search,
filters/sort, fuzzy image backfill via `catalogDb` (min score 150 — pin the
threshold boundary).

**Harness:** `__tests__/helpers/renderHook.ts` + `builders.ts` (mkShow,
mkInventoryCard exist; add builders to helpers if shared).
**Mocks:** `../src/db/eventCatalogDb` (full-mock the query fns the hook
calls — read imports first), `catalogDb` partial-spread (pattern in
`useInventoryScreen.test.ts`: `openCatalogDatabase` rejects fast, rest real
or stubbed per-use). Watch for `useFocusEffect` — already mocked in
`jest.setup.js` as mount-fire.
**Pin:** normalized query (apostrophe/dash strip) reaches the DB layer,
filter/sort params pass through, loading/error transitions, empty-result
shape, image fallback never triggers the image-pack download.

---

## [ ] 3. `useBulkImport.test.ts`

`src/hooks/useBulkImport.ts` (275). Bulk-add path into `useInventoryStore` —
silent data corruption surface. Pin: row→InventoryCard mapping/coercion,
dedupe behavior, error collection per-row vs abort, store write contract
(which action, what payload shape), progress/result reporting.

---

## [ ] 4. `useRegActions.test.ts`

`src/hooks/useRegActions.ts` (233). Organizer actions on registrations
(approve/reject/table/due/paid). Pin: each action → correct store/worker
call, error → notice not crash, state transitions reflected in store.
Mocks: `showVendorStore` actions via `setState` overrides (pattern in
`useShowVendor.test.ts`).

---

## [ ] 5. `useCatalogSearch.test.ts`

`src/hooks/useCatalogSearch.ts` (223). Search wiring into
`searchCatalogCards*`. Pin: normalization applied, filters/rarity/maxPrice/
productType passed through, sort mapping, pagination/`hasMore` contract,
debounce if present. `catalogDb` partial-mock (see useInventoryScreen
pattern).

---

## [ ] 6. Medium hooks — one session, drop whichever resist mocking

`useInventorySignals` (200), `useTradeEntryOps` (195), `useDealAnalysis`
(152), `useCatalogDb` (126). If a hook needs production changes to be
testable, note it and move on — do not refactor to test.

## [ ] 7. Small-hooks batch — one session for all

`useShowForm` (100), `useBulkSelection` (99), `useVendorAdd` (97),
`useScanMeter` (74 — has meter store test already; check overlap),
`useOrganizerShows` (74), `useBuyScout` (70), `useAnalyticsLookups` (56).
Cheap truth-table-style suites; skip any that's pure pass-through.

---

## [ ] 8. `environment.yaml` for Devin Cloud

Invoke the `declarative-repo-setup` skill; generate + verify a working
blueprint so cloud sessions boot green without setup-token burn.

## [ ] 9. `.devin/skills/testing/SKILL.md`

Encode the harness: renderHook usage, `act`/`flushAsync`, per-suite
jest.mock patterns (full-mock vs requireActual-spread), which modules
need setup-level mocks (`react-native-purchases`, `@expo/vector-icons`,
`@react-navigation/native useFocusEffect`), builders convention,
auto-unmount invariant. Future test tasks become a procedure, not
re-discovery.

---

## Deferred (verified acceptable gaps, do not expand scope)

- `closeOffer`/`closeDeal`/`closeAnalysis` one-liner assertions (trivial).
- `balances` passthrough in `useEventList`.
- `useInventorySignals` gated-ON path (signalMap populated) — needs
  catalog-signal fixtures; revisit if deal-engine logic moves in there.
- `worker_pre_show.js` (362) — fold into item 1 if the harness lands
  cheaply; else leave.
- Splitting `inventoryStore` (877) / `dealClassify` (822) — already covered
  by deep suites; split only if churn actually hurts.
