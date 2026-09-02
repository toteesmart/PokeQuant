import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { generateId, initializeDatabase } from '../db/database';
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
import { pushPendingInventoryChanges, SyncFatalError } from '../api/cloudSync';
import { clearPendingSyncs, getPendingInventoryCount } from '../db/syncDb';
import { useAuth } from './AuthContext';
import { useVendorSettings } from './VendorSettingsContext';

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

const DEFAULT_INVENTORY: InventoryCard[] = [
  { id: '1', name: 'Blastoise ex CN 176', liveMarket: 12.34, amountPaid: 5.0, stickerPrice: 8.0, projProfit: 3.0, stock: 2 },
  { id: '2', name: 'Charizard ex OB 054', liveMarket: 25.5, amountPaid: 15.0, stickerPrice: 22.0, projProfit: 7.0, stock: 1 },
  { id: '3', name: 'Pikachu ex PA 094', liveMarket: 9.1, amountPaid: 4.5, stickerPrice: 7.0, projProfit: -0.5, stock: 3 },
  { id: '4', name: 'Venusaur ex CL 003', liveMarket: 6.75, amountPaid: 3.25, stickerPrice: 5.0, projProfit: 1.75, stock: 2 },
  { id: '5', name: 'Mewtwo ex GG 082', liveMarket: 18.2, amountPaid: 10.0, stickerPrice: 15.0, projProfit: 5.0, stock: 1 },
  { id: '6', name: 'Rayquaza V AA 145', liveMarket: 42.0, amountPaid: 30.0, stickerPrice: 38.0, projProfit: 8.0, stock: 1 },
  { id: '7', name: 'Gengar VMAX BD 157', liveMarket: 34.1, amountPaid: 20.0, stickerPrice: 28.0, projProfit: 8.0, stock: 2 },
  { id: '8', name: 'Lugia V AA 138', liveMarket: 55.0, amountPaid: 40.0, stickerPrice: 48.0, projProfit: 8.0, stock: 1 },
  { id: '9', name: 'Darkrai VSTAR AS 123', liveMarket: 11.4, amountPaid: 6.0, stickerPrice: 9.0, projProfit: 3.0, stock: 2 },
  { id: '10', name: 'Lucario V AA 071', liveMarket: 7.8, amountPaid: 4.0, stickerPrice: 6.5, projProfit: 2.5, stock: 3 },
  { id: '11', name: 'Eevee VMAX PR 017', liveMarket: 14.6, amountPaid: 9.0, stickerPrice: 12.0, projProfit: 3.0, stock: 1 },
  { id: '12', name: 'Zoroark VSTAR AR 120', liveMarket: 21.3, amountPaid: 14.0, stickerPrice: 18.0, projProfit: 4.0, stock: 2 },
  { id: '13', name: 'Giratina VSTAR LM 080', liveMarket: 48.0, amountPaid: 35.0, stickerPrice: 42.0, projProfit: 7.0, stock: 1 },
  { id: '14', name: 'Dialga VSTAR AS 112', liveMarket: 26.7, amountPaid: 18.0, stickerPrice: 23.0, projProfit: 5.0, stock: 1 },
  { id: '15', name: 'Palkia VSTAR AS 040', liveMarket: 24.5, amountPaid: 17.0, stickerPrice: 21.0, projProfit: 4.0, stock: 1 },
];

const DEFAULT_COMPLETED_SALES: CompletedSale[] = [
  {
    id: 'c1',
    name: 'eevee vmax',
    set: 'cn 114',
    number: '#N/A',
    condition: 'Unknown',
    acquiredCost: 5.54,
    soldPrice: 10.0,
    dateSold: '2026-09-01',
  },
];

type InventoryContextValue = {
  inventory: InventoryCard[];
  addInventoryCard: (card: InventoryInput) => void;
  removeInventoryCard: (id: string) => void;
  updateInventoryCard: (updates: InventoryUpdate) => void;
  sellInventoryCard: (id: string, soldPrice?: number) => void;
  clearInventory: () => void;
  completedSales: CompletedSale[];
  undoCompletedSale: (sale: CompletedSale) => void;
  pendingSyncCount: number;
  isSyncing: boolean;
  syncFatalError: string | null;
  triggerSync: () => Promise<void>;
  clearPendingSyncs: () => Promise<void>;
};

const InventoryContext = createContext<InventoryContextValue | null>(null);

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

