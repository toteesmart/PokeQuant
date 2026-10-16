// inventory/persistence — the tenant-DB side of the store: persisted-row
// ↔ card mapping, the shared load pipeline (rows → cards → live-price /
// image hydration), the card write-through, and the post-mutation
// pending-sync recount every mutation ends with.
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  loadActiveInventory,
  loadCompletedSales,
  upsertInventoryItem,
  type PersistedCompletedSale,
  type PersistedInventory,
} from '../../db/inventoryDb';
import { getPendingInventoryCount } from '../../db/syncDb';
import { inventorySession } from './session';
import {
  buildVariantMap,
  lookupMarketData,
  resolveCardMarket,
} from './pricing';
import type { CompletedSale, InventoryCard, InventoryState } from './types';

function toInventoryCard(item: PersistedInventory): InventoryCard {
  return {
    ...item,
    projProfit: item.stickerPrice - item.amountPaid,
    stock: 1,
  };
}

function toCompletedSale(sale: PersistedCompletedSale): CompletedSale {
  return { ...sale };
}

async function hydrateCatalogPrices(
  cards: InventoryCard[]
): Promise<InventoryCard[]> {
  const productIds = [
    ...new Set(cards.map((c) => c.productId).filter((id): id is number => id != null)),
  ];
  if (productIds.length === 0) return cards;

  try {
    const { marketMap, imageUrlMap } = await lookupMarketData(
      productIds,
      buildVariantMap(cards)
    );

    return cards.map((card) => {
      if (card.productId == null) return card;
      const resolved = resolveCardMarket(
        card,
        marketMap[card.productId],
        imageUrlMap[card.productId]
      );
      return { ...card, ...resolved };
    });
  } catch (err) {
    console.error('Failed to hydrate catalog prices:', err);
    return cards;
  }
}

export async function recalculatePendingCount(
  set: (partial: Partial<InventoryState>) => void
): Promise<void> {
  const db = inventorySession.db;
  const userId = inventorySession.userId;
  if (!db || !userId) return;

  try {
    const count = await getPendingInventoryCount(db, userId);
    set({ pendingSyncCount: count });
  } catch (err) {
    console.error('Failed to recalculate pending sync count:', err);
  }
}

// Every load/sync/refresh ends in the same reload: persisted rows → cards →
// live-price/image hydration. One name so a future hydration step lands in
// all three call sites at once.
export async function loadHydratedState(
  db: SQLiteDatabase,
  userId: string
): Promise<
  Pick<InventoryState, 'inventory' | 'activeInventory' | 'completedSales'>
> {
  const [active, completed] = await Promise.all([
    loadActiveInventory(db, userId),
    loadCompletedSales(db, userId),
  ]);
  const enriched = await hydrateCatalogPrices(active.map(toInventoryCard));
  return {
    inventory: enriched,
    activeInventory: enriched,
    completedSales: completed.map(toCompletedSale),
  };
}

export function persistCard(
  db: SQLiteDatabase,
  userId: string,
  card: InventoryCard,
  productId: number | null | undefined
) {
  return upsertInventoryItem(db, {
    id: card.id,
    userId,
    name: card.name,
    number: card.number,
    set: card.set,
    rarity: card.rarity,
    productType: card.productType,
    condition: card.condition,
    liveMarket: card.liveMarket,
    amountPaid: card.amountPaid,
    stickerPrice: card.stickerPrice,
    isBulk: card.isBulk ?? false,
    imageUrl: card.imageUrl,
    productId: productId ?? null,
  });
}
