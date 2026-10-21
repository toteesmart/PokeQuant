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

Completed items: 1–33 cleared outright (2026-10-16); 34–69 moved to
`WORK_QUEUE_LANDED.md` (2026-10-20). Full briefs recoverable via git
history (`git log --follow .devin/WORK_QUEUE.md`) — commit bodies carry
the complete landed record.

---

## Open items — new entries number from 70

<!-- Add items as `## [ ] N. <title>` + a brief (what, where, pins,
     reviewer-gate tier). Numbering continues from WORK_QUEUE_LANDED.md. -->

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
  ledgers, 1–33 cleared 2026-10-16); second pass 2026-10-20 moved the
  whole landed block to `WORK_QUEUE_LANDED.md`. Future compactions append
  there — re-compact when completed briefs again dominate this file.
- `nul` / `%TEMP%*` file recurrence — gitignored CMD-isms; cosmetic,
  do not re-file.
- `main` vs `react-native-v2` permanent divergence — release-planning
  call; a mistaken merge deletes the PWA files, but protection is a
  repo-settings/user decision, not a code item.
- `src/screens` / `src/components` jest coverage — out of scope by
  design (logic lives in hooks); Maestro + review is the net.
- Legacy PWA still publicly deployed via `cloudflare-pages.yml` on
  `main` pushes — product/spend decision, not a code gap.
