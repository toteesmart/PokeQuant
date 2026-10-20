import type { CardSignal } from '../../../db/catalogDb';
import type { ScanCatalogVariant } from '../../types/catalog';
import { classifyDeal, resolveRangeEvidence, type DealRead } from './dealClassify';

// Two-sided trade fairness — face value lies when one side is falling and
// the other is compounding, so the verdict weighs where each side is
// *headed*, not just what it costs today. Port of quant.trade's logic to
// the stamped signal schema.

export type TradeEntry = {
  key: string; // unique row key (inventory id or `${productId}:${subType}`)
  /** Set when the entry came from the user's inventory — the row that
   *  gets marked sold on Complete trade. */
  inventoryId?: string;
  /** Original purchase price of the inventory row — the trade's
   *  carry-over cost basis. */
  paidPrice?: number;
  productId: number | null;
  subType: string | null;
  name: string;
  number?: string;
  set?: string;
  imageUrl?: string;
  qty: number;
  price: number; // unit market price
  signal: CardSignal | undefined;
  /** All finish variants with signals — powers the nested analysis sheet's
   *  finish switcher. Absent when the catalog carries no signal row. */
  variants?: ScanCatalogVariant[];
};

export type SideFlags = {
  falling: TradeEntry[]; // actively sliding — stance OR return-driven
  reviving: TradeEntry[]; // waking up off a quiet floor
  dipBuys: TradeEntry[]; // dips inside uptrends
  spent: TradeEntry[]; // dead/declining — offload fuel
  floors: TradeEntry[]; // base forming — downside mostly spent
  stale: TradeEntry[]; // thin/stale data — price it yourself
  total: number;
  proj30: number; // 30d-projected value of the side
};

/** Falling classes for trade math — broader than the `stance` stamp:
 *  a post-spike bleed with a "depressed" stamp is still a faller. */
const FALLING_CLASSES = new Set(['FREE_FALL', 'POST_SPIKE_BLEED', 'HYPE_DECAY']);
const SPENT_CLASSES = new Set(['DECLINER', 'DEAD_STABLE']);

function isStale(signal: CardSignal | undefined): boolean {
  if (!signal) return true;
  if (signal.liqFlag === 'stale' || signal.liqFlag === 'thin' || signal.liqFlag === 'no_data')
    return true;
  if (signal.nEvents != null && signal.nEvents < 15) return true;
  if (signal.daysSinceChange != null && signal.daysSinceChange > 60) return true;
  return false;
}

export type TradeTerms = {
  /** Vendor trade-credit rate applied to THEIR incoming cards. The table
   *  convention — most vendors take trades at ~80% of face, so a $10
   *  incoming card "counts" $8 against your outgoing card. Cash always
   *  counts at 100% on whichever side it's added. */
  tradeRate: number;
  yourCash: number;
  theirCash: number;
};

export type TradeVerdict = {
  yourSide: SideFlags;
  theirSide: SideFlags;
  faceDelta: number; // raw face delta (their cards - your cards)
  facePct: number;
  trajDelta: number; // 30d-projected delta (their proj - your proj)
  theirCredit: number; // their card face discounted at tradeRate
  theirEffective: number; // theirCredit + theirCash
  yourEffective: number; // your card face + yourCash
  tradeDelta: number; // theirEffective - yourEffective
  tradePct: number; // tradeDelta as % of yourEffective
  decayAvoided: number; // $ of projected decay you dodge by offloading
  decayTaken: number; // $ of projected decay incoming cards carry
  smartDelta: number; // tradeDelta + decayAvoided - decayTaken — verdict basis
  smartPct: number; // smartDelta as % of yourEffective
  recommendedMax: number; // rate × their 30d-projection + theirCash —
  // the shielded ceiling for what you give. A falling card's safe offer
  // is below rate×face; a climber's is above.
  ratePct: number; // tradeRate as a whole percent (80)
  notes: string[];
  verdict: 'win' | 'fair' | 'lose';
  headline: string;
  counterSuggestion: string | null;
};

/** 30d-projected value: fwd band midpoint when stamped, else the
 *  ret30d trend extrapolated (clamped), else flat. */
function proj30(entry: TradeEntry): number {
  const s = entry.signal;
  const unit =
    s?.fwd30dLo != null && s?.fwd30dHi != null
      ? (s.fwd30dLo + s.fwd30dHi) / 2
      : s?.ret30d != null
        ? entry.price * (1 + Math.max(-50, Math.min(50, s.ret30d)) / 100)
        : entry.price;
  return unit * entry.qty;
}

