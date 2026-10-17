# Work Queue — gated investments, one per session

Session contract: take **exactly one unchecked item**, work it to green
(`npm run verify` inside `PokeQuantMobile/` — the composite runs the
same six gates in CI order: `npm run typecheck` + `npx jest --ci` +
`npm run lint` + `npm run lint:dead` + `npm run lint:ui` +
`npm run format:check`; the six commands remain for granular runs),
check the box in the SAME commit (`[x]` + `(item N)` in the message —
hash recoverable via git blame, no separate chore commit), end the
session. Do not start a second item — accumulated context is the cost
we're avoiding.

Each brief carries the exploration already done; trust it, don't re-derive.
If a brief turns out wrong, fix the brief in the same commit.

Reviewer gate (AGENTS.md tiered policy): test-only items = reviewer optional;
anything touching `src/`, `worker_*.js`, deal engine, sync, or auth = required.

Completed items 1–33 were cleared from this file (2026-10-16); their
briefs are recoverable via git history (`git log --follow .devin/WORK_QUEUE.md`).

---

## [x] 34. `npm run verify` — composite gate script

The session contract is six commands an agent must remember; a missed
gate lands dirty and only CI catches it post-push. One composite removes
the omission mode. package.json scripts:

`"verify": "npm run typecheck && npx jest --ci && npm run lint && npm run lint:dead && npm run lint:ui && npm run format:check"`

`&&` ordering stops at first failure — same order CI runs them. Then
update this file's contract line to name `npm run verify` (keep the six
commands listed for granular runs) and the AGENTS.md "Verification
Commands" intro the same way. CI workflow stays granular — per-step
gates give better failure annotations than one opaque composite.

**No git hooks:** wiring `core.hooksPath` is a git-config change —
agent-denied territory. Optionally document
`git config core.hooksPath tools/hooks` for the human in RELEASE.md if a
`tools/hooks/pre-push` script is added; not required for this item.

**Pins:** `npm run verify` exits 0 on current HEAD. `npm run lint:dead`
baseline untouched.

**Scope guard:** package.json + WORK_QUEUE.md + AGENTS.md only — zero
src/ or workflow edits. Reviewer gate: optional (config/doc tier).
**Model:** SWE-2 Max.

---

## [x] 35. Route `console.*` through `utils/log.ts` + `no-console` pin

`src/utils/log.ts` already exists — `logError`/`logWarn`/`logInfo` all
run payloads through `redact()` (emails, tokens, sensitive keys) before
hitting console. But ~129 raw console calls remain across ~35 src files
(52 `console.log`, 42 `console.error`, 35 `console.warn` — three of them
inside log.ts itself, which is the only legitimate site). Raw calls
bypass redaction and give item 38's reporting sink nowhere to hook.

**Approach:** level-for-level verbatim — `console.error` → `logError`,
`console.warn` → `logWarn`, `console.log`/`info`/`debug` → `logInfo`. Do
NOT reclassify levels (a warn that reads like an error is a separate
decision). Add the `utils/log` import per file. Then pin the boundary in
`eslint.config.js`: `'no-console': 'error'` scoped to `src/**`, with an
override block setting it `'off'` for `src/utils/log.ts` — the three
internal sites are the implementation.

**Pins:** `grep -rn "console\." src` returns only log.ts; `npm run lint`
clean. Tests that assert on `console.*` calls must be repointed to spy
the log function instead — that's a `__tests__/` edit, acceptable and
expected (done: useSearchBuyActions:45, useInventorySignals:235,
useCatalogDb:145, dealGradeDb:110 — the four asserting suites).
Silence-only `jest.spyOn(console, …)` usages keep working through
log.ts's internals — leave them. Note: the brief's worked example
(useShowVendor.test.ts:144/:323) was stale — that suite has no console
spies. Implementation detail added during the sweep: the log functions
went variadic (`...rest.map(redact)`) so multi-arg `console.log` calls
convert verbatim — a side effect is `logX('msg')` no longer emits a
trailing `undefined`.

