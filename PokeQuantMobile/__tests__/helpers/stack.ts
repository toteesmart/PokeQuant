import {
  classifyDeal,
  dealAction,
  offerBand,
  ownerNote,
  positionAction,
  resolvePosition,
  resolveRangeEvidence,
  rotationBucket,
  stillCompounding,
  type DealRead,
  type RangePosition,
} from '../../src/scanner/services/deal/dealClassify';
import { buildStockHealth } from '../../src/scanner/services/deal/stockHealth';
import {
  diffDealClasses,
  classKey,
  type DealShift,
} from '../../src/scanner/services/deal/dealShiftTracker';
import {
  scoutCandidates,
  scoutFloorBuys,
  type ScoutCandidate,
} from '../../src/scanner/services/deal/buyScout';
import {
  evaluateTrade,
  type TradeEntry,
  type TradeVerdict,
} from '../../src/scanner/services/deal/tradeEval';
import {
  buildFacets,
  dataAgeLabel,
  engineLines,
  positionTriggers,
} from '../../src/scanner/services/deal/sheetReads';
import type { SeriesFeatures } from '../../src/scanner/services/deal/seriesSignals';
import type { CardDeep, CardSignal, PatternStat, ScoutRow } from '../../src/db/catalogDb';
import { auditClaims } from './claims';

// The full surface stack — what the app renders for one card state.
// Every consumer's output, side by side, plus the contract that says
// the surfaces must tell ONE story.

export type Fam = 'add' | 'keep' | 'dump';

/** The action family — what direction the surfaces prescribe. Badge
 *  and sheet may refine into different classes on different evidence,
 *  but they may never point opposite ways: "add" vs "dump" is a
 *  contradiction the user can see. */
export function family(read: DealRead): Fam {
  switch (read.cls) {
    case 'REVIVAL':
    case 'DIP_BUY':
    case 'STABLE_GROWER':
      return 'add';
    case 'RANGE_PLAY':
      return read.variant === 'exit' ? 'dump' : read.variant === 'entry' ? 'add' : 'keep';
    case 'BASE_FORMING':
      return read.variant === 'testing' ? 'keep' : 'add';
    case 'FREE_FALL':
    case 'HYPE_DECAY':
    case 'POST_SPIKE_BLEED':
    case 'DECLINER':
      return 'dump';
    default:
      return 'keep'; // AT_PEAK, DEAD_STABLE, DORMANT, STABLE_FLAT, LOW_DATA
  }
}

export type SurfaceStack = {
  // InventoryCard badge — the scalar read.
  badge: DealRead;
  // The market price the stack renders against.
  px: number;
  // DealAnalysisSheet badge — the series read.
  sheet: DealRead;
  // The effective return legs the classifier saw (series-first).
  effR7: number | null;
  effR30: number | null;
  // Buy-scout action + offer band (not-owned sheet).
  scoutVerb: string;
  band: { open: number; max: number };
  // Owned sheet: verb, note, hero, triggers.
  ownerVerb: string;
  note: string;
  triggers: ReturnType<typeof positionTriggers>;
  // Stock-health row: bucket (deep pass + pre-hydration scalar) + trigger.
  bucket: string;
  scalarBucket: string;
  healthTrigger: string | null;
  onFloor: boolean;
  // Engine + facet lines.
  lines: { text: string; warn?: boolean }[];
  facets: { label: string; text: string }[];
  // The sheet's catalog-age disclosure line ("Prices as of M/D/YY").
  dataAge: string | null;
  // Movement-shift surface — the banner diff against a remembered
  // neutral class. `to` must equal the badge read for the same signal.
  shift: DealShift<null> | null;
  // Buy-scout surfaces — null when the class isn't a scout class.
  scout: ScoutCandidate | null;
  scoutFloor: ScoutCandidate | null;
  // Trade-eval surface — the card incoming on their side.
  trade: TradeVerdict | null;
  // The inputs, for claim verification.
  signal: CardSignal;
  features: SeriesFeatures | undefined;
  deep: CardDeep | null;
  ctxPrice: number;
  ctxFloor: number | null;
  // The context resolution the note/verb consumed — the detector
  // quotes THESE values rather than re-deriving a parallel opinion.
  ctxPosition: RangePosition;
  ctxCeiling: number | null;
  // The underwater verdict the owned verb consumed — vsCost < 0 is
  // the designed exception to the keep-class verb-honesty check.
  ctxUnderwater: boolean;
};

