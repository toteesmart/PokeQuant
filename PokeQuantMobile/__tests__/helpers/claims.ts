import { oddsWord } from '../../src/scanner/services/deal/sheetReads';
import {
  resolvePosition,
  resolveRangeEvidence,
  type RangePosition,
} from '../../src/scanner/services/deal/dealClassify';
import type { SurfaceStack } from './stack';

// Claims audit — the generic "text can't lie about the data" layer.
// Every numeric/verbal claim a surface renders gets verified against
// the inputs that generated it, so a bug can't hide in phrasing the
// way "Down 35% in 30d" did on a +34.6% month (golduck) or "No floor
// under it" did beside a quoted shelf. Checkers are conservative —
// they flag provable contradictions, not judgment calls.

const ODDS_WORDS = /a long shot|against the odds|a coin flip|favored|a near-lock/gi;

type Source = { src: string; text: string };

function sources(stack: SurfaceStack): Source[] {
  return [
    { src: 'headline', text: stack.sheet.headline },
    { src: 'script', text: stack.sheet.script },
    { src: 'note', text: stack.note },
    { src: 'ownerVerb', text: stack.ownerVerb },
    { src: 'scoutVerb', text: stack.scoutVerb },
    { src: 'healthTrigger', text: stack.healthTrigger ?? '' },
    { src: 'data age', text: stack.dataAge ?? '' },
    ...stack.lines.map((l) => ({ src: 'engine line', text: l.text })),
    ...stack.facets.map((f) => ({
      src: `facet "${f.label}"`,
      text: f.text,
    })),
  ].filter((s) => s.text.length > 0);
}

/** The dollars a claim may legitimately name — a price, a floor-family
 *  level, or a band/target level the card actually carries. Range
 *  ceilings are included DERIVED: the classifier quotes
 *  `floor × (1 + resolvedBounce)` when no stored ceiling exists, so a
 *  "~$X ceiling" built that way is a known level too. */
function knownLevels(stack: SurfaceStack): number[] {
  const s = stack.signal;
  const t = stack.triggers;
  const f = stack.features;
  const floors = [
    stack.ctxFloor,
    t.floorPrice,
    s.shelfPrice,
    s.low90d,
    f?.floorPrice ?? null,
  ].filter((x): x is number => x != null && x > 0);
  const bounces = [
    f?.medianBouncePct ?? null,
    s.medianBouncePct ?? null,
    // sameShelf union resolves max — include it too.
    f?.medianBouncePct != null && s.medianBouncePct != null
      ? Math.max(f.medianBouncePct, s.medianBouncePct)
      : null,
  ].filter((x): x is number => x != null && x > 0);
  const derived = floors.flatMap((fl) => bounces.map((b) => fl * (1 + b / 100)));
  return [
    s.price,
    t.floorPrice,
    t.crackPrice,
    t.targetPrice,
    s.shelfPrice,
    s.low90d,
    s.high90d,
    f?.floorPrice ?? null,
    f?.sellIntoPrice ?? null,
    f?.targetPrice ?? null,
    s.price != null ? Math.round(s.price) : null,
    ...derived,
  ].filter((x): x is number => x != null && x > 0);
}

/** Test-count fields a "N× at the floor" claim may quote. */
function testCounts(stack: SurfaceStack): number[] {
  return [
    stack.features?.floorTests ?? null,
    stack.signal.shelfTests ?? null,
    stack.deep?.analogN ?? null,
  ].filter((x): x is number => x != null);
}

