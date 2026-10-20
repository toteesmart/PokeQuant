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

Completed items: 1–33 cleared outright (2026-10-16); 34–60 compressed to
landed ledgers (2026-10-19). Full briefs recoverable via git history
(`git log --follow .devin/WORK_QUEUE.md`) — commit bodies carry the
complete landed record.

---

## [x] 34. `npm run verify` — composite gate script

**Landed:** package.json `verify` script runs the six gates in CI order
via `&&` (stops at first failure); session contract + AGENTS.md updated.
CI workflow stays granular.

## [x] 35. Route `console.*` through `utils/log.ts` + `no-console` pin

**Landed:** ~129 raw console calls across ~35 files routed level-for-level
through `logError`/`logWarn`/`logInfo` (redacted); `'no-console': 'error'`
scoped to `src/**` with a log.ts override; log functions went variadic so
multi-arg calls convert verbatim.

## [x] 36. Coverage floor — ratchet, don't celebrate

**Landed:** per-path `coverageThreshold` keys pin the strong layers
(hooks 90L/85B, scanner hooks 90L, deal 80L/80B, scanner store 90L) +
a global backstop on the un-pinned remainder. Correction pinned: Jest
subtracts path-group files from `global` — floors set 16/11/9/16.

## [x] 37. Store-action pin suite — the real coverage hole

**Landed:** syncActions 1.1→93.2 / authStore 4.9→88.9 / subscriptionStore
6.9→94.25 stmt via direct store tests + `helpers/fakeSqlite.ts` (the
syncWatermark fake). Quirks pinned: double `setSession`/`saveSession`,
`clearSession` firing twice on 4xx/SIGNED_OUT races, rehydrate overwriting
an in-memory preview skip.

## [x] 38. Error/crash reporting sink

**Landed:** `@sentry/react-native ~7.11.0` + vendor-free `setErrorSink`
seam in log.ts; init gated on `!__DEV__` + real DSN; reviewer's catch —
do NOT wrap `ErrorUtils` (Sentry's own integration owns it, double-wrap
risks dedupe). Plumbed, not activated: DSN + privacy-manifest steps in
`docs/RELEASE.md`.

## [x] 39. `pullRemoteChanges` keyset pagination — last unbounded read

**Landed:** `(updated_at, id)` keyset pages of 500 with the OR-free
predicate `updated_at >= ? AND NOT (updated_at = ? AND id <= ?)` —
the worker allowlist bans `OR` in tenant SQL (pinned 403 in
workerSync.test.ts). Per-page apply→watermark advance; same-ms cluster
boundary pinned.

## [x] 40. MatchReviewSheet — leaf extraction pass

**Landed:** `matchReviewSheetStyles.ts` sibling + memo'd `OtherMatchCard`/
`FinishChip` leaves; selection state stayed in the sheet; zero behavior
change.

## [x] 41. Maestro flow audit + UI-verification runbook

**Landed:** static selector audit of the six flows + `docs/RELEASE.md`
UI-verification runbook (`tools/ui-screenshots.ps1`, Pixel_10_Pro).
Maestro Cloud/CI E2E → Deferred (spend decision).

## [x] 42. Worker deploy runbook — three wrangler configs, zero docs

**Landed:** `docs/RELEASE.md` "Workers" — config→file→hostname map,
per-worker deploy commands, env invariants (https-only Turso, secrets
via `wrangler secret put`), deploy-order rule (worker before app build),
rollback note.

## [x] 43. `vendor_settings` push LWW — the unguarded tenant upsert

**Landed:** guarded upsert `INSERT ... ON CONFLICT(user_id) DO UPDATE ...
WHERE excluded.updated_at > vendor_settings.updated_at` at allowlist
index 4 (OR-banned group); `user_id` PK verified live on Turso; pull
gained `ORDER BY updated_at DESC`. Worker deployed first per item-42
runbook — legacy `INSERT OR REPLACE` stays 200 for older builds.

