// inventoryStore — the useInventoryStore facade: the zustand create()
// call and the public import path live here. Implementation is split
// across store/inventory/: types.ts (contract), session.ts (shared db /
// user / sync-queue slots), pricing.ts (catalog price + image
// resolution), persistence.ts (tenant-DB mapping, hydration, recount),
// syncActions.ts + cardActions.ts (the action bodies). Consumers keep
// importing './inventoryStore' — the re-exports below preserve the
// public surface.
import { create } from 'zustand';
import { createSyncActions } from './inventory/syncActions';
import { createCardActions } from './inventory/cardActions';
import type { InventoryStore } from './inventory/types';

export type {
  CompletedSale,
  InventoryCard,
  InventoryInput,
} from './inventory/types';
export { buildInventoryImageUrl } from './inventory/pricing';

export const useInventoryStore = create<InventoryStore>((set, get) => ({
  inventory: [],
  activeInventory: [],
  completedSales: [],
  pendingSyncCount: 0,
  isSyncing: false,
  syncFatalError: null,

  ...createSyncActions(set, get),
  ...createCardActions(set, get),
}));