export function auditClaims(stack: SurfaceStack): string[] {
  const problems: string[] = [];
  const s = stack.signal;
  const f = stack.features;
  const { effR7, effR30 } = stack;
  const counts = testCounts(stack);
  const levels = knownLevels(stack);
  // Peak-age claims resolve the same way the headline does — the
  // freshest of the two ATH-age fields (a window that saw the high
  // quotes it over the stamp).
  const dshVals = [f?.daysSinceAth, s.daysSinceHigh].filter((v): v is number => v != null);
  const dsh = dshVals.length ? Math.max(...dshVals) : null;
  const span = s.spanDays;

  const flag = (src: string, what: string) => problems.push(`${src} claim: ${what}`);

  for (const { src, text } of sources(stack)) {
    // "Down N% in 30 days" — the month leg must actually be red.
    for (const m of text.matchAll(/down\s+(\d+(?:\.\d+)?)%\s+in 30 ?days?/gi)) {
      if ((effR30 ?? 0) > -0.05) flag(src, `"down ${m[1]}% in 30 days" but effR30=${effR30}`);
    }
    // "Down N% this week" — the week leg must be red.
    for (const m of text.matchAll(/down\s+(\d+(?:\.\d+)?)%\s+this week/gi)) {
      if ((effR7 ?? 0) > -0.05) flag(src, `"down ${m[1]}% this week" but effR7=${effR7}`);
    }
    // "Down/off N% from its peak/high" — a real drawdown must exist.
    for (const m of text.matchAll(
      /(?:down|off)\s+(\d+(?:\.\d+)?)%\s+(?:below|from)\s+(?:its|the)\s+(?:\w+\s+)?(?:peak|high|early high)/gi,
    )) {
      if ((s.drawdown ?? 0) > -0.5) flag(src, `"${m[0]}" but drawdown=${s.drawdown}`);
    }
    // "Up N%" — some leg must be green.
    for (const m of text.matchAll(/\bup\s+(\d+(?:\.\d+)?)%/gi)) {
      const anyGreen =
        (effR30 ?? 0) > 0 || (effR7 ?? 0) > 0 || (s.ret90d ?? 0) > 0 || (s.retAll ?? 0) > 0;
      if (!anyGreen) flag(src, `"${m[0]}" but no leg is green`);
    }
    // "Sat at this floor N×" / "Hit its floor N×" / "N× held" /
    // "held N times" / "hit its floor N times" — the count must match
    // an actual test-count field.
    for (const m of text.matchAll(
      /(?:sat at this (?:floor|low)|hit (?:its|the) floor)\s*(\d+)\s*(?:×|times?)|(\d+)\s*×\s*held|held\s+(\d+)\s*times/gi,
    )) {
      const n = Number(m[1] ?? m[2] ?? m[3]);
      if (counts.length === 0 || !counts.some((c) => Math.abs(c - n) <= 0.5))
        flag(src, `"${m[0]}" but test counts are ${JSON.stringify(counts)}`);
    }
    // "bounced K of N" — N must be a real test count and K ≤ N.
    for (const m of text.matchAll(/bounced\s+(\d+)\s+of\s+(\d+)/gi)) {
      const k = Number(m[1]);
      const n = Number(m[2]);
      if (k > n) flag(src, `"${m[0]}" — bounced more times than it was at the floor`);
      if (counts.length && !counts.some((c) => Math.abs(c - n) <= 0.5))
        flag(src, `"${m[0]}" but test counts are ${JSON.stringify(counts)}`);
    }
    // Dollar figures — every "$X.XX" must name a level the card has.
    for (const m of text.matchAll(/\$(\d+(?:\.\d+)?)/g)) {
      const v = parseFloat(m[1]);
      if (!levels.some((l) => Math.abs(l - v) <= 0.51))
        flag(src, `"$${v}" doesn't match a known level in "${text}"`);
    }
    // Odds words — must carry evidence, and the word's band must match
    // the percent it cites.
    for (const m of text.matchAll(ODDS_WORDS)) {
      const pm = text.match(/~?(\d+(?:\.\d+)?)\s*%/);
      const km = text.match(/(\d+)\s+of\s+(\d+)/);
      const rate =
        pm != null ? parseFloat(pm[1]) : km != null ? (Number(km[1]) / Number(km[2])) * 100 : null;
      if (rate == null) {
        flag(src, `odds word "${m[0]}" with no % evidence: "${text}"`);
      } else if (oddsWord(rate) !== m[0].toLowerCase()) {
        flag(src, `"${m[0]}" but the cited ${rate.toFixed(0)}% is "${oddsWord(rate)}"`);
      }
    }
    // Time claims — "peaked ~Nmo ago", "Nd tracked", "every ~Nd".
    for (const m of text.matchAll(/(\d+)\s*d(?:ays?)?\s+tracked/gi)) {
      if (span != null && Math.abs(Number(m[1]) - span) > 8)
        flag(src, `"${m[0]}" but spanDays=${span}`);
    }
    for (const m of text.matchAll(/peaked ~?(\d+)\s*d\s+ago/gi)) {
      if (dsh != null && Math.abs(Number(m[1]) - dsh) > 8)
        flag(src, `"${m[0]}" but daysSinceHigh=${dsh}`);
    }
    for (const m of text.matchAll(/peaked ~?(\d+)\s*mo\s+ago|~(\d+)mo ago/gi)) {
      const n = Number(m[1] ?? m[2]);
      if (dsh != null && Math.abs(n - dsh / 30) > 1.5)
        flag(src, `"${m[0]}" but daysSinceHigh=${dsh}`);
    }
    // Cycle rhythm + bounce claims quote the SAME resolution object
    // the classifier used — the audit can't mirror the arithmetic
    // itself and drift (item 55: mirrors consume the resolver, they
    // don't re-implement it).
    const ev = resolveRangeEvidence(s, f);
    const cyc = ev.cycleDays;
    for (const m of text.matchAll(/every ~?(\d+)\s*days?\b/gi)) {
      if (cyc != null && Math.abs(Number(m[1]) - cyc) > 2)
        flag(src, `"${m[0]}" but cycleDays=${cyc}`);
    }
    for (const m of text.matchAll(/every ~?(\d+)\s*mo/gi)) {
      if (cyc != null && Math.abs(Number(m[1]) - cyc / 30) > 0.8)
        flag(src, `"${m[0]}" but cycleDays=${cyc}`);
    }
    // "Prior floor tests ran ~+N%" / "Past floor hits bounced ~+N%" —
    // the resolved median bounce.
    for (const m of text.matchAll(/(?:ran|bounced) ~\+(\d+(?:\.\d+)?)%/gi)) {
      const bp = ev.bouncePct;
      if (bp != null && Math.abs(Number(m[1]) - bp) > 1.5)
        flag(src, `"${m[0]}" but medianBouncePct=${bp}`);
    }
    // "(+N%)" vs-set claim — excess30d.
    for (const m of text.matchAll(/\(([+-]\d+(?:\.\d+)?)%\)/g)) {
      if (s.excess30d != null && Math.abs(Number(m[1]) - s.excess30d) <= 1.5) continue; // legit excess claim
      // Not every parenthetical % is excess — only flag ones following
      // a "set" mention.
      if (/its set|rest of its set/i.test(text) && s.excess30d != null)
        flag(src, `"${m[0]}" vs its set but excess30d=${s.excess30d}`);
    }
    // "still falling/sliding" — needs a live red leg.
    if (/still falling|still sliding|still bleeding|keeps sliding|keeps falling/i.test(text)) {
      if (!((effR7 ?? 0) < 0 || (effR30 ?? 0) < 0))
        flag(src, `"still falling/sliding" but both legs are ≥0`);
    }
    // "fodder"/"spare change"/"cheap either way" — needs a sub-$3
    // price or sub-$3 bounce.
    if (/fodder|spare change|cheap either way/i.test(text)) {
      const px = s.price ?? 0;
      const fl = stack.ctxFloor;
      const bounceWorth = fl != null && px != null ? fl - px : null;
      const cheap = px < 3 || (bounceWorth != null && bounceWorth < 3);
      if (!cheap) flag(src, `"fodder/spare change/cheap" at price $${px} with floor $${fl ?? '—'}`);
    }
    // "no floor under it" — only when no floor exists anywhere.
    if (/no floor under it/i.test(text)) {
      if (stack.ctxFloor != null || s.shelfPrice != null || s.low90d != null)
        flag(src, `"no floor under it" but a floor level exists`);
    }
    // Data claims — "N sales", "no price change in N days".
    for (const m of text.matchAll(/(\d+)\s+sales?\s+(?:tracked|on record)/gi)) {
      if (s.nEvents != null && Number(m[1]) !== s.nEvents)
        flag(src, `"${m[0]}" but nEvents=${s.nEvents}`);
    }
    for (const m of text.matchAll(/no price change in (\d+) days/gi)) {
      if (s.daysSinceChange != null && Number(m[1]) !== s.daysSinceChange)
        flag(src, `"${m[0]}" but daysSinceChange=${s.daysSinceChange}`);
    }
  }
  problems.push(...auditPositionClaims(stack));
  return problems;
}

