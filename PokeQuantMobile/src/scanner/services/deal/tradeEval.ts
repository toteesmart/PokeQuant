import type { CardSignal } from '../../../db/catalogDb';
import type { ScanCatalogVariant } from '../../types/catalog';
import { classifyDeal } from './dealClassify';

// Two-sided trade fairness — face value lies when one side is falling and
// the other is compounding, so the verdict weighs where each side is
// *headed*, not just what it costs today. Port of quant.trade's logic to
// the stamped signal schema.

export type TradeEntry = {
  key: string; // unique row key (inventory id or `${productId}:${subType}`)
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
  falling: TradeEntry[]; // cards bleeding out right now
  dipBuys: TradeEntry[]; // dips inside uptrends
  total: number;
  proj30: number; // 30d-projected value of the side
};

export type TradeVerdict = {
  yourSide: SideFlags;
  theirSide: SideFlags;
  faceDelta: number; // theirTotal - yourTotal
  facePct: number; // delta as % of your side
  trajDelta: number; // 30d-projected delta (their proj - your proj)
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

function sideFlags(entries: TradeEntry[]): SideFlags {
  return {
    falling: entries.filter((e) => e.signal?.stance === 'falling'),
    dipBuys: entries.filter((e) => classifyDeal(e.signal).cls === 'DIP_BUY'),
    total: entries.reduce((n, e) => n + e.price * e.qty, 0),
    proj30: entries.reduce((n, e) => n + proj30(e), 0),
  };
}

export function evaluateTrade(
  yours: TradeEntry[],
  theirs: TradeEntry[]
): TradeVerdict | null {
  if (yours.length === 0 && theirs.length === 0) return null;
  const y = sideFlags(yours);
  const t = sideFlags(theirs);
  const faceDelta = t.total - y.total;
  const facePct = y.total > 0 ? (faceDelta / y.total) * 100 : 0;
  const trajDelta = t.proj30 - y.proj30;

  const notes: string[] = [];

  // Offload bonus — shedding a falling card is worth more than face value.
  for (const e of y.falling) {
    notes.push(
      `${e.name}: falling on your side — offloading it is a quiet bonus`
    );
  }
  // Gift risk — a dip-buy leaving your binder hands them the recovery.
  for (const e of y.dipBuys) {
    notes.push(
      `${e.name}: dip buy on YOUR side — you'd be gifting the recovery`
    );
  }
  // Incoming free-fallers drag the trade down over the next month.
  for (const e of t.falling) {
    notes.push(`${e.name}: falling on their side — worth less in 30 days`);
  }
  // Concentration — heavy duplicates move slower than face value implies.
  for (const [side, entries] of [
    ['your', yours],
    ['their', theirs],
  ] as const) {
    const byProduct = new Map<number, number>();
    for (const e of entries) {
      if (e.productId == null) continue;
      byProduct.set(
        e.productId,
        (byProduct.get(e.productId) ?? 0) + e.qty
      );
    }
    for (const e of entries) {
      if (
        e.productId != null &&
        (byProduct.get(e.productId) ?? 0) >= 3
      ) {
        notes.push(
          `${e.name}: ${byProduct.get(e.productId)}× on ${side} side — ` +
            'bulk duplicates move slower than face value'
        );
        break;
      }
    }
  }

  // Verdict — face within ±5% can still be a win or a loss on trajectory.
  let verdict: TradeVerdict['verdict'];
  let headline: string;
  let counterSuggestion: string | null = null;

  if (facePct <= -8 || (facePct <= -4 && trajDelta <= -5)) {
    verdict = 'lose';
    headline = `You're underwater $${Math.abs(faceDelta).toFixed(2)} on face`;
    // Counter: which of their cards gets it back to fair, or the cash gap.
    if (facePct <= -4) {
      counterSuggestion = `Ask ~$${Math.abs(faceDelta).toFixed(2)} more in ` +
        `cards or cash to square it`;
    }
    if (y.dipBuys.length > 0) {
      counterSuggestion =
        (counterSuggestion ? `${counterSuggestion}; ` : '') +
        `or pull ${y.dipBuys[0].name} out of the deal`;
    }
  } else if (facePct >= 8 || (facePct >= 4 && trajDelta >= 0) || trajDelta >= 5) {
    verdict = 'win';
    headline =
      trajDelta > faceDelta
        ? `+$${faceDelta.toFixed(2)} face, +$${trajDelta.toFixed(2)} ` +
          'projected — trading into the better assets'
        : `+$${faceDelta.toFixed(2)} ahead on face value`;
  } else {
    verdict = 'fair';
    headline =
      Math.abs(trajDelta) > Math.abs(faceDelta) + 2
        ? `Face is square — but trajectory favors ` +
          `${trajDelta >= 0 ? 'you' : 'them'} ~$${Math.abs(trajDelta).toFixed(0)}`
        : 'Square trade at face value';
    if (trajDelta < -4) {
      counterSuggestion =
        `Trajectory slightly favors them — ask ~$${Math.abs(trajDelta).toFixed(2)}` +
        ' more to cover the drift';
    }
  }

  return {
    yourSide: y,
    theirSide: t,
    faceDelta,
    facePct,
    trajDelta,
    notes,
    verdict,
    headline,
    counterSuggestion,
  };
}
