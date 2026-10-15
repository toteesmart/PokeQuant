import { colors } from '../../../constants/colors';
import type { CardSignal } from '../../../db/catalogDb';
import type { SeriesFeatures } from './seriesSignals';
import type { DealRead, PeakState } from './types';
import { onRealFloor, resolveRangeEvidence } from './evidence';

// Deal classification — composes the stamped engine signals into the
// table-time read the vendor actually needs: what kind of deal is this,
// how hard to shield the offer, and what to say to the customer.
// Pure classification on shipped stats — everything here is instant.
//
// Public surface stays ONE module: this file re-exports the vocabulary
// (types.ts), shared evidence resolution (evidence.ts), portfolio reads
// (rotation.ts) and customer-facing language (copy.ts) — 22+ call sites
// import from './dealClassify' and never see the split.
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
  features?: SeriesFeatures
): DealRead {
  const price = signal?.price ?? null;
  const stance = signal?.stance ?? null;
  const trend = signal?.trend ?? null;
  // Series-fresh returns beat the stamps — they're computed at the
  // chart's last point, not the catalog's snapshot time.
  const r7 = features?.ret7d ?? signal?.ret7d ?? null;
  const r30 = features?.ret30d ?? signal?.ret30d ?? null;
  const r90 = signal?.ret90d ?? null;
  // A 'depreciating' stamp describes the whole window — a crash that
  // ended months ago still carries it. Only a slide still visible in
  // recent returns counts as bleeding; a flat card with an old crash
  // is dead/stable, not declining.
  // "Still bleeding" means the slide is happening NOW. A red quarter
  // alone doesn't count when the month has steadied — the crash can
  // sit inside a 90d window while the card recovers (ampharos: launch
  // crash → floor → +14% month). −0.8% on the month is flat, not
  // bleeding — that's why the r90 clause needs a real red month.
  const stillBleeding =
    f(r7) <= -7 ||
    f(r30) <= -10 ||
    // A 90d window on a young card IS its launch crash — it can't
    // testify about now. Only counts once the card outlived it.
    ((signal?.spanDays == null || signal.spanDays >= 120) &&
      f(r90) <= -15 &&
      f(r30) <= -3);
  // "Parked on the floor" — the decline already landed on a tested
  // level. Proximity is required (petilil: a shelf far below a mid-air
  // card is not a floor it's parked on). Series features prove it on
  // the sheet; the shipped deep shelf proves it for stamp-only badges.
  const parkedOnFloor = onRealFloor(signal, features);
  // "Parked" only ends the slide once the slide has actually ended —
  // a −40% month sitting on a floor is still coming down, not basing
  // (toucannon/ampharos: crashing AT the floor ≠ parked on it). The
  // suppression is earned by a steadied month, not just a shelf.
  const slideEnded = f(r30) > -12 && f(r7) > -12;

  if (!signal || !signal.action || signal.action === 'UNRATED' || price == null) {
    return {
      cls: 'LOW_DATA',
      label: 'Low data',
      headline: "Not much sales history — can't call it",
      color: colors.textMuted,
      risk: 'risky',
      offerLoFactor: 0.85,
      offerHiFactor: 0.95,
      script:
        "This one doesn't have much sales history to go on, so I have to " +
        'stay conservative on the offer.',
    };
  }

  if (stance === 'falling') {
    // A dip inside an intact long-term uptrend is a different animal than
    // a card in genuine decline — the trend line is the difference.
    if (trend === 'appreciating' && f(r90) > 0 && f(signal.cagr) > 0) {
      return {
        cls: 'DIP_BUY',
        label: 'Buy the dip',
        headline: 'Short-term dip inside an appreciating card',
        color: colors.velocityPositive,
        risk: 'good',
        offerLoFactor: 0.95,
        offerHiFactor: 1.05,
        script:
          "It's dipped off a strong run — the longer trend is still up, " +
          'so I can stay close to full rate on this.',
      };
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
    !(parkedOnFloor && slideEnded)
  ) {
    return {
      cls: 'HYPE_DECAY',
      label: 'New-set slide',
      headline: `Off release hype — ${Math.abs(f(signal.drawdown)).toFixed(0)}% below its early high`,
      color: colors.velocityNegative,
      risk: 'risky',
      offerLoFactor: 0.85,
      offerHiFactor: 0.9,
      script:
        "It's still coming down from launch — normal for a new card, " +
        "but I only buy where it's going, not where it debuted.",
    };
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
  const ev = resolveRangeEvidence(signal, features);
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
  if (rangeTests >= 3 && rangeShapeOk) {
    const floor = rangeFloor;
    const cyc = Math.round(rangeCycle);
    const variant: 'entry' | 'mid' | 'exit' =
      features?.atFloor === true ||
      features?.atShelf === true ||
      price <= floor * 1.15
        ? 'entry'
        : price >= rangeCeiling * 0.92
          ? 'exit'
          : 'mid';
    return {
      cls: 'RANGE_PLAY',
      label: 'Range bouncer',
      variant,
      headline:
        `Cycles ~$${floor.toFixed(2)} → ~$${rangeCeiling.toFixed(2)} ` +
        `every ~${cyc} days — ` +
        (variant === 'entry'
          ? 'at the buy end of the range'
          : variant === 'exit'
            ? 'at the sell end of the range'
            : 'mid-range on the swing'),
      color: variant === 'entry' ? colors.velocityPositive : colors.warning,
      risk: variant === 'entry' ? 'good' : 'neutral',
      offerLoFactor: variant === 'entry' ? 0.95 : variant === 'mid' ? 0.85 : 0.75,
      offerHiFactor: variant === 'entry' ? 1.05 : variant === 'mid' ? 0.95 : 0.85,
      script:
        variant === 'entry'
          ? 'It bounces off this shelf on a rhythm — buy at the floor, ' +
            'sell the pop back toward the ceiling.'
          : variant === 'exit'
            ? 'Top of the range — it fades back to the floor on schedule. ' +
              "Sell into it; buying the top is buying the fade."
            : "Mid-swing on a proven range — the buy window is the floor " +
              "and the sell window is the top; mid-air pays for neither.",
    };
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
  // r7 +39% on a $0.71 card still cycles $0.51→$0.66).
  const possibleRangeExit =
    possibleRange &&
    price != null &&
    rangeCeiling != null &&
    price >= rangeCeiling * 0.92 &&
    f(r30) <= 5;
  // The stamped sell-into was REACHED — the price already sits at or
  // above the level the stamp says to sell into, so "safe to stock"
  // can't stand whether or not the rest of the range shape resolved
  // (exeggcute: $1.04 over a $0.71 stamped target; blastoise: $66.54
  // over $62.97 — both badge-said grower while the sheet sold the
  // range top). Reached means reached: a crater shelf's modest
  // bounce-target above the price isn't a sell zone yet (tremendous
  // bomb: $1.85 vs a $1.90 stamp — it's still building, not topping).
  const atStampedTarget =
    signal.targetPrice != null &&
    price != null &&
    price >= signal.targetPrice;

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
  const dshVals = [
    features?.daysSinceAth,
    signal.daysSinceHigh,
  ].filter((v): v is number => v != null);
  const dsh = dshVals.length ? Math.max(...dshVals) : null;
  if (
    (dsh == null || (dsh >= 14 && dsh <= 365)) &&
    f(signal.drawdown) <= -25 &&
    (f(r30) <= -3 || f(r7) <= -3) &&
    !(parkedOnFloor && slideEnded) &&
    !possibleRange
  ) {
    return {
      cls: 'POST_SPIKE_BLEED',
      label: 'Coming off its high',
      headline:
        dsh != null
          ? `Down ${Math.abs(f(signal.drawdown)).toFixed(0)}% from its peak ~${Math.round(dsh / 30)} months ago — still sliding`
          : `Down ${Math.abs(f(signal.drawdown)).toFixed(0)}% from its peak — still sliding`,
      color: colors.velocityNegative,
      risk: 'risky',
      offerLoFactor: 0.85,
      offerHiFactor: 0.95,
      script:
        "It's still coming off the top — yesterday's spike price isn't " +
        "today's. I buy where it's going, not where it peaked.",
    };
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
  const floorHeld =
    features?.failedBounce === true && features.atFloor === true;
  // Defense is evidence, not proximity. A FAILED floor's protection
  // already died once (the bounce off it ran and died back on the
  // shelf — yamper: −19.7%/mo on a shelf whose rally already failed),
  // and a SPENT knife needs the floor's pops to be worth holding for:
  // a level whose median bounce ran under the range bar (15%) is
  // spare change, not defense (yamper's +13% pops on a −79 cagr card).
  // A live card gets the benefit of the level — the test decides its
  // trend; a spent card is holding for the pop, so the pop must exist.
  const feebleFloor =
    f(signal.cagr) <= -15 &&
    ev.bouncePct != null &&
    ev.bouncePct < 15;
  const onDefendedFloor =
    features?.failedBounce !== true && parkedOnFloor && !feebleFloor;
  if (knifeSpeed && structural && onDefendedFloor && !weekBouncing) {
    return {
      cls: 'BASE_FORMING',
      label: 'Sitting on a low',
      variant: 'testing',
      headline: `Falling hard toward a low that's held before — whether it holds is the decision`,
      color: colors.warning,
      risk: 'neutral',
      offerLoFactor: 0.9,
      offerHiFactor: 1.0,
      script:
        "It's dropping into a level buyers have defended before — I " +
        "don't pay for a knife, but if the floor holds this is where " +
        'it turns.',
    };
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
    // Quote the leg that's actually knifing — a week-only knife on a
    // flat card must print "this week", never abs() of a green month
    // (golduck: +34.6%/mo rendered as "Down 35% in 30d").
    const legIsMonth = f(r30) <= -10;
    const legPct = legIsMonth ? f(r30) : Math.min(f(r7), f(r30));
    return {
      cls: 'FREE_FALL',
      label: 'Free fall',
      headline:
        `Down ${Math.abs(legPct).toFixed(0)}% ` +
        `${legIsMonth ? 'in 30 days' : 'this week'} and still sliding`,
      color: colors.velocityNegative,
      risk: 'risky',
      offerLoFactor: 0.75,
      offerHiFactor: 0.85,
      script:
        `Market's down ${Math.abs(legPct).toFixed(0)}% ` +
        `${legIsMonth ? 'this month' : 'this week'} and ` +
        "hasn't found a floor yet — I have to buy where it's going, " +
        'not where it was.',
    };
  }

  // Revival — a quiet/spent card showing fresh upward life. This is the
  // pickup signal: momentum on a history that was flat or declining.
  if (!possibleRangeExit && isReviving(signal, r7, r30, trend, features)) {
    return {
      cls: 'REVIVAL',
      label: 'Waking up',
      headline: `Quiet for a while — now up ${Math.max(f(r7), f(r30)).toFixed(0)}% recently`,
      color: colors.velocityPositive,
      risk: 'good',
      offerLoFactor: 0.95,
      offerHiFactor: 1.05,
      script:
        "It's showing life after a long flat stretch — the kind of " +
        'early move worth paying rate for.',
    };
  }

  // Base forming — a real drawdown that stopped falling and is holding
  // a floor, on a card that isn't historically spent. Distinct from
  // dead/stable: buyers are defending a level on something still alive.
  const dd = f(signal.drawdown);
  // The series can disprove "near a floor": when it knows the real
  // shelf is far below the price, a low pctile ("cheapest this year")
  // is range position, not support (petilil's $7.66 under a $20 card).
  const midAir =
    features?.floorPrice != null &&
    price != null &&
    price > features.floorPrice * 1.25;
  const nearFloor =
    parkedOnFloor ||
    (signal.low90d != null && price != null
      ? price >= signal.low90d * 0.97 && price <= signal.low90d * 1.15
      : midAir !== true && f(signal.pctile1y, 100) <= 25);
  if (
    dd <= -20 &&
    !stillBleeding &&
    Math.abs(f(r30)) <= 12 &&
    nearFloor &&
    // An unproven cycler parked on its floor is a WATCH, not a rest
    // to stock — "at a floor, safe to hold" under a range the other
    // path can't confirm is the badge-vs-sheet add/dump seam (paras:
    // stamped 80d cycle vs window-resolved 203d glacial). Same for a
    // card parked above the stamped sell-into.
    !possibleRange &&
    !atStampedTarget &&
    // A young card's CAGR is its annualized launch crash — it can't
    // prove "spent" the way a 632-day bleed can.
    (f(signal.cagr) > -15 || isYoung(signal))
  ) {
    return {
      cls: 'BASE_FORMING',
      label: 'At a low',
      variant: 'resting',
      headline:
        `Down ${Math.abs(dd).toFixed(0)}% off its high but holding a ` +
        'floor — could build from here',
      color: colors.warning,
      risk: 'neutral',
      offerLoFactor: 0.95,
      offerHiFactor: 1.05,
      script:
        "It fell, then stopped — this level is holding. Safe to hold " +
        'or stock at rate; the tell is whether it starts ticking up.',
    };
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
    if (stillBleeding && !possibleRange) {
      return {
        cls: 'DECLINER',
        label: 'Slow decline',
        headline: `Near its low and still sliding${f(r90) < 0 ? ` — ${Math.abs(f(r90)).toFixed(0)}% in 90 days` : ''}`,
        color: colors.velocityNegative,
        risk: 'risky',
        offerLoFactor: 0.8,
        offerHiFactor: 0.9,
        script:
          "It's cheap, but the long trend is still drifting down — it " +
          "sells fine but doesn't hold value, so I keep margin in it.",
      };
    }
    // Cheap AND spent — flat at the floor because the run is over.
    // An appreciating stamp contradicts "spent" — trust the sustained
    // directional read over the lifetime CAGR. A lone green month on
    // a flat/depreciating stamp is a bounce, not a restart (emcees).
    // A possibleRange-suppressed card isn't dead either — its thin
    // range evidence benched the dump reads, and spent-flat can't be
    // the landing for a card whose legs are still falling.
    if (
      f(signal.cagr) <= -15 &&
      trend !== 'appreciating' &&
      !possibleRange
    ) {
      return {
        cls: 'DEAD_STABLE',
        label: 'Spent / flat',
        headline: `Cheap and spent (${f(signal.cagr).toFixed(0)}% a year) — no growth left`,
        color: colors.warning,
        risk: 'neutral',
        offerLoFactor: 0.8,
        offerHiFactor: 0.9,
        script:
          "It's cheap and flat — the run already happened. Fine as " +
          "filler stock, but don't pay up for growth that isn't coming.",
      };
    }
    // Cheap + alive: an appreciating stamp on a cheap card IS the
    // uptrend — "no uptrend to ride yet" would contradict it. Let it
    // fall through to the appreciating read below instead.
    if (trend !== 'appreciating') {
      return {
        cls: 'DORMANT',
        label: 'Quiet / cheap',
        headline: 'Priced low — but no uptrend to ride yet',
        color: colors.warning,
        risk: 'neutral',
        offerLoFactor: 0.85,
        offerHiFactor: 0.95,
        script:
          "It's cheap right now but it's been flat a while — nothing says " +
          "it's turning up yet, so I keep a little margin.",
      };
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
    !possibleRange &&
    !atStampedTarget &&
    ((f(signal.cagr) >= 25 && f(signal.pctile1y) >= 50) ||
      // Slower climbers count too — a cagr of 10–25 at ≥60th pctile
      // is the same "dips get bought" shape with a gentler slope.
      (f(signal.cagr) >= 10 && f(signal.pctile1y) >= 60)) &&
    f(r90) <= 0 &&
    f(r30) > -10 &&
    f(r7) > -10
  ) {
    return {
      cls: 'STABLE_GROWER',
      label: 'Steady riser',
      headline:
        'Long-term riser cooling off its run — dips like this get bought',
      color: colors.velocityPositive,
      risk: 'good',
      offerLoFactor: 0.95,
      offerHiFactor: 1.05,
      script:
        "This one's a proven climber pausing after a run — its dips " +
        'keep getting bought, so I can pay near rate here.',
    };
  }

  // The appreciating catch-all — but a stamp can't outrank a fresh
  // week knife: "steady appreciation, safe to stock" on a card that
  // dropped ≥7% this week is a lie the leg disproves. A soft MONTH on
  // an intact trend is still a cooling grower (flying pikachu); a red
  // week is a live knife, so it falls through to the flat/dead reads.
  // A possible cycler isn't a steady grower either — suppressing a
  // knife on thin range evidence can't promote the card to a buy
  // (tentacruel: −10% month at a 1-test shelf); it lands keep-family.
  if (
    trend === 'appreciating' &&
    f(r7) > -7 &&
    !possibleRange &&
    !atStampedTarget
  ) {
    return {
      cls: 'STABLE_GROWER',
      label: 'Steady riser',
      headline: 'Climbing steadily — safe to stock',
      color: colors.velocityPositive,
      risk: 'good',
      offerLoFactor: 0.95,
      offerHiFactor: 1.05,
      script:
        "This one's been climbing steadily, not spiking — it holds " +
        'value well, so I can pay full rate.',
    };
  }

  // A neutral/quiet stance on top of a depreciating long trend is not
  // "stable flat" — it's a slow leak. Same for a stamped 'falling'
  // card that survived every structural check above: the stamp is
  // direction without lifecycle — it's declining, just not knifing.
  // A green month means the stamped fall already turned (the stamp is
  // a stale window, not a prophecy) — don't call a +10% month a bleed.
  if (
    !possibleRange &&
    ((trend === 'depreciating' && stillBleeding) ||
      (stance === 'falling' && f(r30) <= 0 && f(r7) <= 0))
  ) {
    return {
      cls: 'DECLINER',
      label: 'Slow decline',
      headline: `Sliding long-term${signal.cagr != null ? ` (${signal.cagr.toFixed(0)}% a year)` : ''} — thin margin for error`,
      color: colors.velocityNegative,
      risk: 'risky',
      offerLoFactor: 0.8,
      offerHiFactor: 0.9,
      script:
        "The long-term trend on this is drifting down — it sells fine " +
        "but doesn't hold value, so I keep some margin in it.",
    };
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
  if (
    f(signal.cagr) <= -15 &&
    trend !== 'appreciating' &&
    !possibleRange &&
    !stillBleeding
  ) {
    return {
      cls: 'DEAD_STABLE',
      label: 'Spent / flat',
      headline: `Flat now — but long-term it's spent (${f(signal.cagr).toFixed(0)}% a year)`,
      color: colors.warning,
      risk: 'neutral',
      offerLoFactor: 0.8,
      offerHiFactor: 0.9,
      script:
        "It moves at rate and won't tank on you, but the growth is gone — " +
        'only pick it up if you need the stock.',
    };
  }
  // The bleeders the gates couldn't claim. A suppressed possible-
  // cycler still falling toward a floor whose pops are worth holding
  // is a live floor test — that's keep/watch family, never dead
  // money (the range might be real; the floor hold is the decision).
  // A spent bleeder on a feeble floor earned no such benefit —
  // neither did any other drifter reaching the tail: "flat band"
  // would be the lie the stillBleeding flag exists to catch.
  if (stillBleeding) {
    if (possibleRange && !feebleFloor) {
      return {
        cls: 'BASE_FORMING',
        label: 'Sitting on a low',
        variant: 'testing',
        headline: `Falling toward a low that's held before — whether it holds is the decision`,
        color: colors.warning,
        risk: 'neutral',
        offerLoFactor: 0.9,
        offerHiFactor: 1.0,
        script:
          "It's dropping into a level buyers have touched before — I " +
          "don't pay for a knife, but if the floor holds this is where " +
          'it turns.',
      };
    }
    return {
      cls: 'DECLINER',
      label: 'Slow decline',
      headline: `Sliding long-term${signal.cagr != null ? ` (${signal.cagr.toFixed(0)}% a year)` : ''} — thin margin for error`,
      color: colors.velocityNegative,
      risk: 'risky',
      offerLoFactor: 0.8,
      offerHiFactor: 0.9,
      script:
        "The long-term trend on this is drifting down — it sells fine " +
        "but doesn't hold value, so I keep some margin in it.",
    };
  }
  return {
    cls: 'STABLE_FLAT',
    label: 'Flat & steady',
    headline: 'Price sits in a flat band — worth the going rate',
    color: colors.text,
    risk: 'neutral',
    offerLoFactor: 0.95,
    offerHiFactor: 1.0,
    script:
      "Price has been pretty flat on this one — no real moves " +
      'either way, so the standard rate applies.',
  };
}

/** tcgcsv price capture began ~Feb 2024 — a series whose first print
 *  is after that is a genuinely new card, not just newly tracked. But
 *  "post-floor" alone isn't young: a card printed Jan 2025 has a year
 *  of history by now. Launch-window language only applies while the
 *  series itself is still young. */
const COLLECTION_FLOOR = '2024-04-01';
const NEW_SET_MAX_AGE_DAYS = 200;

function isYoung(signal: CardSignal): boolean {
  const span =
    signal.spanDays ??
    (signal.firstDate != null && signal.priceDate != null
      ? Math.round(
          (Date.parse(`${signal.priceDate}T00:00:00Z`) -
            Date.parse(`${signal.firstDate}T00:00:00Z`)) /
            86400000
        )
      : null);
  if (signal.firstDate != null) {
    return (
      signal.firstDate > COLLECTION_FLOOR &&
      (span == null || span <= NEW_SET_MAX_AGE_DAYS)
    );
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
  features?: SeriesFeatures
): boolean {
  if (f(r7) < 5 && f(r30) < 10) return false;
  // A meaningfully red week means the bounce already happened and is
  // rolling over — "waking up" only counts while the move is arriving.
  if (r7 != null && r7 <= -3) return false;
  // A bounce that already ran and died back at the floor is a dead
  // cat, not a revival — unless the lows are now stepping up. A
  // retrace to a HIGHER shelf mid-recovery doesn't count.
  if (features?.failedBounce && features.atFloor && !features.higherLows)
    return false;
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
    f(signal.cagr) <= 5 ||
    trend === 'flat' ||
    trend === 'depreciating' ||
    f(signal.pctile1y) <= 35
  );
}

/** Elevated stances — is the peak still building or rolling over? */
function atPeakRead(r7: number | null, r30: number | null): DealRead {
  let peakState: PeakState = 'intact';
  if (r7 != null && r7 < -3) {
    peakState = r30 != null && r30 < 0 ? 'topping' : 'fading';
  }
  const band: Record<PeakState, [number, number]> = {
    intact: [0.9, 1.0],
    fading: [0.9, 1.0],
    topping: [0.8, 0.9],
  };
  const scripts: Record<PeakState, string> = {
    intact:
      "It's at the top of its range but the trend hasn't broken — " +
      'I can pay near rate, just no premium for the peak.',
    fading:
      "It's priced at its high but the move is cooling — I need a " +
      'little cushion in case it starts easing back.',
    topping:
      "It's been at the top and it's already starting to roll over — " +
      'I have to protect myself on this one.',
  };
  const [lo, hi] = band[peakState];
  const peakWord =
    peakState === 'intact'
      ? 'still strong'
      : peakState === 'fading'
        ? 'easing'
        : 'rolling over';
  return {
    cls: 'AT_PEAK',
    label: `At its high · ${peakWord}`,
    headline:
      peakState === 'intact'
        ? 'Top of range — trend still intact'
        : peakState === 'fading'
          ? 'At its high — the move is cooling'
          : 'At peak — already rolling over',
    color:
      peakState === 'intact' ? colors.velocityPositive : colors.warning,
    risk: peakState === 'topping' ? 'risky' : 'neutral',
    offerLoFactor: lo,
    offerHiFactor: hi,
    script: scripts[peakState],
    peakState,
  };
}