export type StackCtx = {
  price: number;
  floor: number | null;
  vsCost?: number;
  daysHeld?: number;
  cracked?: boolean;
  ceiling?: number | null;
  // Identity for the shift/scout/trade surfaces — defaults cover the
  // synthetic fixtures; real-card tests pass the true productId/finish.
  productId?: number;
  subType?: string;
  name?: string;
  // Deep-analog + pattern context for engineLines — scenarios that
  // carry real analog/pattern data pass it so those lines render.
  deep?: CardDeep | null;
  patterns?: Record<string, PatternStat>;
};

export function renderSurfaces(
  signal: CardSignal,
  features: SeriesFeatures | undefined,
  ctx: StackCtx,
): SurfaceStack {
  const badge = classifyDeal(signal);
  const sheet = classifyDeal(signal, features);
  const triggers = positionTriggers(sheet, signal, features);
  // The context verdict the owned-side surfaces resolve — ONE call,
  // same inputs ownerNote/positionAction consume (ctx price + the
  // resolved structural floor + the resolved-ceiling→ctx-ceiling→
  // display-target chain), so the verb and the detector quote the same
  // position the note did. The floor is ctxEv.floor, not the trigger
  // row's display level — a bare 90d low can't prove parked-on copy.
  const ctxEv = resolveRangeEvidence(signal, features);
  const ctxCeiling = ctxEv.ceiling ?? ctx.ceiling ?? triggers.targetPrice;
  const ctxPosition = resolvePosition(
    ctx.price ?? features?.lastPrice,
    ctxEv.floor,
    ctxCeiling,
    signal.targetPrice,
    ctxEv.ath,
  );
  // The underwater verdict the verb consumes — stored so the detector
  // quotes what the surface saw rather than re-deriving a parallel
  // opinion. vsCost<0 is the designed cut-language exception.
  const ctxUnderwater = ctx.vsCost != null && ctx.vsCost < 0;
  const health = buildStockHealth(
    [
      {
        id: 'x',
        name: 'x',
        liveMarket: signal.price ?? 0,
        amountPaid: 5,
      },
    ],
    () => signal,
    () => features,
  );
  const item = health.items[0];

  // Consumers of the same classification —
  // shift banner: reclassified against a remembered neutral stamp.
  const pid = ctx.productId ?? 1;
  const sub = ctx.subType ?? signal.subType ?? 'Normal';
  const key = classKey(pid, sub);
  const { shifts } = diffDealClasses({ [key]: { cls: 'DORMANT', label: 'Dormant' } }, [
    { card: null, productId: pid, subType: sub, signal },
  ]);
  // Buy scout: this signal alone through both lanes.
  const scoutRow: ScoutRow = {
    signal,
    name: ctx.name ?? 'card',
    number: null,
    set: null,
    rarity: null,
  };
  const scout = scoutCandidates([scoutRow], new Set(), 1)[0] ?? null;
  const scoutFloor = scoutFloorBuys([scoutRow], new Set(), 1)[0] ?? null;
  // Trade eval: the card incoming at face on their side — the notes
  // must describe it with the same class the badge/sheet computed.
  const entry: TradeEntry = {
    key: 't1',
    productId: pid,
    subType: sub,
    name: ctx.name ?? 'card',
    qty: 1,
    price: signal.price ?? ctx.price,
    signal,
  };
  const trade = evaluateTrade([], [entry], { theirCash: 10 });
  return {
    badge,
    px: ctx.price,
    sheet,
    effR7: features?.ret7d ?? signal.ret7d ?? null,
    effR30: features?.ret30d ?? signal.ret30d ?? null,
    scoutVerb: dealAction(sheet),
    band: offerBand(sheet, 100),
    ownerVerb: positionAction(sheet, {
      cracked: triggers.floorCracked,
      bounceCheap: triggers.bounceCheap,
      ceiling: triggers.showTarget ? triggers.targetPrice : null,
      green: ctx.vsCost != null && ctx.vsCost >= 1,
      underwater: ctxUnderwater,
      price: ctx.price,
      position: ctxPosition,
      signal,
    }),
    note: ownerNote(sheet, features, {
      price: ctx.price,
      floor: ctx.floor ?? triggers.floorPrice,
      vsCost: ctx.vsCost,
      daysHeld: ctx.daysHeld,
      cracked: triggers.floorCracked,
      ceiling: ctx.ceiling ?? triggers.targetPrice,
      signal,
    }),
    triggers,
    bucket: rotationBucket(sheet, signal, features),
    scalarBucket: rotationBucket(badge, signal),
    healthTrigger: item?.trigger ?? null,
    onFloor: item?.onFloor ?? false,
    lines: engineLines(sheet, ctx.deep ?? null, false, ctx.patterns ?? {}, () => false),
    facets: buildFacets(signal, features),
    dataAge: dataAgeLabel(signal),
    shift: shifts[0] ?? null,
    scout,
    scoutFloor,
    trade,
    signal,
    features,
    deep: ctx.deep ?? null,
    ctxPrice: ctx.price,
    ctxFloor: ctx.floor ?? triggers.floorPrice,
    ctxPosition,
    ctxCeiling,
    ctxUnderwater,
  };
}

