# Card Cache — Copy Glossary

The canonical vocabulary for every string the user sees. The audience is
card vendors and collectors who know the market cold but aren't software
people. Write like a sharp booth-mate, not like a dashboard.

> Rule of thumb: if a word would sound normal at a card-show table, it's
> in. If it only sounds normal in a standup, it's out.

---

## 1. Canonical swaps

| Never say | Say instead | Why |
|---|---|---|
| catalog | **price list** (downloads) / **listings** (shows) | "catalog" is our internal DB name |
| sync / synced / pending | **back up / backed up / waiting to back up** | sync is DB vocabulary |
| offline | **without internet / on this phone** | tech-speak |
| queue (scan batch) | **batch** | "Add to batch", not "Add to Queue" |
| seat / seats | **spot** (founder) / **people** (teams) | SaaS-speak |
| asset | **card** | dev vocabulary |
| manual entry | **by hand** | |
| log | **add** (inventory) / **save** (records) | |
| COGS / cost basis / gross revenue / net profit / avg ticket | **what you paid / total sales / profit / avg sale** | accountant jargon |
| velocity / shifts / momentum | **price moves / recent moves** | trading vocabulary |
| watermark / hydrate / warm / seed / migration / pull / push | never user-facing | engine internals |
| detection model / embeddings / OCR / matcher | **card finder / card matcher / card photo data** | ML jargon |
| entitlement / offering / RevenueCat | **plan** | |
| entitlement restore | **get back my purchases** | |
| redeem | **use code** | |
| confidence / conf | **% sure / solid data / thin data** | engine shorthand |
| variants | **printings** | vendor vocabulary |
| sub_type / print finish | **print finish** (one word, glossed) | |
| graded (track record) | **rated** | collides with PSA grading |
| small n | **small sample** | statistics jargon |
| horizon (analytics) | **period** | BI jargon |
| range play / testing the floor / compounder / bleeder / flatline / topping / cracked / shielded ceiling / cyclers | plain equivalents: **bounces in a range / sitting on a low / steady riser / slow bleeder / flat / rolling over / floor broke / safe max / at their low** | engine vocabulary |
| Danger Zone | **Delete account** | GitHub-ism |

## 2. Vendor slang that's allowed

Floor, bounce, dip, chase, dead money, sticker, buy the dip, free fall,
waking up — hobby-familiar *if* the badge carries a `Tip`/`ExplainChip`
gloss. Evocative is fine; cryptic is not. When a badge can't be glossed
(trigger tags, tight pills), prefer the plain form (`FLOOR BROKE` over
`CRACKED`).

## 3. Format rules

- **Every `%` carries a noun**: `62% of market`, `91% sure`, `18% over
  cost` — never a bare `Buy %` or `64th`.
- **Spell out units**: `7 days` not `7d`; `3 mo` not `3M`; `min ago` not
  `m ago`; `All` not `MAX`.
- **Numbers get labels**: `$12 → $15 suggested`, not `12 → 15`.
- **Errors: friendly first, technical never.** Map `err.message` through
  a friendly phrase; raw `Network request failed`, SQLite text, and
  worker bodies must not reach the UI. `toErrorMessage` in
  `src/utils/log.ts` is the choke point.
- **Buttons say the outcome**: `Try again` not `Retry`; `Add 12 items`
  not `Commit 12`; `Delete` not `Del`.
- **Confirm destructive taps in words**: `Tap again to delete`, not
  `Sure?`.
- **Empty states say what to do**, not just what's missing.

## 4. Tab / feature names (settled)

`Inventory` · `Scan` · `Search & Buy` · `Shows` — tabs.
Segments: `Cards` / `Resticker` / `Analytics`.
Features: `Buy scout` (the deal finder), `Trade evaluator` (trade
checker), `Stock health`, `Price moves` (market shifts).

## 5. Voice

Short sentences. Active verbs. The user's data is *their* money — say
"you paid", "you're offering", "your stock". A good line answers the
question before it's asked: not `Market $4.50`, but what that number
means for *this* decision.
