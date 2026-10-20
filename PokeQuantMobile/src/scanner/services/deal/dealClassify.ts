import type { CardSignal } from '../../../db/catalogDb';
import type { SeriesFeatures } from './seriesSignals';
import type { DealRead } from './types';
import { resolveRangeEvidence } from './evidence';
import {
  atPeakRead,
  baseFormingRestingRead,
  bleedFloorTestRead,
  deadStableCheapRead,
  deadStableSpentRead,
  declinerNearLowRead,
  declinerSlideRead,
  dipBuyRead,
  dormantRead,
  freeFallRead,
  growerCoolingRead,
  growerSteadyRead,
  hypeDecayRead,
  knifeFloorTestRead,
  lowDataRead,
  postSpikeBleedRead,
  rangePlayRead,
  revivalRead,
  stableFlatRead,
} from './reads';
import { COLLECTION_FLOOR } from '../../../utils/format';

// Deal classification — composes the stamped engine signals into the
// table-time read the vendor actually needs: what kind of deal is this,
// how hard to shield the offer, and what to say to the customer.
// Pure classification on shipped stats — everything here is instant.
//
// Public surface stays ONE module: this file re-exports the vocabulary
// (types.ts), shared evidence resolution (evidence.ts), portfolio reads
// (rotation.ts) and customer-facing language (copy.ts) — 22+ call sites
// import from './dealClassify' and never see the split. This file is the
// ordered decision list plus its private predicates (f/isYoung/
// isReviving); the DealRead literals each gate lands on live in
// reads.ts (internal — not re-exported).
export * from './types';
export * from './evidence';
export * from './rotation';
export * from './copy';

function f(v: number | null | undefined, fallback = 0): number {
  return v ?? fallback;
}

/** Classify from the stamped signal; when the caller has the card's
 *  price_series loaded (the analysis sheet does), pass its curve
 *  features — fresher returns and bounce/floor structure override the
 *  stalest stamp edges. List surfaces stay scalar-only. */