## [x] 44. Store-action pins round 2 — `showVendorStore` + `cardActions` tail

**Landed:** 70 pins — showVendorStore 2.9→100 stmt / cardActions
9.45→91.2. Quirks pinned: inclusive buy-tier bounds, addScannedCards'
Promise.all lets grades land on market-fetch reject, provisional
`set({team})` overwritten by `/vendor/me`, listings-refresh failure →
`listingsError` never `uploadError`.

## [x] 45. Download/pipeline services pins — the `src/services` 17% hole

**Landed:** 8 suites / 133 pins — services 17.2→86.0 stmt. Infra:
expo-file-system setup mock made path-aware; `babel.config.js` test-env
plugin rewrites `import()`→`require` (CatalogDownloadService's only
dynamic import crashed jest workers). Pinned: single-flight coalescing,
anti-cache headers, hydrate→cleanup ordering, 80-row/960-param chunking.
Gotcha recorded: deferred `mockReturnValueOnce` survives
`clearAllMocks` — FS suites `mockReset()` in beforeEach.

## [x] 46. `worker.js` is the production sync gateway — relabel + finish the boundary pins

**Landed:** docs relabeled (production sync proxy, not "unmaintained PWA
gateway"); 19 new boundary asserts (12→31): OPTIONS→CORS, 405s, >1MB
body →413 pre-auth AND post-auth (both caps reachable — undici doesn't
auto-set Content-Length), 2001-statement→413, full auth matrix →401,
JWKS single-fetch + concurrent coalescing. 3 reviewer observations →
Deferred.

## [x] 47. Micro-pin batch — the four trivial deferred asserts

**Landed:** closeOffer/closeDeal/closeAnalysis discard-path asserts;
`mkBalance`→builders.ts; `ensureInstalledAt(now?)` injection — fresh
installs now read 7 trial-days (the 8 was a same-ms coin-flip).

## [x] 48. `useInventorySignals` gated-ON — catalog-signal fixtures

**Landed:** `fixtures/inventorySignals.json` — 3 hand-authored real
`card_signals` rows (bleed/revival/cycler w/ `d_*` deep-join cols)
declaring their scalar class; gated pair + seeded-prev-map diff covering
all three `shiftKind`s + merged-map restamp.

## [x] 49. `tools/hooks/pre-push` — the human-side verify gate

**Landed:** POSIX pre-push mirroring all four mobile-ci.yml paths;
fail-safe on unreadable ranges; `.gitattributes` `eol=lf` for
tools/hooks (CRLF would break the shebang). Human opt-in —
`core.hooksPath` stays un-wired per ask-tier.

## [x] 50. Coverage path pins round 2 — floor the un-pinned layers

**Landed:** 7 more per-path floors ~5 under measured (api/db/store/
utils/services/scanner services+utils); global remainder is now pure
UI+constants (2/1/1/2 — a "didn't vanish" gate, not a regression gate).

## [x] 51. Dependency hygiene — audit triage + update policy

**Landed:** 73→68 vulns, 0 critical — in-range `npm update` set +
`audit fix` transitives (shell-quote crit fix); RELEASE.md "Dependency
updates" — `expo install` owns SDK surface, `npm update` owns non-SDK
ranges, patch re-verify checklist, drizzle RC-pair tracking. Deferred/
wontfix sets recorded.

## [x] 52. Queue-contract CI check — mechanize the session contract

**Landed:** `tools/queue-contract.mjs` lib + `check-queue-contract.mjs`
runner + advisory `continue-on-error` CI step. Gated commits touching
src/**/worker surfaces need `(item N)` or `(no queue item)` + a box
flip in the same commit's queue diff; force-push/deep pushes degrade
to warnings.

## [x] 53. Replay + pin the show-verdict ledger — the position-claim family

**Landed:** `collectProblems` position-claim rule mirrors
`resolveRangeEvidence` — floor-proximity/buy-end language banned when
price ≥ resolved ceiling or stamped `targetPrice`; message names the
firing level. KNOWN_SIBLINGS per-row ledger + fuzz pinned-lane
(`toBe(266)`) conventions established. Fixture +4 → 25 cards: ninetales
42352 (seed), flying_pikachu_ev 124123, spiritomb 676056, piplup 201350.
Off-family findings spawned items 58–60.

## [x] 54. Tail-landing guards + floor-proximity predicate split

**Landed:** `floorWithinReach` (directional, ×[0.97,1.25] semantics)
split from `sittingOnFloor` (parked ×[0.97,1.15]); tail
`bleedFloorTestRead` gated `!possibleRangeExit && !atStampedTarget &&
!feebleFloor && floorForTest` — ninetales 42352 lands DECLINER both
paths. `declinerSlideRead` nulls positive cagr instead of quoting it
as a slide rate.

## [x] 55. Position-first evidence core — resolve position once, quote it everywhere

**Landed:** `RangeEvidence.position` via `resolvePosition` inside
`resolveRangeEvidence` — ceiling-first (×0.92 exit band gated on
`ceiling ≥ 0.6×ath`, or stamped sell-into reached), crack ×0.97 →
through-floor, parked ×[0.97,1.15] → on-floor, reach ×1.25 →
approaching-floor, floor>ceiling → no-structure. Every gate/variant/
tail quotes `pos`; `stillBleeding`→`legStillFalling`; `sittingOnFloor`
deleted. Reviewer defers → raw `medianBouncePct` read lives on as
item 63; stockHealth ceiling-blind display flag noted deliberate-then
(item 64 now owns it). Fuzz position lane 252→0 hard-fail.

## [x] 56. Positional-language claims sweep — the audit's missing axis

**Landed:** `checkPositionText` audits every rendered phrase against a
per-surface `PosView` (scalar badge/scout/shift/trade, deep sheet/facet/
engine, ctxPosition note/verb); 12+ phrase classes incl. cross-surface
1y-band contradictions; `positionalClaims.test.ts` (32). realCards
detectorPins: tremendous_bomb + flying_pikachu_ev; KNOWN_SIBLINGS +22.
Defers: dead PosView fields, unreachable defensive branches — folded
into item 63's scope.

## [x] 57. Catalog-age disclosure on DealAnalysisSheet

**Landed:** `dataAgeLabel` → `Prices as of M/D/YY`, always-on muted line
inside priceHero under the DeltaPill (ISO-shape guard, malformed →
renders nothing); harness-audited on numeric + positional axes.

## [x] 58. `positionAction` verb split — keep-class cards get dump verbs

**Landed:** `stillCompounding(signal)` trajectory leg — `trend !==
'depreciating'` veto else `appreciating || cagr > 0`; STABLE_FLAT:
underwater → `Cut it — down vs cost`, compounding → `Hold — still
climbing`, else dead-money verbatim; DEAD_STABLE/DORMANT unchanged.
collectProblems rule 14 verb-honesty check. Piplup 201350 (+75%/yr)
lands hold. Defers → item 68 (sub-dollar underwater epsilon,
deep-negative cagr edge, flatline gloss, lifecycleSim nit).

## [x] 59. RANGE_PLAY proof-of-rhythm — "bounces on a rhythm" at 0/3

**Landed:** held-bounce ledger — `CardSignal.analogBounceN` (stamped
K-of-N off card_deep, joined in signalFromRow + both production joins
incl. scout SQL mirror `d.analog_bounce_n >= 1 OR cs.trend IS NOT
'depreciating'`) vs `SeriesFeatures.floorBounces` (window ledger —
≥15% rally never undercut past ×0.97) unioned into `ev.bounces`.
Gate: `ev.bounces >= 1 || trend !== 'depreciating'` — spiritomb 676056
(0-of-3 both resolutions, −84% cagr) lands DECLINER badge /
POST_SPIKE_BLEED sheet. Pattern facet's "and held"/"bounces every"
tails gated on the same ledger.

## [x] 60. Suppressed-riser tail — `possibleRange` benches the grower reads

**Landed:** `riserOutranksRange` — appreciating trend + (cagr≥25 &&
pctile≥50 || cagr≥10 && pctile≥60) + `r30 > −20` + `!atCeiling` —
a proven riser's giveback keeps grower reads over thin cycler
evidence; flying_pikachu_ev 124123 lands STABLE_GROWER. 8 stale
KNOWN_SIBLINGS retired, 11 leg-straddle direction flips pinned with
mechanisms.

---

## [x] 61. DIP_BUY leg-speed brake — a −30% week can't be a dip

**Landed:** `extremeSpeed` (`r30 ≤ −20`/`r7 ≤ −15` — the structural
clause's own arm, hoisted pre-gate and folded back verbatim) brakes
the dip arm; knife legs fall through to the shared phase logic the
falling-block comment already promised (PSB / floor-test / FREE_FALL
/ DECLINER tail per the decision order). `atPeakRead`: a knife-speed
leg → `topping` whatever the partner leg prints (week AND month arms
— "still intact" on a −20% month was the same lie). classifySweep's
blanket `read.cls !== 'DIP_BUY'` exemption deleted — it now lives in
the gate's brake band — and its leg bars read the gate's resolved
(features-first) legs. Fuzz `R7_BARS` gained −15 as a real bar.
Live catalog had NINE stamped knife-dips printing buy-at-near-rate
(42550 on a −70% month) — post-brake: 0 hard problems, 0 stale pins.
Bar choice pinned against `legStillFalling`: the wider brake would
eat the pinned mabosstiff (r30 −13 → DIP_BUY). Reviewer: no
must-fix; three landing edges + the residual under-brake deferred →
item 69 + this ledger. Pins: 4 lifecycle scenarios on both paths,
±edge brake/peakState pins, scout stat/why survival + dropout.

---

## [x] 62. BASE_FORMING·resting earns "holding a floor" off a fresh low

Invariant-14 residue inside the classifier's own gate. `nearFloor`
(dealClassify:369–373) is three arms: resolved `pos === 'on-floor'`
(real shelf — fine), `price ∈ low90d × [0.97,1.15]` (the fresh-low
tautology — any card that stopped falling sits there by definition),
and `pctile1y ≤ 25` gated on `!midAir`. The low90d arm is also
midAir-blind: a card at $21 with a resolved $10 shelf (`midAir`
TRUE, pos 'mid-range') still satisfies nearFloor whenever a $19.5
recent print sits under it — verdict reads "holding a floor — this
level is holding" while its own trigger row names the $10 shelf.
Reachable copy: baseFormingRestingRead's "holding a floor" headline
+ "this level is holding" script, and the scout row "resting on the
floor — this is where bounces start" (resting passes the scout
filter; only 'testing' is excluded) with "on a held floor" stat when
no shelfPrice ships. The `pctile` arm is already midAir-guarded —
the low90d arm needs the same disproof, and the resting read may need
hedged copy when proximity-to-a-fresh-print is the only floor
evidence the gate ran on.

**Approach:** `pos === 'on-floor'` is the proof arm. Decide whether
unproven low90d proximity still earns the class at all or earns
hedged language ("stopped falling near its low" vs "holding a
floor") — and apply `midAir` to the low90d arm either way: a resolved
shelf far below means the card isn't holding HERE. inventoryHeld's
`testingNoFloor` probe already pins the same doctrine for the testing
variant — extend the probe family to resting rows.

**Pins:** synthetic resting candidate priced mid-air above a resolved
shelf but inside the low90d band must not print floor-held copy (or
must not classify resting — whichever the fix lands); a stamped-shelf
resting card keeps BASE_FORMING·resting; the low-only case's scout
stat drops "held floor". Scope guard: dealClassify.ts + reads.ts /
buyScout stat copy as the fix dictates + the inventoryHeld probe.
Reviewer gate: required (deal engine). **Model:** SWE-2 Max.

---

## [x] 63. ownerNote quotes raw `features.*` where `noteEv` resolved the union

copy.ts resolves `noteEv = resolveRangeEvidence(...)` at :69 and
quotes it for ceiling/cycle/ath — then reads the tests/bounce legs
raw anyway: `floorN` prints "(N× held)" only off `features.floorTests`
(:82), `onWeakFloor` counts `(features?.floorTests ?? 0) < 3` (:90–95),
`weakBounce` reads `features?.medianBouncePct` (:99), and the
BASE_FORMING "safe stock" branch repeats the raw tests read (:228).
With no features (first paint, or a short/absent price_series —
useDeepFeatures drops <15 points) `floorTests ?? 0` is 0 → every
parked card evaluates `onWeakFloor` → "one crack from new lows —
discount it out" on a stamped 8×-held shelf the badge's own
classification used; hydration then flips the same card's note to
"held" language — a self-contradiction on one surface. A stamped
thin-bounce shelf (medianBouncePct 13) similarly reads "floor that's
held" until features load. Item 56's reviewer defer (producer-side
raw medianBouncePct) is still live — the union fields
(`noteEv.tests`, `noteEv.bouncePct`) are computed two lines up and
ignored. Same seam upstream: `notePos` resolves off
`floorCtx.floor`, which is positionTriggers' display chain including
`low90d` — so "parked on a floor that's held" can earn its on-floor
verdict off a bare fresh low the classifier would never call a floor
(copy.ts:63–76; the classifySweep note probe only ever passes real
floors, so the harness can't see it).

**Approach:** quote the union — `noteEv.tests`/`noteEv.bouncePct` —
for every tests/bounce read in ownerNote (same evidence the verdict
and the Pattern facet print), and resolve `notePos` off the
structural shelf (`noteEv.floor`) — keep the caller's `floorCtx.floor`
as the named crack/bounce-back level, not as positional proof.
`features.failedBounce` stays features-only (no stamped equivalent —
the window's own observation; leave it).

**Pins:** unit test — scalar path (features undefined) + stamped
shelfTests 8 / medianBouncePct 13 → held-floor note prints "(8×
held)", no weak-floor language; same-shelf deep mirror proves the
max wins; surface-coherence asserts the note doesn't flip between
the no-features and hydrated render of one card; a low90d-only ctx
floor can't produce "floor that's held" copy. Scope guard: copy.ts
(+ DealReadSection ctx if the floor plumbing changes) + stack/claims
harness. Reviewer gate: required (deal engine). **Model:** SWE-2 Max.

---

## [x] 64. Stock-health rows resolve position with half the evidence

**Landed:** `triggerFor`/`onFloor` quote `resolveRangeEvidence(signal,
features).position` — the same ev classifyDeal resolves a call
earlier — so the armed "sell if it drops below $X" wording and the
thin-ice flag only fire under the resolved `on-floor` verdict.
`low90d` stays in the display chain to NAME a stop level (a level can
be named without asserting the card is parked on it — invariant 14);
at-ceiling/degenerate ranges can't arm a floor stop. RANGE_PLAY's
ceiling reads `ev.ceiling` — including the derived
`floor×(1+bouncePct)` tail — and `positionTriggers.targetPrice` quotes
the same `ev.ceiling ?? high90d` so the sheet's SELL INTO row names
the level the row and the verdict used (zekrom $17.29→$15.90;
tremendous bomb's launch-spike $9.40 eject suppressed under the $3
bounce-worth gate). claims.ts health PosView audits `ev.position`;
inventoryHeld's healthArmedNoFloor probe asserts flag+wording match
the verdict on both passes. Surface snapshot 7 flips — all armed→named
or tautology-flag drops.

---

## [x] 65. POST_SPIKE_BLEED watch escape — counted tests, no position

**Landed:** the raw `(features?.floorTests ?? 0) >= 2` arm cut —
`floorWithinReach` alone is the watch gate. The tests arm's unique
firing zones — mid-air over a shelf, at the sell end, degenerate
floor>ceiling — all resolve rotate by doctrine ("a shelf the price
can't reach is a chart fact, not a trigger to watch" — the ×1.25
reach band already IS the "nearly arrived" measure); no surviving
purpose to pin. inventoryHeld's
`psbWatchNoFloor` probe now mirrors the arm — `floorWithinReach` on
both passes, both directions (watch-without-verdict or
rotate-despite-verdict flags); the deliberate ceiling-blind
`floorUnder` retired with the arm that needed it. dealClassify pins:
mid-air over a 2-test shelf stays rotate hydrated (petilil shape),
parked-on-shelf stays watch, at-ceiling inside a thin range stays
rotate (spiritomb shape). Surface snapshots 4 flips — all spiritomb,
watch→rotate on the deep pass (scalar already rotated — the
hydration flip this killed).

---

## [ ] 66. "Right now" facet — a stamped MA preempts the resolved legs

`buildFacets` (sheetReads:290–299) resolves `nowR7`/`nowR30`
features-first — but only inside the `ma20_60 == null` fallback
branch. When the stamp ships an MA ratio it wins unconditionally: a
stale-catalog `ma20_60 +0.8` with slope prints "Going up — picking
up speed" while the same sheet's leg chips and the verdict show
r7 −18% / r30 −25% (the data-age line item 57 added makes the
contradiction readable). The facet's own comment claims "series-fresh
legs beat the stamps, same override the classifier uses" — the
override just never reaches the MA branch. `features.slope30d` is
likewise never reconciled against the stamped slope clause.

**Approach:** when features resolve legs, the facet's direction comes
from them — reorder so the legs branch runs first when features
exist, or gate the MA clause on agreement (stamped "up" + window
"down" is a direction contradiction the claims audit should catch).
No series → the stamped MA stays; scalar-only sheets still need a
facet.

**Pins:** surface-coherence case — stamped up-MA + window down-legs
prints the legs' direction (and the claims audit flags a disagreeing
MA clause if reconciliation is the fix); a no-features card still
prints the stamped MA line. Scope guard: sheetReads.ts + claims/
facet pins. Reviewer gate: required (deal engine). **Model:** SWE-2
Max.

---

## [ ] 67. Shift tracker cracks the bare 90d low 3% late

`isCracked` (dealShiftTracker:64–65) applies the shelf-zone ×0.97
margin to the `low90d` fallback — `price < low * 0.97` — while the
sheet's positionTriggers cracks a bare 90d low at the level itself
("the 90d-low fallback is already the low itself; under it is broken
by definition", sheetReads:170–171). A card printing in the
(low×0.97, low) band shows FLOOR BROKE on the sheet while the tracker
sees nothing — the "under its floor" banner and the same-class crack
transition stay silent for the band the sheet already calls broken.

**Approach:** mirror the sheet's two-zone convention — zone floors
(stamped `shelfPrice`) keep the ×0.97 margin so a print sitting
exactly on the level isn't flagged; the bare `low90d` fallback cracks
at the level.

**Pins:** tracker unit test — price inside (low×0.97, low) with only
a low90d stamps `cracked: true`; a stamped-shelf card keeps the 3%
margin (exactly-on-the-level stays unflagged). Scope guard:
dealShiftTracker.ts + its unit suite. Reviewer gate: required (deal
engine). **Model:** SWE-2 Max.

---

## [ ] 68. Copy tail — item-58's deferred owner-note/verb edges

The reviewer defer list from item 58 is still live — each a small
violation of doctrines the surrounding code already enforces:

- **Sub-dollar underwater epsilon:** DealReadSection passes
  `underwater: vsCost < 0` (:86) — a $0.80 card down five cents earns
  "Cut it — down vs cost" while invariant 8 (and `bounceWorth < 3`
  one function up in copy.ts) says sub-$3 swings aren't inventory
  events. `green` already needs a real dollar (`vsCost >= 1`, :83) —
  underwater firing on any negative cent is the asymmetry the
  reviewer named. Fix shape: underwater needs the same real-money
  bar, ~−$1.
- **`stillCompounding` deep-negative edge:** an 'appreciating' stamp
  with a window-resolved negative cagr still earns "Hold — still
  climbing" — the verb trusts the stamp over the fresher window the
  verdict used. ctx already carries `ctxEv`/features in scope at the
  call site if a resolved trajectory leg is needed.
- **flatline archetype gloss** (DealAnalysisSheet.tsx:311): "stable
  but dead money" — unconditional dead-money language on a shape
  descriptor, rendered beside a verdict that can say "Hold — still
  climbing" on a compounding flat card (the shape is flat; the money
  claim is trajectory — same defect class item 58 fixed in the verb).
- **lifecycleSim ctx.signal nit** (test-side): the note-side context
  should pass the signal the surface consumes, mirrored the way
  stack.ts does.

**Approach:** one pass through owner-side copy edges — each fix is a
line or a phrase; no gate moves. Pins: surfaceCoherence underwater
band cases (+$/−$/sub-dollar), a stillCompounding edge case, the
flatline gloss wording, the lifecycleSim mirror. Scope guard: copy.ts,
DealReadSection.tsx, DealAnalysisSheet.tsx, lifecycleSim. Reviewer
gate: required (deal copy). **Model:** SWE-2 Max.

---

## [ ] 69. Braked-dip landing edges — the recovering week

Item-61 reviewer defers — all three live where the new brake's
knife-speed arm is week-blind around `weekBouncing` (r7 > +10 =
"already bounced"):

- **`r30 ≤ −20` with `r7 ∈ (0, +10]` lands "still sliding" copy.** A
  V-recovery in flight: FREE_FALL prints "Down 20% in 30 days and
  still sliding" and knifeFloorTest prints "Falling hard toward a
  low" beside a green week chip (dealClassify knife gates;
  freeFallRead). POST_SPIKE_BLEED's "still sliding" carries the same
  wrinkle at dd ≤ −25. The claims checker passes it — its sliding
  bar needs only EITHER leg red. Money stays protective (0.75–0.85).