/** Prints the card the way the user reads it — the dump is the audit. */
export function dumpStack(stack: SurfaceStack): string {
  const t = stack.triggers;
  return [
    `  badge (inventory) : ${stack.badge.cls}${stack.badge.variant ? `·${stack.badge.variant}` : ''}`,
    `  badge (sheet)     : ${stack.sheet.cls}${stack.sheet.variant ? `·${stack.sheet.variant}` : ''}`,
    `  data age          : ${stack.dataAge ?? '—'}`,
    `  scout action      : ${stack.scoutVerb}`,
    `  offer band        : $${stack.band.open} – $${stack.band.max} on $100`,
    `  owner action      : ${stack.ownerVerb}`,
    `  headline          : ${stack.sheet.headline}`,
    `  owner note        : "${stack.note}"`,
    `  floor row         : ${t.showFloor ? (t.floorCracked ? `CRACKED $${t.floorPrice?.toFixed(2)}` : `SELL UNDER $${t.crackPrice?.toFixed(2)}`) : '—'}`,
    `  target row        : ${t.showTarget ? `SELL INTO $${t.targetPrice?.toFixed(2)}` : '—'}`,
    `  health bucket     : ${stack.bucket} (scalar: ${stack.scalarBucket})`,
    `  health trigger    : ${stack.healthTrigger ?? '—'} · onFloor=${stack.onFloor}`,
    `  shift banner      : ${stack.shift ? `${stack.shift.from.label} → ${stack.shift.to.label} (${stack.shift.kind})` : '—'}`,
    `  scout row         : ${stack.scout ? `${stack.scout.read.cls} score ${stack.scout.score} — ${stack.scout.stat} · ${stack.scout.why}` : 'not surfaced'}`,
    `  floor lane        : ${stack.scoutFloor ? `${stack.scoutFloor.read.cls} score ${stack.scoutFloor.score}` : 'not surfaced'}`,
    `  trade verdict     : ${stack.trade ? `${stack.trade.verdict} — ${stack.trade.headline}` : '—'}`,
    ...(stack.trade?.notes ?? []).map((n) => `  trade note        : ${n}`),
    ...stack.lines.map((l) => `  engine line       : ${l.text}`),
    ...stack.facets.map((f) => `  facet ${f.label.padEnd(12)}: ${f.text}`),
  ].join('\n');
}

const DUMP_VERBS =
  /rotate|bank it|consolidate|bundle|sell|move it|pass|don't catch|lowball|dump|cut/i;
const ADD_VERBS = /buy|let it run|hold|watch/i;
const EXIT_ONLY = /floor broke|sell it|sell the bounce|sell if/i;

/** Runs every contract rule and returns the violations — sweeps use
 *  this to collect findings across thousands of combos instead of
 *  throwing on the first one. */