export function classifyDeal(
  signal: CardSignal | null | undefined,
  features?: SeriesFeatures,
): DealRead {
  const price = signal?.price ?? null;
  const stance = signal?.stance ?? null;
  const trend = signal?.trend ?? null;
  // Series-fresh returns beat the stamps — they're computed at the
  // chart's last point, not the catalog's snapshot time.
  const r7 = features?.ret7d ?? signal?.ret7d ?? null;
  const r30 = features?.ret30d ?? signal?.ret30d ?? null;
  const r90 = signal?.ret90d ?? null;
  // The shared resolution — floor, ceiling, tests, rhythm, and the
  // resolved POSITION every gate below quotes. One verdict, ceiling-
  // side first, so no landing can assert proximity it never verified
  // (ninetales 42352: a giveback week priced over its own sell-into
  // landed floor-test copy on both paths before the tail consulted it).
  const ev = resolveRangeEvidence(signal, features);
  const pos = ev.position;
  // At the sell end — the resolved ceiling's exit band or the stamped
  // sell-into reached. Folds what possibleRangeExit and atStampedTarget
  // measured separately: a card at the top of its own range can't be
  // "safe to stock at the low" no matter which arm fired.
  const atCeiling = pos === 'at-ceiling';
  // A 'depreciating' stamp describes the whole window — a crash that
  // ended months ago still carries it. Only a slide still visible in
  // recent returns counts as a live leg; a flat card with an old crash
  // is dead/stable, not declining.
  // "A leg is still falling" means the slide is happening NOW — pure
  // leg SPEED, not position: it says nothing about where the price
  // sits, so the tail keys its floor-test landing on `pos`, never on
  // this flag alone. A red quarter alone doesn't count when the month
  // has steadied — the crash can sit inside a 90d window while the
  // card recovers (ampharos: launch crash → floor → +14% month).
  // −0.8% on the month is flat, not falling — that's why the r90
  // clause needs a real red month.
  const legStillFalling =
    f(r7) <= -7 ||
    f(r30) <= -10 ||
    // A 90d window on a young card IS its launch crash — it can't
    // testify about now. Only counts once the card outlived it.
    ((signal?.spanDays == null || signal.spanDays >= 120) && f(r90) <= -15 && f(r30) <= -3);
  // "A real shelf is within reach" — the resolved position places the
  // price ON the shelf or closing into its reach band (petilil: a
  // shelf far below a mid-air card is not a floor it's parked on, and
  // a card at its sell end isn't approaching anything). The parked-on
  // claim the resting read makes is `pos === 'on-floor'` — checked at
  // the gate that asserts it.
  const floorInReach = pos === 'on-floor' || pos === 'approaching-floor';
  // A floor in reach only ends the slide once the slide has actually
  // ended — a −40% month sitting on a floor is still coming down, not
  // basing (toucannon/ampharos: crashing AT the floor ≠ landed on it).
  // The suppression is earned by a steadied month, not just a shelf.
  const slideEnded = f(r30) > -12 && f(r7) > -12;

  if (!signal || !signal.action || signal.action === 'UNRATED' || price == null) {
    return lowDataRead();
  }

  if (stance === 'falling') {
    // A dip inside an intact long-term uptrend is a different animal than
    // a card in genuine decline — the trend line is the difference.
    if (trend === 'appreciating' && f(r90) > 0 && f(signal.cagr) > 0) {
      return dipBuyRead();
    }
    // Otherwise the stamp just means "returns are red" — it can't see
    // the lifecycle. Fall through to the shared phase logic: a knife
    // still knifes, but a post-spike bleed reads as the bleed, and a
    // faller that already landed on a held floor isn't still falling.
    // The stamped faller that hits nothing gets a DECLINER floor below.
  }

  if (stance === 'elevated' || stance === 'elevated_rising') {
    return atPeakRead(r7, r30);
  }

  // New-set slide — a young series still coming off release hype. The
  // story beats the speed label: launch-window decay is expected, so it
  // shields hard but reads differently from a mature knife. A young
  // card parked on a floor that keeps holding isn't "still coming
  // down" — the crash ended; that's basing, not sliding (tremendous
  // bomb: −80% in week one, then flat on an 8×-held floor).
  if (
    isYoung(signal) &&
    f(signal.drawdown) <= -15 &&
    (f(r30) < 0 || f(r7) < 0) &&
    !(floorInReach && slideEnded)
  ) {
    return hypeDecayRead(f(signal.drawdown));
  }

  // Range play — a proven cycler: the same shelf tested 3+ times on a
  // real rhythm, each bounce worth playing (≥15%). The current leg is
  // just where the card sits in the cycle — its fade back to the floor
  // is the normal half of the pattern, NOT a post-spike bleed or a
  // knife, so this reads position, not leg speed. Checked before PSB:
  // a cycler's fade leg trips every "still sliding" test on a chart
  // that does this on schedule. Only live while the price is inside
  // the range — through the floor the pattern is dead and the normal
  // reads take over. failedBounce does NOT disqualify a proven cycler:
  // "bounced +15% then returned to the floor" IS the cycle completing
  // its down-leg — it only looks like a dead cat if you expected a new
  // leg. The bounce bar (<15% median) is what catches a real weakener.
  const rangeFloor = ev.floor;
  const rangeTests = ev.tests;
  const rangeCycle = ev.cycleDays;
  const rangeBounce = ev.bouncePct;
  const rangeCeiling = ev.ceiling;
  const rangeAth = ev.ath;
  // The range CORE — floor + ceiling + position — is the evidence a
  // cycle structure exists at all, separate from the three resolution-
  // sensitive legs, each a measure that can under-resolve on either
  // path:
  //  - tests: stamped tests vs window troughs at the same shelf see
  //    different data (the st1×ft5 mismatch family)
  //  - cycle: the stamp's median spacing spans the WHOLE history —
  //    pre-shelf micro-chop pollutes it (zekrom: stamp 12d vs the
  //    window-resolved 31.5d rhythm at the current shelf)
  //  - bounce: the stamp's median bounce vs the window's own measure —
  //    same data-resolution split (98128: stamp 13.3% fails the bar,
  //    window resolves ≥15% — badge FREE_FALL, sheet RANGE_PLAY)
  //  - the bounce LEDGER: tests+cycle+bouncePct resolve the metronome
  //    and the amplitude, but "it bounces off this shelf on a rhythm"
  //    claims a bounce was OBSERVED to hold — the stamped analog
  //    "bounced K of N" or the window's own held-bounce count. A
  //    zero-bounce card only keeps the claim when its stamped trend
  //    doesn't contradict the range story: spiritomb's −84%-cagr
  //    depreciating ledger says 0-of-3 ever held (and the window
  //    agrees — every trough's rally broke lower), so the rhythm is a
  //    fiction and the card falls to the next honest landing in the
  //    classifier's own order. The trend arm also keeps stamp-only
  //    reads honest where a catalog predates the analog ledger.
  // A card with the full core but one thin leg is an UNCONFIRMED
  // cycler, not a knife: dump-family reads below yield so the two
  // paths can't read opposite families on the same shelf. Cycles
  // >180d are glacial — no suppression; cycles that resolve nothing
  // (null) give no rhythm evidence — no suppression either.
  const rangeCoreOk =
    rangeCeiling != null &&
    rangeFloor != null &&
    (rangeAth == null || rangeCeiling >= rangeAth * 0.6) &&
    price != null &&
    price >= rangeFloor * 0.97 &&
    price <= rangeCeiling * 1.15;
  const rangeShapeOk =
    rangeCoreOk &&
    rangeCycle != null &&
    rangeCycle >= 21 &&
    rangeCycle <= 180 &&
    (rangeBounce ?? 0) >= 15;
  if (rangeTests >= 3 && rangeShapeOk && (ev.bounces >= 1 || trend !== 'depreciating')) {
    const floor = rangeFloor;
    // The variant IS the resolved position: entry = parked on the
    // floor, exit = at the sell end (ceiling-side resolves first —
    // inside a thin range a price in the floor band that already
    // reached the sell line is still the sell end), mid = between.
    const variant: 'entry' | 'mid' | 'exit' =
      pos === 'on-floor' ? 'entry' : pos === 'at-ceiling' ? 'exit' : 'mid';
    return rangePlayRead(variant, floor, rangeCeiling, rangeCycle);
  }
  // Unconfirmed cycler — the full core plus a thin leg: a test count
  // under the proof bar, a stamped sub-21d cycle the window can't see,
  // or a stamped thin bounce the window resolves stronger (or vice
  // versa). Suppresses the dump reads below so an under-resolved leg
  // can't produce a knife on one path while the other sees the range.
  const possibleRange =
    rangeCoreOk &&
    rangeTests >= 1 &&
    rangeCycle != null &&
    rangeCycle <= 180 &&
    !(rangeTests >= 3 && rangeShapeOk);
  // The suppression's reach has one boundary: a proven riser doesn't
  // cede its GROWER reads to thin cycler evidence — "benched so an
  // unconfirmed cycler can't knife" can't mean "benched into floor-
  // test copy on a compounder" (flying pikachu 124123: +119%/yr at the
  // 88th pctile, a −11% giveback month on a 2-test/~32d stamped shelf
  // landed "testing a low" while its trend stamp read appreciating —
  // the honest read is the giveback inside the run). The bar is the
  // grower gate's own shape plus one: a stamped 'appreciating' without
  // the numbers (tentacruel's −10% month at a 1-test shelf) stays
  // benched, and so does a riser whose month is a structural knife
  // (r30 ≤ −20 — a giveback retraces, a knife cuts). The dump reads
  // keep their suppression either way — a knife-speed riser on a
  // defended floor still lands the floor-test read it earned.
  const riserOutranksRange =
    trend === 'appreciating' &&
    ((f(signal.cagr) >= 25 && f(signal.pctile1y) >= 50) ||
      (f(signal.cagr) >= 10 && f(signal.pctile1y) >= 60)) &&
    f(r30) > -20;
  // The same card at the TOP of a possible range can't be a buy —
  // "stable grower, stock it" under a ceiling the other path sells
  // into is the add↔dump contradiction the exit zone makes visible
  // (84649: badge STABLE_GROWER vs sheet RANGE_PLAY·exit). In the
  // exit band the add-family reads below yield to keep-family — but
  // a card with real upward legs is BREAKING OUT, not parked at the
  // ceiling: momentum is its story, the range is already behind it
  // (budew: +14% month at the top of a stamped channel is a revival,
  // not a ceiling sale). Only the month leg counts — a +20% WEEK on a
  // sub-dollar card is print noise, not a breakout (psychic energy:
  // r7 +39% on a $0.71 card still cycles $0.51→$0.66). The resolved
  // position supplies the exit band — `at-ceiling` already folds in
  // the stamped sell-into reach (the price already sits at or above
  // the level the stamp says to sell into, so "safe to stock" can't
  // stand whether or not the rest of the range shape resolved —
  // exeggcute: $1.04 over a $0.71 stamped target; blastoise: $66.54
  // over $62.97. Reached means reached: a crater shelf's modest
  // bounce-target above the price isn't a sell zone yet — tremendous
  // bomb: $1.85 vs a $1.90 stamp, still building not topping).
  const possibleRangeExit = possibleRange && atCeiling && f(r30) <= 5;

  // Post-spike bleed — a real drawdown off a peak that's already months
  // old and still drifting down. Checked before the generic knife rule:
  // "coming off a May spike" tells the story better than "free fall".
  // Old catalogs lack the peak-age stamp — a deep drawdown still
  // sliding is the bleed either way; the headline just loses the age.
  // Peak age: the stamp counts days since the card's LIFETIME high;
  // the series pass only sees its shipped window, so its "ATH" can be
  // a recent lower peak (leafeon: stamp 620d vs window ~90d — badge
  // FREE_FALL, sheet bleed). The older measure is the honest one —
  // take the max so deeper evidence can only age the peak, never
  // rejuvenate it into a "bleed" the badge can't see.
  const dshVals = [features?.daysSinceAth, signal.daysSinceHigh].filter(
    (v): v is number => v != null,
  );
  const dsh = dshVals.length ? Math.max(...dshVals) : null;
  if (
    (dsh == null || (dsh >= 14 && dsh <= 365)) &&
    f(signal.drawdown) <= -25 &&
    (f(r30) <= -3 || f(r7) <= -3) &&
    !(floorInReach && slideEnded) &&
    !possibleRange
  ) {
    return postSpikeBleedRead(f(signal.drawdown), dsh);
  }

  // Knife-speed WITH real damage — a red month is only a crash when it
  // breaks structure: deep drawdown, mid/low range position, broken
  // long trend, or extreme speed. A double-digit giveback off a peak
  // inside an intact uptrend is a pullback, not a free fall (the
  // flying-pikachu case: +690% all-time, 91st pctile, one soft month
  // is a grower cooling, not a card dying).
  const knifeSpeed = f(r30) <= -10 || f(r7) <= -7;
  const structural =
    (f(signal.drawdown) <= -20 ||
      f(signal.pctile1y, 0) <= 50 ||
      trend === 'depreciating' ||
      f(r30) <= -20 ||
      f(r7) <= -15) &&
    // A green month in an appreciating trend can't be in free fall —
    // the red week is a giveback inside a run, not damage (golduck:
    // +34.6%/mo, +136%/qtr, −20% week off a fresh high — a pullback,
    // not a knife; the headline even had to abs() the month to lie).
    !(f(r30) > 0 && trend === 'appreciating');
  // A knife dropping INTO a defended floor isn't a knife into the
  // void — it's a floor test. Defense needs real floor evidence: the
  // series shelf or the stamped deep shelf in proximity (a raw 90d
  // low proves nothing — a falling card always sits near the low it
  // just printed; petilil knifed at $19.87 with its shelf at $10.13
  // and read "testing a floor" purely off the fresh low). The card's
  // long-term grade doesn't decide this — a spent knife parked on a
  // 17-test shelf is still a live floor test: whether it holds is
  // the decision, spent or not. No floor evidence → the knife read
  // stands. Either way a sharply green WEEK breaks the story — a
  // card up double digits this week already bounced; "falling
  // hard"/"still sliding" would be lying about the leg that's
  // pointing up.
  const weekBouncing = f(r7) > 10;
  const floorHeld = features?.failedBounce === true && features.atFloor === true;
  // Defense is evidence, not proximity. A FAILED floor's protection
  // already died once (the bounce off it ran and died back on the
  // shelf — yamper: −19.7%/mo on a shelf whose rally already failed),
  // and a SPENT knife needs the floor's pops to be worth holding for:
  // a level whose median bounce ran under the range bar (15%) is
  // spare change, not defense (yamper's +13% pops on a −79 cagr card).
  // A live card gets the benefit of the level — the test decides its
  // trend; a spent card is holding for the pop, so the pop must exist.
  const feebleFloor = f(signal.cagr) <= -15 && ev.bouncePct != null && ev.bouncePct < 15;
  const onDefendedFloor = features?.failedBounce !== true && floorInReach && !feebleFloor;
  if (knifeSpeed && structural && onDefendedFloor && !weekBouncing) {
    return knifeFloorTestRead(pos === 'on-floor');
  }
  // A knife still sliding through a FAILED floor is a knife — the
  // floor's defense already died once, so a hard-red month doesn't
  // get to hide behind it (yamper: −19.7%/mo parked on a dead shelf).
  // But a dead-bounce card the floor CAUGHT — month net-positive,
  // only the retracing week red — is spent, not falling (ogerpon).
  if (
    knifeSpeed &&
    structural &&
    !possibleRange &&
    !weekBouncing &&
    (!floorHeld || (f(signal.cagr) <= -15 && f(r30) <= -10))
  ) {
    // floorInReach stays honest even when defense failed — the shelf
    // is beneath the price whether or not it can stop the slide.
    return freeFallRead(f(r7), f(r30), floorInReach);
  }

  // Revival — a quiet/spent card showing fresh upward life. This is the
  // pickup signal: momentum on a history that was flat or declining.
  if (!possibleRangeExit && isReviving(signal, r7, r30, trend, features)) {
    return revivalRead(f(r7), f(r30));
  }

  // Base forming — a real drawdown that stopped falling and is holding
  // a floor, on a card that isn't historically spent. Distinct from
  // dead/stable: buyers are defending a level on something still alive.
  const dd = f(signal.drawdown);
  // The series can disprove "near a floor": when it resolves a real
  // shelf far below the price, a low pctile ("cheapest this year") is
  // range position, not support (petilil's $7.66 under a $20 card). The
  // resolved position says it — a window shelf the price outgrew reads
  // mid-range or higher, never floor-side.
  const midAir =
    features?.floorPrice != null &&
    (pos === 'mid-range' || pos === 'at-ceiling' || pos === 'no-structure');
  const nearFloor =
    pos === 'on-floor' ||
    (signal.low90d != null && price != null
      ? price >= signal.low90d * 0.97 && price <= signal.low90d * 1.15
      : midAir !== true && f(signal.pctile1y, 100) <= 25);
  if (
    dd <= -20 &&
    !legStillFalling &&
    Math.abs(f(r30)) <= 12 &&
    nearFloor &&
    // An unproven cycler parked on its floor is a WATCH, not a rest
    // to stock — "at a floor, safe to hold" under a range the other
    // path can't confirm is the badge-vs-sheet add/dump seam (paras:
    // stamped 80d cycle vs window-resolved 203d glacial). Same for a
    // card parked at its resolved sell end — "resting on the floor"
    // can't print at the top of the range.
    !possibleRange &&
    !atCeiling &&
    // A young card's CAGR is its annualized launch crash — it can't
    // prove "spent" the way a 632-day bleed can.
    (f(signal.cagr) > -15 || isYoung(signal))
  ) {
    return baseFormingRestingRead(dd);
  }

  // The 'depressed' stamp means "below its recent average" — not
  // necessarily cheap. A card mid-range or higher (pctile > 40) isn't
  // near a floor no matter what the stamp says; it falls through to
  // the position-aware branches below. Null pctile (old catalogs)
  // keeps trusting the stamp.
  if (stance === 'depressed' && f(signal.pctile1y, 0) <= 40) {
    // "Cheap" splits on direction — a slow long bleed is Long-term
    // decline (knives were caught above); only a genuinely flat cheap
    // card is Dormant. Bleeding is judged on the recent legs, not the
    // raw 90d window — a cheap card whose month turned up is recovering.
    if (legStillFalling && !possibleRange) {
      return declinerNearLowRead(f(r90));
    }
    // Cheap AND spent — flat at the floor because the run is over.
    // An appreciating stamp contradicts "spent" — trust the sustained
    // directional read over the lifetime CAGR. A lone green month on
    // a flat/depreciating stamp is a bounce, not a restart (emcees).
    // A possibleRange-suppressed card isn't dead either — its thin
    // range evidence benched the dump reads, and spent-flat can't be
    // the landing for a card whose legs are still falling.
    if (f(signal.cagr) <= -15 && trend !== 'appreciating' && !possibleRange) {
      return deadStableCheapRead(f(signal.cagr));
    }
    // Cheap + alive: an appreciating stamp on a cheap card IS the
    // uptrend — "no uptrend to ride yet" would contradict it. Let it
    // fall through to the appreciating read below instead.
    if (trend !== 'appreciating') {
      return dormantRead();
    }
  }

  // A proven grower cooling off — the quarter is red but the month has
  // steadied and the long-term trend is strongly up. On cards like
  // this the dips keep getting bought; that's a pullback between runs,
  // not a decline. (Bubble mew: +598% all-time, 60th pctile, month
  // flat — its post-spike dips have set new highs twice.) The week leg
  // has to cooperate too — a double-digit down week isn't a dip being
  // bought, it's a live knife (fuzz: −26% week on a +23% month).
  if (
    (!possibleRange || riserOutranksRange) &&
    !atCeiling &&
    ((f(signal.cagr) >= 25 && f(signal.pctile1y) >= 50) ||
      // Slower climbers count too — a cagr of 10–25 at ≥60th pctile
      // is the same "dips get bought" shape with a gentler slope.
      (f(signal.cagr) >= 10 && f(signal.pctile1y) >= 60)) &&
    f(r90) <= 0 &&
    f(r30) > -10 &&
    f(r7) > -10
  ) {
    return growerCoolingRead();
  }

  // The appreciating catch-all — but a stamp can't outrank a fresh
  // week knife: "steady appreciation, safe to stock" on a card that
  // dropped ≥7% this week is a lie the leg disproves. A soft MONTH on
  // an intact trend is still a cooling grower (flying pikachu); a red
  // week is a live knife, so it falls through to the flat/dead reads.
  // A possible cycler isn't a steady grower either — suppressing a
  // knife on thin range evidence can't promote the card to a buy
  // (tentacruel: −10% month at a 1-test shelf); it lands keep-family.
  // The one exemption is riserOutranksRange upstream — a proven riser's
  // giveback IS the grower read, and the knife gates already ran.
  if (
    trend === 'appreciating' &&
    f(r7) > -7 &&
    (!possibleRange || riserOutranksRange) &&
    !atCeiling
  ) {
    return growerSteadyRead();
  }

  // A neutral/quiet stance on top of a depreciating long trend is not
  // "stable flat" — it's a slow leak. Same for a stamped 'falling'
  // card that survived every structural check above: the stamp is
  // direction without lifecycle — it's declining, just not knifing.
  // A green month means the stamped fall already turned (the stamp is
  // a stale window, not a prophecy) — don't call a +10% month a bleed.
  if (
    !possibleRange &&
    ((trend === 'depreciating' && legStillFalling) ||
      (stance === 'falling' && f(r30) <= 0 && f(r7) <= 0))
  ) {
    return declinerSlideRead(signal.cagr);
  }

  // Reaching here means no directional read fired — but "flat NOW"
  // has to be earned, not assumed. A deeply negative long-term CAGR
  // on a card that's actually flat is post-hype spent; the same CAGR
  // on a card still bleeding is a knife the gates above couldn't
  // claim (suppression, or a stance the stamps undersell). The
  // inventory audit was the proof: the whole dead bucket read
  // "flat now" on cards down 20–44% in the month — possibleRange
  // benched the dump reads and the spent stamp finished them off.
  // An appreciating stamp contradicts "spent" — the sustained
  // directional read beats the lifetime CAGR (same rule as above).
  if (f(signal.cagr) <= -15 && trend !== 'appreciating' && !possibleRange && !legStillFalling) {
    return deadStableSpentRead(f(signal.cagr));
  }
  // The bleeders the gates couldn't claim. A card still falling
  // toward a real floor whose pops are worth holding is a live floor
  // test — that's keep/watch family, never dead money (the floor
  // hold is the decision). But the floor has to be THERE: the
  // resolved position says so — parked on the shelf or closing into
  // its reach band, never mid-air and never at the sell end (a card
  // at the TOP of its own range can't be "falling toward a low" —
  // ninetales 42352: a +38%/yr compounder at the 91st pctile landed
  // floor-test copy on both paths while priced above its stamped
  // target). A spent bleeder on a feeble floor earned no such
  // benefit — neither did any other drifter reaching the tail: "flat
  // band" would be the lie the legStillFalling flag exists to catch.
  if (legStillFalling) {
    // The floor has to be THERE — and the verdict already says so:
    // floorInReach is the resolved on-floor ∪ approaching position,
    // single-shelf, ceiling-first, minus a shelf the series already
    // watched fail (onDefendedFloor's rule: a dead bounce means the
    // test ran and lost; "whether it holds" is no longer the open
    // question). `atCeiling` covers both old guards — the unproven-
    // cycler exit band and the stamped sell-into reach.
    const floorForTest = features?.failedBounce !== true && floorInReach;
    if (!atCeiling && !feebleFloor && floorForTest) {
      return bleedFloorTestRead(pos === 'on-floor');
    }
    // The tail's slide can land an appreciating card (a giveback week
    // on a compounder above its sell-into) — quoting a positive CAGR
    // as its slide rate would print a lie the claim audit can't see.
    return declinerSlideRead(signal.cagr != null && signal.cagr < 0 ? signal.cagr : null);
  }
  return stableFlatRead();
}

