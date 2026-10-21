// Customer-facing language — display names, the per-card owner note,
// and the buy-side / owned-side action verbs. Every sentence here is
// honest-by-contract (AGENTS.md invariants 8–10): floors are evidence
// never forecasts, rounded-dollar economics, and the note can never
// promise holding while the trigger says sell.
import type { CardSignal } from '../../../db/catalogDb';
import type { SeriesFeatures } from './seriesSignals';
import type { DealClassId, DealRead, RangePosition } from './types';
import { resolvePosition, resolveRangeEvidence } from './evidence';

/** Static display names — DealRead.label can carry dynamic suffixes
 *  ("At peak · topping"); track-record rows need the base word. */
const CLASS_LABELS: Record<DealClassId, string> = {
  HYPE_DECAY: 'New-set slide',
  POST_SPIKE_BLEED: 'Cooling after a spike',
  REVIVAL: 'Waking up',
  BASE_FORMING: 'At a low',
  DIP_BUY: 'Buy the dip',
  FREE_FALL: 'Free fall',
  AT_PEAK: 'At its high',
  STABLE_GROWER: 'Steady riser',
  DECLINER: 'Slow decline',
  DEAD_STABLE: 'Spent / flat',
  STABLE_FLAT: 'Flat & steady',
  DORMANT: 'Quiet / cheap',
  RANGE_PLAY: 'Range bouncer',
  LOW_DATA: 'Low data',
};

export function classLabel(cls: DealClassId): string {
  return CLASS_LABELS[cls];
}

/** Same classes, phrased for "I already own this" instead of
 *  "should I buy it" — the inventory-side read. When the chart's
 *  structure is loaded, floor context changes the advice: a card
 *  parked on a floor that held is a hold-until-it-breaks, not a
 *  dump-at-the-bottom. */
