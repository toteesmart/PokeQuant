import { create } from 'zustand';
import type { SQLiteDatabase } from 'expo-sqlite';
import { generateId, initializeDatabase, wipeLocalAccountData } from '../db/database';
import {
  getInventoryItem,
  loadActiveInventory,
  loadCompletedSales,
  markInventorySold,
  softDeleteInventoryItem,
  unmarkInventorySold,
  upsertInventoryItem,
  type PersistedCompletedSale,
  type PersistedInventory,
} from '../db/inventoryDb';
import {
  getProductMarketData,
  openCatalogDatabase,
  type ProductMarketMap,
} from '../db/catalogDb';
import { getCatalogImageUri } from '../services/CatalogImageService';
import {
  deleteCloudAccount,
  pullRemoteChanges,
  pushLocalChanges,
  SyncFatalError,
} from '../api/cloudSync';
import { clearPendingSyncs, getPendingInventoryCount } from '../db/syncDb';
import { CATALOG_IMAGE_BASE, INVENTORY_IMAGE_BASE } from '../constants/api';
import { useVendorStore } from './vendorStore';

export type InventoryCard = {
  id: string;
  name: string;
  number?: string;
  set?: string;
  rarity?: string;
  productType?: string;
  condition?: string;
  liveMarket: number;
  amountPaid: number;
  stickerPrice: number;
  projProfit: number;
  stock: number;
  isBulk?: boolean;
  imageUrl?: string;
  productId?: number | null;
};

export type InventoryInput = {
  id?: string;
  name: string;
  number?: string;
  set?: string;
  rarity?: string;
  productType?: string;
  condition?: string;
  liveMarket: number;
  amountPaid?: number;
  stickerPrice?: number;
  isBulkDeal?: boolean;
  imageUrl?: string;
  productId?: number | null;
};

export type InventoryUpdate = {
  id: string;
} & Partial<InventoryInput>;

export type CompletedSale = {
  id: string;
  name: string;
  number?: string;
  set?: string;
  condition?: string;
  acquiredCost: number;
  soldPrice: number;
  dateSold: string;
};

type InventoryState = {
  inventory: InventoryCard[];
  activeInventory: InventoryCard[];
  completedSales: CompletedSale[];
  pendingSyncCount: number;
  isSyncing: boolean;
  syncFatalError: string | null;
};

type InventoryActions = {
  addInventoryCard: (card: InventoryInput) => Promise<void>;
  removeInventoryCard: (id: string) => Promise<void>;
  updateInventoryCard: (updates: InventoryUpdate) => Promise<void>;
  sellInventoryCard: (id: string, soldPrice?: number) => Promise<void>;
  clearInventory: () => void;
  undoCompletedSale: (sale: CompletedSale) => Promise<void>;
  triggerSync: (overrideUserId?: string, force?: boolean) => Promise<void>;
  refreshInventoryState: () => Promise<void>;
  clearPendingSyncs: () => Promise<void>;
  forceWipeAndResync: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  loadForUser: (userId: string | null) => Promise<void>;
};

let dbRef: SQLiteDatabase | null = null;
let currentUserId: string | null = null;

async function getDb(): Promise<SQLiteDatabase | null> {
  if (dbRef) return dbRef;
  try {
    const { db } = await initializeDatabase();
    dbRef = db;
    return db;
  } catch (err) {
    console.error('Failed to initialize SQLite for inventory:', err);
    return null;
  }
}

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

