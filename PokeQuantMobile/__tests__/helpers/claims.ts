import { oddsWord } from '../../src/scanner/services/deal/sheetReads';
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
    // "Sat at this floor N×" / "Hit its floor N×" / "N× held" — the
    // count must match an actual test-count field.
    for (const m of text.matchAll(
      /(?:sat at this floor|hit its floor)\s*(\d+)\s*×|(\d+)\s*×\s*held/gi,
    )) {
      const n = Number(m[1] ?? m[2]);
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
    // Cycle rhythm — "every ~Nd" / "every ~Nmo". Mirrors the
    // classifier's resolution: a window that resolves no floor is
    // blind — the stamp's measure stands; on the same shelf the
    // in-band measure wins; otherwise the window's regime rules.
    const sameShelf =
      f?.floorPrice != null &&
      s.shelfPrice != null &&
      Math.abs(f.floorPrice - s.shelfPrice) <= s.shelfPrice * 0.08;
    const windowBlind = f?.floorPrice == null;
    const inBand = (c: number | null | undefined): c is number => c != null && c >= 21 && c <= 180;
    const cyc = windowBlind
      ? (s.cycleDays ?? f?.cycleDays ?? null)
      : sameShelf &&
          f?.cycleDays != null &&
          s.cycleDays != null &&
          !inBand(f.cycleDays) &&
          inBand(s.cycleDays)
        ? s.cycleDays
        : (f?.cycleDays ?? s.cycleDays ?? null);
    for (const m of text.matchAll(/every ~?(\d+)\s*days?\b/gi)) {
      if (cyc != null && Math.abs(Number(m[1]) - cyc) > 2)
        flag(src, `"${m[0]}" but cycleDays=${cyc}`);
    }
    for (const m of text.matchAll(/every ~?(\d+)\s*mo/gi)) {
      if (cyc != null && Math.abs(Number(m[1]) - cyc / 30) > 0.8)
        flag(src, `"${m[0]}" but cycleDays=${cyc}`);
    }
    // "Prior floor tests ran ~+N%" — the card's median bounce. Same
    // union as the classifier: blind window ⇒ the stamp's measure
    // stands; same shelf ⇒ the better-resolved (max) measure wins.
    for (const m of text.matchAll(/ran ~\+(\d+(?:\.\d+)?)%/gi)) {
      const bp = windowBlind
        ? (s.medianBouncePct ?? f?.medianBouncePct ?? null)
        : sameShelf && f?.medianBouncePct != null && s.medianBouncePct != null
          ? Math.max(f.medianBouncePct, s.medianBouncePct)
          : (f?.medianBouncePct ?? s.medianBouncePct ?? null);
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
    if (/still falling|still sliding/i.test(text)) {
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
  return problems;
}