/* ------------------------------------------------------------------ */
/* Positional claims — the audit's position axis (item 56). The checks
 * above verify the figures ($/%/×/odds/days); this pass verifies the
 * position words themselves: "sitting on a low", "at its high",
 * "buy end", "through the floor" each assert WHERE the card sits, and
 * each must quote the resolved `RangeEvidence.position` the producing
 * surface's own resolution reached — one resolver, never a second
 * band re-derived in the harness (item 55: the verdict IS the
 * precondition). A phrase that implies a position the verdict didn't
 * reach is a provable contradiction, not a judgment call (ninetales
 * 42352: "Sitting on a low" beside a price above its own ceiling).
 *
 * There is ONE resolver but the surfaces resolve it on different
 * inputs, so each text is judged by the verdict of the resolution
 * that produced it: */

/** The position evidence a rendered text asserts, resolved the way the
 *  producing surface resolved it. */
export type PosView = {
  /** The producing resolution's `RangeEvidence.position` verdict. */
  pos: RangePosition;
  /** The price the position resolved against (ctx price for notes). */
  px: number | null;
  /** The floor the position resolved against (never low90d raw). */
  floor: number | null;
  /** The break line the surface's own convention draws — a resolved
   *  zone floor gets the ×0.97 margin; a stamped low breaks at the
   *  level itself. */
  crack: number | null;
  /** Any floor-family level the surface legitimately names — the
   *  resolver floor plus the 90d low the floor-chain fallbacks quote. */
  floorExists: boolean;
  /** Resolved floor-test count (the same-shelf union). */
  tests: number;
  /** Resolved held-bounce ledger (the same union — stamp's
   *  analogBounceN vs the window's floorBounces). */
  bounces: number;
  bouncePct: number | null;
  cycleDays: number | null;
  ceiling: number | null;
  ath: number | null;
  /** The stamped long-trend verdict — the rhythm claim's minimum bar
   *  is a trend that doesn't contradict the range story. */
  trend: string | null;
  /** The stamped 90d band — the Recent-range facet's own axis. */
  low90d: number | null;
  high90d: number | null;
  pctile: number | null;
  drawdown: number | null;
  /** A live red leg under this view's leg resolution (features-first
   *  for the sheet/context surfaces, stamps for the scalar ones). */
  redLeg: boolean;
  /** A real move either way — flat/sideways claims can't sit on it. */
  bigLeg: boolean;
  /** A real WEEK move — the "Right now" facet's direction window. */
  bigWeek: boolean;
  /** The price sits on SOME evidence floor ([0.97,1.15]×level) — a
   *  resolved through-floor vs one shelf stays compatible with a
   *  parked claim vs another live shelf. */
  parkedAny: boolean;
  failedBounce: boolean;
  higherLows: boolean;
};

/** The sheet read's own verdict — the health trigger's exit line
 *  quotes `read.variant` (the SHEET's position), not the row's
 *  floor-only resolution, so its "near the top" phrasing verifies
 *  against this. `sheetCls` lets a cycler's structural crack trigger
 *  skip the armed-floor bar (a range break is the exit regardless of
 *  where the price sits inside the range). */
export type PosAux = { sheetPos: RangePosition; sheetCls: string };

// The phrase table — each class names the position claim it makes.
// "Parked" phrases assert the price IS at the level; "thesis" phrases
// only arm the floor as the live downside (the producers' floorSide
// band: on-floor ∪ approaching-floor).
const PARKED =
  /sitting on|parked on|on the floor|at the floor|on a floor|at a floor|at a low|on a low|at the low|at its low|holding (?:its|a|the) floor|knifed back to|back on the floor|died (?:right )?back on|resting on|buy end|level is holding|sat on the floor/i;
// Pure distributional-low wording — "at a low", "sitting on a low" —
// defensible on a pctile≤25 stamp even when no shelf resolves.
const DIST_LOW =
  /(?:sitting|parked|resting|sat|knifed back|back)\s+on\s+(?:a|the|its)\s+low|(?:at|on|to)\s+(?:a|the|its)\s+low\b/i;
const FLOOR_THESIS = /sell if it drops below|on a held floor|drops below the floor/i;
const APPROACH =
  /falling toward|falling hard toward|dropping into|heading toward|headed toward|toward (?:a|the|its) (?:low|floor|shelf|level)/i;