- **`r30 ≤ −20` with `r7 > +10` escapes to growerSteady.** The
  braked dip skips the knife gates via `weekBouncing`, then
  `growerSteady`'s r7-only bar prints "Climbing steadily — safe to
  stock" at 0.95–1.05 over a −20%-month chip. Old code printed
  DIP_BUY at the same band — no money regression, arguably a worse
  story. The sweep grid's `r30s` cap at −15, so the harness can't
  see it today.
- **Week-knife + green-month landings label DECLINER.** `r7 ≤ −15` /
  `r30 > 0` / appreciating → the golduck clause kills `structural` →
  the tail's generic `declinerSlideRead` ("Sliding long-term", cagr
  correctly nulled). Honest family, understates a −18% week —
  matches the pre-existing golduck-twin tail.

Residual under-brake is deliberate and stays: the band keeps
DIP_BUY at 0.95–1.05 on live double-digit slides just inside the
bar (`legStillFalling` territory every sibling vetoes) — braking
wider would eat the pinned mabosstiff and near-delete the class.

**Approach:** decide whether a recovering week (r7 ∈ (0, +10]) earns
softer copy on the knife landings (a relief below `weekBouncing`'s
+10 bar, or a tighter either-leg claims mirror) and whether a −20%
month can ever print "climbing steadily" — both one-line gate
adjustments; the DECLINER label is copy-side if it earns one. Pins:
braked dip + recovering week landing/copy on both paths, the
growerSteady escape closed or pinned deliberate, sweep grid extended
if `r30s` learns ≤ −20. Scope guard: dealClassify.ts + reads.ts +
classifySweep (+ claims.ts if the mirror tightens). Reviewer gate:
required (deal engine). **Model:** SWE-2 Max.