export function ownerNote(
  read: DealRead,
  features?: SeriesFeatures,
  floorCtx?: {
    price: number | null;
    floor: number | null;
    /** Market minus cost — negative means you're down vs cost;
     *  ≤ −$1 is the real-dollar bar that earns "underwater". */
    vsCost?: number | null;
    /** How long the card has been held — ages a "dead money" read
     *  from filler into shelf rent. */
    daysHeld?: number | null;
    /** Price already through the floor's break level — computed by the
     *  caller at the same threshold the trigger row flips on, so the
     *  note and the row can't disagree about whether the floor died. */
    cracked?: boolean;
    /** The stamped sell target (card_deep target_price) — a cycler's
     *  ceiling when the price series isn't loaded. */
    ceiling?: number | null;
    /** The signal the read classified — lets cycler notes quote the
     *  same resolved rhythm the verdict used (the stamped 152d cycle
     *  the badge saw, not the window's under-resolved 231d). */
    signal?: CardSignal | null;
  },
): string {
  const floor = floorCtx?.floor ?? features?.floorPrice ?? null;
  const price = floorCtx?.price ?? features?.lastPrice ?? null;
  // The note's position resolves against the resolved STRUCTURAL shelf —
  // the same union the verdict and the Pattern facet print — never the
  // caller's display floor: floorCtx.floor comes off positionTriggers'
  // fallback chain, which bottoms out at a bare 90d low, and a fresh low
  // is a print the card just made, not proof it's parked on anything.
  // The ctx floor stays the NAMED crack/bounce-back level — a level can
  // be named without asserting the card sits on it. Ceiling-side still
  // resolves first, same rule the verdict lands on.
  const noteEv = resolveRangeEvidence(floorCtx?.signal ?? null, features);
  const notePos = resolvePosition(
    price,
    noteEv.floor,
    noteEv.ceiling ?? floorCtx?.ceiling ?? null,
    floorCtx?.signal?.targetPrice ?? null,
    noteEv.ath,
  );
  // "Parked on a floor" means actually AT the shelf — a proven floor 60%
  // below the price is real, but the card isn't parked on it. floorTests
  // alone tells how proven the shelf is, not where the card sits.
  const onHeldFloor = notePos === 'on-floor';
  // Test count and bounce memory quote the resolved UNION, not the raw
  // window fields — on the scalar path the stamp is the only measure,
  // and a stamped 8×-held shelf can't read as untested pre-hydration and
  // then flip to "held" copy when the series loads.
  const floorN = noteEv.tests >= 2 ? ` (${noteEv.tests}× held)` : '';
  // Parked right on a floor that hasn't proven itself yet — one crack
  // from new lows, not one bounce from the top. A floor tested 3×+
  // still earns the hold; weaker ones get the redeploy read. The tight
  // sub-band narrows the resolved on-floor verdict — "parked" still
  // can't claim itself at the sell end.
  const onWeakFloor =
    notePos === 'on-floor' &&
    noteEv.floor != null &&
    price != null &&
    price <= noteEv.floor * 1.04 &&
    noteEv.tests < 3;
  // "Held N×" counts tests, not bounce quality — a shelf whose tests
  // produced <15% bounces was touched, not defended (yamper: 8 tests,
  // +13% one-day bounces). Weak defense doesn't earn a hold script.
  const weakBounce = noteEv.bouncePct != null && noteEv.bouncePct < 15;
  // What a bounce back to the floor is worth in dollars. Vendors deal
  // in rounded dollars — $3.19 vs $3.02 is the same $3 at a table, so
  // under ~$3 of upside "sell on the bounce" collapses to "sell it".
  const bounceWorth = floor != null && price != null ? floor - price : null;
  const cheapBounce = bounceWorth != null && bounceWorth < 3;
  // A bounce that already died back on the shelf. The exit depends on
  // where the card sits: still parked on it (sell before the crack),
  // through it with a cent-level retest (just sell it — vendors deal
  // in rounded dollars), or through it with a real-dollar retest
  // (the bounce back is worth the wait).
  const failedFloorNote = (crackedLead: string, parked: string): string => {
    if (floor != null && price != null && price < floor) {
      return cheapBounce
        ? `${crackedLead} — at $${Math.round(price)} a bounce is ` + 'spare change; sell it.'
        : `${crackedLead} — sell on a bounce back toward ` + `$${Math.round(floor)}.`;
    }
    return parked;
  };
  // Underwater reframes every falling/dead read — you're not locking
  // a win, you're cutting a loss; that changes what "sell now" means.
  // Same real-dollar bar the owned verb uses: a $0.80 card down a
  // nickel is the same $1 sticker, not a loss worth cut language
  // (invariant 8 — sub-dollar swings aren't inventory events).
  const underwater = (floorCtx?.vsCost ?? 0) <= -1;
  const monthsHeld = floorCtx?.daysHeld != null ? floorCtx.daysHeld / 30 : 0;
  const discountOut =
    'Better to sell at a small discount and pour that money into ' +
    "steadier cards — it's one crack from new lows.";
  const cutLoss =
    "You're underwater on it — cutting it at a small discount beats " +
    'riding it through the floor into a bigger hole.';
  // A cracked floor kills every floor-premised hold note — a dip-buy
  // can't keep saying "this is the dip others buy" when the trigger
  // row under it already flipped to CRACKED. Exit phrasing follows
  // the same spare-change rule as the row.
  if (floorCtx?.cracked === true && floor != null && price != null) {
    const exit = cheapBounce ? 'sell it.' : `sell on a bounce back toward $${Math.round(floor)}.`;
    switch (read.cls) {
      case 'DIP_BUY':
        return `It broke through the dip's floor — not a dip anymore; ${exit}`;
      case 'BASE_FORMING':
        return `The floor gave way — the basing read is dead; ${exit}`;
      case 'POST_SPIKE_BLEED':
        return `Off its peak and through the floor — ${exit}`;
      case 'DECLINER':
        return `Through the floor and still bleeding — ${exit}`;
      case 'RANGE_PLAY':
        return `The range broke — the floor it kept bouncing off gave way; ${exit}`;
      case 'FREE_FALL':
        // Its held-floor branch still says "hold while it holds" —
        // the floor it fell back to already gave way (fuzz: FREE_FALL
        // 3–6% under the crack line quoting "that's held").
        return `Through the floor and still falling — ${exit}`;
      default:
        break;
    }
  }
  switch (read.cls) {
    case 'FREE_FALL':
      if (underwater) return cutLoss;
      // A dead bounce matters anywhere near the level, not just parked
      // on it — deeper breaks route through failedFloorNote's crack
      // phrasing instead of pretending the floor's still underfoot.
      if (features?.failedBounce && floor != null && price != null && price <= floor * 1.15) {
        return failedFloorNote(
          'Still falling through a failed floor',
          'Bounced once and died right back on the floor — sell before ' + 'the crack.',
        );
      }
      if (onWeakFloor) return discountOut;
      if (onHeldFloor && weakBounce) {
        return `Floor's been tested${floorN} but barely bounces — ` + 'bank it before the crack.';
      }
      return onHeldFloor
        ? `It knifed back to a floor that's held${floorN} — hold while ` +
            'it holds; a crack through it is the real exit.'
        : floor != null
          ? `Nothing under it until the shelf at $${floor.toFixed(2)} ` +
            'and still falling — sell at a discount and put that money ' +
            'into steadier cards.'
          : 'No floor under it and still falling — sell at a discount ' +
            'and put that money into steadier cards.';
    case 'HYPE_DECAY':
      // Spare-change prices make "move it while it's hot" overstate
      // the stakes — a $1.27 card is a $1 sticker either way. The real
      // question is binder real estate: consolidate or let it sit.
      return price != null && price < 3
        ? `Still sliding off launch hype — at $${Math.round(price)} ` +
            "it's cheap either way: bundle it into better cards, " +
            'or let it sit as binder filler.'
        : 'Still sliding off launch hype — move it while the set is hot.';
    case 'POST_SPIKE_BLEED':
      if (underwater && (!onHeldFloor || weakBounce || features?.failedBounce)) return cutLoss;
      if (onWeakFloor) return discountOut;
      if (underwater) {
        return (
          `Underwater, but the floor's held${floorN} — the bounce ` +
          'is your way back to even; a crack is the exit.'
        );
      }
      return onHeldFloor
        ? features?.failedBounce
          ? failedFloorNote(
              "Off its peak and the floor's gone",
              'Off its peak — the bounce died back on the floor; sell ' + 'before the crack.',
            )
          : weakBounce
            ? `Off its peak and parked on a floor that barely bounces${floorN} — ` +
              'sell on the next bounce.'
            : `Off its peak, but parked on a floor that's held${floorN} — ` +
              'holding beats dumping at the bottom. If the floor cracks, ' +
              "that's the exit; until then it can bounce from here."
        : 'Coming down off the peak — sell into bumps before the slide continues.';
    case 'REVIVAL':
      return features?.higherLows
        ? 'Waking up and each dip bottoms higher — this is a hold, not a sell.'
        : 'Waking up off a quiet floor — this is a hold, not a sell.';
    case 'BASE_FORMING': {
      const floorSide = notePos === 'on-floor' || notePos === 'approaching-floor';
      if (onWeakFloor) return underwater ? cutLoss : discountOut;
      if ((features?.ret30d ?? 0) <= -10) {
        if (features?.failedBounce && !underwater && onHeldFloor) {
          return 'Back on the floor after a failed bounce — ' + 'a crack may already be starting.';
        }
        return underwater
          ? cutLoss
          : floorSide && floor != null
            ? "It's falling toward a floor that's held — hold while " +
              'it holds; a crack through it is the exit.'
            : 'Rough stretch — the base is holding; upgrade if it starts ticking up.';
      }
      return noteEv.tests >= 2
        ? `Floor's held ${noteEv.tests}× — safe stock; upgrade if it starts ticking up.`
        : onHeldFloor
          ? 'Holding its floor — safe stock; upgrade if it starts ticking up.'
          : 'Holding steady — safe stock; upgrade if it starts ticking up.';
    }
    case 'DECLINER':
      return underwater
        ? cutLoss
        : 'Bleeding with no end in sight — sell at a discount and ' +
            'pour that money into steadier cards.';
    case 'AT_PEAK':
      return read.peakState === 'topping'
        ? "It's already rolling over — take the win before it fades."
        : read.peakState === 'fading'
          ? "Momentum's cooling at the top — a good window to move it."
          : 'At its high and still strong — holding or selling into strength both work.';
    case 'STABLE_GROWER':
      return 'Steady climb — holding is doing the work for you.';
    case 'DIP_BUY':
      return 'A dip inside an uptrend — hold; this is the dip others buy.';
    case 'RANGE_PLAY': {
      // Same resolved evidence the verdict used — the note can't quote
      // a cycle or ceiling the classifier didn't (mr. mime: stamped
      // 152d rhythm vs the window's under-resolved 231d). noteEv is
      // that resolution, computed once at the top. The position words
      // quote notePos, not the variant — this note renders in the
      // owned context, and a shelf the context already passed can't
      // read as the buy end (fuzz #2871: the stamped sell-into sat
      // between the ctx shelf and the resolved floor, so variant=entry
      // printed "buy end" over an at-ceiling context).
      const ceiling = noteEv.ceiling ?? floorCtx?.ceiling ?? null;
      const cyc = noteEv.cycleDays != null ? Math.round(noteEv.cycleDays) : null;
      const posVariant =
        notePos === 'at-ceiling' ? 'exit' : notePos === 'on-floor' ? 'entry' : 'mid';
      if (posVariant === 'exit') {
        return ceiling != null
          ? `Top of its range — sell into ~$${ceiling.toFixed(2)}; it ` +
              'fades back to the floor on schedule.'
          : 'Top of its range — sell into it; it fades back on schedule.';
      }
      if (posVariant === 'entry') {
        const cycPart = cyc != null ? ` every ~${cyc} days` : '';
        return ceiling != null
          ? `On the buy end of a proven range — it bounces off this ` +
              `shelf${cycPart}; sell the pop back toward ~$${ceiling.toFixed(2)}.`
          : `On the buy end of a proven range — it bounces off this ` +
              `shelf${cycPart}; sell the pop.`;
      }
      return ceiling != null
        ? `Mid-range on a proven cycle — hold for the ~$${ceiling.toFixed(2)} ` +
            'ceiling; the fade back to the floor is the next buy window.'
        : 'Mid-range on a proven cycle — hold for the ceiling; the fade ' +
            'back to the floor is the next buy window.';
    }
    case 'DEAD_STABLE':
      return monthsHeld > 3
        ? `Parked ~${Math.round(monthsHeld)} months and not growing — ` +
            "that's shelf rent. Discount it out into cards that move."
        : "Spent — it holds value but won't grow, so it's dead " +
            'money. Keep it as filler, or discount it out into cards that move.';
    case 'DORMANT':
      return monthsHeld > 3
        ? `Quiet ~${Math.round(monthsHeld)} months with no turn in ` +
            'sight — discount it out if you want that money working.'
        : 'Cheap and quiet — a patience hold, or discount it out ' + "if you'd rather hold movers.";
    case 'LOW_DATA':
      return 'Trust your sticker over the model on this one.';
    default:
      return 'Flat and stable — no urgency in either direction.';
  }
}