// Range-top claims — "sell end", "top of its range", "sell into ~$X"
// — assert the resolved range's ceiling side and verify only against
// the at-ceiling verdict. Lifetime-top copy ("At its high", "chase the
// top", "Top of range") is stance-axis, not positional: atPeakRead
// only prints it under a stamped `elevated*` stance, so the stamp is
// the claim's own evidence — its coherence with the drawdown stamp is
// an upstream pipeline question, outside this axis.
const TOP =
  /sell end|sell near the top|sell into ~?\$|sell into it\b|sell around ~|top of (?:its|the) range|near the top of (?:its|the) range|buying the top/i;
const OFF_PEAK =
  /off (?:its|the) (?:peak|high)|from (?:its|the) (?:peak|high)|below its (?:early )?high|coming off (?:its|the) (?:peak|high|top)|coming down off|off release hype/gi;
// A cracked floor: the price is under the ~3%-margin break line the
// surface quotes (notes/verbs/triggers all fire on `floorCracked`).
// "through the floor into …" is the cut-loss hypothetical (the thing
// being avoided), not a crack assertion — excluded.
const CRACKED =
  /gave way|floor broke|the range broke|broke through|through its floor|through the dip's floor|through the floor(?! into)|already broke|under its floor/i;
// Under the floor level itself — the failed-bounce note's own
// `price < floor` bar, no margin.
const THROUGH_LEVEL = /through a failed floor|floor's gone/i;
// Between the ends — can't print at either end or under the floor.
const MID = /mid-range|mid-swing|mid-air|mid range|mid swing/i;
// Floor-existence claims — a level must exist for the phrase to name.
// Bare "the floor"/"the shelf" references stay out — they're
// referential (the cut-loss hypothetical's "through the floor"), not
// existence claims.
const FLOOR_EXIST =
  /floor'?s held|that'?s held|sat at (?:this|a|the) (?:low|floor)|hit (?:its|the) floor|off this shelf|this shelf|held floor|held before|touched before|defended before|quiet floor|low that'?s held|level that'?s held|kept bouncing off|floor beneath|until the shelf|level buyers have|floor that barely bounces/i;
// A shelf beneath the price — "the shelf under it" / "nothing under
// it until the shelf at $X" both assert the named level is below.
const FLOOR_BENEATH = /shelf under it|floor beneath|under it until|nothing under it until/i;
// Floor denial — can't print while a floor is resolved within reach.
const FLOOR_DENIAL = /no floor under it|hasn't found a floor|never found a floor|no floor beneath/i;
// "Held/touched/defended before" — the resolved test count must show
// prior touches; a floor that was never reached can't have held.
const TESTED =
  /held before|that'?s held|kept bouncing off|defended|touched before|been tested|hit (?:its|the) floor \d+|times? and held/i;
// "...times and held" — the outcome tail of the floor-test phrase.
// Touches are measured by tests; "held" asserts a bounce outcome, so
// only the resolved held-bounce ledger can carry it (item 59: a
// 0-of-3 card can print the hits but not the held).
const HELD_OUTCOME = /times? and held/i;
// "Bounces about every ~N months" — the facet's rhythm phrase; it
// rides the classifier's own leg (cycle in-band, plus the held-bounce
// ledger or a trend that doesn't contradict the range story).
const RHYTHM_CYCLE = /bounces about every/i;
// "Proven range" — the classifier's own proof bars (tests ≥3, a cycle
// inside the band, bounce ≥15%).
const PROVEN = /proven (?:range|cycle)|on a rhythm|on schedule|proven range|keeps? bouncing/i;
// Flat/sideways — can't sit on a ±15% leg.
const FLAT =
  /trading sideways|flat & steady|flat and stable|pretty flat|flat now|holding steady|holds steady|no real moves|not much moving/i;
// Feature-flag narratives — the note/facets quote buildSeriesFeatures
// flags; a surface can't claim a dead bounce or higher lows the series
// never produced.
const FAILED_BOUNCE =
  /bounced once|died (?:right )?back|fell back|bounce died|failed floor|failed bounce/i;
const HIGHER_LOWS = /each dip bottoms higher|bottoms higher|higher lows|dips? bottom/i;
// "Barely bounces" — the weak-bounce claim needs weak resolved bounce.
const WEAK_BOUNCE = /barely bounces|weak bounce/i;

const fmtD = (n: number | null | undefined) => (n != null ? `$${n.toFixed(2)}` : '—');

/** Audit one rendered text against the position view of the resolution
 *  that produced it. Exported so the positional suite can pin each
 *  phrase class on synthetic views, not just via whole stacks. */
