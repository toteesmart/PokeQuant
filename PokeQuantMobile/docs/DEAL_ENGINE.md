# Deal Engine & Analysis — module map and test harness

The deal stack answers three questions per card — what it is (class), what
to do (action, offer band, triggers), and where it sits in the case
(bucket). All of it lives in `src/scanner/services/deal/`;
`DealAnalysisSheet.tsx` is the per-card surface and `SearchBuyScreen.tsx`
hosts the buy scout. **The 15 invariants in `AGENTS.md` are the contract —
read them before touching this module.**

Sheet internals: `DealAnalysisSheet.tsx` keeps only UI state
(finish/window/details) + JSX; `src/scanner/hooks/useDealAnalysis.ts` owns
all data plumbing (series/deep/pattern load with cancellation,
`features`/`read`/`facets` memos, `DEEP_STALE_DAYS` guard, timeframe clamp
to MAX, `shown`/`winRet`/`deltaRet`/`deltaLabel`). `DealReadSection.tsx`
owns the deal-read card (unowned offer-band + private `PositionSection`
for owned) and exports `DealOwnership`; `DealEngineLines.tsx` renders
`engineLines` output; `dealSheetStyles.ts` owns the shared StyleSheet.
Money/held formatting (`fmtDollars`, `fmtShort`, `releaseLabel`,
`heldDays`, `heldLabel`, `COLLECTION_FLOOR`, `tableMoney`) lives in
`src/utils/format.ts` — one owner, also used by dealClassify.

`TradeEvaluatorSheet.tsx` is a composition shell (~245 lines): entry
helpers in `services/deal/tradeEntry.ts` (`nextTradeEntryKey`,
`parseTradeCash`, `TRADE_RATE_OPTIONS`, `tradeVariantsFor`,
`tradeEntryMatch`, `TradePick`), both side-picker pipelines + the
many-vs-one add guard in `src/hooks/useTradeEntryOps.ts` (local inventory
search vs 250ms-debounced catalog search), sections `TradeMatchupHeader`/
`TradeVerdictCard`/`TradeMathDisclosure`/`TradeYourSide`/`TradeTheirSide`/
`TradeEntryRow` (rate chips live inside TradeTheirSide — they sit under
the Theirs total), shared styles in `tradeSheetStyles.ts`. The shell keeps
verdict math + `handleComplete` (the `completeTrade` write path) + the
nested `DealAnalysisSheet`.

## Module map

- **`dealClassify.ts`** — the classifier core + single public surface:
  `classifyDeal(signal, features?)` → `DealRead` (`cls`, optional
  `variant`, `headline`, `script`, `color`, `offerLoFactor/HiFactor`,
  `risk`). Classes: `DIP_BUY`, `REVIVAL`, `RANGE_PLAY`, `BASE_FORMING`
  (variants `testing`/`resting`), `STABLE_GROWER`, `STABLE_FLAT`,
  `POST_SPIKE_BLEED`, `HYPE_DECAY`, `FREE_FALL`, `DECLINER`, `AT_PEAK`,
  `DEAD_STABLE`, `DORMANT`, `LOW_DATA`. `RANGE_PLAY` variants:
  `entry`/`mid`/`exit` (position in the proven range). Also re-exports
  `offerBand`, `ownerNote`, `rotationBucket`, `dealAction` (buy-side
  verb), `positionAction` (owned-side verb) — **the module is layered:
  `types.ts` (DealRead/DealClassId/PeakState/RangeEvidence vocabulary),
  `evidence.ts` (`resolveRangeEvidence`/`resolvePosition`/`floorWithinReach`), `rotation.ts`
  (buckets + offer bands), `copy.ts` (labels, ownerNote, action verbs),
  `reads.ts` (the DealRead literals — one pure builder per verdict, in
  gate order; internal to the classifier, not re-exported);
  `dealClassify.ts` re-exports the first four so call sites import from
  `dealClassify` only — the ordered decision list in `classifyDeal` is
  load-bearing (each block's `// checked before X` comment encodes
  precedence) and stays whole: gates own WHEN a read fires, reads.ts
  owns WHAT it says.**
- **`seriesSignals.ts`** — `buildSeriesFeatures(pricePoints)` →
  `floorPrice`, `floorTests`, `medianBouncePct`, `medianBounceDays`,
  `cycleDays`, `targetPrice`, `sellIntoPrice`, `failedBounce`,
  `higherLows`, `atFloor`, `atShelf`, fresh `ret7d/30d/90d` (which beat
  the stamped returns once loaded).