export function InventoryProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth();
  const { getCashOffer, getStickerPrice } = useVendorSettings();
  const dbRef = useRef<import('expo-sqlite').SQLiteDatabase | null>(null);

  const [inventory, setInventory] = useState<InventoryCard[]>(DEFAULT_INVENTORY);
  const [completedSales, setCompletedSales] = useState<CompletedSale[]>(
    DEFAULT_COMPLETED_SALES
  );
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFatalError, setSyncFatalError] = useState<string | null>(null);

  const recalculatePendingCount = useCallback(async () => {
    if (!dbRef.current || !userId) return;
    try {
      const count = await getPendingInventoryCount(dbRef.current, userId);
      setPendingSyncCount(count);
    } catch (err) {
      console.error('Failed to recalculate pending sync count:', err);
    }
  }, [userId]);

  const triggerSync = useCallback(async () => {
    if (isSyncing || !dbRef.current || !userId) return;
    setIsSyncing(true);
    setSyncFatalError(null);
    try {
      await pushPendingInventoryChanges(dbRef.current, userId);
      await recalculatePendingCount();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unexpected sync failure';
      console.error('triggerSync failed:', message);
      if (err instanceof SyncFatalError) {
        setSyncFatalError(message);
      }
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, userId, recalculatePendingCount]);

  const clearPendingSyncsCallback = useCallback(async () => {
    if (!dbRef.current || !userId) return;
    setIsSyncing(true);
    try {
      await clearPendingSyncs(dbRef.current, userId);
      setSyncFatalError(null);
      await recalculatePendingCount();
    } catch (err) {
      console.error('clearPendingSyncs failed:', err);
    } finally {
      setIsSyncing(false);
    }
  }, [userId, recalculatePendingCount]);

  // Initialize the SQLite bridge and hydrate the in-memory inventory from the
  // local database. Falls back to the default demo set and seeds it when empty.
  useEffect(() => {
    if (!userId) return;

    let mounted = true;

    const hydrate = async () => {
      try {
        const { db: database } = await initializeDatabase();
        if (!mounted) return;
        dbRef.current = database;

        const active = await loadActiveInventory(database, userId);
        const completed = await loadCompletedSales(database, userId);

        if (active.length === 0) {
          await database.withTransactionAsync(async () => {
            for (const card of DEFAULT_INVENTORY) {
              await upsertInventoryItem(database, {
                id: card.id,
                userId,
                name: card.name,
                number: card.number,
                set: card.set,
                condition: card.condition,
                liveMarket: card.liveMarket,
                amountPaid: card.amountPaid,
                stickerPrice: card.stickerPrice,
                isBulk: card.isBulk ?? false,
              });
            }

            if (completed.length === 0) {
              for (const sale of DEFAULT_COMPLETED_SALES) {
                await upsertInventoryItem(database, {
                  id: sale.id,
                  userId,
                  name: sale.name,
                  number: sale.number,
                  set: sale.set,
                  condition: sale.condition,
                  liveMarket: sale.soldPrice,
                  amountPaid: sale.acquiredCost,
                  stickerPrice: sale.soldPrice,
                  isBulk: false,
                  isSold: true,
                  soldPrice: sale.soldPrice,
                  dateSold: sale.dateSold,
                  dateBought: sale.dateSold,
                });
              }
            }
          });

          const active2 = await loadActiveInventory(database, userId);
          const completed2 = await loadCompletedSales(database, userId);

          if (mounted) {
            setInventory(active2.map(toInventoryCard));
            setCompletedSales(completed2.map(toCompletedSale));
          }
        } else if (mounted) {
          setInventory(active.map(toInventoryCard));
          setCompletedSales(completed.map(toCompletedSale));
        }

        if (mounted) {
          await recalculatePendingCount();
        }
      } catch (err) {
        console.error('Inventory hydration failed:', err);
      }
    };

    hydrate();

    return () => {
      mounted = false;
    };
  }, [userId, recalculatePendingCount]);

  const addInventoryCard = useCallback(
    async (card: InventoryInput) => {
      const amountPaid =
        typeof card.amountPaid === 'number'
          ? card.amountPaid
          : getCashOffer(card.liveMarket);
      const rawSticker =
        typeof card.stickerPrice === 'number'
          ? card.stickerPrice
          : getStickerPrice(card.liveMarket);
      const stickerPrice = getStickerPrice(rawSticker);

      const newCard: InventoryCard = {
        ...card,
        id: generateId(),
        amountPaid,
        stickerPrice,
        projProfit: stickerPrice - amountPaid,
        stock: 1,
      };

      setInventory((prev) => [newCard, ...prev]);

      if (dbRef.current && userId) {
        try {
          await upsertInventoryItem(dbRef.current, {
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
    [getCashOffer, getStickerPrice, userId, recalculatePendingCount]
  );

  const removeInventoryCard = useCallback(
    async (id: string) => {
      setInventory((prev) => prev.filter((c) => c.id !== id));

      if (dbRef.current && userId) {
        try {
          await softDeleteInventoryItem(dbRef.current, id);
          await recalculatePendingCount();
        } catch (err) {
          console.error('removeInventoryItem failed:', err);
        }
      }
    },
    [userId, recalculatePendingCount]
  );

  const updateInventoryCard = useCallback(
    async (updates: InventoryUpdate) => {
      const existing = inventory.find((c) => c.id === updates.id);
      if (!existing) return;

      const name = updates.name ?? existing.name;
      const number = updates.number ?? existing.number;
      const set = updates.set ?? existing.set;
      const rarity = updates.rarity ?? existing.rarity;
      const productType = updates.productType ?? existing.productType;
      const condition = updates.condition ?? existing.condition;
      const imageUrl = updates.imageUrl ?? existing.imageUrl;
      const liveMarket = updates.liveMarket ?? existing.liveMarket;
      const amountPaid =
        typeof updates.amountPaid === 'number'
          ? updates.amountPaid
          : existing.amountPaid;
      const stickerPrice =
        typeof updates.stickerPrice === 'number'
          ? updates.stickerPrice
          : existing.stickerPrice;
      const isBulk = updates.isBulkDeal ?? existing.isBulk;

      const updated: InventoryCard = {
        ...existing,
        id: updates.id,
        name,
        number,
        set,
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

      setInventory((prev) =>
        prev.map((c) => (c.id === updates.id ? updated : c))
      );

      if (dbRef.current && userId) {
        try {
          await upsertInventoryItem(dbRef.current, {
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
            productId: updates.productId,
          });
          await recalculatePendingCount();
        } catch (err) {
          console.error('updateInventoryItem failed:', err);
        }
      }
    },
    [inventory, userId, recalculatePendingCount]
  );

  const sellInventoryCard = useCallback(
    async (id: string, soldPrice?: number) => {
      const card = inventory.find((c) => c.id === id);
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

      setInventory((prev) => prev.filter((c) => c.id !== id));
      setCompletedSales((prev) => [sale, ...prev]);

      if (dbRef.current && userId) {
        try {
          await markInventorySold(dbRef.current, id, price, sale.dateSold);
          await recalculatePendingCount();
        } catch (err) {
          console.error('markInventorySold failed:', err);
        }
      }
    },
    [inventory, userId, recalculatePendingCount]
  );

  const clearInventory = useCallback(() => {
    setInventory([]);
  }, []);

  const undoCompletedSale = useCallback(
    async (sale: CompletedSale) => {
      let persisted: PersistedInventory | null = null;
      if (dbRef.current && userId) {
        try {
          persisted = await getInventoryItem(dbRef.current, sale.id);
          await unmarkInventorySold(dbRef.current, sale.id);
          await recalculatePendingCount();
        } catch (err) {
          console.error('undoCompletedSale failed:', err);
        }
      }

      const stickerPrice =
        persisted?.stickerPrice ?? getStickerPrice(sale.soldPrice);
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

      setCompletedSales((prev) => prev.filter((s) => s.id !== sale.id));
      setInventory((prev) => [restored, ...prev]);
    },
    [getStickerPrice, userId, recalculatePendingCount]
  );

  const value = useMemo(
    () => ({
      inventory,
      addInventoryCard,
      removeInventoryCard,
      updateInventoryCard,
      sellInventoryCard,
      clearInventory,
      completedSales,
      undoCompletedSale,
      pendingSyncCount,
      isSyncing,
      syncFatalError,
      triggerSync,
      clearPendingSyncs: clearPendingSyncsCallback,
    }),
    [
      inventory,
      completedSales,
      addInventoryCard,
      removeInventoryCard,
      updateInventoryCard,
      sellInventoryCard,
      clearInventory,
      undoCompletedSale,
      pendingSyncCount,
      isSyncing,
      syncFatalError,
      triggerSync,
      clearPendingSyncsCallback,
    ]
  );

  return (
    <InventoryContext.Provider value={value}>
      {children}
    </InventoryContext.Provider>
  );
}

export function useInventory() {
  const context = useContext(InventoryContext);
  if (!context) {
    throw new Error('useInventory must be used within an InventoryProvider');
  }
  return context;
}
