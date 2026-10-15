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
  getCardSignals,
  getProductMarketData,
  openCatalogDatabase,
  type CardSignal,
  type ProductMarketData,
  type ProductMarketMap,
} from '../db/catalogDb';
import { classifyDeal } from '../scanner/services/deal/dealClassify';
import {
  recordDealGrades,
  type DealGradeInsert,
} from '../scanner/services/deal/dealGradeDb';
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
import { deleteVendorAccount } from '../services/showVendorService';
import { toErrorMessage } from '../utils/log';

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
  dateBought?: string;
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

type InventoryUpdate = {
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
  addScannedCards: (cards: InventoryInput[]) => Promise<void>;
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
  scheduleSync: () => void;
};

let dbRef: SQLiteDatabase | null = null;
let currentUserId: string | null = null;
let syncQueueTail: Promise<void> = Promise.resolve();
let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const AUTO_SYNC_DEBOUNCE_MS = 1500;

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

export function buildInventoryImageUrl(
  imageUrl: string | undefined,
  productId: number | null | undefined,
  catalogImageUrl?: string
): string | undefined {
  const trimmed = imageUrl?.trim() ?? '';
  // file:// URLs point to a catalog-image cache on a specific device/install
  // and are not portable across phones or rebuilds, so treat them like the
  // generated CDN URLs and re-derive an image from productId instead.
  const isReproducibleUrl =
    trimmed.startsWith(INVENTORY_IMAGE_BASE) ||
    trimmed.startsWith(CATALOG_IMAGE_BASE) ||
    trimmed.startsWith('file://');

  if (trimmed && !isReproducibleUrl) {
    if (trimmed.startsWith('http://')) {
      return trimmed.replace(/^http:\/\//, 'https://');
    }
    return trimmed;
  }

  if (catalogImageUrl) {
    return catalogImageUrl;
  }

  if (trimmed && productId != null && productId !== 0) {
    return getCatalogImageUri(productId) ?? trimmed;
  }

  if (productId == null || productId === 0) return undefined;
  return getCatalogImageUri(productId);
}

function buildVariantMap(
  cards: {
    productId?: number | null;
    productType?: string;
    rarity?: string;
  }[]
): Record<number, string> {
  const map: Record<number, string> = {};
  for (const card of cards) {
    if (card.productId == null) continue;
    if (map[card.productId] == null) {
      map[card.productId] = card.productType ?? card.rarity ?? 'Normal';
    }
  }
  return map;
}

async function lookupMarketData(
  productIds: number[],
  variantMap: Record<number, string>
): Promise<{
  marketMap: ProductMarketMap;
  imageUrlMap: Record<number, string | undefined>;
}> {
  const catalog = await openCatalogDatabase();
  const marketMap = await getProductMarketData(catalog, productIds, variantMap);
  const imageUrlMap: Record<number, string | undefined> = {};
  for (const productId of productIds) {
    imageUrlMap[productId] = getCatalogImageUri(productId);
  }
  return { marketMap, imageUrlMap };
}

// Resolves a card's pricing triple against its catalog match. The image URL
// rebuilds whenever a productId exists — even on a price miss — so rows
// always upgrade from file:// leftovers to the local/CDN image.
function resolveCardMarket(
  card: {
    productId?: number | null;
    condition?: string;
    liveMarket: number;
    productType?: string;
    imageUrl?: string;
  },
  market: ProductMarketData | undefined,
  catalogImageUrl: string | undefined
): {
  liveMarket: number;
  productType: string | undefined;
  imageUrl: string | undefined;
} {
  const { getConditionedMarket } = useVendorStore.getState();
  return {
    liveMarket: market
      ? getConditionedMarket(market.marketPrice, card.condition)
      : card.liveMarket,
    productType: market ? market.matchedSubType : card.productType,
    imageUrl: buildInventoryImageUrl(
      card.imageUrl,
      card.productId,
      catalogImageUrl
    ),
  };
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

// Every load/sync/refresh ends in the same reload: persisted rows → cards →
// live-price/image hydration. One name so a future hydration step lands in
// all three call sites at once.
async function loadHydratedState(
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

// Cash-offer / sticker derivation shared by single and bulk adds.
// getStickerPrice runs even on explicit stickers — the rounding rules apply
// to vendor-entered prices too.
function derivePaidAndSticker(
  liveMarket: number,
  amountPaid: number | undefined,
  stickerPrice: number | undefined
): { amountPaid: number; stickerPrice: number } {
  const { getCashOffer, getStickerPrice } = useVendorStore.getState();
  const paid =
    typeof amountPaid === 'number'
      ? amountPaid
      : Math.round(getCashOffer(liveMarket));
  const rawSticker =
    typeof stickerPrice === 'number'
      ? stickerPrice
      : getStickerPrice(liveMarket);
  return { amountPaid: paid, stickerPrice: getStickerPrice(rawSticker) };
}

function persistCard(
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
      set({ syncFatalError: null });

      if (!userId) {
        set({
          inventory: [],
          activeInventory: [],
          completedSales: [],
          pendingSyncCount: 0,
        });
        return;
      }

      const db = await getDb();
      if (!db) return;

      try {
        set(await loadHydratedState(db, userId));
        await recalculatePendingCount();
      } catch (err) {
        console.error('Inventory hydration failed:', err);
      }
    },

    triggerSync: async (overrideUserId, force = false) => {
      const target = overrideUserId ?? currentUserId;
      if (!target) return;

      const run = async (): Promise<void> => {
        currentUserId = target;

        const db = await getDb();
        if (!db) return;

        set({ isSyncing: true, syncFatalError: null });

        try {
          await pushLocalChanges(db, target);
          await pullRemoteChanges(db, target);

          set(await loadHydratedState(db, target));
          await recalculatePendingCount();
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Unexpected sync failure';
          console.error('triggerSync failed:', message);
          if (err instanceof SyncFatalError) {
            set({ syncFatalError: toErrorMessage(err) });
          }
        } finally {
          set({ isSyncing: false });
        }
      };

      const promise = syncQueueTail.then(run);
      syncQueueTail = promise.catch(() => {});
      return promise;
    },

    scheduleSync: () => {
      if (syncDebounceTimer) {
        clearTimeout(syncDebounceTimer);
      }
      syncDebounceTimer = setTimeout(() => {
        syncDebounceTimer = null;
        get().triggerSync();
      }, AUTO_SYNC_DEBOUNCE_MS);
    },

    refreshInventoryState: async () => {
      const db = dbRef;
      const target = currentUserId;
      if (!db || !target) return;

      try {
        set(await loadHydratedState(db, target));
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
          await db.runAsync('DELETE FROM inventory WHERE user_id = ?', userId);
          await db.runAsync(
            'UPDATE sync_metadata SET last_updated = 0, last_pushed_local_updated_at = 0 WHERE user_id = ?',
            userId
          );
        });
        await get().triggerSync(undefined, true);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unexpected wipe/resync failure';
        console.error('forceWipeAndResync failed:', message);
        if (err instanceof SyncFatalError) {
          set({ syncFatalError: toErrorMessage(err) });
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
        // Delete the show-vendor profile, public listings, team data, and the
        // Supabase auth user before we wipe local/cloud data.
        await deleteVendorAccount();
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
        throw new Error(toErrorMessage(err));
      } finally {
        set({ isSyncing: false });
      }
    },

    addInventoryCard: async (card) => {
      let resolved = {
        liveMarket: card.liveMarket,
        productType: card.productType,
        imageUrl: card.imageUrl,
      };

      if (card.productId != null) {
        try {
          const { marketMap, imageUrlMap } = await lookupMarketData(
            [card.productId],
            { [card.productId]: card.productType ?? card.rarity ?? 'Normal' }
          );
          resolved = resolveCardMarket(
            card,
            marketMap[card.productId],
            imageUrlMap[card.productId]
          );
        } catch (err) {
          console.error('Catalog price lookup failed:', err);
        }
      }

      const { liveMarket, productType, imageUrl } = resolved;
      const { amountPaid, stickerPrice } = derivePaidAndSticker(
        liveMarket,
        card.amountPaid,
        card.stickerPrice
      );

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
        // Input carries isBulkDeal; the stored field is isBulk — without this
        // the AddAssetForm bulk toggle silently dropped to false on every add.
        isBulk: card.isBulkDeal ?? false,
      };

      set((state) => ({
        inventory: [newCard, ...state.inventory],
        activeInventory: [newCard, ...state.activeInventory],
      }));

      const db = dbRef;
      const userId = currentUserId;
      if (db && userId) {
        try {
          await persistCard(db, userId, newCard, card.productId);
          await recalculatePendingCount();
        } catch (err) {
          console.error('addInventoryItem failed:', err);
        }
      }
    },

    // Bulk path for the scan queue — one catalog lookup for all productIds
    // and one state update, otherwise identical to addInventoryCard.
    addScannedCards: async (cards) => {
      if (cards.length === 0) return;

      const productIds = [
        ...new Set(
          cards.map((c) => c.productId).filter((id): id is number => id != null)
        ),
      ];
      let marketMap: ProductMarketMap = {};
      let signalMap: Record<number, Record<string, CardSignal>> = {};
      let imageUrlMap: Record<number, string | undefined> = {};
      if (productIds.length > 0) {
        try {
          const catalog = await openCatalogDatabase();
          [{ marketMap, imageUrlMap }, signalMap] = await Promise.all([
            lookupMarketData(productIds, buildVariantMap(cards)),
            getCardSignals(catalog, productIds),
          ]);
        } catch (err) {
          console.error('Scanned card price lookup failed:', err);
        }
      }

      const signalById = new Map<string, CardSignal | undefined>();
      const newCards: InventoryCard[] = cards.map((card) => {
        const resolved =
          card.productId != null
            ? resolveCardMarket(
                card,
                marketMap[card.productId],
                imageUrlMap[card.productId]
              )
            : {
                liveMarket: card.liveMarket,
                productType: card.productType,
                imageUrl: card.imageUrl,
              };
        const { liveMarket, productType, imageUrl } = resolved;

        const { amountPaid, stickerPrice } = derivePaidAndSticker(
          liveMarket,
          card.amountPaid,
          card.stickerPrice
        );

        const id = card.id ?? generateId();
        // The stamped engine signal for the resolved print finish — drives
        // the deal grade recorded alongside the inventory write.
        signalById.set(
          id,
          card.productId != null
            ? signalMap[card.productId]?.[productType ?? ''] ??
                signalMap[card.productId]?.[card.productType ?? '']
            : undefined
        );

        return {
          ...card,
          id,
          rarity: productType ?? card.rarity,
          productType,
          imageUrl,
          liveMarket,
          amountPaid,
          stickerPrice,
          projProfit: stickerPrice - amountPaid,
          stock: 1,
          isBulk: card.isBulkDeal ?? false,
        };
      });

      set((state) => ({
        inventory: [...newCards, ...state.inventory],
        activeInventory: [...newCards, ...state.activeInventory],
      }));

      const db = dbRef;
      const userId = currentUserId;
      if (db && userId) {
        try {
          for (const newCard of newCards) {
            await persistCard(db, userId, newCard, newCard.productId);
          }
          const gradeRows: DealGradeInsert[] = newCards.map((c) => {
            const sig = signalById.get(c.id);
            const read = classifyDeal(sig);
            return {
              inventoryId: c.id,
              userId,
              productId: c.productId ?? null,
              subType: c.productType ?? null,
              offerGiven: c.amountPaid ?? null,
              signal: sig,
              cls: read.cls,
              risk: read.risk,
            };
          });
          await recordDealGrades(db, gradeRows);
          await recalculatePendingCount();
        } catch (err) {
          console.error('addScannedCards failed:', err);
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
          const { marketMap, imageUrlMap } = await lookupMarketData(
            [existing.productId],
            {
              [existing.productId]:
                updates.productType ??
                updates.rarity ??
                existing.productType ??
                existing.rarity ??
                'Normal',
            }
          );
          const resolved = resolveCardMarket(
            { ...existing, condition, liveMarket, productType, imageUrl },
            marketMap[existing.productId],
            imageUrlMap[existing.productId]
          );
          liveMarket = resolved.liveMarket;
          productType = resolved.productType;
          imageUrl = resolved.imageUrl;
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
          await persistCard(
            db,
            userId,
            updated,
            updates.productId ?? existing.productId
          );
          await recalculatePendingCount();
        } catch (err) {
          console.error('updateInventoryItem failed:', err);
        }
      }
    },

    sellInventoryCard: async (id, soldPrice) => {
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