- **`stockHealth.ts`** — `buildStockHealth(cards, signalFor, features?)`
  → buckets `grow`/`keep`/`watch`/`rotate`/`dead` with `BUCKET_DESC`
  glosses (grow=compounding, keep=fine, watch=trigger armed, rotate=money
  for better cards, dead=value-no-motion); `triggerFor(read, signal,
  features?)` renders the armed/fired trigger text.
- **`buyScout.ts`** — `scoutCandidates` (top-40 mixed rank) +
  `scoutFloorBuys` (entry-position cyclers only — a separate lane because
  ~65–85 cycler scores lose to 80–100 revival/grower scores in one list).
  `getScoutRows` in `catalogDb.ts` is the SQL funnel: joins `card_deep`
  and carries a position-based cycler arm — a floor-parked cycler fails
  every leg-based arm precisely because it's at the floor.
- **`dealShiftTracker.ts`** — `diffDealClasses` → movement alerts;
  `RANGE_PLAY`→faller = `floor_crack`.
- **`dealExplain.ts`** — class/confidence Tip glosses.

## Two data surfaces — keep them coherent

- **Scalar path:** `CardSignal` stamps plus the `card_deep` join fields
  (`shelfPrice`, `shelfTests`, `cycleDays`, `medianBouncePct`,
  `targetPrice`). Drives badges, scout, shift tracker, and the first paint
  of stock health.
- **Deep path:** `buildSeriesFeatures` off `price_series` — analysis sheet
  and hydrated stock-health refinement. Features win over stamps once
  loaded (`features.ret*` > stamped `ret*`).
- **Every new classifier input must resolve on both paths through
  `resolveRangeEvidence(signal, features)`** — the shared evidence union
  in `evidence.ts` (re-exported via `dealClassify.ts`): series-fresh legs
  beat stamps; a window that resolves no floor is *blind* (the stamp's
  tests/cycle/bounce stand alone); on the same shelf (±8%) the
  better-resolved measure wins (max tests, in-band cycle, max bounce).
  Facets, notes, headlines, and the test claims-verifier all consume the
  same resolved evidence — never read `features.*` raw when a stamped
  field exists too. Pipeline side: `quant/deep.py` (PokeQuant repo,
  `main` branch) computes `card_deep`; `ship.py` ships the whole table —
  adding a column = add it to the signal join in `catalogDb.ts`.
- **Position is a resolved verdict, not a per-consumer band.** `RangeEvidence.position`
  (`through-floor | on-floor | approaching-floor | mid-range | at-ceiling | no-structure`)
  resolves ONCE in `resolveRangeEvidence` — ceiling-side first (price in
  the ×0.92 exit band of a plausible ceiling — `≥0.6×ath`, the same bar
  the RANGE_PLAY core applies — or at/above the stamped sell-into wins
  the verdict even inside the floor band), crack line ×0.97 under the
  floor → `through-floor`, parked ×[0.97,1.15] → `on-floor`, reach
  ×(1.15,1.25] → `approaching-floor`, degenerate floor>ceiling →
  `no-structure`. Every proximity claim quotes it: `possibleRangeExit`/
  `atStampedTarget` folded into `at-ceiling`; the RANGE_PLAY variant map
  consumes it (variant IS a position verdict); `floorWithinReach` =
  `on-floor ∪ approaching-floor`; the tail keys on it so a landing can't
  assert what wasn't verified. Owned-side surfaces resolve the SAME
  verdict against the context price/floor (`ownerNote`'s `notePos`,
  `positionAction` ctx `.position` — DealReadSection and the stack
  harness compute it once and pass it through).
- **Deltas refresh data, not code.** The classifier is compiled into the
  app; `card_deep` stamps refresh with each catalog delta. Old catalogs
  without deep columns get `null` stamps and fall back to the series path
  — keep all deep fields nullable-tolerant.

## Regression harness — use it