export function checkPositionText(
  text: string,
  src: string,
  v: PosView,
  aux: PosAux,
  cls?: string,
): string[] {
  const out: string[] = [];
  const flag = (what: string) => out.push(`${src} claim: ${what}`);
  const say = (re: RegExp) => `"${text.match(re)?.[0] ?? text}"`;
  const floorSide = v.pos === 'on-floor' || v.pos === 'approaching-floor';
  const beneath = v.floor != null && v.px != null && v.px >= v.floor * 0.97;

  // Parked-on claims need the resolved on-floor verdict — parked at
  // anything else is the item-53 lie shape (Ninetales at the ceiling).
  // The one honest exception: a through-floor verdict vs one shelf can
  // still sit parked on another evidence shelf — the claim names the
  // level it's parked on, not the one it broke. And a resting read can
  // land on the pctile≤25 nearFloor proxy with NO shelf resolved —
  // "at a low"/"sitting on a low" is then honest DISTRIBUTIONAL
  // position (a pctile-6 card IS at a low); the structural floor words
  // ("holding a floor", "level is holding") still need a real level.
  if (v.pos !== 'on-floor' && !v.parkedAny) {
    // Exempt only matches that fall wholly inside a distributional-low
    // phrase — a leading "at a low" can't launder a later structural
    // claim in the same text.
    for (const pm of text.matchAll(new RegExp(PARKED.source, 'gi'))) {
      const dl = text.match(DIST_LOW);
      const proxiedLow =
        v.pos === 'no-structure' &&
        (v.pctile ?? 100) <= 25 &&
        dl != null &&
        pm.index >= dl.index! &&
        pm.index + pm[0].length <= dl.index! + dl[0].length;
      if (!proxiedLow) {
        flag(`"${pm[0]}" claims it's parked on a floor but position resolved '${v.pos}'`);
        break;
      }
    }
  }

  // Floor-thesis claims (armed triggers, "on a held floor") need the
  // floor-side reach band — the producers' floorSide gate. The health
  // row resolves its own floor-only verdict; a cycler's crack trigger
  // is structural, not proximity.
  if (FLOOR_THESIS.test(text)) {
    const ok =
      src === 'health trigger' ? aux.sheetCls === 'RANGE_PLAY' || v.pos === 'on-floor' : floorSide;
    if (!ok)
      flag(
        `${say(FLOOR_THESIS)} arms a floor thesis but position resolved '${v.pos}'` +
          (src === 'health trigger' ? ' (row floor resolution)' : ''),
      );
  }

  // Directional claims need the reach band, a real level beneath the
  // price, and a live red leg — "falling toward a low" on a flat card
  // or with nothing below is unverified.
  if (APPROACH.test(text)) {
    if (!floorSide) {
      flag(`${say(APPROACH)} claims it's falling toward a floor but position resolved '${v.pos}'`);
    } else if (!(v.floor != null && v.px != null && v.px >= v.floor * 0.9)) {
      flag(`${say(APPROACH)} claims a floor beneath but none resolved under ${fmtD(v.px)}`);
    } else if (!v.redLeg) {
      flag(`${say(APPROACH)} claims it's falling but no leg is red`);
    }
  }

  // Range-top claims need the at-ceiling verdict — but only from
  // position-aware reads: AT_PEAK's "at the top of its range" is
  // stance-axis copy (the trading band's top, asserted by the elevated
  // stamp itself), and RANGE_PLAY's exit wording is the range's. The
  // health trigger's top line quotes the sheet read's exit variant —
  // judge it on the sheet verdict, not the row's ceiling-blind
  // resolution.
  const bandFacet = src === 'facet "Recent range"'; // that facet's "near the top" is a 90d-band claim, checked below
  if (TOP.test(text) && !bandFacet && cls !== 'AT_PEAK') {
    const topPos = src === 'health trigger' ? aux.sheetPos : v.pos;
    if (topPos !== 'at-ceiling')
      flag(`${say(TOP)} claims the sell end but position resolved '${topPos}'`);
  }

  // "Off its peak/high" asserts real distance below a high — unless it
  // self-quantifies ("0% off the high" is honest at dd≈0): a stated N%
  // is verified against the stamp's drawdown, not the ≥3% bar.
  for (const m of text.matchAll(OFF_PEAK)) {
    const quant = text.slice(0, m.index).match(/(\d+(?:\.\d+)?)%\s*$/);
    if (quant) {
      if (v.drawdown != null && Math.abs(Number(quant[1]) - Math.abs(v.drawdown)) > 1.5)
        flag(`"${quant[1]}% ${m[0]}" but drawdown=${v.drawdown}`);
    } else if (!((v.drawdown ?? 0) <= -3)) {
      flag(`"${m[0]}" claims it's off a high but drawdown=${v.drawdown ?? '—'}`);
    }
  }

  // Crack claims need the price under the surface's own break line —
  // no floor resolved at all means there's nothing to be through.
  if (CRACKED.test(text) && !(v.crack != null && v.px != null && v.px < v.crack))
    flag(
      `${say(CRACKED)} claims a broken floor but ${fmtD(v.px)} isn't under ` +
        `the crack line ${v.crack != null ? fmtD(v.crack) : '(none resolved)'}`,
    );

  // Failed-floor claims assert the price under the floor level itself.
  if (THROUGH_LEVEL.test(text) && !(v.floor != null && v.px != null && v.px < v.floor))
    flag(
      `${say(THROUGH_LEVEL)} claims it's under the floor but ${fmtD(v.px)} ` +
        `isn't under ${v.floor != null ? fmtD(v.floor) : 'any resolved floor'}`,
    );

  // Mid-swing claims can't sit at either end or under the floor. The
  // note's own posVariant quotes notePos (copy.ts: "the position words
  // quote notePos, not the variant"), so its "Mid-range" verifies
  // against this view's resolution — a through-floor verdict it
  // collapses into 'mid' is the lie shape.
  if (
    MID.test(text) &&
    (v.pos === 'on-floor' || v.pos === 'at-ceiling' || v.pos === 'through-floor')
  )
    flag(`${say(MID)} claims mid-range but position resolved '${v.pos}'`);

  // Floor-existence claims need a resolved level to name.
  if (FLOOR_EXIST.test(text) && !v.floorExists)
    flag(`${say(FLOOR_EXIST)} quotes a floor but no floor level resolved`);

  // "The shelf under it" — the named level must sit beneath the price.
  if (FLOOR_BENEATH.test(text) && !beneath)
    flag(
      `${say(FLOOR_BENEATH)} claims a shelf beneath but ` +
        (v.floor != null ? `${fmtD(v.px)} vs floor ${fmtD(v.floor)}` : 'no floor resolved'),
    );

  // Floor denial — can't print while a floor resolves within reach.
  // A through-floor verdict stays legal: nothing IS holding, which is
  // all "hasn't found a floor" asserts about the present.
  if (FLOOR_DENIAL.test(text) && floorSide)
    flag(`${say(FLOOR_DENIAL)} denies a floor but position resolved '${v.pos}'`);

  // "Held/defended/touched before" — resolved tests must show a touch.
  if (TESTED.test(text) && v.tests < 1)
    flag(`${say(TESTED)} claims prior floor tests but resolved tests=${v.tests}`);

  // "...times and held" — the outcome tail needs the ledger's own
  // verdict: at least one observed held bounce. Tests alone can't
  // carry "held" (spiritomb: 3 sits, 0-of-3 held, "and held" is the
  // ledger's own contradiction).
  if (HELD_OUTCOME.test(text) && v.bounces < 1)
    flag(`${say(HELD_OUTCOME)} claims held outcomes but resolved bounces=${v.bounces}`);

  // "Bounces about every ~N months" — mirrors the facet's own gate:
  // an in-band resolved cycle plus the rhythm leg (a held bounce on
  // either resolution, or a trend that doesn't contradict).
  if (RHYTHM_CYCLE.test(text)) {
    const rhythm =
      v.cycleDays != null && v.cycleDays >= 45 && (v.bounces >= 1 || v.trend !== 'depreciating');
    if (!rhythm)
      flag(
        `${say(RHYTHM_CYCLE)} claims a rhythm but cycle=${v.cycleDays ?? '—'}d, ` +
          `bounces=${v.bounces}, trend=${v.trend ?? '—'}`,
      );
  }

  // "Proven range/rhythm" — the classifier's proof bars, including the
  // item-59 rhythm leg: ≥1 observed held bounce on either resolution,
  // or a trend that doesn't contradict the range story (a −84%-cagr
  // decliner's "rhythm" is a fiction).
  if (PROVEN.test(text)) {
    const proven =
      v.tests >= 3 &&
      v.cycleDays != null &&
      v.cycleDays >= 21 &&
      v.cycleDays <= 180 &&
      (v.bouncePct ?? 0) >= 15 &&
      (v.bounces >= 1 || v.trend !== 'depreciating');
    if (!proven)
      flag(
        `${say(PROVEN)} claims a proven range but tests=${v.tests}, ` +
          `cycle=${v.cycleDays ?? '—'}d, bounce=${v.bouncePct ?? '—'}%, bounces=${v.bounces}`,
      );
  }

  // Flat/sideways claims can't sit on a live move. The "Right now"
  // facet is a current-direction read — its flat fallback asserts a
  // quiet week, so its bar is the week leg alone (a −16% descent INTO
  // a parked floor is the cycle, not "not much moving" being wrong).
  if (FLAT.test(text) && (src === 'facet "Right now"' ? v.bigWeek : v.bigLeg))
    flag(`${say(FLAT)} claims flat/sideways but a leg runs ±15%+`);

  // Feature-flag narratives.
  if (FAILED_BOUNCE.test(text) && !v.failedBounce)
    flag(`${say(FAILED_BOUNCE)} claims a failed bounce but the series never flagged one`);
  if (HIGHER_LOWS.test(text) && !v.higherLows)
    flag(`${say(HIGHER_LOWS)} claims higher lows but the series never flagged them`);
  if (WEAK_BOUNCE.test(text) && !(v.bouncePct != null && v.bouncePct < 15))
    flag(`${say(WEAK_BOUNCE)} claims a weak bounce but bouncePct=${v.bouncePct ?? '—'}`);

  // The Recent-range facet's own positional claim — "near the bottom/
  // top" reads the stamped 90d band, not the resolver. Mirror its spot
  // arithmetic with a margin so only provable misprints flag.
  if (bandFacet) {
    const m = text.match(
      /\$(\d+(?:\.\d+)?)\s*–\s*\$(\d+(?:\.\d+)?)\s*lately\s*—\s*(near the bottom|in the middle|near the top)/,
    );
    if (m && v.px != null && Number(m[1]) > 0) {
      const lo = Number(m[1]);
      const hi = Number(m[2]);
      const above = ((v.px - lo) / lo) * 100;
      const spot = m[3];
      if (spot === 'near the bottom' && above > 20)
        flag(`"${spot}" but ${fmtD(v.px)} is ${above.toFixed(0)}% above the quoted $${lo} low`);
      if (spot === 'near the top' && !(above >= 70 && hi > lo))
        flag(`"${spot}" but ${fmtD(v.px)} is only ${above.toFixed(0)}% into the quoted band`);
      if (spot === 'in the middle' && (above <= 10 || (above >= 85 && hi > lo)))
        flag(`"${spot}" but ${fmtD(v.px)} sits ${above.toFixed(0)}% above the quoted $${lo} low`);
    }
  }

  return out;
}