function sideFlags(entries: TradeEntry[], reads: Map<string, DealRead>): SideFlags {
  const read = (e: TradeEntry) => reads.get(e.key);
  const cls = (e: TradeEntry) => read(e)?.cls;
  // A 'testing' BASE_FORMING is a knife still mid-fall toward the
  // floor — it decays like a faller, it isn't "downside spent" yet.
  const fallingOrTesting = (e: TradeEntry) =>
    FALLING_CLASSES.has(cls(e) ?? '') ||
    (cls(e) === 'BASE_FORMING' && read(e)?.variant === 'testing');
  return {
    falling: entries.filter(fallingOrTesting),
    reviving: entries.filter((e) => cls(e) === 'REVIVAL'),
    dipBuys: entries.filter((e) => cls(e) === 'DIP_BUY'),
    spent: entries.filter((e) => SPENT_CLASSES.has(cls(e) ?? '')),
    floors: entries.filter((e) => cls(e) === 'BASE_FORMING' && read(e)?.variant !== 'testing'),
    stale: entries.filter((e) => isStale(e.signal) && cls(e) !== 'LOW_DATA'),
    total: entries.reduce((n, e) => n + e.price * e.qty, 0),
    proj30: entries.reduce((n, e) => n + proj30(e), 0),
  };
}

