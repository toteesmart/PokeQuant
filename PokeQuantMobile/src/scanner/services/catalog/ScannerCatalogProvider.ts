import {
  getLatestSubTypePricesForProducts,
  normalizeSubType,
  openCatalogDatabase,
  resolveVariantPrice,
} from '../../../db/catalogDb';
import { getCatalogImageUri } from '../../../services/CatalogImageService';
import { precomputeCatalogCache } from './catalogMatcher';
import type { ScanCatalogCard } from '../../types/catalog';

export type CardRow = {
  product_id: number;
  card_name: string;
  card_number: string | null;
  set_name: string | null;
  rarity: string | null;
};

export type PriceRow = {
  product_id: number;
  sub_type: string;
  market_price: number;
  date: string;
};

// Pure row mapping, exported for tests. variants[0] holds the canonical
// display variant (Normal -> holofoil -> lowest positive), matching what
// getProductMarketData would resolve for the default variant.
export function mapRowsToCards(cardRows: CardRow[], priceRows: PriceRow[]): ScanCatalogCard[] {
  const pricesByProduct = new Map<number, Record<string, { marketPrice: number; date: string }>>();
  for (const row of priceRows) {
    let record = pricesByProduct.get(row.product_id);
    if (!record) {
      record = {};
      pricesByProduct.set(row.product_id, record);
    }
    record[row.sub_type] = { marketPrice: Number(row.market_price) || 0, date: row.date };
  }

  return cardRows.map((row) => {
    const { marketPrice, matchedSubType, date } = resolveVariantPrice(
      pricesByProduct.get(row.product_id) ?? {},
      'Normal'
    );
    return {
      productId: row.product_id,
      name: row.card_name,
      number: row.card_number ?? '',
      set: row.set_name ?? '',
      rarity: row.rarity,
      imageUrl: getCatalogImageUri(row.product_id) ?? '',
      variants: [{ subType: matchedSubType, marketPrice, date }],
    };
  });
}

// The production catalog DB (pokequant_catalog.db) replaces the standalone
// app's bundled full_catalog.json: same shape, sourced from `cards` plus the
// latest price_history row per subtype.
let cachedCatalog: ScanCatalogCard[] | null = null;
let catalogPromise: Promise<ScanCatalogCard[]> | null = null;

async function buildScannerCatalog(): Promise<ScanCatalogCard[]> {
  const db = await openCatalogDatabase();

  const cardRows = await db.getAllAsync<CardRow>(
    'SELECT product_id, card_name, card_number, set_name, rarity FROM cards'
  );

  // Prices are hydrated lazily per candidate by hydrateVariantPrices — a
  // GROUP BY over the entire price_history table here costs seconds on
  // device while only ~30 candidates ever need a display price. Inventory
  // writes re-resolve through getProductMarketData regardless.
  return mapRowsToCards(cardRows, []);
}

// Hydrates every latest subType price (Normal / Holofoil / Reverse Holofoil /
// promos) for a small set of matched candidates — the review sheet needs them
// all so the user can pick the physical finish. Mutates each card's variants
// in place; cards are shared catalog singletons so callers see prices
// immediately. variants[0] stays the Normal-resolved default.
export async function hydrateVariantPrices(
  cards: ScanCatalogCard[]
): Promise<void> {
  const pending = cards.filter((c) => !(c.variants[0]?.marketPrice > 0));
  if (pending.length === 0) return;

  const db = await openCatalogDatabase();
  const prices = await getLatestSubTypePricesForProducts(
    db,
    pending.map((c) => c.productId)
  );

  for (const card of pending) {
    const subTypePrices = prices[card.productId] ?? {};
    const resolved = resolveVariantPrice(subTypePrices, 'Normal');
    const resolvedCanonical = normalizeSubType(resolved.matchedSubType);
    card.variants = [
      ...(resolved.matchedSubType
        ? [
            {
              subType: resolved.matchedSubType,
              marketPrice: resolved.marketPrice,
              date: resolved.date,
            },
          ]
        : []),
      ...Object.entries(subTypePrices)
        .filter(([s]) => normalizeSubType(s) !== resolvedCanonical)
        .sort((a, b) => b[1].marketPrice - a[1].marketPrice)
        .map(([subType, p]) => ({
          subType,
          marketPrice: p.marketPrice,
          date: p.date,
        })),
    ];
  }
}

export async function loadScannerCatalog(): Promise<ScanCatalogCard[]> {
  if (cachedCatalog) return cachedCatalog;
  if (!catalogPromise) {
    catalogPromise = buildScannerCatalog()
      .then((cards) => {
        precomputeCatalogCache(cards);
        cachedCatalog = cards;
        return cards;
      })
      .catch((err) => {
        // Allow retry on the next scan after a transient failure.
        catalogPromise = null;
        throw err;
      });
  }
  return catalogPromise;
}