export function collectProblems(stack: SurfaceStack): string[] {
  const problems: string[] = [];

  // 1) Direction coherence — badge and sheet may refine but never
  //    contradict: a scout-buy family can't sit under an exit-family
  //    sheet, and vice versa.
  const bf = family(stack.badge);
  const sf = family(stack.sheet);
  if ((bf === 'add' && sf === 'dump') || (bf === 'dump' && sf === 'add')) {
    problems.push(
      `direction flip: badge=${stack.badge.cls}(${bf}) sheet=${stack.sheet.cls}(${sf})`,
    );
  }

  // 2) Verb coherence — the verbs must match the sheet class's own
  //    direction. Cracked floor → exit-only language.
  if (stack.triggers.floorCracked) {
    if (!EXIT_ONLY.test(stack.ownerVerb)) {
      problems.push(`cracked floor but owner verb is "${stack.ownerVerb}"`);
    }
    if (/hold|let it run|buy/i.test(stack.note)) {
      problems.push(`cracked floor but note says hold: "${stack.note}"`);
    }
  } else if (sf === 'dump') {
    if (
      !DUMP_VERBS.test(stack.ownerVerb) &&
      !/dead money|hold|consolidate|fodder/i.test(stack.ownerVerb)
    ) {
      problems.push(`dump-family class ${stack.sheet.cls} but owner verb is "${stack.ownerVerb}"`);
    }
    if (/buy the|solid buy/i.test(stack.scoutVerb)) {
      problems.push(`dump-family class ${stack.sheet.cls} but scout says "${stack.scoutVerb}"`);
    }
  } else if (sf === 'add') {
    if (!ADD_VERBS.test(stack.ownerVerb)) {
      problems.push(`add-family class ${stack.sheet.cls} but owner verb is "${stack.ownerVerb}"`);
    }
    if (/rotate|dump|consolidate|bundle|move it|dead money|pass|don't/i.test(stack.scoutVerb)) {
      problems.push(`add-family class ${stack.sheet.cls} but scout says "${stack.scoutVerb}"`);
    }
  }

  // 3) Bucket coherence — the health bucket can't put a dump-family
  //    class in "grow" or an add-family class in "rotate".
  if (sf === 'dump' && stack.bucket === 'grow') {
    problems.push(`dump class ${stack.sheet.cls} landed in grow bucket`);
  }
  if (sf === 'add' && (stack.bucket === 'rotate' || stack.bucket === 'dead')) {
    problems.push(`add class ${stack.sheet.cls} landed in ${stack.bucket} bucket`);
  }

  // 4) Trigger coherence — the health row's exit line must name a
  //    floor-family dollar the sheet also shows: the shelf itself or
  //    the crack line under it. A "sell into ~$X" line quotes the
  //    TARGET instead — same rule against targetPrice. Lines with no
  //    dollar figure can't misquote.
  if (stack.triggers.showFloor) {
    const m = stack.healthTrigger?.match(/\$(\d+(?:\.\d+)?)/);
    if (m) {
      const quoted = parseFloat(m[1]);
      const near = (v: number | null | undefined) =>
        v != null && Math.abs(quoted - v) <= Math.max(0.011, v * 0.02);
      const floorish = /crack|below|floor|range breaks|through/i.test(stack.healthTrigger ?? '');
      const targets = [stack.triggers.floorPrice, stack.triggers.crackPrice];
      const sellInto = /sell (into|around)|top of (its |the )?range/i.test(
        stack.healthTrigger ?? '',
      );
      if (sellInto && !near(stack.triggers.targetPrice)) {
        problems.push(
          `target mismatch: health "${stack.healthTrigger}" vs sheet target $${stack.triggers.targetPrice?.toFixed(2)}`,
        );
      } else if (floorish && !targets.some((fl) => near(fl))) {
        problems.push(
          `floor mismatch: sheet floor $${stack.triggers.floorPrice?.toFixed(2)} vs health "${stack.healthTrigger}"`,
        );
      }
    }
  }

  // 5) Offer-band sanity — never inverted, never past full-rate +10%.
  if (!(stack.band.open <= stack.band.max && stack.band.max <= 110)) {
    problems.push(`insane band $${stack.band.open}-$${stack.band.max}`);
  }

  // 6) Language standards — every '%' inside an engine line sits in a
  //    parenthetical evidence clause (the odds word leads), and the
  //    pooled floor prior says "Market-wide", never "floors like this".
  for (const l of stack.lines) {
    if (/floors like this/i.test(l.text)) {
      problems.push(`pooled prior mislabeled: "${l.text}"`);
    }
    const stripped = l.text.replace(/\([^)]*\)/g, '');
    if (/\d(?:\.\d+)?%/.test(stripped)) {
      problems.push(`bare percent outside evidence parens: "${l.text}"`);
    }
  }

  // 7) Note coherence — a note can't claim a floor the price isn't at,
  //    and can't deny a floor the engine lines cite. Only POSITIONAL
  //    claims are lies at distance: "falling toward a floor" is a
  //    direction, and it's true — the price is literally headed there.
  //    The check mirrors the note's own floor source (ctxFloor) — the
  //    window may resolve a deeper shelf the note never quoted.
  const fl = stack.ctxFloor;
  const px = stack.px;
  if (
    fl != null &&
    px != null &&
    px > fl * 1.3 &&
    // atFloor/atShelf ARE proximity evidence — the note's "on the
    // floor" reads the window shelf the flags measured, not ctxFloor.
    !(stack.features?.atFloor || stack.features?.atShelf) &&
    /parked on|knifed back to|sitting on|at the floor|been tested/i.test(stack.note)
  ) {
    problems.push(`note claims distant floor: "${stack.note}"`);
  }
  if (fl != null && /no floor under it/i.test(stack.note)) {
    problems.push(`note says "no floor" while a $${fl.toFixed(2)} shelf exists: "${stack.note}"`);
  }

  // 8) Headline honesty — "Down X% in 30d" can't sit on a green month:
  //    the leg it quotes must exist (golduck: +34.6%/mo printed as
  //    "Down 35% in 30d" under a red week).
  if (/down \d+(?:\.\d+)?% in 30d/i.test(stack.sheet.headline) && (stack.effR30 ?? 0) > -0.05) {
    problems.push(
      `headline claims "Down" in 30d but effR30=${stack.effR30}: "${stack.sheet.headline}"`,
    );
  }

  // 9) Shift-banner coherence — the diff reclassifies the same signal
  //    the badge reads, so its `to` stamp must BE the badge read. With
  //    that pinned, direction vs the sheet is covered by rule 1. (A
  //    refactor that hands the tracker features or a different signal
  //    would break this before it breaks the app.)
  if (stack.shift) {
    if (stack.shift.to.cls !== stack.badge.cls) {
      problems.push(
        `shift label "${stack.shift.to.label}" (${stack.shift.to.cls}) != badge ${stack.badge.cls}`,
      );
    }
    // A same-class floor crack rewrites the to-label to "under its
    // floor" on purpose — that's the crack phrasing, not a mismatch.
    if (stack.shift.to.label !== stack.badge.label && stack.shift.kind !== 'floor_crack') {
      problems.push(
        `shift label text "${stack.shift.to.label}" != badge label "${stack.badge.label}"`,
      );
    }
  }

  // 10) Scout coherence — a surfaced candidate's class must be a
  //     scout-legal read (entry-position cyclers, non-testing floors),
  //     and its stat numbers verify against the stamp it quotes.
  for (const [lane, c] of [
    ['main', stack.scout],
    ['floor', stack.scoutFloor],
  ] as const) {
    if (!c) continue;
    if (c.read.cls === 'RANGE_PLAY' && c.read.variant !== 'entry') {
      problems.push(`${lane} scout surfaced RANGE_PLAY·${c.read.variant}`);
    }
    if (c.read.cls === 'BASE_FORMING' && c.read.variant === 'testing') {
      problems.push(`${lane} scout surfaced a testing floor`);
    }
    const heldM = c.stat.match(/held (\d+)×/);
    if (
      heldM &&
      stack.signal.shelfTests != null &&
      parseInt(heldM[1], 10) !== stack.signal.shelfTests
    ) {
      problems.push(
        `${lane} scout claims "held ${heldM[1]}×" but shelfTests=${stack.signal.shelfTests}`,
      );
    }
    const roomM = c.stat.match(/\+(\d+(?:\.\d+)?)% room/);
    if (roomM && stack.signal.targetPrice != null && stack.signal.price) {
      const real = (stack.signal.targetPrice / stack.signal.price - 1) * 100;
      if (Math.abs(parseFloat(roomM[1]) - real) > 0.6) {
        problems.push(
          `${lane} scout claims "+${roomM[1]}% room" but target/price gives ${real.toFixed(0)}%`,
        );
      }
    }
    const cycM = c.stat.match(/~(\d+)d/);
    if (
      cycM &&
      stack.signal.cycleDays != null &&
      Math.abs(parseInt(cycM[1], 10) - Math.round(stack.signal.cycleDays)) > 1
    ) {
      problems.push(
        `${lane} scout claims "every ~${cycM[1]}d" but cycleDays=${stack.signal.cycleDays}`,
      );
    }
  }
  if (stack.scoutFloor && stack.scoutFloor.read.cls !== 'RANGE_PLAY') {
    problems.push(`floor lane surfaced non-cycler ${stack.scoutFloor.read.cls}`);
  }

  // 11) Trade-note coherence — the eval classifies the same scalar
  //     signal, so each note phrase must map to the badge's own class:
  //     a "falling" note on a non-dump read, or a "dip buy" note on a
  //     non-DIP_BUY, is the eval describing a different card.
  if (stack.trade) {
    const badgeFallingOrTesting =
      bf === 'dump' || (stack.badge.cls === 'BASE_FORMING' && stack.badge.variant === 'testing');
    for (const n of stack.trade.notes) {
      if (/falling —/i.test(n) && !badgeFallingOrTesting) {
        problems.push(`trade note calls ${stack.badge.cls}(${bf}) falling: "${n}"`);
      }
      if (/dip buy —/i.test(n) && stack.badge.cls !== 'DIP_BUY') {
        problems.push(`trade note calls ${stack.badge.cls} a dip buy: "${n}"`);
      }
      if (/waking up —/i.test(n) && stack.badge.cls !== 'REVIVAL') {
        problems.push(`trade note calls ${stack.badge.cls} reviving: "${n}"`);
      }
      if (
        /at a floor —/i.test(n) &&
        !(stack.badge.cls === 'BASE_FORMING' && stack.badge.variant !== 'testing')
      ) {
        problems.push(`trade note calls ${stack.badge.cls} floor-held: "${n}"`);
      }
      if (
        /spent —/i.test(n) &&
        stack.badge.cls !== 'DECLINER' &&
        stack.badge.cls !== 'DEAD_STABLE'
      ) {
        problems.push(`trade note calls ${stack.badge.cls} spent: "${n}"`);
      }
    }
  }

  // 12) Claims audit — every numeric/verbal claim in rendered text
  //    verifies against the inputs that generated it.
  problems.push(...auditClaims(stack));

  // 13) Position-claim coherence — floor-proximity language may not
  //     render when the resolved position is at the TOP. The trigger
  //     IS the verdict now (item 55): `ev.position === 'at-ceiling'`
  //     folds the ceiling exit band and the stamped sell-into reach
  //     the classifier suppresses with, so the detector can't drift
  //     to a second opinion (ninetales 42352: "Sitting on a low" /
  //     "sell if it drops below the floor" on a card priced ABOVE its
  //     own $37.95 ceiling). The note and the owned-side verbs resolve
  //     position against the CONTEXT price/floor the inventory row
  //     carries — same resolver, different inputs — so an at-ceiling
  //     context can't print parked copy either.
  {
    const ev = resolveRangeEvidence(stack.signal, stack.features);
    // Each text is judged by the resolution that produced it: the
    // badge and trade eval classify on the scalar path (no series),
    // the sheet/scout/facet stack resolves the deep evidence, and the
    // note/owned verb resolve against the context price the inventory
    // row carries. One resolver, three input sets — never a second
    // opinion.
    const badgePos = resolveRangeEvidence(stack.signal).position;
    const badgeAtCeil = badgePos === 'at-ceiling';
    const sheetAtCeil = ev.position === 'at-ceiling';
    const px = stack.signal.price ?? stack.px;
    // The note-side verdict is the one renderSurfaces already resolved
    // and handed to ownerNote/positionAction — quote it, don't
    // re-derive a parallel opinion that can drift from the surface.
    const noteAtCeil = stack.ctxPosition === 'at-ceiling';
    if (badgeAtCeil || sheetAtCeil || noteAtCeil) {
      // The level that fired — the ×0.92 sell-end band counts, so name
      // the ceiling the position resolved against even when the price
      // sits inside the band rather than over the line itself.
      const level =
        ev.ceiling != null && px != null && px >= ev.ceiling
          ? ev.ceiling
          : stack.signal.targetPrice != null && px != null && px >= stack.signal.targetPrice
            ? stack.signal.targetPrice
            : (ev.ceiling ?? stack.ctxCeiling);
      const levelKind =
        ev.ceiling != null && px != null && px >= ev.ceiling
          ? 'resolved ceiling'
          : stack.signal.targetPrice != null && px != null && px >= stack.signal.targetPrice
            ? 'stamped target'
            : 'sell-end band';
      // Proximity/buy-end vocabulary only — floor-existence and
      // past-tense claims ("Floor's held", "Sat at this low",
      // "bounces off this shelf") are a different phrase class and
      // belong to the item-56 audit, not this check.
      const FLOOR_PROXIMITY =
        /sitting on|at a low|on a low|at the low|near its low|on the floor|at the floor|at a floor|parked on|on a held floor|holding its floor|knifed back to|buy end|toward a (?:low|floor|level)|toward the (?:low|floor|level)|dropping into a level|sell[^.]*below[^.]*floor/i;
      // Texts that render off the signal's own price check the signal's
      // verdict; the note and owned verb render off the context price
      // the inventory row carries — the context verdict checks those.
      const texts: [string, string, boolean][] = [
        ['badge label', stack.badge.label, badgeAtCeil],
        ['badge headline', stack.badge.headline, badgeAtCeil],
        ['badge script', stack.badge.script, badgeAtCeil],
        ['sheet label', stack.sheet.label, sheetAtCeil],
        ['sheet headline', stack.sheet.headline, sheetAtCeil],
        ['sheet script', stack.sheet.script, sheetAtCeil],
        ['note', stack.note, noteAtCeil],
        ['owner verb', stack.ownerVerb, noteAtCeil],
        ['scout verb', stack.scoutVerb, sheetAtCeil],
        // The scout lanes classify the bare signal (buyScout passes no
        // features) — the scalar resolution judges their stat/why.
        ['scout stat', stack.scout?.stat ?? '', badgeAtCeil],
        ['scout why', stack.scout?.why ?? '', badgeAtCeil],
        ['floor-scout stat', stack.scoutFloor?.stat ?? '', badgeAtCeil],
        ['floor-scout why', stack.scoutFloor?.why ?? '', badgeAtCeil],
        ['health trigger', stack.healthTrigger ?? '', sheetAtCeil],
        ...stack.lines.map((l): [string, string, boolean] => ['engine line', l.text, sheetAtCeil]),
        ...stack.facets.map((f): [string, string, boolean] => [
          `facet "${f.label}"`,
          f.text,
          sheetAtCeil,
        ]),
        ...(stack.trade?.notes ?? []).map((n): [string, string, boolean] => [
          'trade note',
          n,
          badgeAtCeil,
        ]),
      ];
      for (const [src, text, atCeil] of texts) {
        if (text && atCeil && FLOOR_PROXIMITY.test(text)) {
          problems.push(
            `position claim: ${src} "${text}" claims floor proximity ` +
              `but $${px!.toFixed(2)} is at/above the ${levelKind} $${level?.toFixed(2)}`,
          );
        }
      }
    }
  }

  // 14) Verb honesty — an unconditional dump verb can't render on a
  //     keep-bucket card that's still compounding while the owner
  //     isn't underwater (piplup 201350: +75%/yr STABLE_FLAT told
  //     "Dead money — move it when you can"). Two earned exceptions:
  //     vsCost<0 — the underwater branch cuts on purpose — and a keep
  //     card whose long trajectory is actually down keeps the rotate
  //     framing, the verb earning itself off the same trajectory leg
  //     the classifier read. Dead-by-class verbs never reach this
  //     check: DEAD_STABLE/DORMANT bucket to dead/watch, so their
  //     "dead money" line is the class story, not a mislabeled hold.
  if (
    stack.bucket === 'keep' &&
    stack.ctxUnderwater !== true &&
    stillCompounding(stack.signal) &&
    /dead money|move it|rotate|cut it/i.test(stack.ownerVerb)
  ) {
    problems.push(
      `verb honesty: keep-bucket ${stack.sheet.cls} is still compounding ` +
        `but the owner verb dumps it — "${stack.ownerVerb}"`,
    );
  }

  return problems;
}

export function assertContract(name: string, stack: SurfaceStack) {
  const problems = collectProblems(stack);
  if (problems.length > 0) {
    throw new Error(
      `${name} — surface contract broken:\n${dumpStack(stack)}\n` +
        problems.map((p) => `  ✗ ${p}`).join('\n'),
    );
  }
}
