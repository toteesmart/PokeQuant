# Work Queue — landed ledger (items 34–69)

Moved out of `WORK_QUEUE.md` 2026-10-20 — every item below shipped
green and committed. The `**Landed:**` notes are the summary; full
briefs and the complete landed record live in git history
(`git log --follow .devin/WORK_QUEUE.md`) and each `(item N)`
commit body. Items 1–33 were cleared outright 2026-10-16 (no ledger);
34–60 compressed 2026-10-19; 61–69 joined on the second compaction.

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

**Landed:** `nearFloor`'s low90d band was midAir-blind — a card at $21
mid-air over a resolved $10 shelf landed resting off the $19.5 print
it just made. `floorDisproven` replaces `midAir`: any resolved verdict
that isn't on-floor/approaching-floor vetoes both proximity arms, and
the veto resolves through EITHER path (a stamped shelf kills the badge
read the same way the window's shelf kills the sheet's); approaching
stays eligible hedged. `heldFloor = pos === 'on-floor'` is the only
arm earning floor copy — proximity-only landings keep the class hedged
('Near a low', "stopped falling near its recent low"). buyScout
shelf-less resting rows stat the low AS a low; tradeEval floor notes
hedge on the scalar verdict. Pins: mid-air disproof scalar+deep,
hedged low90d/pctile landings, parked keeps proven copy,
restingHeldNoFloor probe on both passes.

---

## [x] 63. ownerNote quotes raw `features.*` where `noteEv` resolved the union

**Landed:** `notePos`/`ctxPosition` now resolve off `noteEv.floor`
(the structural shelf the verdict and Pattern facet print) instead of
positionTriggers' display chain, which bottomed at a bare `low90d` —
a fresh-low print names a level, it doesn't prove the card is parked;
`floorCtx.floor` stays the NAMED crack/bounce-back level for dollar
phrasing. `floorN`/`onWeakFloor`/`weakBounce` and 'Floor's held Nx'
quote the `noteEv.tests`/`noteEv.bouncePct` union — a stamped 8×-held
shelf can't print weak-floor copy pre-hydration then flip to held
post-hydration, and a stamped feeble-bounce shelf reads 'barely
bounces' from first paint. DealReadSection `ctxPosition` + stack.ts
mirrors resolve `ctxEv.floor`; `features.failedBounce` stays
features-only. fuzzSweep's mid-below-floor lane retired with the bug
— the cls+position pair is mutually exclusive by construction.

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

## [x] 66. "Right now" facet — a stamped MA preempts the resolved legs