/** The four-resolutions map — build the PosView each surface's text
 *  was produced under, quoting the stored verdicts renderSurfaces
 *  already computed rather than re-deriving parallel opinions. */
function positionViews(stack: SurfaceStack): {
  badge: PosView;
  sheet: PosView;
  ctx: PosView;
  health: PosView;
} {
  const s = stack.signal;
  const f = stack.features;
  const { effR7, effR30 } = stack;
  // The classifier's own legStillFalling shape — stamped legs for the
  // scalar surfaces, features-first for the hydrated ones.
  const legFalling = (r7: number | null | undefined, r30: number | null | undefined): boolean =>
    (r7 ?? 0) <= -7 ||
    (r30 ?? 0) <= -10 ||
    ((s.spanDays ?? 200) >= 120 && (s.ret90d ?? 0) <= -15 && (r30 ?? 0) <= -3);
  // The producers' parked band — on a floor means inside [0.97, 1.15]×
  // its level. Any evidence shelf counts: two resolutions can disagree
  // on WHICH shelf is live without the parked claim becoming a lie.
  const parkedOn = (px: number | null, floors: (number | null | undefined)[]): boolean =>
    px != null && floors.some((fl) => fl != null && px >= fl * 0.97 && px <= fl * 1.15);
  const shape = {
    low90d: s.low90d ?? null,
    high90d: s.high90d ?? null,
    pctile: s.pctile1y ?? null,
    drawdown: s.drawdown ?? null,
    failedBounce: f?.failedBounce ?? false,
    higherLows: f?.higherLows ?? false,
    trend: s.trend ?? null,
  };

  // Scalar view — badge read, scout lanes, shift label, trade notes.
  const evS = resolveRangeEvidence(s);
  const crackFloorS = s.shelfPrice ?? s.low90d ?? null; // isCracked's chain
  const badge: PosView = {
    ...shape,
    pos: evS.position,
    px: s.price ?? null,
    floor: evS.floor,
    crack: crackFloorS != null ? crackFloorS * 0.97 : null,
    // A counted test IS floor-existence evidence — a stamp can carry
    // the count without shipping the level.
    floorExists: evS.floor != null || s.low90d != null || evS.tests >= 1,
    tests: evS.tests,
    bounces: evS.bounces,
    bouncePct: evS.bouncePct,
    cycleDays: evS.cycleDays,
    ceiling: evS.ceiling,
    ath: evS.ath,
    redLeg: legFalling(s.ret7d, s.ret30d),
    bigLeg: Math.abs(s.ret7d ?? 0) >= 15 || Math.abs(s.ret30d ?? 0) >= 15,
    bigWeek: Math.abs(s.ret7d ?? 0) >= 15,
    parkedAny: parkedOn(s.price ?? null, [s.shelfPrice, s.low90d]),
  };

  // Sheet view — sheet read, scout verb, engine lines, facets.
  const ev = resolveRangeEvidence(s, f);
  const sheet: PosView = {
    ...shape,
    pos: ev.position,
    px: s.price ?? null,
    floor: ev.floor,
    crack: stack.triggers.crackPrice,
    floorExists: stack.triggers.floorPrice != null || s.low90d != null || ev.tests >= 1,
    tests: ev.tests,
    bounces: ev.bounces,
    bouncePct: ev.bouncePct,
    cycleDays: ev.cycleDays,
    ceiling: ev.ceiling,
    ath: ev.ath,
    redLeg: legFalling(effR7, effR30),
    bigLeg: Math.abs(effR7 ?? 0) >= 15 || Math.abs(effR30 ?? 0) >= 15,
    bigWeek: Math.abs(effR7 ?? 0) >= 15,
    parkedAny: parkedOn(s.price ?? null, [ev.floor, f?.floorPrice, s.shelfPrice, s.low90d]),
  };

  // Context view — the owner note/verb's own resolution, stored on the
  // stack the same call that produced the texts resolved it. The crack
  // line quotes the triggers' — `floorCracked` (the flag every crack
  // text is gated on) measures `triggers.floorPrice`, even when the
  // note's named floor is the context's own level.
  const ctx: PosView = {
    ...shape,
    pos: stack.ctxPosition,
    px: stack.ctxPrice ?? f?.lastPrice ?? null,
    floor: stack.ctxFloor,
    crack: stack.triggers.crackPrice,
    floorExists: stack.ctxFloor != null || s.low90d != null,
    tests: ev.tests,
    bounces: ev.bounces,
    bouncePct: ev.bouncePct,
    cycleDays: ev.cycleDays,
    ceiling: stack.ctxCeiling,
    ath: ev.ath,
    redLeg: legFalling(effR7, effR30),
    bigLeg: Math.abs(effR7 ?? 0) >= 15 || Math.abs(effR30 ?? 0) >= 15,
    bigWeek: Math.abs(effR7 ?? 0) >= 15,
    parkedAny: parkedOn(stack.ctxPrice ?? f?.lastPrice ?? null, [
      stack.ctxFloor,
      s.shelfPrice,
      f?.floorPrice,
    ]),
  };

  // Health view — the row's own floor-only resolution (deliberately
  // ceiling-blind; its floor/crack chain is the sheet's, quoted from
  // the stored triggers rather than recomputed).
  const health: PosView = {
    ...shape,
    pos: resolvePosition(s.price, stack.triggers.floorPrice, null, null),
    px: s.price ?? null,
    floor: stack.triggers.floorPrice,
    crack: stack.triggers.crackPrice,
    floorExists: stack.triggers.floorPrice != null,
    tests: ev.tests,
    bounces: ev.bounces,
    bouncePct: ev.bouncePct,
    cycleDays: ev.cycleDays,
    ceiling: ev.ceiling,
    ath: ev.ath,
    redLeg: legFalling(effR7, effR30),
    bigLeg: Math.abs(effR7 ?? 0) >= 15 || Math.abs(effR30 ?? 0) >= 15,
    bigWeek: Math.abs(effR7 ?? 0) >= 15,
    parkedAny: parkedOn(s.price ?? null, [stack.triggers.floorPrice]),
  };

  return { badge, sheet, ctx, health };
}

