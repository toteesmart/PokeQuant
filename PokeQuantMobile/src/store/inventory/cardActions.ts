// inventory/cardActions — the card CRUD actions: single add, scan-queue
// bulk add (with deal-grade recording), remove, update, sell, clear, and
// sale undo. The inventoryStore facade wires createCardActions(set, get).
import type { StoreApi } from 'zustand';
import { generateId } from '../../db/database';
import {
  getInventoryItem,
  markInventorySold,
  softDeleteInventoryItem,
  unmarkInventorySold,
  type PersistedInventory,
} from '../../db/inventoryDb';
import {
  getCardSignals,
  openCatalogDatabase,
  type CardSignal,
  type ProductMarketMap,
} from '../../db/catalogDb';
import { classifyDeal } from '../../scanner/services/deal/dealClassify';
import {
  recordDealGrades,
  type DealGradeInsert,
} from '../../scanner/services/deal/dealGradeDb';
import { useVendorStore } from '../vendorStore';
import { inventorySession } from './session';
import { persistCard, recalculatePendingCount } from './persistence';
import {
  buildVariantMap,
  derivePaidAndSticker,
  lookupMarketData,
  resolveCardMarket,
} from './pricing';
import type {
  CompletedSale,
  InventoryActions,
  InventoryCard,
  InventoryStore,
} from './types';

type SetState = StoreApi<InventoryStore>['setState'];
type GetState = StoreApi<InventoryStore>['getState'];

export function createCardActions(
  set: SetState,
  get: GetState
): Pick<
  InventoryActions,
  | 'addInventoryCard'
  | 'addScannedCards'
  | 'removeInventoryCard'
  | 'updateInventoryCard'
  | 'sellInventoryCard'
  | 'clearInventory'
  | 'undoCompletedSale'
> {
  return {
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

      const db = inventorySession.db;
      const userId = inventorySession.userId;
      if (db && userId) {
        try {
          await persistCard(db, userId, newCard, card.productId);
          await recalculatePendingCount(set);
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

      const db = inventorySession.db;
      const userId = inventorySession.userId;
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
          await recalculatePendingCount(set);
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

      const db = inventorySession.db;
      const userId = inventorySession.userId;
      if (db && userId) {
        try {
          await softDeleteInventoryItem(db, id);
          await recalculatePendingCount(set);
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

      const db = inventorySession.db;
      const userId = inventorySession.userId;
      if (db && userId) {
        try {
          await persistCard(
            db,
            userId,
            updated,
            updates.productId ?? existing.productId
          );
          await recalculatePendingCount(set);
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

      const db = inventorySession.db;
      const userId = inventorySession.userId;
      if (db && userId) {
        try {
          await markInventorySold(db, id, price, sale.dateSold);
          await recalculatePendingCount(set);
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
      const db = inventorySession.db;
      const userId = inventorySession.userId;

      if (db && userId) {
        try {
          persisted = await getInventoryItem(db, sale.id);
          await unmarkInventorySold(db, sale.id);
          await recalculatePendingCount(set);
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
  };
}
