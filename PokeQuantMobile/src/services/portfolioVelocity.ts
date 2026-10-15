// Portfolio velocity — the dollar-weighted market move of the held
// stock over 1d/3d/1w windows, plus the top mover cards per window.
// Pure builder over ProductMarketMap so the screen's numbers and any
// future surface compute identically.
import type { ProductMarketMap } from '../db/catalogDb';
import type { InventoryCard } from '../store/inventoryStore';
export type Mover = {
  name: string;
  number: string;
  set: string;
  rarity: string;
  condition: string;
  productId?: number;
  oldPrice: number;
  newPrice: number;
};

export type Period = '1d' | '3d' | '1w';

export type VelocityWindow = {
  label: string;
  change: number;
  movers: Mover[];
};

export type ProductVelocity = {
  price1d: number;
  price3d: number;
  price7d: number;
};

export const DEFAULT_VELOCITY: Record<Period, VelocityWindow> = {
  '1d': { label: 'Today', change: 0, movers: [] },
  '3d': { label: '3 days', change: 0, movers: [] },
  '1w': { label: 'This week', change: 0, movers: [] },
};

export const VELOCITY_PERIODS: Period[] = ['1d', '3d', '1w'];

export const VELOCITY_PILL_TABS: readonly {
  key: Period;
  label: string;
}[] = [
  { key: '1d', label: 'Today' },
  { key: '3d', label: '3 days' },
  { key: '1w', label: 'This week' },
];

const VELOCITY_DELTA_KEY: Record<Period, keyof ProductVelocity> = {
  '1d': 'price1d',
  '3d': 'price3d',
  '1w': 'price7d',
};

const VELOCITY_LABEL: Record<Period, string> = {
  '1d': 'Today',
  '3d': '3 days',
  '1w': 'This week',
};

export function buildVelocityWindows(
  map: ProductMarketMap,
  activeInventory: InventoryCard[],
  getConditionedMarket: (price: number, condition?: string) => number
): Record<Period, VelocityWindow> {
  type Aggregate = {
    stock: number;
    liveSum: number;
    count: number;
    representative: InventoryCard;
  };

  const productMap = new Map<number, Aggregate>();
  for (const card of activeInventory) {
    if (card.productId == null) continue;
    const existing = productMap.get(card.productId);
    if (existing) {
      existing.stock += card.stock;
      existing.liveSum += card.liveMarket;
      existing.count += 1;
    } else {
      productMap.set(card.productId, {
        stock: card.stock,
        liveSum: card.liveMarket,
        count: 1,
        representative: card,
      });
    }
  }

  const windows = { ...DEFAULT_VELOCITY } as Record<Period, VelocityWindow>;

  for (const period of VELOCITY_PERIODS) {
    const key = VELOCITY_DELTA_KEY[period];
    let totalChange = 0;
    const movers: Mover[] = [];

    for (const [productId, aggregate] of productMap) {
      const productData = map[productId];
      if (!productData) continue;

      const condition = aggregate.representative.condition ?? 'NM';
      const liveMarket = getConditionedMarket(productData.marketPrice, condition);
      const pastPrice = getConditionedMarket(productData[key], condition);
      const delta = liveMarket - pastPrice;
      totalChange += delta * aggregate.stock;

      const { representative } = aggregate;
      movers.push({
        name: representative.name,
        number: representative.number ?? '',
        set: representative.set ?? '',
        rarity: representative.productType ?? representative.rarity ?? '',
        condition: representative.condition ?? 'NM',
        productId: representative.productId ?? undefined,
        oldPrice: pastPrice,
        newPrice: liveMarket,
      });
    }

    movers.sort(
      (a, b) =>
        Math.abs(b.newPrice - b.oldPrice) - Math.abs(a.newPrice - a.oldPrice)
    );

    windows[period] = {
      label: VELOCITY_LABEL[period],
      change: totalChange,
      movers: movers.slice(0, 20),
    };
  }

  return windows;
}