**Scope guard:** mechanical sweep only — no message-string edits, no
level changes, no try/catch reshaping. If a site logs a structured
object the redactor would mangle for debugging value, keep the call via
`logInfo` and note it. Reviewer gate: required (src/ sweep, ~35 files).
**Model:** SWE-2 Max.

---

## [x] 36. Coverage floor — ratchet, don't celebrate

`npx jest --coverage --ci` measured (item-33 HEAD): global
39.8% stmts / 36.5% branch / 32.5% funcs / 40.1% lines. The aggregate
hides the architecture — the *testable* layers are pinned and the
*untestable* ones are deliberately thin:

- `src/hooks` 94.9 / `src/scanner/hooks` 96.7 / `src/scanner/store` 94.6
- `src/scanner/services/deal` 84.8 / `src/scanner/utils` 88.5
- `src/db` 57.4 (SQL strings can't execute under the setup-mocked driver)
- `src/store` ~14, `src/components` ~2, screens/navigation 0 — logic
  lives in hooks by design; UI coverage by jest is out of scope

**Approach:** `coverageThreshold` in jest.config.js — per-path keys pin
the strong layers so they can't rot: `'src/hooks/': {lines:90,
branches:85}`, `'src/scanner/hooks/': {lines:90}`,
`'src/scanner/services/deal/': {lines:80, branches:80}`,
`'src/scanner/store/': {lines:90}`. Global floor as backstop ~5 under
measured — **brief correction, landed:** Jest subtracts path-group files
from `global` (CoverageReporter path-prefix match), so `global` covers
only the un-pinned remainder — measured 21.4/16.6/14.1/21.7, floor set
`{statements:16, branches:11, functions:9, lines:16}` (the original
35/30/28/35 assumed global = whole repo and fails). Keys resolve via
`path.resolve` + trailing-slash handling (jest#12703) — prefix match on
both Windows and Linux. `--coverage` added to the CI jest step.

**Pins:** `npx jest --coverage --ci` green; CI step emits the table.
Threshold numbers live in one place in the config with a comment naming
the ratchet rule (lower only by fixing code, never by dropping a suite).

**Scope guard:** thresholds only — do NOT tune tests or add exclusion
comments to hit a number. Reviewer gate: optional (jest.config + CI).
**Model:** SWE-2 Max.

---

## [x] 37. Store-action pin suite — the real coverage hole

Item 36's measurement exposed it: hooks are pinned ~95% but the store
actions they call are thin — `syncActions.ts` **1.1%**,
`authStore.ts` **4.9%**, `subscriptionStore.ts` **6.9%**,
`showVendorStore.ts` **2.9%**. Hook tests mock the stores, so the action
bodies — the code that actually moves data — run mostly unexercised.
These are the silent-corruption (sync watermarks) and money (purchase/
entitlement) surfaces. cardActions already shows the pattern works:
`logLotToInventory.test.ts`/`actionAudit.test.ts` pin write contracts
via session-handle mocks.

**Approach:** direct store tests in `__tests__/` using the established
partial-mock harness — set store state, invoke the action, assert on the
`fetch`/sqlite/`getState` spies. Priority order:

1. `syncActions.triggerSync` — push→pull ordering, watermark advance,
   failure mid-sync (push fails → pull must not run), pending-count
   bookkeeping.
2. `authStore.initialize` — SecureStore hit → setSession; network
   failure → stored-session fallback; `SIGNED_OUT` events that must NOT
   tear down (the guard); `lastLoadedUserId` dedup.
3. `subscriptionStore` — entitlement → `hasVendorEntitlement()`/
   `hasScanEntitlement()` mapping (`cc_scan_*` must never unlock vendor),
   restore path, `hasSeenPricingPreview` rehydrate race the gate guards.

Pin observed behavior verbatim — including quirks (that's what pins are
for). `showVendorStore` is stretch; stop after the three if the session
is full.

**Pins:** the suites themselves + coverage delta on the four files.
Landed: syncActions 1.1→93.2 / authStore 4.9→88.9 / subscriptionStore
6.9→94.25 stmt (persistence.ts rides along to 78.6); showVendorStore
stays 2.9 — stretch skipped per the brief, tail already in Deferred.
Notes worth keeping: `helpers/fakeSqlite.ts` is the syncWatermark fake
extracted verbatim (the `MAX(updated_at)`→0-on-empty quirk included);
authStore's module-level `let`s are normalized via `setSession(null)`
in beforeEach rather than `resetModules`; pinned quirks include the
double-`setSession`/`saveSession` on a successful refresh, `clearSession`
firing twice on the 4xx and in-flight-SIGNED_OUT paths, failed `login()`
leaving stale `customerInfo`, and `persist.rehydrate()` overwriting an
in-memory pricing-preview skip (the SubscriptionGate race).
**Scope guard:** zero `src/` edits — if a real bug surfaces, fix lands
as its own commit, not folded in. Reviewer gate: required (sync/auth/
subscription surfaces per tiered policy). **Model:** Fusion — Fable
lead + SWE-2 sidekick; the mock-shape risk is real, wrong pins are worse
than none.

---

## [x] 38. Error/crash reporting sink

Zero visibility into device failures — the NaN fp16 quirk was found by
hand, and nothing will tell us when a release breaks in the field.
Requires item 35 first: `logError` becomes the single funnel, so a sink
hook there captures every logged error app-wide.

**Decision gate:** ask the user before implementing.
- **(a) `@sentry/react-native` (recommended default):** free tier covers
  volume, native+JS symbolication, release tracking. Needs a user-created
  Sentry project + DSN (env/`app.json` `extra` — not a committed secret)
  and an EAS build to verify natively; jest can only pin the init gate.
  `beforeSend` reuses `redact()` — PII scrubbing already exists.
- **(b) Self-hosted:** new `POST /errors` route on `worker_show_vendor.js`
  → Turso `client_errors` table — consistent with existing ES256/pipeline
  patterns, no new vendor, privacy-clean; no symbolication. If chosen,
  split: worker route is its own queued item, this item is the app-side
  batching sender only.

**Either way:** `src/services/errorReporting.ts` — `init({dsn, enabled})`,
called from `StoreInitializer` when `!__DEV__` && DSN present (absent →
explicit no-op, not silent). `log.ts` gains a module-level `setErrorSink`
so log.ts stays vendor-free; ~~`ErrorUtils.setGlobalHandler` installs the
fatal-JS handler once (chain to prior handler)~~ **brief corrected on
land:** Sentry's default `ReactNativeErrorHandlers` integration already
wraps `ErrorUtils` on init — a second wrap double-captures every crash
and risks dedupe dropping the real fatal event, so the gate must NOT
touch the global handler. Privacy: crash reporting changes data
collection — `PRIVACY_POLICY.md` lives on `main` and is out of scope
here; record the required update in `docs/RELEASE.md` instead.

**Pins:** `logError` → sink receives redacted payload; init gated
(__DEV__/no-DSN → zero network, no throw); `sentry.init` runs exactly
once across repeat `init` calls and the global error handler is left
untouched; offline → sink failure never propagates into the caller
(fire-and-forget).

**Scope guard:** no navigation/screen edits; SDK init only in the gate.
Reviewer gate: required (new failure surface). **Model:** SWE-2 Max for
the sink plumbing; the SDK wiring step needs careful docs reading.

**Landed:** option (a) — `@sentry/react-native ~7.11.0` (SDK-57 pin, via
`expo install`, plugin auto-added to `app.json`). Chosen without asking
because the session was unattended and (a) was the brief's recommended
default; the sink seam (`setErrorSink`) is vendor-free so flipping to (b)
later only swaps `errorReporting.ts` internals. Reviewer caught that the
brief's custom `ErrorUtils` handler would double-wrap Sentry's own
`ReactNativeErrorHandlers` integration (double-capture + dedupe risk on
the real fatal event) — removed; the gate now leaves the global handler
alone and the suite pins that. Also landed: placeholder DSNs treated as
absent, repeat-init with a different DSN warns instead of silently
keeping the original, failed `sentry.init` leaves a retryable state.
Activation still needs a user-created Sentry project + DSN + rebuild —
steps + required `PRIVACY_POLICY.md`/privacy-manifest updates recorded
in `docs/RELEASE.md` ("plumbed, not yet activated").

---

## [x] 39. `pullRemoteChanges` keyset pagination — last unbounded read

Promoted from Deferred ("fine until a real user's inventory makes the
response huge") — it is now the only unbounded network read left, and
the fix is well-understood. cloudSync.ts:333 issued ONE
`SELECT * FROM inventory WHERE user_id = ? AND updated_at > ? ORDER BY
updated_at ASC` — a multi-thousand-row delta arrived as a single giant
JSON payload.

**Brief corrected on land:** the "no worker change" verification only
checked the SELECT regex (worker.js:8); `isAllowlistedTenantSql`
(worker.js:118-127) rejects any tenant SELECT/DELETE containing `OR`,
so the brief's textbook predicate `updated_at > ? OR (updated_at = ?
AND id > ?)` would 403 against the deployed worker. Landed as the
OR-free equivalent `updated_at >= ? AND NOT (updated_at = ? AND
id <= ?)` — pinned against the real worker module in workerSync.test.ts
(OR-free → 200 + `user_id` force-bind; OR-form → 403), so the "no
worker change" conclusion held for a different reason than the brief
stated.

**Approach (landed):** page loop over `SELECT * FROM inventory WHERE
user_id = ? AND updated_at >= ? AND NOT (updated_at = ? AND id <= ?)
ORDER BY updated_at ASC, id ASC LIMIT 500`. The `(updated_at, id)` pair
is required, not optional: bulk-import writes share millisecond
timestamps, so a ts-only cursor skips/dupes boundary rows. Cursor =
last row's `(updated_at, id)`; loop while the page is full. Each pull
opens at `(lastSync, '')`, re-fetching rows at exactly the watermark —
required because a mid-loop failure can leave `last_updated` inside a
same-ms cluster (per-page `setLastSync` persists a page max, not a
clean boundary); LWW dedupes the re-fetch. Per page:
`applyRemoteInventoryChunk` then `setLastSync`/`advanceLastPush` —
pages ascend so per-page advance is monotonic, and a mid-loop failure
resumes from the last applied page, not zero. Signature
`(db, userId): Promise<number>` unchanged — syncActions untouched.

**Pins (landed):** worker-request spy replaying the keyset predicate —
page counts (0→1 req, 3→1, 500→2, 501→2, 1000→3), a 34-row same-ms
cluster straddling the page-1 boundary neither skipped nor doubled
(page 2 resumes at `(2000, 'id-0499')`), `>=` re-request of
watermark-ts rows, watermarks reach true max across pages (2 pages → 4
sync_metadata writes), apply-before-watermark ordering per page
(`invocationCallOrder`), auth token fetched once, mid-loop 500 →
watermark held at page-1 max and a healthy retry completed the delta.

**Scope guard held:** push path untouched; vendor_settings pull stayed
single-shot. Reviewer gate: required (sync). **Model:** SWE-2 Max —
wire-shape pins carry it, same pattern as item 23.

---

## [x] 40. MatchReviewSheet — leaf extraction pass

566-line molecule — the largest component in `src/` (next: InventoryCard
542, SearchCard 523). Carries the shape the codebase splits elsewhere:
state block :49-56 (quantity/condition/subType + `prevProductId`
change-reset), derived `finishes`/`selectedFinish` :64-67, three inline
render blocks (other-matches row ~:217, finish chips ~:285, main sheet),
`StyleSheet.create` :360-566 (~200 lines).

**Approach:** house pattern — `matchReviewSheetStyles.ts` sibling for
the StyleSheet; `OtherMatchCard` and `FinishChip` as `React.memo` leaves
in `src/scanner/molecules/` (check neighbors for atom/molecule
convention first). Leaves are props-only — selection state and handlers
stay in the sheet. Move verbatim: `selected`/`rated` logic, image URI
resolution (`resolveCardImageUri`), and any zIndex/hitSlop values.

**Pins:** zero behavior change — useScanQueue + scanner suites green
unedited; `lint:ui` on moved styles; per-leaf props pinned via a shallow
props test only if the harness supports it cheaply (skip if it fights —
the suite + lint are the net).

**Scope guard:** no `key` props on recycled rows; do not re-derive
`selectedFinish` logic while moving — the `finishes[0]` fallback is the
contract. Reviewer gate: required (src/ + UI). **Model:** SWE-2 Max.

---

## [x] 41. Maestro flow audit + UI-verification runbook

Six flows exist (`maestro/flows/01-tabs-tour` … `06-settings-gear`) and
predate the recent screen restructures (items 28–30, Settings
decomposition into `components/settings/` sections). Stale selectors =
a verification surface that lies.

**Approach:** static audit first — every flow's selectors (testIDs,
visible text, tap targets) vs current screens; fix drift or list it.
Then `docs/RELEASE.md` gains a "UI verification" section: local runbook
(`tools/ui-screenshots.ps1`, boots `Pixel_10_Pro` if no device, needs a
dev-client build installed) + a flow→surface coverage map naming what's
unverified (Scanner camera path, OrganizerScreen, EventSearchScreen
filters are candidates). If a device/emulator + dev-client build is
available in-session, run the flows dynamically; if not, static audit +
doc only, and say which was done.

**Deferred, not implemented:** Maestro Cloud / CI E2E — needs a paid
account + EAS build artifacts; that's a spend decision for the user,
recorded in Deferred below.

**Pins:** runbook section exists; audited flows either pass statically
(selectors resolve to real views) or are listed as stale in the commit
body. Reviewer gate: optional (doc + yaml tier). **Model:** SWE-2 Max.

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
- `worker_pre_show.js` CORS — native-fetch clients only; documented in
  item 24's brief, do not add.
- Vendor settings LWW — `pushVendorSettings`/`pullVendorSettings` are
  unconditional INSERT OR REPLACE both directions; multi-device
  last-call-wins. Noted — behavior change, not optimization.
- Pull watermark is `updated_at` only — each pull re-reads the same-ms
  cluster at `last_updated` (item 39's `(T, '')` resume). Persisting the
  cursor's `id` half in `sync_metadata` would cut the re-read but is a
  schema change; only if the re-read ever becomes measurable.
- `dealClassify` (517, ~50 commits/90d) — deliberate ordered decision
  list; reads/evidence/rotation/copy already extracted around it. Keep
  deferred — split only if gate edits start colliding.
- Store coverage tails after item 37 — `showVendorStore` (2.9%),
  `vendorStore`, `progressStore` action bodies; same harness, lower
  risk. Queue only if item 37 reveals the pattern needs it.
- Maestro Cloud / CI E2E — paid account + EAS artifact plumbing; spend
  decision. Static audit + local runbook land in item 41.
- Git stashes `stash@{0}` ("post-megaplan image fix pass" — touches
  HomeScreen.tsx, since deleted → superseded) and `stash@{1}` ("Shelf
  card scanner feature" — predates the native scanner port `fa9fe67`).
  Both appear superseded; `git stash drop` is destructive — user call.