---

## Deferred (verified acceptable gaps, do not expand scope)

- `environment.yaml` for Devin Cloud (was item 6) — user runs local-only
  sessions; the blueprint only pays off if cloud workers get used.
  Resurrect the `declarative-repo-setup` skill approach if that changes.
- `worker_pre_show.js` CORS — native-fetch clients only; documented in
  item 24's brief, do not add.
- Pull watermark is `updated_at` only — each pull re-reads the same-ms
  cluster at `last_updated` (item 39's `(T, '')` resume). Persisting the
  cursor's `id` half in `sync_metadata` would cut the re-read but is a
  schema change; only if the re-read ever becomes measurable.
- worker.js allowlist pattern[0] end-anchor — `VALUES\s*\(.*\)\s*$` is
  greedy, so a `)`-terminated crafted INSERT into vendor_settings/
  sync_metadata carrying an OR tail still bypasses the OR-ban
  (pre-existing; exploit value nil — `injectAndValidateUserId` still
  force-binds every user_id slot/literal). Tightening needs literal-aware
  paren parsing; separate item if the allowlist ever needs to be airtight.
- `worker.js` review tail (item 46): the post-gate byte cap (`:602`) runs
  after `ensureSyncSchema` + `assertIsPaidVendorSync`, so a >1MB chunked body
  (no Content-Length) costs ~12 Turso round-trips before its 413 — a cost
  ordering quirk, not a hole. `verifyJwt`'s issuer check is `payload.iss &&`
  — an iss-absent token skips it entirely (signature still required, so it's
  defense-in-depth slack, not exploitable). And `env.TURSO_*` is checked
  twice (`:579` and `:630`) — the second is dead code. All pre-existing;
  fixes are a worker-edit item, not characterization.
- `vendor_settings.updated_at` is second-granularity
  (`Math.floor(Date.now()/1000)` in persistSettings) — strict-`>` LWW
  silently drops same-second pushes, and a same-ts repush never converges
  until a newer-timestamp edit. Consider ms stamps if rapid successive
  settings edits prove common.
- `dealClassify` file split (517, ~50 commits/90d) — deliberate ordered
  decision list; reads/evidence/rotation/copy already extracted around
  it. Items 53–55 restructure the decision MODEL inside that shape
  (position resolved once as typed evidence) — not a file split and
  doesn't earn one. Keep deferred — split only if gate edits start
  colliding.
- Maestro Cloud / CI E2E — paid account + EAS artifact plumbing; spend
  decision. Static audit + local runbook landed in item 41.
- Git stashes `stash@{0}` ("post-megaplan image fix pass" — touches
  HomeScreen.tsx, since deleted → superseded) and `stash@{1}` ("Shelf
  card scanner feature" — predates the native scanner port `fa9fe67`).
  Both appear superseded; `git stash drop` is destructive — user call.
- WORK_QUEUE compaction — landed 2026-10-19 (items 34–60 → landed
  ledgers, 1–33 cleared 2026-10-16). Re-compact when completed briefs
  again dominate the file.
- `nul` / `%TEMP%*` file recurrence — gitignored CMD-isms; cosmetic,
  do not re-file.
- `main` vs `react-native-v2` permanent divergence — release-planning
  call; a mistaken merge deletes the PWA files, but protection is a
  repo-settings/user decision, not a code item.
- `src/screens` / `src/components` jest coverage — out of scope by
  design (logic lives in hooks); Maestro + review is the net.
- Legacy PWA still publicly deployed via `cloudflare-pages.yml` on
  `main` pushes — product/spend decision, not a code gap.