/** Cross-surface positional contradictions — the distributional facet
 *  (the stamped 1y band) can't sit beside structural copy that claims
 *  the opposite end (ninetales: "Near its 1-year high" beside
 *  "Sitting on a low"). */
// Only distributional-low wording contradicts a 1y-high facet —
// "Sitting on a low", "at its low". Floor/shelf words stay out (a shelf
// near the 1y top is still a floor), and so does "buy end": the buy end
// of a high-band proven range still sits near the 1y high (liveCatalog
// pid:44455 — RANGE_PLAY·entry at pctile>85, the range's entry IS the
// high band).
const LOW_SIDE =
  /(?:sitting|parked|resting|sat)\s+on\s+(?:a|the|its|this)\s+low|(?:at|on|to)\s+(?:a|the|its|this)\s+low\b|at the low end|bottom of (?:its|the) range|at the bottom|near (?:its|the) low/i;
// Only lifetime-high claims contradict a 1y-bottom facet — "sell
// end"/"top of its range" are positions inside the card's own cycle
// band, which can legally sit at the bottom of the 1y distribution
// (a low-band cycler at its sell end).
const TOP_SIDE = /at its high|at its peak|at peak\b|near its high/i;

/** The position-claim pass over every rendered text — including the
 *  badge/scout/shift/trade surfaces the numeric audit above doesn't
 *  cover (their $ figures aren't price levels, so they're positional
 *  only). */