function buildInventoryImageUrl(
  imageUrl: string | undefined,
  productId: number | null | undefined,
  catalogImageUrl?: string
): string | undefined {
  const trimmed = imageUrl?.trim() ?? '';
  const isGeneratedCdn =
    trimmed.startsWith(INVENTORY_IMAGE_BASE) ||
    trimmed.startsWith(CATALOG_IMAGE_BASE);

  if (trimmed && !isGeneratedCdn) {
    if (trimmed.startsWith('http://')) {
      return trimmed.replace(/^http:\/\//, 'https://');
    }
    return trimmed;
  }

  if (catalogImageUrl) {
    return catalogImageUrl;
  }

  if (trimmed) {
    return trimmed;
  }

  if (productId == null || productId === 0) return undefined;
  return getCatalogImageUri(productId);
}

function buildVariantMap(cards: InventoryCard[]): Record<number, string> {
  const map: Record<number, string> = {};
  for (const card of cards) {
    if (card.productId == null) continue;
    if (map[card.productId] == null) {
      map[card.productId] = card.productType ?? card.rarity ?? 'Normal';
    }
  }
  return map;
}

async function hydrateCatalogPrices(
  cards: InventoryCard[]
): Promise<InventoryCard[]> {
  const productIds = [
    ...new Set(cards.map((c) => c.productId).filter((id): id is number => id != null)),
  ];
  if (productIds.length === 0) return cards;

  try {
    const catalog = await openCatalogDatabase();
    const data = await getProductMarketData(catalog, productIds, buildVariantMap(cards));

    const imageUrlMap: Record<number, string | undefined> = {};
    for (const productId of productIds) {
      imageUrlMap[productId] = getCatalogImageUri(productId);
    }

    return cards.map((card) => {
      if (card.productId == null) return card;
      const market = data[card.productId];
      const catalogImageUrl = imageUrlMap[card.productId];

      const getConditionedMarket = useVendorStore.getState().getConditionedMarket;

      const updates: Partial<InventoryCard> = {};
      if (market) {
        updates.liveMarket = getConditionedMarket(market.marketPrice, card.condition);
        updates.productType = market.matchedSubType;
      }
      updates.imageUrl = buildInventoryImageUrl(
        card.imageUrl,
        card.productId,
        catalogImageUrl
      );

      if (Object.keys(updates).length === 0) return card;
      return { ...card, ...updates };
    });
  } catch (err) {
    console.error('Failed to hydrate catalog prices:', err);
    return cards;
  }
}

async function recalculatePendingCount(): Promise<void> {
  const db = dbRef;
  const userId = currentUserId;
  if (!db || !userId) return;

  try {
    const count = await getPendingInventoryCount(db, userId);
    useInventoryStore.setState({ pendingSyncCount: count });
  } catch (err) {
    console.error('Failed to recalculate pending sync count:', err);
  }
}

export const useInventoryStore = create<InventoryState & InventoryActions>(
  (set, get) => ({
    inventory: [],
    activeInventory: [],
    completedSales: [],
    pendingSyncCount: 0,
    isSyncing: false,
    syncFatalError: null,

    loadForUser: async (userId) => {
      currentUserId = userId;

      if (!userId) {
        set({
          inventory: [],
          activeInventory: [],
          completedSales: [],
          pendingSyncCount: 0,
          syncFatalError: null,
        });
        return;
      }

      const db = await getDb();
      if (!db) return;

      try {
        const [active, completed] = await Promise.all([
          loadActiveInventory(db, userId),
          loadCompletedSales(db, userId),
        ]);

        const enriched = await hydrateCatalogPrices(active.map(toInventoryCard));

        set({
          inventory: enriched,
          activeInventory: enriched,
          completedSales: completed.map(toCompletedSale),
        });

        await recalculatePendingCount();
      } catch (err) {
        console.error('Inventory hydration failed:', err);
      }
    },

    triggerSync: async (overrideUserId, force = false) => {
      if (!force && get().isSyncing) return;

      const target = overrideUserId ?? currentUserId;
      if (!target) return;

      currentUserId = target;

      const db = await getDb();
      if (!db) return;

      set({ isSyncing: true, syncFatalError: null });

      try {
        await pushLocalChanges(db, target);
        await pullRemoteChanges(db, target);

        const [active, completed] = await Promise.all([
          loadActiveInventory(db, target),
          loadCompletedSales(db, target),
        ]);

        const enriched = await hydrateCatalogPrices(active.map(toInventoryCard));

        set({
          inventory: enriched,
          activeInventory: enriched,
          completedSales: completed.map(toCompletedSale),
        });

        await recalculatePendingCount();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unexpected sync failure';
        console.error('triggerSync failed:', message);
        if (err instanceof SyncFatalError) {
          set({ syncFatalError: message });
        }
      } finally {
        set({ isSyncing: false });
      }
    },

    refreshInventoryState: async () => {
      const db = dbRef;
      const target = currentUserId;
      if (!db || !target) return;

      try {
        const [active, completed] = await Promise.all([
          loadActiveInventory(db, target),
          loadCompletedSales(db, target),
        ]);

        const enriched = await hydrateCatalogPrices(active.map(toInventoryCard));

        set({
          inventory: enriched,
          activeInventory: enriched,
          completedSales: completed.map(toCompletedSale),
        });

        await recalculatePendingCount();
      } catch (err) {
        console.error('refreshInventoryState failed:', err);
      }
    },

    clearPendingSyncs: async () => {
      const db = dbRef;
      const userId = currentUserId;
      if (!db || !userId) return;

      set({ isSyncing: true });
      try {
        await clearPendingSyncs(db, userId);
        set({ syncFatalError: null });
        await recalculatePendingCount();
      } catch (err) {
        console.error('clearPendingSyncs failed:', err);
      } finally {
        set({ isSyncing: false });
      }
    },

    forceWipeAndResync: async () => {
      const db = dbRef;
      const userId = currentUserId;
      if (!db || !userId) return;

      set({ isSyncing: true, syncFatalError: null });
      try {
        await db.withTransactionAsync(async () => {
          await db.runAsync('DELETE FROM inventory');
          await db.runAsync(
            'UPDATE sync_metadata SET last_updated = 0 WHERE user_id = ?',
            userId
          );
        });
        await get().triggerSync(undefined, true);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unexpected wipe/resync failure';
        console.error('forceWipeAndResync failed:', message);
        if (err instanceof SyncFatalError) {
          set({ syncFatalError: message });
        }
      } finally {
        set({ isSyncing: false });
      }
    },

    deleteAccount: async () => {
      const db = dbRef;
      const userId = currentUserId;
      if (!db || !userId) return;

      set({ isSyncing: true, syncFatalError: null });
      try {
        await deleteCloudAccount(userId);
        await wipeLocalAccountData(db, userId);
        set({
          inventory: [],
          activeInventory: [],
          completedSales: [],
          pendingSyncCount: 0,
          syncFatalError: null,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Account deletion failed';
        console.error('deleteAccount failed:', message);
        throw new Error(message);
      } finally {
        set({ isSyncing: false });
      }
    },

    addInventoryCard: async (card) => {
      const getCashOffer = useVendorStore.getState().getCashOffer;
      const getStickerPrice = useVendorStore.getState().getStickerPrice;
      const getConditionedMarket = useVendorStore.getState().getConditionedMarket;

      let liveMarket = card.liveMarket;
      let productType = card.productType;
      let imageUrl = card.imageUrl;

      if (card.productId != null) {
        try {
          const catalog = await openCatalogDatabase();
          const data = await getProductMarketData(catalog, [card.productId], {
            [card.productId]: card.productType ?? card.rarity ?? 'Normal',
          });
          const catalogImageUrl = getCatalogImageUri(card.productId);
          const market = data[card.productId];
          if (market) {
            liveMarket = getConditionedMarket(market.marketPrice, card.condition);
            productType = market.matchedSubType;
          }
          imageUrl = buildInventoryImageUrl(imageUrl, card.productId, catalogImageUrl);
        } catch (err) {
          console.error('Catalog price lookup failed:', err);
        }
      }

      const amountPaid =
        typeof card.amountPaid === 'number'
          ? card.amountPaid
          : getCashOffer(liveMarket);
      const rawSticker =
        typeof card.stickerPrice === 'number'
          ? card.stickerPrice
          : getStickerPrice(liveMarket);
      const stickerPrice = getStickerPrice(rawSticker);

      const newCard: InventoryCard = {
        ...card,
        id: card.id ?? generateId(),
        rarity: productType ?? card.rarity,
        productType,
        imageUrl,
        liveMarket,
        amountPaid,
        stickerPrice,
        projProfit: stickerPrice - amountPaid,
        stock: 1,
      };

      set((state) => ({
        inventory: [newCard, ...state.inventory],
        activeInventory: [newCard, ...state.activeInventory],
      }));

      const db = dbRef;
      const userId = currentUserId;
      if (db && userId) {
        try {
          await upsertInventoryItem(db, {
            id: newCard.id,
            userId,
            name: newCard.name,
            number: newCard.number,
            set: newCard.set,
            rarity: newCard.rarity,
            productType: newCard.productType,
            condition: newCard.condition,
            liveMarket: newCard.liveMarket,
            amountPaid: newCard.amountPaid,
            stickerPrice: newCard.stickerPrice,
            isBulk: newCard.isBulk ?? false,
            imageUrl: newCard.imageUrl,
            productId: card.productId ?? null,
          });
          await recalculatePendingCount();
        } catch (err) {
          console.error('addInventoryItem failed:', err);
        }
      }
    },

    removeInventoryCard: async (id) => {
      set((state) => ({
        inventory: state.inventory.filter((c) => c.id !== id),
        activeInventory: state.activeInventory.filter((c) => c.id !== id),
      }));

      const db = dbRef;
      const userId = currentUserId;
      if (db && userId) {
        try {
          await softDeleteInventoryItem(db, id);
          await recalculatePendingCount();
        } catch (err) {
          console.error('removeInventoryItem failed:', err);
        }
      }
    },

    updateInventoryCard: async (updates) => {
      const getConditionedMarket = useVendorStore.getState().getConditionedMarket;

      const existing = get().inventory.find((c) => c.id === updates.id);
      if (!existing) return;

      const name = updates.name ?? existing.name;
      const number = updates.number ?? existing.number;
      const cardSetName = updates.set ?? existing.set;
      const rarity = updates.rarity ?? existing.rarity;
      const condition = updates.condition ?? existing.condition;
      let imageUrl = updates.imageUrl ?? existing.imageUrl;
      const amountPaid =
        typeof updates.amountPaid === 'number'
          ? updates.amountPaid
          : existing.amountPaid;
      const stickerPrice =
        typeof updates.stickerPrice === 'number'
          ? updates.stickerPrice
          : existing.stickerPrice;
      const isBulk = updates.isBulkDeal ?? existing.isBulk;

      let liveMarket = updates.liveMarket ?? existing.liveMarket;
      let productType = updates.productType ?? existing.productType;

      if (existing.productId != null) {
        try {
          const catalog = await openCatalogDatabase();
          const data = await getProductMarketData(catalog, [existing.productId], {
            [existing.productId]:
              updates.productType ??
              updates.rarity ??
              existing.productType ??
              existing.rarity ??
              'Normal',
          });
          const catalogImageUrl = getCatalogImageUri(existing.productId);
          const market = data[existing.productId];
          if (market) {
            liveMarket = getConditionedMarket(market.marketPrice, condition);
            productType = market.matchedSubType;
          }
          imageUrl = buildInventoryImageUrl(imageUrl, existing.productId, catalogImageUrl);
        } catch (err) {
          console.error('Catalog price recompute failed:', err);
        }
      }

      const updated: InventoryCard = {
        ...existing,
        id: updates.id,
        name,
        number,
        set: cardSetName,
        rarity,
        productType,
        condition,
        imageUrl,
        liveMarket,
        amountPaid,
        stickerPrice,
        isBulk,
        projProfit: stickerPrice - amountPaid,
      };

      set((state) => ({
        inventory: state.inventory.map((c) => (c.id === updates.id ? updated : c)),
        activeInventory: state.activeInventory.map((c) =>
          c.id === updates.id ? updated : c
        ),
      }));

      const db = dbRef;
      const userId = currentUserId;
      if (db && userId) {
        try {
          await upsertInventoryItem(db, {
            id: updated.id,
            userId,
            name: updated.name,
            number: updated.number,
            set: updated.set,
            rarity: updated.rarity,
            productType: updated.productType,
            condition: updated.condition,
            liveMarket: updated.liveMarket,
            amountPaid: updated.amountPaid,
            stickerPrice: updated.stickerPrice,
            isBulk: updated.isBulk ?? false,
            imageUrl: updated.imageUrl,
            productId: updates.productId ?? existing.productId,
          });
          await recalculatePendingCount();
        } catch (err) {
          console.error('updateInventoryItem failed:', err);
        }
      }
    },

    sellInventoryCard: async (id, soldPrice) => {
      const getStickerPrice = useVendorStore.getState().getStickerPrice;

      const card = get().inventory.find((c) => c.id === id);
      if (!card) return;

      const price = soldPrice ?? card.stickerPrice;
      const sale: CompletedSale = {
        id: card.id,
        name: card.name,
        number: card.number,
        set: card.set,
        condition: card.condition,
        acquiredCost: card.amountPaid,
        soldPrice: price,
        dateSold: new Date().toISOString(),
      };

      set((state) => ({
        inventory: state.inventory.filter((c) => c.id !== id),
        activeInventory: state.activeInventory.filter((c) => c.id !== id),
        completedSales: [sale, ...state.completedSales],
      }));

      const db = dbRef;
      const userId = currentUserId;
      if (db && userId) {
        try {
          await markInventorySold(db, id, price, sale.dateSold);
          await recalculatePendingCount();
        } catch (err) {
          console.error('markInventorySold failed:', err);
        }
      }
    },

    clearInventory: () =>
      set({
        inventory: [],
        activeInventory: [],
      }),

    undoCompletedSale: async (sale) => {
      const getStickerPrice = useVendorStore.getState().getStickerPrice;

      let persisted: PersistedInventory | null = null;
      const db = dbRef;
      const userId = currentUserId;

      if (db && userId) {
        try {
          persisted = await getInventoryItem(db, sale.id);
          await unmarkInventorySold(db, sale.id);
          await recalculatePendingCount();
        } catch (err) {
          console.error('undoCompletedSale failed:', err);
        }
      }

      const stickerPrice = persisted?.stickerPrice ?? getStickerPrice(sale.soldPrice);
      const liveMarket = persisted?.liveMarket ?? sale.soldPrice;

      const restored: InventoryCard = {
        id: sale.id,
        name: sale.name,
        number: sale.number,
        set: sale.set,
        condition: sale.condition,
        liveMarket,
        amountPaid: sale.acquiredCost,
        stickerPrice,
        projProfit: stickerPrice - sale.acquiredCost,
        stock: 1,
        isBulk: persisted?.isBulk ?? false,
        imageUrl: persisted?.imageUrl,
      };

      set((state) => ({
        completedSales: state.completedSales.filter((s) => s.id !== sale.id),
        inventory: [restored, ...state.inventory],
        activeInventory: [restored, ...state.activeInventory],
      }));
    },
  })
);