export function evaluateTrade(
  yours: TradeEntry[],
  theirs: TradeEntry[],
  terms?: Partial<TradeTerms>,
): TradeVerdict | null {
  if (yours.length === 0 && theirs.length === 0) return null;
  const rate = Math.max(0.01, Math.min(1, terms?.tradeRate ?? 1));
  const yourCash = Math.max(0, terms?.yourCash ?? 0);
  const theirCash = Math.max(0, terms?.theirCash ?? 0);
  const reads = new Map<string, DealRead>();
  for (const e of [...yours, ...theirs]) {
    reads.set(e.key, classifyDeal(e.signal));
  }
  const y = sideFlags(yours, reads);
  const t = sideFlags(theirs, reads);
  const faceDelta = t.total - y.total;
  const facePct = y.total > 0 ? (faceDelta / y.total) * 100 : 0;
  const trajDelta = t.proj30 - y.proj30;
  // Trade-terms basis: incoming cards discounted at the vendor's rate,
  // cash at face on both sides.
  const theirCredit = t.total * rate;
  const theirEffective = theirCredit + theirCash;
  const yourEffective = y.total + yourCash;
  const tradeDelta = theirEffective - yourEffective;
  const tradePct = yourEffective > 0 ? (tradeDelta / yourEffective) * 100 : 0;
  const ratePct = Math.round(rate * 100);
  const rateLabel = rate >= 0.999 ? 'face value' : `${ratePct}% credit`;

  // Decay adjustment — a falling card counts at where it's headed, not
  // today's print. Offloading yours dodges real dollars of decay; taking
  // theirs imports it. This is why a falling-for-stable swap can be a
  // win even at a face deficit.
  const decayOf = (entries: TradeEntry[]) =>
    entries.reduce((n, e) => n + Math.max(0, e.price * e.qty - proj30(e)), 0);
  const decayAvoided = decayOf(y.falling);
  const decayTaken = decayOf(t.falling);
  const smartDelta = tradeDelta + decayAvoided - decayTaken;
  const smartPct = yourEffective > 0 ? (smartDelta / yourEffective) * 100 : 0;
  // Shielded ceiling — your rate applied to where their cards are GOING,
  // not today's face. Paying the flat-rate price for a free-faller is
  // overpaying even when it "looks good on paper".
  const recommendedMax = t.proj30 * rate + theirCash;

  const notes: string[] = [];

  // Offload bonus — shedding a falling card is worth more than face value.
  for (const e of y.falling) {
    const dodge = Math.max(0, e.price * e.qty - proj30(e));
    notes.push(`${e.name}: falling — moving it avoids ~$${dodge.toFixed(0)} of the drop`);
  }
  // Gift risk — a dip-buy or revival leaving your binder hands them
  // the recovery.
  for (const e of y.dipBuys) {
    notes.push(`${e.name}: dip buy — you'd hand them the recovery`);
  }
  for (const e of y.reviving) {
    notes.push(`${e.name}: waking up — you'd hand them the run`);
  }
  // Incoming free-fallers drag the trade down over the next month.
  for (const e of t.falling) {
    const hit = Math.max(0, e.price * e.qty - proj30(e));
    notes.push(`${e.name}: falling — expect ~$${hit.toFixed(0)} less in 30 days`);
  }
  // Second-wind timing — a revival coming IN is the move to catch.
  for (const e of t.reviving) {
    notes.push(`${e.name}: waking up — good timing to take it before the run`);
  }
  // Floor cards coming in — most of the downside already happened.
  // The parked verdict names a floor; a proxied resting card (fresh
  // low or low pctile, nothing resolved) is honestly "at a low"
  // (item 62 — a recent low is not support).
  for (const e of t.floors) {
    const onFloor = resolveRangeEvidence(e.signal).position === 'on-floor';
    notes.push(`${e.name}: ${onFloor ? 'at a floor' : 'at a low'} — downside looks mostly spent`);
  }
  // Floor-tested holds leaving your binder hand them the bounce.
  for (const e of y.floors) {
    const onFloor = resolveRangeEvidence(e.signal).position === 'on-floor';
    notes.push(
      `${e.name}: ${onFloor ? 'floor-tested hold' : 'resting-low hold'} — ` +
        `you'd hand them the bounce`,
    );
  }
  // Spent cards — yours are offload fuel, theirs only at a discount.
  for (const e of y.spent) {
    notes.push(`${e.name}: spent — flat forever; fine one to move`);
  }
  for (const e of t.spent) {
    notes.push(`${e.name}: spent — fine at a discount, don't pay for growth`);
  }
  // Topping incoming peaks — pay for where it's going, not the top.
  for (const e of theirs) {
    const r = reads.get(e.key);
    if (r?.cls === 'AT_PEAK' && r.peakState === 'topping') {
      notes.push(`${e.name}: rolling over at its high — it should be cheaper in a month`);
    }
  }
  // Data honesty — thin/stale reads mean price it yourself.
  for (const [side, entries] of [
    ['your', y.stale],
    ['their', t.stale],
  ] as const) {
    for (const e of entries) {
      notes.push(
        `${e.name}: thin or old data on ${side} side — ` + 'trust your own price over the tag',
      );
    }
  }
  // Concentration — heavy duplicates move slower than face value implies.
  for (const [side, entries] of [
    ['your', yours],
    ['their', theirs],
  ] as const) {
    const byProduct = new Map<number, number>();
    for (const e of entries) {
      if (e.productId == null) continue;
      byProduct.set(e.productId, (byProduct.get(e.productId) ?? 0) + e.qty);
    }
    for (const e of entries) {
      if (e.productId != null && (byProduct.get(e.productId) ?? 0) >= 3) {
        notes.push(
          `${e.name}: ${byProduct.get(e.productId)}× on ${side} side — ` + 'dupes move slower',
        );
        break;
      }
    }
  }

  // Verdict — judged on smartDelta: trade terms PLUS decay. A falling
  // card leaving your binder counts as avoided loss, so a slight face
  // deficit can still be a clear win.
  let verdict: TradeVerdict['verdict'];
  let headline: string;
  let counterSuggestion: string | null = null;
  const shortfall = Math.abs(smartDelta);

  if (smartPct <= -8 || (smartPct <= -4 && trajDelta <= -5)) {
    verdict = 'lose';
    headline = `Down $${Math.round(shortfall)} at ${rateLabel}`;
    // Counter: the extra FACE they need to add at your rate — or raw cash.
    if (smartPct <= -4) {
      const needFace = shortfall / rate;
      counterSuggestion =
        rate < 0.999
          ? `Need ~$${Math.round(needFace)} more in cards or ` + `$${Math.round(shortfall)} cash`
          : `Need ~$${Math.round(shortfall)} more to square it`;
    }
    // When incoming cards are falling, the more useful counter is the
    // shielded ceiling — the safe price for what you're giving.
    if (t.falling.length > 0 && recommendedMax < yourEffective - 0.5) {
      counterSuggestion =
        `Safe max ≈ $${Math.round(recommendedMax)} — ` +
        `you're offering $${Math.round(yourEffective)}` +
        (counterSuggestion ? `; ${counterSuggestion}` : '');
    }
    if (y.dipBuys.length > 0) {
      counterSuggestion =
        (counterSuggestion ? `${counterSuggestion}; ` : '') + `or pull ${y.dipBuys[0].name} out`;
    }
  } else if (smartPct >= 8 || (smartPct >= 4 && trajDelta >= 0) || trajDelta >= 5) {
    verdict = 'win';
    headline =
      decayAvoided > 0 || decayTaken > 0
        ? `+$${Math.round(smartDelta)} after the slide — the right ` + 'side of the move'
        : `+$${Math.round(smartDelta)} ahead at ${rateLabel}`;
  } else {
    // Qualitative upgrade — flat-or-better money that exits a falling
    // card into a non-falling side is a win on asset quality, even when
    // the dollar delta is near zero. The decay already netted out; what
    // remains is that you now hold the better card.
    const exitUpgrade =
      smartPct > -4 && y.falling.length > 0 && t.falling.length === 0 && trajDelta >= 0;
    if (exitUpgrade) {
      verdict = 'win';
      headline =
        trajDelta > 0
          ? 'Even money — out of a faller, into a riser'
          : 'Even money — out of a faller, into a steadier hold';
    } else {
      verdict = 'fair';
      headline =
        Math.abs(trajDelta) > Math.abs(smartDelta) + 2
          ? `Even at ${rateLabel} — trajectory favors ` + `${trajDelta >= 0 ? 'you' : 'them'}`
          : `Even at ${rateLabel}`;
      if (trajDelta < -4) {
        counterSuggestion = `Prices are moving their way — ask ~$${Math.round(Math.abs(trajDelta))} more`;
      }
    }
  }

  return {
    yourSide: y,
    theirSide: t,
    faceDelta,
    facePct,
    trajDelta,
    theirCredit,
    theirEffective,
    yourEffective,
    tradeDelta,
    tradePct,
    decayAvoided,
    decayTaken,
    smartDelta,
    smartPct,
    recommendedMax,
    ratePct,
    notes,
    verdict,
    headline,
    counterSuggestion,
  };
}
