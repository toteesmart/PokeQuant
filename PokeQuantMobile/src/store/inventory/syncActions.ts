// inventory/syncActions — the cloud-sync and account-lifecycle actions:
// load, manual sync (serialized through session.syncQueueTail), debounce
// scheduling, refresh, pending-count clear, wipe+resync, account delete.
// The inventoryStore facade wires createSyncActions(set, get).
import type { StoreApi } from 'zustand';
import {
  deleteCloudAccount,
  pullRemoteChanges,
  pushLocalChanges,
  SyncFatalError,
} from '../../api/cloudSync';
import { wipeLocalAccountData } from '../../db/database';
import { clearPendingSyncs } from '../../db/syncDb';
import { deleteVendorAccount } from '../../services/showVendorService';
import { toErrorMessage } from '../../utils/log';
import { AUTO_SYNC_DEBOUNCE_MS, getDb, inventorySession } from './session';
import { loadHydratedState, recalculatePendingCount } from './persistence';
import type { InventoryActions, InventoryStore } from './types';

type SetState = StoreApi<InventoryStore>['setState'];
type GetState = StoreApi<InventoryStore>['getState'];

export function createSyncActions(
  set: SetState,
  get: GetState
): Pick<
  InventoryActions,
  | 'loadForUser'
  | 'triggerSync'
  | 'scheduleSync'
  | 'refreshInventoryState'
  | 'clearPendingSyncs'
  | 'forceWipeAndResync'
  | 'deleteAccount'
> {
  return {
    loadForUser: async (userId) => {
      inventorySession.userId = userId;
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
        await recalculatePendingCount(set);
      } catch (err) {
        console.error('Inventory hydration failed:', err);
      }
    },

    triggerSync: async (overrideUserId, force = false) => {
      const target = overrideUserId ?? inventorySession.userId;
      if (!target) return;

      const run = async (): Promise<void> => {
        inventorySession.userId = target;

        const db = await getDb();
        if (!db) return;

        set({ isSyncing: true, syncFatalError: null });

        try {
          await pushLocalChanges(db, target);
          await pullRemoteChanges(db, target);

          set(await loadHydratedState(db, target));
          await recalculatePendingCount(set);
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

      const promise = inventorySession.syncQueueTail.then(run);
      inventorySession.syncQueueTail = promise.catch(() => {});
      return promise;
    },

    scheduleSync: () => {
      if (inventorySession.syncDebounceTimer) {
        clearTimeout(inventorySession.syncDebounceTimer);
      }
      inventorySession.syncDebounceTimer = setTimeout(() => {
        inventorySession.syncDebounceTimer = null;
        get().triggerSync();
      }, AUTO_SYNC_DEBOUNCE_MS);
    },

    refreshInventoryState: async () => {
      const db = inventorySession.db;
      const target = inventorySession.userId;
      if (!db || !target) return;

      try {
        set(await loadHydratedState(db, target));
        await recalculatePendingCount(set);
      } catch (err) {
        console.error('refreshInventoryState failed:', err);
      }
    },

    clearPendingSyncs: async () => {
      const db = inventorySession.db;
      const userId = inventorySession.userId;
      if (!db || !userId) return;

      set({ isSyncing: true });
      try {
        await clearPendingSyncs(db, userId);
        set({ syncFatalError: null });
        await recalculatePendingCount(set);
      } catch (err) {
        console.error('clearPendingSyncs failed:', err);
      } finally {
        set({ isSyncing: false });
      }
    },

    forceWipeAndResync: async () => {
      const db = inventorySession.db;
      const userId = inventorySession.userId;
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
      const db = inventorySession.db;
      const userId = inventorySession.userId;
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
  };
}
