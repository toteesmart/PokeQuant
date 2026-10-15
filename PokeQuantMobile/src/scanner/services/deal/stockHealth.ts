// Stock health — the portfolio-level read. Everything else in the deal
// engine answers "what about THIS card"; this answers "what about my
// WHOLE stock". Pure functions over held cards + their stamped signals
// (the same signalMap the list rows already use), so the panel is one
// synchronous pass — no extra queries, no series loads.
//
// Buckets come from rotationBucket(): grow = compounding, keep = fine
// where it is, watch = hold but it has a live trigger, rotate = money
// that belongs in better cards, dead = value but no motion.

import { colors } from '../../../constants/colors';
import type { CardSignal } from '../../../db/catalogDb';
import type { SeriesFeatures } from './seriesSignals';
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
  grow: 'Rising',
  keep: 'Keepers',
  watch: 'Watch',
  rotate: 'Sell first',
  dead: 'Dead money',
};

/** One-line gloss per bucket — the names alone don't say what keeps a
 *  card out of the rotate list. */
export const BUCKET_DESC: Record<RotationBucket, string> = {
  grow: 'going up on its own',
  keep: 'fine where it is',
  watch: 'holding — sells if it drops',
  rotate: 'swap for better cards',
  dead: 'worth money, not moving',
};

/** Token color per bucket — legend bars, ring segments, row tags all
 *  read from the same map so a bucket can't drift to two hues. */
export const BUCKET_COLOR: Record<RotationBucket, string> = {
  grow: colors.velocityPositive,
  keep: colors.primary,
  watch: colors.warning,
  rotate: colors.velocityNegative,
  dead: colors.textMuted,
};

const fmtMoney = (n: number): string =>
  n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`;

function daysHeldSince(since?: string): number | null {
  if (!since) return null;
  const t = new Date(since).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 86400000));
}

/** The trigger the row is waiting on — same floor priority as the
 *  analysis sheet (deep shelf → stamped shelf → 90d low), so the
 *  health row and the sheet name the same exit zone, not two
 *  different numbers for the same card. */
function triggerFor(
  read: DealRead,
  signal: CardSignal,
  features?: SeriesFeatures
): string | null {
  const price = signal.price;
  if (price == null || price <= 0) return null;
  // Same floor resolution order as PositionSection — a deep shelf the
  // sheet quotes as the crack line is the same shelf the row waits on.
  const floorPrice =
    features?.floorPrice ?? signal.shelfPrice ?? signal.low90d ?? null;
  // Same crack convention the sheet uses: a resolved zone (series
  // floor or deep shelf) gets a 3% margin before it's "broken"; the
  // stamped 90d low is the low itself — under it is broken flat.
  const zoneFloor =
    (features?.floorPrice ?? signal.shelfPrice ?? null) != null;
  const crackPrice =
    floorPrice != null && zoneFloor ? floorPrice * 0.97 : floorPrice;
  // "On" the floor is the zone — under the crack line the exit
  // already fired and the row should say so, not show a pending stop.
  const onFloor =
    floorPrice != null &&
    price >= floorPrice * 0.97 &&
    price <= floorPrice * 1.05;
  switch (read.cls) {
    case 'BASE_FORMING':
    case 'POST_SPIKE_BLEED':
    case 'FREE_FALL':
    case 'DIP_BUY':
    case 'DECLINER':
      if (floorPrice != null) {
        return crackPrice != null && price < crackPrice
          ? `under ~$${floorPrice.toFixed(2)} — floor already broke`
          : onFloor
            ? `sell if it drops below $${floorPrice.toFixed(2)}`
            : `floor ~$${floorPrice.toFixed(2)}`;
      }
      return null;
    case 'AT_PEAK':
      return read.peakState === 'intact'
        ? 'still strong — sell when you want'
        : 'sell now while buyers are paying';
    case 'RANGE_PLAY': {
      // A cycler's triggers: sell the ceiling at the top, exit under
      // the floor everywhere else — the range break kills the play.
      // Stamped deep stats carry the same levels on the scalar path.
      const ceiling =
        features?.sellIntoPrice ??
        features?.targetPrice ??
        signal.targetPrice ??
        null;
      if (read.variant === 'exit') {
        return ceiling != null
          ? `near the top of its range — sell around ~$${ceiling.toFixed(2)}`
          : 'near the top of its range — sell now';
      }
      const floor =
        features?.floorPrice ?? signal.shelfPrice ?? signal.low90d;
      // Same crack figure the sheet's SELL UNDER row prints — a zone
      // floor's margin, a stamped low's own level.
      return floor != null && crackPrice != null
        ? `sell if it drops below ~$${crackPrice.toFixed(2)}`
        : null;
    }
    default:
      return null;
  }
}

export function buildStockHealth(
  cards: StockCard[],
  signalFor: (card: StockCard) => CardSignal | undefined,
  /** Same deep read the analysis sheet uses — when the held cards'
   *  price_series is hydrated, floor/bounce features upgrade the
   *  scalar stamps into the full curve read. */
  featuresFor?: (card: StockCard) => SeriesFeatures | undefined
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

    const features = featuresFor?.(card);
    const read = classifyDeal(signal, features);
    const bucket = rotationBucket(read, signal, features);
    const item: StockHealthItem = {
      card,
      read,
      bucket,
      value,
      cost,
      daysHeld: daysHeldSince(card.dateBought),
      trigger: triggerFor(read, signal, features),
      onFloor: (() => {
        // Same floor the trigger names — a deep/stamped shelf counts
        // as thin ice, not just the 90d low.
        const fl =
          features?.floorPrice ?? signal.shelfPrice ?? signal.low90d;
        return (
          fl != null &&
          signal.price != null &&
          signal.price >= fl * 0.97 &&
          signal.price <= fl * 1.05
        );
      })(),
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
    return "We don't have much sales data yet — these reads are rough.";
  }
  const growPct = buckets.grow.value / totalValue;
  const outPct = (buckets.rotate.value + buckets.dead.value) / totalValue;
  const outDollars = fmtMoney(buckets.rotate.value + buckets.dead.value);

  if (outPct >= 0.25 && rotateOut.length > 0) {
    return (
      `${Math.round(outPct * 100)}% of your stock's value is in cards ` +
      `losing value or not moving — sell these ${rotateOut.length} ` +
      `${rotateOut.length === 1 ? 'card' : 'cards'} (${outDollars}) first.`
    );
  }
  if (growPct >= 0.55) {
    return (
      `Most of your money is in cards going up — ` +
      `${Math.round(growPct * 100)}% of your stock's value.`
    );
  }
  return (
    `${fmtMoney(buckets.grow.value)} in rising cards, ${outDollars} to ` +
    'move into better ones.'
  );
}