/** The two-second answer — what to DO — rendered large on the analysis
 *  sheet. The class label says what the card IS; this says what to do
 *  with it when someone puts it in front of you. */
export function dealAction(read: DealRead): string {
  switch (read.cls) {
    case 'REVIVAL':
      return 'Buy the turnaround';
    case 'DIP_BUY':
      return 'Buy the dip';
    case 'BASE_FORMING':
      return read.variant === 'testing' ? 'Watch — still falling in' : 'Buy at the low';
    case 'STABLE_GROWER':
      return 'Solid buy — it keeps climbing';
    case 'RANGE_PLAY':
      return read.variant === 'entry'
        ? 'Buy at the low'
        : read.variant === 'exit'
          ? "At the sell end — don't buy"
          : 'Wait for the low';
    case 'FREE_FALL':
      return "Don't catch it";
    case 'HYPE_DECAY':
      return 'Pass — hype cooling';
    case 'POST_SPIKE_BLEED':
      return 'Lowball it or pass';
    case 'AT_PEAK':
      return "Don't chase the top";
    case 'DECLINER':
      return 'Pass — it keeps sliding';
    case 'DEAD_STABLE':
      return 'Dead money — skip it';
    case 'DORMANT':
      return 'Nothing to ride yet';
    case 'STABLE_FLAT':
      return 'Fine — worth the going rate';
    default:
      return 'Not enough data — trust your sticker';
  }
}