**Landed:** with a series loaded (`features != null`) the resolved
legs pair IS the facet's direction — the legs branch runs ahead of
`signal.ma20_60`, so a stale +0.8 stamp can't print "Going up —
picking up speed" beside a −18%/−25% window (the leg chips and the
verdict quote the same `features?.ret7d ?? signal.ret7d` resolution
the classifier uses). Scalar sheets keep the stamped MA line — the
pipeline's own direction measure where no series exists — and its
speed tail now quotes `features?.slope30d ?? signal.slope30d` (the
brief's second half: the window slope was never reconciled). The
reorder exposed the legs copy's flat else-tail printing "Flat — not
much moving" under big legs the MA had masked (golduck Unlimited's
−20% week inside a flat month + 11 live-catalog rows, all flagged by
the audit's `bigWeek` bar): four one-sided arms close it —
"Slipping — down this week, flat on the month" / "Rising — up this
week, flat on the month" and the mirrored month residuals "Easing —
down on the month, flat this week" / "Cooling — up on the month,
flat this week" — so Flat only prints when both legs are quiet
(reviewer's [edge] finding absorbed in-flight). Pins: stamped up-MA
+ window down-legs prints the legs' direction hydrated; scalar keeps
the stamped MA; features-without-legs MA branch reconciles the fresh
slope ("slowing down" off slope30d −2 vs stamped +1.5); a 10-cell
lattice pins every arm's wording with a riding down-MA so a
precedence revert fails 10 ways + the incomplete-pair MA fallback.
Snapshots 3 flips — ninetales →Slipping, toucannon + flying pikachu
→Easing (real month moves the old Flat lied about). Reviewer gate
SAFE TO COMMIT (2 passes) — defers: cross-arm sign-vs-band
granularity (`a>0`/`a<0` vs the |x|≥5 flat band), claims-audit
two-axis flat vocabulary + its week-only comment, a true
mixed-resolution pin.

---

## [x] 67. Shift tracker cracks the bare 90d low 3% late

**Landed:** `isCracked` adopted the two-zone convention
`positionTriggers` and `stockHealth` already used — a stamped
`shelfPrice` is a zone (break ~3% through it, so a print exactly on
the level stays unflagged); the bare `low90d` fallback is the low
itself and cracks at the level. The (low×0.97, low) band can no
longer show FLOOR BROKE on the sheet while the "under its floor"
banner stays silent. claims.ts's badge PosView `crack` mirror updated
to the same chain — the CRACKED phrase audit verifies "under its
floor" against the surface's own break line, so the mirror had to
move with the tracker. Pins: in-band bare-low stamps `cracked` +
fires the same-class `floor_crack` → "under its floor"; a stamped
shelf brackets on-level/in-zone unflagged vs through-margin flagged.
Reviewer gate SAFE TO COMMIT — defers: tracker lacks the sheet's
`mkt > 0` guard (pre-existing, a 0-price stamp reads cracked) and
stays class-blind where the sheet gates `floorCracked` on
FLOOR_CLASSES (pre-existing; the widened band enlarges the gap ~3%
on bare lows).

---

## [x] 68. Copy tail — item-58's deferred owner-note/verb edges

**Landed:** the four owner-side copy edges, each a line or a phrase.

- **Underwater needs a real dollar.** `vsCost < 0` → `vsCost <= -1`
  in DealReadSection's verb ctx AND `ownerNote`'s cut-loss reframe —
  verb and note share the bar, mirroring the `green >= 1` arm. A $0.80
  card down five cents is the same $1 sticker, not a loss worth cut
  language (invariant 8, same doctrine as `bounceWorth < 3` one
  function down). Mirrors updated: stack.ts `ctxUnderwater`,
  lifecycleSim's positionAction ctx, `vsCost`/`underwater` field docs.
- **`stillCompounding` spent-floor veto.** The appreciating arm now
  requires `(signal?.cagr ?? 0) > -15` — the classifier's own
  `f(cagr) <= -15` spent floor — so an 'appreciating' stamp can't
  outrank a deeply spent lifetime (budew 004/131: stamp up, cagr −88,
  "Hold — still climbing" was a lie; the window the verb was asked to
  trust IS the stamped cagr — scalar badge path has no features).
  Null cagr stays stamp-tolerant; depreciating veto unchanged. The
  item-58 pin at dealClassify.test.ts:2369 was the defect's own pin —
  updated + −14/−15/null boundary cases.
- **Flatline gloss is shape-only.** `ARCHETYPE_*` maps moved to
  dealExplain.ts as `archetypeLabel()`/`explainArchetype()` (fallbacks
  verbatim); flatline now says "stable, no big moves either way" — the
  trajectory call belongs to the verdict beside the chip.
- **lifecycleSim note mirror.** `ownerNote` ctx now passes `signal`
  (stack.ts/DealReadSection already do — the note resolves the
  stamped+window union); underwater mirror flipped to `<= -1`.

**Pins:** surfaceCoherence context matrix gained noteWant/noteNotWant
+ the three underwater bands (sub-dollar riser hold, −$1 boundary cut,
sub-dollar bleeder rotate with no underwater note); dealClassify pins
the stillCompounding bar + the flatline gloss. realCards: 8 snapshot
flips, all intended — budew/leafeon still-climbing→dead-money,
budew sub-dollar cut→dead-money, three DECLINER notes drop cutLoss on
sub-dollar dips. Reviewer: SAFE TO COMMIT; three comment-drift nits
folded in; STABLE_FLAT spent-lifetime note variant deferred (verb
"move it" vs note "no urgency" — tension, not a lie).

---

## [x] 69. Braked-dip landing edges — the recovering week

**Landed:** slide-copy landings now take the resolved `r7`/`r30` —
`postSpikeBleedRead`/`knifeFloorTestRead`/`bleedFloorTestRead`/
`declinerNearLowRead`/`declinerSlideRead` concede a green week under
`weekBouncing`'s +10 bar ("the week's green is the first tell",
'Testing a low' label) instead of printing "still sliding"/"Falling
hard toward" beside the green chip. `growerSteady` gained
`f(r30) > -20` — the extreme-speed bar — so a knife-speed month
can't print "Climbing steadily — safe to stock" (it falls to the
tail's bleed-floor or weekTurned arms). `declinerSlideRead` splits:
knifeWeek (r7 ≤ −15 on r30 > 0) → 'Sharp drop' ("a fast drop, not a
slow slide" — or "inside a long slide" when a depreciating stamp or
red cagr already proves the slide), weekTurned → "Down on the month
— the week's green". Under-brake DIP_BUY residual pinned both paths;
sweep `r30s` extended past −20 + a rebound week shape;
slide-copy-on-green-week flag: 0 hits / 466,560 combos. Togedemaru's
3 snapshot flips are the intended fix.

---
The Deferred ledger lives in WORK_QUEUE.md — it tracks open gaps, not landed work.