function auditPositionClaims(stack: SurfaceStack): string[] {
  const problems: string[] = [];
  const { badge, sheet, ctx, health } = positionViews(stack);
  const aux: PosAux = { sheetPos: sheet.pos, sheetCls: stack.sheet.cls };

  const texts: { src: string; text: string; v: PosView; cls?: string }[] = [
    { src: 'badge label', text: stack.badge.label, v: badge, cls: stack.badge.cls },
    { src: 'badge headline', text: stack.badge.headline, v: badge, cls: stack.badge.cls },
    { src: 'badge script', text: stack.badge.script, v: badge, cls: stack.badge.cls },
    { src: 'sheet label', text: stack.sheet.label, v: sheet, cls: stack.sheet.cls },
    { src: 'sheet headline', text: stack.sheet.headline, v: sheet, cls: stack.sheet.cls },
    { src: 'sheet script', text: stack.sheet.script, v: sheet, cls: stack.sheet.cls },
    { src: 'note', text: stack.note, v: ctx },
    { src: 'owner verb', text: stack.ownerVerb, v: ctx },
    { src: 'scout verb', text: stack.scoutVerb, v: sheet, cls: stack.sheet.cls },
    {
      src: 'health trigger',
      text: stack.healthTrigger ?? '',
      v: health,
      cls: stack.sheet.cls,
    },
    {
      src: 'shift label',
      text: stack.shift?.to.label ?? '',
      v: badge,
      cls: stack.badge.cls,
    },
    {
      src: 'data age',
      text: stack.dataAge ?? '',
      v: sheet,
      cls: stack.sheet.cls,
    },
    ...stack.lines.map((l) => ({
      src: 'engine line',
      text: l.text,
      v: sheet,
      cls: stack.sheet.cls,
    })),
    ...stack.facets.map((fc) => ({
      src: `facet "${fc.label}"`,
      text: fc.text,
      v: sheet,
    })),
    { src: 'scout stat', text: stack.scout?.stat ?? '', v: badge, cls: stack.badge.cls },
    { src: 'scout why', text: stack.scout?.why ?? '', v: badge, cls: stack.badge.cls },
    {
      src: 'floor-scout stat',
      text: stack.scoutFloor?.stat ?? '',
      v: badge,
      cls: stack.badge.cls,
    },
    {
      src: 'floor-scout why',
      text: stack.scoutFloor?.why ?? '',
      v: badge,
      cls: stack.badge.cls,
    },
    ...(stack.trade?.notes ?? []).map((n) => ({
      src: 'trade note',
      text: n,
      v: badge,
      cls: stack.badge.cls,
    })),
  ];
  for (const { src, text, v, cls } of texts) {
    if (text) problems.push(...checkPositionText(text, src, v, aux, cls));
  }

  problems.push(...crossSurfaceProblems(stack));
  return problems;
}

/** The 1y-band facet names a distributional position — it can't sit
 *  beside structural copy claiming the opposite end (ninetales: "Near
 *  its 1-year high" beside "Sitting on a low"; flying_pikachu_ev is
 *  the pinned production specimen). Exported so the positional suite
 *  can pin the rule without a full stack. */
export function crossSurfaceProblems(stack: {
  facets: { label: string; text: string }[];
  badge: { label: string; headline: string };
  sheet: { label: string; headline: string; script: string };
  note: string;
  ownerVerb: string;
}): string[] {
  const problems: string[] = [];
  const priceFacet = stack.facets.find((fc) => fc.label === 'Price level')?.text;
  const pairTexts: [string, string][] = [
    ['badge label', stack.badge.label],
    ['badge headline', stack.badge.headline],
    ['sheet label', stack.sheet.label],
    ['sheet headline', stack.sheet.headline],
    ['sheet script', stack.sheet.script],
    ['note', stack.note],
    ['owner verb', stack.ownerVerb],
  ];
  if (priceFacet === 'Near its 1-year high') {
    for (const [src, text] of pairTexts) {
      if (text && LOW_SIDE.test(text))
        problems.push(
          `cross-surface: facet "Price level" says "Near its 1-year high" but ${src} says "${text}"`,
        );
    }
  }
  if (priceFacet === 'Bottom of its 1-year range') {
    for (const [src, text] of pairTexts) {
      if (text && TOP_SIDE.test(text))
        problems.push(
          `cross-surface: facet "Price level" says "Bottom of its 1-year range" but ${src} says "${text}"`,
        );
    }
  }
  return problems;
}