/** The card's own long-horizon trajectory — the same trend/cagr leg
 *  the classifier reads. "Flat now" on a card still compounding is a
 *  hold, not dead money; a depreciating stamp vetoes the lifetime cagr
 *  (it owns the live read the way it does in the classifier). An
 *  'appreciating' stamp can't outrank a deeply spent lifetime either —
 *  recovering off a −88%-cagr crash is a direction, not compounding
 *  (budew 004/131 printed "still climbing"); −15 is the classifier's
 *  own spent floor. */
export function stillCompounding(signal: CardSignal | null | undefined): boolean {
  if (signal?.trend === 'depreciating') return false;
  if (signal?.trend === 'appreciating') return (signal?.cagr ?? 0) > -15;
  return (signal?.cagr ?? 0) > 0;
}

/** The owned-side verb — what to do with a card already in the case. */
export function positionAction(
  read: DealRead,
  ctx?: {
    cracked?: boolean;
    bounceCheap?: boolean;
    ceiling?: number | null;
    /** Up vs cost — the verb banks the win instead of urging a loss-cut. */
    green?: boolean;
    /** Market price — sub-$3 cards are fodder: no floor to lose, no
     *  green to bank; the exit framing collapses to consolidate-or-sit. */
    price?: number | null;
    /** The resolved position verdict for the CONTEXT price the verb
     *  speaks to — same resolvePosition the ownerNote quotes. Floor-
     *  proximity verbs can't render when the context sits at the sell
     *  end (pid 138572: a shelf the card already passed is overhead
     *  resistance, not a floor it's holding). */
    position?: RangePosition;
    /** Underwater — market sits ≥$1 below what the owner paid (the
     *  caller resolves the bar). Keep-class cards get cut language on
     *  purpose: the verb names a loss you can stop, not a hold. */
    underwater?: boolean;
    /** The signal the read classified — lets keep-class verbs quote
     *  the card's own trajectory leg (same trend/cagr the classifier
     *  saw), the way ownerNote quotes its floorCtx signal. */
    signal?: CardSignal | null;
  },
): string {
  if (ctx?.cracked) {
    return ctx.bounceCheap ? 'Floor broke — just sell it' : 'Floor broke — sell the bounce back';
  }
  switch (read.cls) {
    case 'REVIVAL':
    case 'STABLE_GROWER':
    case 'DIP_BUY':
      return 'Let it run';
    case 'AT_PEAK':
      return "Bank it while it's hot";
    case 'RANGE_PLAY': {
      // The variant IS the sheet's position claim, but the verb speaks
      // to the owned context — ctx.position wins when it's known, so
      // "at the buy end" can't render over an at-ceiling context (fuzz
      // #2871) and "Sell near the top" can't render parked on the ctx
      // shelf. Callers that don't pass a position keep the variant.
      const pos =
        ctx?.position === 'at-ceiling'
          ? 'exit'
          : ctx?.position === 'on-floor'
            ? 'entry'
            : ctx?.position == null
              ? read.variant
              : 'mid';
      if (pos === 'exit') {
        return ctx?.ceiling != null
          ? `Sell around ~$${ctx.ceiling.toFixed(2)}`
          : 'Sell near the top';
      }
      return pos === 'entry' ? 'Hold — at the buy end' : 'Hold for the top';
    }
    case 'FREE_FALL':
    case 'DECLINER':
    case 'POST_SPIKE_BLEED':
    case 'HYPE_DECAY':
      // Dollar-price fodder has no floor to lose and no green to bank —
      // $0.50 vs $1.49 is the same $1 sticker. It's filler stock:
      // optional to consolidate into better cards, fine to let sit.
      if (ctx?.price != null && ctx.price < 3) {
        return 'Bundle it or let it sit — cheap either way';
      }
      // Green + falling isn't "dump a loser" — it's "bank the win before
      // it decays". Same exit, different urgency framing.
      return ctx?.green ? "Sell while you're up" : 'Move it out';
    case 'BASE_FORMING': {
      if (ctx?.position === 'at-ceiling') {
        return ctx.ceiling != null
          ? `Sell around ~$${ctx.ceiling.toFixed(2)}`
          : 'Sell near the top';
      }
      const floorSide =
        ctx?.position == null ||
        ctx.position === 'on-floor' ||
        ctx.position === 'approaching-floor';
      if (read.variant === 'testing') {
        return floorSide
          ? 'Risky to hold — sell if it drops below the floor'
          : 'Hold — while the base holds';
      }
      return floorSide ? 'Hold — on a held floor' : 'Hold — while the base holds';
    }
    case 'DEAD_STABLE':
    case 'DORMANT':
      return 'Dead money — move it when you can';
    case 'STABLE_FLAT': {
      // Flat is honest — "dead money" isn't when the card's own leg is
      // still up: a +75%/yr compounder told to rotate is a lie about
      // the verb, not the class (piplup 201350). Underwater stays cut
      // language on purpose — down vs cost is a loss you can stop.
      if (ctx?.underwater) return 'Cut it — down vs cost';
      return stillCompounding(ctx?.signal)
        ? 'Hold — still climbing'
        : 'Dead money — move it when you can';
    }
    default:
      return 'Hold';
  }
}
