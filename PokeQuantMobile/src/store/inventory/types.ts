// inventory/types — the card/sale shapes and the useInventoryStore
// contract shared by the facade and the action modules. Pure types;
// no runtime code lives here.

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

export type InventoryState = {
  inventory: InventoryCard[];
  activeInventory: InventoryCard[];
  completedSales: CompletedSale[];
  pendingSyncCount: number;
  isSyncing: boolean;
  syncFatalError: string | null;
};

export type InventoryActions = {
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

export type InventoryStore = InventoryState & InventoryActions;
