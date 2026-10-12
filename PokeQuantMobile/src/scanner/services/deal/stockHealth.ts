// Stock health — the portfolio-level read. Everything else in the deal
// engine answers "what about THIS card"; this answers "what about my
// WHOLE stock". Pure functions over held cards + their stamped signals
// (the same signalMap the list rows already use), so the panel is one
// synchronous pass — no extra queries, no series loads.
//
// Buckets come from rotationBucket(): grow = compounding, keep = fine
// where it is, watch = hold but it has a live trigger, rotate = money
// that belongs in better cards, dead = value but no motion.

import type { CardSignal } from '../../../db/catalogDb';
import {
  classifyDeal,
  rotationBucket,
  type DealRead,
  type RotationBucket,
} from './dealClassify';

/** Minimal held-card shape — InventoryCard satisfies this, tests pass
 *  plain objects. */
export type StockCard = {
  id: string;
  name: string;
  productId?: number | null;
  productType?: string;
  liveMarket: number;
  amountPaid: number;
  dateBought?: string;
};

export type StockHealthItem = {
  card: StockCard;
  read: DealRead;
  bucket: RotationBucket;
  /** Current market value — the dollars you'd recover/redeploy today. */
  value: number;
  /** What was paid — the cost basis the return is measured against. */
  cost: number;
  daysHeld: number | null;
  /** The concrete exit/entry trigger for the row — "exit < $5.00",
   *  "window ~$6.30", or null when the class carries no trigger. */
  trigger: string | null;
  /** Stamped floor evidence: price parked at-or-under the 90d floor —
   *  the "on thin ice" flag the deep features would confirm. */
  onFloor: boolean;
};

export type BucketStats = {
  count: number;
  value: number;
  cost: number;
};

export type StockHealth = {
  totalValue: number;
  totalCost: number;
  /** Share of held value with a stamped signal to classify. */
  coverage: number;
  buckets: Record<RotationBucket, BucketStats>;
  /** Cards to move first — rotate + dead, sorted by dollars locked. */
  rotateOut: StockHealthItem[];
  /** Everything classified, for the per-bucket drill-down. */
  items: StockHealthItem[];
  headline: string;
};

export const BUCKET_ORDER: RotationBucket[] = [
  'grow',
  'keep',
  'watch',
  'rotate',
  'dead',
];

export const BUCKET_LABEL: Record<RotationBucket, string> = {
  grow: 'Growers',
  keep: 'Keepers',
  watch: 'Watching',
  rotate: 'Rotate out',
  dead: 'Dead money',
};

const fmtMoney = (n: number): string =>
  n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`;

function daysHeldSince(since?: string): number | null {
  if (!since) return null;
  const t = new Date(since).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 86400000));
}

/** The trigger the row is waiting on — stamped-signal version of the
 *  sheet's floor/target lines (low90d/high90d stand in for the deep
 *  shelf read, which the list doesn't load). */
function triggerFor(read: DealRead, signal: CardSignal): string | null {
  const price = signal.price;
  if (price == null || price <= 0) return null;
  const onFloor =
    signal.low90d != null && price <= signal.low90d * 1.05;
  switch (read.cls) {
    case 'BASE_FORMING':
    case 'POST_SPIKE_BLEED':
    case 'FREE_FALL':
    case 'DIP_BUY':
    case 'DECLINER':
      if (signal.low90d != null) {
        return onFloor
          ? `exit below $${signal.low90d.toFixed(2)}`
          : `floor ~$${signal.low90d.toFixed(2)}`;
      }
      return null;
    case 'AT_PEAK':
      return read.peakState === 'intact'
        ? 'still strong — pick your window'
        : 'sell into strength now';
    default:
      return null;
  }
}

export function buildStockHealth(
  cards: StockCard[],
  signalFor: (card: StockCard) => CardSignal | undefined
): StockHealth {
  const buckets: Record<RotationBucket, BucketStats> = {
    grow: { count: 0, value: 0, cost: 0 },
    keep: { count: 0, value: 0, cost: 0 },
    watch: { count: 0, value: 0, cost: 0 },
    rotate: { count: 0, value: 0, cost: 0 },
    dead: { count: 0, value: 0, cost: 0 },
  };
  const items: StockHealthItem[] = [];
  let totalValue = 0;
  let totalCost = 0;
  let signaledValue = 0;

  for (const card of cards) {
    const value = Math.max(0, card.liveMarket || 0);
    const cost = Math.max(0, card.amountPaid || 0);
    totalValue += value;
    totalCost += cost;

    const signal = signalFor(card);
    if (!signal) continue;
    signaledValue += value;

    const read = classifyDeal(signal);
    const bucket = rotationBucket(read, signal);
    const item: StockHealthItem = {
      card,
      read,
      bucket,
      value,
      cost,
      daysHeld: daysHeldSince(card.dateBought),
      trigger: triggerFor(read, signal),
      onFloor:
        signal.low90d != null &&
        signal.price != null &&
        signal.price <= signal.low90d * 1.05,
    };
    items.push(item);
    buckets[bucket].count += 1;
    buckets[bucket].value += value;
    buckets[bucket].cost += cost;
  }

  const rotateOut = items
    .filter((i) => i.bucket === 'rotate' || i.bucket === 'dead')
    .sort((a, b) => b.value - a.value);

  const coverage = totalValue > 0 ? signaledValue / totalValue : 0;
  const headline = headlineFor(buckets, totalValue, coverage, rotateOut);

  return { totalValue, totalCost, coverage, buckets, rotateOut, items, headline };
}

function headlineFor(
  buckets: Record<RotationBucket, BucketStats>,
  totalValue: number,
  coverage: number,
  rotateOut: StockHealthItem[]
): string {
  if (totalValue <= 0 || coverage < 0.25) {
    return 'Catalog signals are thin — stock reads may be sparse.';
  }
  const growPct = buckets.grow.value / totalValue;
  const outPct = (buckets.rotate.value + buckets.dead.value) / totalValue;
  const outDollars = fmtMoney(buckets.rotate.value + buckets.dead.value);

  if (outPct >= 0.25 && rotateOut.length > 0) {
    return (
      `${Math.round(outPct * 100)}% of your stock's value is in ` +
      `bleeders or dead money — ${rotateOut.length} ` +
      `${rotateOut.length === 1 ? 'card' : 'cards'} (${outDollars}) ` +
      'to rotate out first.'
    );
  }
  if (growPct >= 0.55) {
    return (
      `Most of your money is in growers — ${Math.round(growPct * 100)}% ` +
      'of value is compounding or keeping pace.'
    );
  }
  return (
    `${fmtMoney(buckets.grow.value)} in growers, ${outDollars} to ` +
    'redeploy into better cards.'
  );
}
