# CardCacheScanner — Global Rules

Behavioral rules and hard-won invariants for the scanner. Read `agentsscanner.md` for the project map; read this before touching matching, OCR parsing, embeddings, or the review UI. Repo-root `AGENTS.md` and `global_rules.md` still apply (Windows `npm.cmd` invocation, commit conventions, no secrets).

## Identity

- Offline-first Pokémon card scanner for **Card Cache by Totees Mart**. Everything after first launch must work without network: catalog JSON and the binary embedding sidecar are bundled assets.
- Never generate catalog embeddings on-device at scale — ~31k embeddings is a sidecar problem, not a runtime problem. On-device embedding is for the *query crop only*.
- iOS + Android via custom native clients / EAS (`expo-dev-client`); no Expo Go (VisionCamera, fast-tflite, nitro are native).

## Verification

Always run both after any change to `processPhoto.ts`, `catalogMatcher.ts`, `normalizeText.ts`, `MatchReviewSheet.tsx`, or `VisualEmbedder.ts`:

```bash
npm run typecheck
npm test
```

Jest tests live in `__tests__/`. Pure logic (number extraction, matching) is deliberately kept in `src/utils/normalizeText.ts` and `src/services/catalog/catalogMatcher.ts` so tests never import native modules — **do not move `extractCardNumber` back into `processPhoto.ts`** (it imports VisionCamera/tflite and will crash Jest).

## OCR contract

- Top strip (8% height at y=6%, `line` level) → card **name**; bottom-left 55% × bottom 12% (`word` level) → collector **number**. Full-card OCR is fallback only.
- `extractCardNumber` grammar, in priority order:
  1. `NNN/NNN` or `NNN NNN` or concatenated `NNNNNN` — left ≥ 1 (reject `0/026` — that's `©2026` noise), right ≥ 5 with a slash, ≥ 30 space-separated. Leftmost match wins.
  2. Promo prefixes `SVP|SWSH|SM|SV|XY|BW|HGSS|DP|GG|TG|RC|AR|SH|RT|SL|PW|PR` + optional lang tag + optional ≤3-letter junk token + digits → `PREFIXddd` (e.g. `SVP EN UE 200` → `SVP200`).
  3. Modern set codes `MEP|MEG|ASC|JTG|PRE|PAF|PFL|DRI|OBS|PAR|PAL|SFA|SCR|SST|SVI|TEF|TWM|BLK|WHT` + optional lang/junk + digits → bare `NNN` (`MEP EN 075` → `075`).
- `normalizeNumber` strips leading zeros and is space-insensitive: `006/012` == `6/12`, `SVP 200` == `SVP200`.

## Matching rules (`findBestMatch`)

Order of precedence — do not reorder without a regression test:

1. Exact number + name agreement → `number` @ 0.95 (unique agreeing card) or `max(0.8, nameScore)` (multiple).
2. Exact number, no name agreement → `number` fallback @ 0.5 with `alternates` = the other same-number cards (cross-set collisions like Eevee ex vs Rockruff `075/131` stay reachable).
3. Name path → `name` @ score ≥ 0.5.
4. Number correction — only when name match ≥ 0.7 **and** the corrected card shares an exact non-generic name token (`ex`/`mega`/`dark`/etc. are excluded as too weak). Fixes `023/137` → `023/131`; must not let `dianga` → `dialga`.
5. Subset guard — generic name match that is a token-subset of the same-number card's name (`spiritomb` ⊂ `cynthias spiritomb`) loses to the number fallback.
6. Fuzzy-only name matches never override an exact-number fallback.

`findNearNumberCandidates(number)` returns one-digit-off same-set-total cards on the *raw* (pre-normalized) left side — `013/217` finds `113/217`. Substituting on the normalized left misses insertions like `13` → `113`. Only feed it into the visual pool when the number path is weak (fallback or name-disagreeing) — clean number+name scans keep their tight pool.

## Visual matching rules

- Catalog and query embeddings must share `VisualEmbedder.convertAndNormalize` preprocessing: art crop 8%–55% of card height, shortest-edge-224 resize + center crop, [0,1] pixels, L2 normalize. Change one, rebuild the sidecar.
- fp16 MobileCLIP overflows to NaN on bright holo crops. Retry with compounding dampen 0.95 → 0.85 → 0.6 (~0.49 cumulative) before giving up — direction is scale-stable enough to stay useful.
- `findVisualMatches` assumes L2-normalized vectors (cosine = dot). Keep it that way.

## Fusion + auto-confirm gates

- `fuseConfidence`: text weight 0.75 for `number`, 0.55 for `name`, 0.35 otherwise; visual fills the remainder. Auto-confirm at fused ≥ 0.85.
- **Variant ambiguity gate** (in `processPhoto`, after fusion): if the top visual candidate and the best *same-base-name* alternative anywhere in the candidate list differ by < 0.06, force manual review — stamped/prize-pack/staff printings and reprints of the same art are genuinely indistinguishable at that margin (Eevee ex 0.796/0.780, Ampharos staff 0.812/0.777).
- **Catalog-match preference**: when `fusion.top` beats the OCR/catalog match by < 0.1 fused, preselect the catalog match — number/name evidence outranks a visual-only candidate on a noisy crop.
- Auto-confirm queues immediately with `NM × 1`. If that ever changes, it changes for every scan — the gate exists because users trust auto-queued rows.

## Review-sheet contract (`MatchReviewSheet`)

- **Variants** = same normalized number **and** same base name. Never let a same-number different-name card in (Plusle/Minun sharing `6/12` with Pikachu was a real regression).
- **Other matches** = everything else worth showing: the catalog match itself when it isn't top, `alternates` (same-number cross-name collisions), fused candidates within 0.12 of top, deduped by cleaned name, capped at 5. No firehose of low-confidence visual neighbors.
- Selecting a row must update the match that Confirm queues — header and queued `productId` must always agree. A bare-name suggestion (`Eevee` @ 91%) still maps to one specific productId; ambiguity belongs in the list, not in a surprise queue row.

## Don't regress — fixed behaviors with log evidence

- `0/026` from `©2026` must never become a collector number (was auto-queueing Ampharos `090/086`).
- `MEP EN 075` must extract `075` (Mega Evolution promos print no set total).
- `SVP EN UE 200` / `SVP B 200` must extract `SVP200` (junk token between lang and digits).
- `013/217` misread of Lucario `113/217` must keep the real card reachable via near-number candidates.
- Same-name near-ties across different numbers (Ampharos bare vs `075`, gap 0.001) must go manual, not auto.
- Inteleon `142/192` right-side misread must correct to `142/132` via name evidence.
- Cynthia's Spiritomb: apostrophes normalize to `cynthias spiritomb` — subset `spiritomb` must not win.
- Mega Diancie `Diangia`: fuzzy `dialga` must not beat exact number `267/217`.

## Data hygiene

- `embeddings.bin`, `manifest.json` (generated), and `catalog_embeddings.json` are git-ignored — regenerate with `tools/build_embeddings.py`, don't commit.
- Keep `patches/react-native-fast-tflite+3.0.1.patch` — required; `postinstall` applies it.
- Dark UI only (`userInterfaceStyle: dark`); colors live in `src/constants/colors.ts`.

## Roadmap pointer

Queue → Card Cache `inventory` integration is the planned next step: `ScannedCard.productId` maps to `pokequant_catalog.db`, conditions map onto the existing inventory schema. Until then the queue is session-only Zustand.