Two lanes. **Lane 1 gates the build** (`npx jest` must stay green): every
failure is a provable contradiction — a claim vs its evidence, an
impossible band, an add↔dump flip on equivalent inputs. **Lane 2 never
gates**: soft refinements and design-permitted divergence print as counts
(`[fuzz] N soft flips`, audit's `soft refinements`) — rising counts are
the signal, not a red build. A real bug found anywhere gets promoted into
Lane 1 as a pinned scenario — moles get captured once, not re-chased.

Shared plumbing (all suites use it — one builder, one contract):

- `__tests__/helpers/builders.ts` — `mkSignal`/`mkFeatures` factories.
- `__tests__/helpers/stack.ts` — `renderSurfaces(signal, features?, ctx)`
  runs the **whole consumer stack**: scalar badge + hydrated sheet +
  facets + engine lines + owner note + position action + offer band +
  stock-health trigger + rotation buckets + shift banner + scout lanes +
  trade eval; `collectProblems` enforces the coherence contract (direction
  flips, band sanity, note-vs-floor, headline-vs-leg, shift-label,
  scout-lane, target consistency).
- `__tests__/helpers/claims.ts` — the claims verifier: every `%`, `$`,
  `×`, odds-word and time claim in rendered text is checked against the
  inputs that generated it ("Down 20% this week" needs a red week; "no
  floor under it" can't sit beside a quoted shelf; "every ~Nd" must equal
  the *resolved* cycle). Checkers mirror the classifier's own evidence
  resolution (`resolveRangeEvidence`, same-shelf unions, windowBlind
  fallbacks) — extend the mirror when the resolver learns a new rule.
- `__tests__/helpers/hydrate.ts` — catalog-row → `CardSignal`/
  `SeriesFeatures` hydration mirroring `catalogDb.ts` SQL aliases (`d_*`
  → deep fields).

Suites:

- `__tests__/lifecycleSim.test.ts` — journeys mutate one card through real
  transitions; steps **accumulate**. Every step asserts the class on
  scalar AND series paths + note coherence. **New bug report → add a
  journey step.**
- `__tests__/classifySweep.test.ts` — ~260k-combo grid: stance/trend/legs
  (independent `r7` — golduck's green-month/red-week shape) ×
  evidence-mismatch axis (stamped vs window floor-test counts — the union
  family). Contradiction detector, not a proof.
- `__tests__/fuzzSweep.test.ts` — seeded PRNG (deterministic): 3000
  random signal×feature combos with honest geometry (`atFloor` derives
  from generated distance, legs jitter ±8pp around a true leg). Flips
  split hard (equivalent evidence → fail) vs soft (stamp-blind/
  leg-straddle/shelf-or-ceiling split → counted). Found 6 real bugs on
  first run.
- `__tests__/surfaceCoherence.test.ts` — named scenarios (golduck, paras,
  tremendous bomb, week-knife…) through the full stack + snapshots.
- `__tests__/realCards.test.ts` + `__tests__/fixtures/realCards.json` —
  ~20 real catalog cards replayed through the stack. **`tools/
  export_real_cards.py --db <catalog>` regenerates/extends the fixture; a
  reported card's product_id joins the list → permanent coverage.**
- `__tests__/liveCatalog.test.ts` — skip-unless-present audit over the
  real shipped DB (`PQ_CATALOG_DB` env, `%TEMP%/mobile_catalog.db`, or
  repo fallback) via `node:sqlite`: ~1500 deterministic rows, hard
  contract = 0 problems; prints soft-refinement count.
- `__tests__/inventoryHeld.test.ts` + `__tests__/fixtures/
  inventoryHeld.json` — skip-unless-present replay of a real
  held-inventory export (product ids + variants only, no cost data). Pins
  the bucket-panel invariants: no bleeding `DEAD_STABLE`, no
  `POST_SPIKE_BLEED` watch without `floorWithinReach`, no floor-test badge
  without real floor evidence. Refresh the fixture by re-running the row
  extraction on a fresh `cardcache_inventory_*.csv` export.
- `__tests__/featureShapes.test.ts` — `buildSeriesFeatures` measurement
  semantics pinned on crafted series (8%-reversal swings, despiking,
  trough asymmetry, in-progress touches not counted, floor-tests vs
  `atFloor` vs `atShelf`, under-resolved windows) — documents *why* the
  union rules exist.
- `__tests__/gateBoundaries.test.ts` — every classifier threshold pinned
  ±edge.
- `__tests__/consumerStack.test.ts` — finish/subtype resolution +
  scout/trade/shift consumer contracts.
- `__tests__/dealClassify.test.ts`, `stockHealth.test.ts`,
  `buyScout.test.ts` — per-class unit pins.
- Verify before commit: `npx jest` + `npx tsc --noEmit`.