/** tcgcsv price capture began ~Feb 2024 — a series whose first print
 *  is after that is a genuinely new card, not just newly tracked. But
 *  "post-floor" alone isn't young: a card printed Jan 2025 has a year
 *  of history by now. Launch-window language only applies while the
 *  series itself is still young. COLLECTION_FLOOR itself is shared
 *  vocabulary — it lives in utils/format.ts with the sheet helpers. */
const NEW_SET_MAX_AGE_DAYS = 200;

function isYoung(signal: CardSignal): boolean {
  const span =
    signal.spanDays ??
    (signal.firstDate != null && signal.priceDate != null
      ? Math.round(
          (Date.parse(`${signal.priceDate}T00:00:00Z`) -
            Date.parse(`${signal.firstDate}T00:00:00Z`)) /
            86400000,
        )
      : null);
  if (signal.firstDate != null) {
    return signal.firstDate > COLLECTION_FLOOR && (span == null || span <= NEW_SET_MAX_AGE_DAYS);
  }
  return span != null && span <= NEW_SET_MAX_AGE_DAYS;
}

/** Quiet-or-spent history showing fresh upward momentum — the early
 *  "pick it up before it runs" signal. */
function isReviving(
  signal: CardSignal,
  r7: number | null,
  r30: number | null,
  trend: string | null,
  features?: SeriesFeatures,
): boolean {
  if (f(r7) < 5 && f(r30) < 10) return false;
  // A meaningfully red week means the bounce already happened and is
  // rolling over — "waking up" only counts while the move is arriving.
  if (r7 != null && r7 <= -3) return false;
  // A bounce that already ran and died back at the floor is a dead
  // cat, not a revival — unless the lows are now stepping up. A
  // retrace to a HIGHER shelf mid-recovery doesn't count.
  if (features?.failedBounce && features.atFloor && !features.higherLows) return false;
  // Confirmation: MA crossover / positive 30d slope when shipped, the
  // series' own slope or higher-lows shape when loaded — and a strong
  // 30d pop always counts, stamped or series-fresh.
  const confirmed =
    f(signal.ma20_60) > 0 ||
    f(signal.slope30d) > 0 ||
    (features?.slope30d ?? 0) > 0 ||
    features?.higherLows === true ||
    f(r30) >= 12;
  if (!confirmed) return false;
  // A high-range compounder isn't "quiet" — a green month on a card
  // sitting in the top 40% of its year's range with real lifetime
  // growth is a dip getting bought back, not a sleeper waking
  // (flygon/umbreon/ralts: 66–80th pctile, +44–111%/yr cagr).
  if (f(signal.pctile1y) >= 60 && f(signal.cagr) > 10) return false;
  if (trend === 'appreciating') return false;
  return (
    f(signal.cagr) <= 5 || trend === 'flat' || trend === 'depreciating' || f(signal.pctile1y) <= 35
  );
}
