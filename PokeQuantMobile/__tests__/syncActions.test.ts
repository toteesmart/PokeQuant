import type { SQLiteDatabase } from 'expo-sqlite';
import {
  deleteCloudAccount,
  pullRemoteChanges,
  pushLocalChanges,
  SyncFatalError,
} from '../src/api/cloudSync';
import { wipeLocalAccountData } from '../src/db/database';
import {
  loadActiveInventory,
  loadCompletedSales,
  type PersistedCompletedSale,
  type PersistedInventory,
} from '../src/db/inventoryDb';
import { setLastPush, setLastSync } from '../src/db/syncDb';
import { deleteVendorAccount } from '../src/services/showVendorService';
import { lookupMarketData } from '../src/store/inventory/pricing';
import { AUTO_SYNC_DEBOUNCE_MS, inventorySession } from '../src/store/inventory/session';
import { useInventoryStore } from '../src/store/inventoryStore';
import { useVendorStore } from '../src/store/vendorStore';
import * as logModule from '../src/utils/log';
import { deferred, tick } from './helpers/async';
import { mkInventoryCard } from './helpers/builders';
import { FakeSQLite } from './helpers/fakeSqlite';

// syncActions characterization pins — the store actions run for real
// against FakeSQLite (syncDb stays real: pending-count and watermark
// bookkeeping is the behavior under test). Only the true seams are cut:
// cloudSync's network calls, the Drizzle row loaders, the catalog price
// lookup, the local-account wipe, and the vendor account delete.
// SyncFatalError must stay REAL — triggerSync flags the store via
// instanceof. No React, no act(), no fake timers.

jest.mock('../src/api/cloudSync', () => {
  const actual = jest.requireActual<typeof import('../src/api/cloudSync')>('../src/api/cloudSync');
  return {
    ...actual,
    pushLocalChanges: jest.fn(),
    pullRemoteChanges: jest.fn(),
    deleteCloudAccount: jest.fn(),
  };
});

jest.mock('../src/db/inventoryDb', () => {
  const actual =
    jest.requireActual<typeof import('../src/db/inventoryDb')>('../src/db/inventoryDb');
  return { ...actual, loadActiveInventory: jest.fn(), loadCompletedSales: jest.fn() };
});

jest.mock('../src/store/inventory/pricing', () => {
  const actual = jest.requireActual<typeof import('../src/store/inventory/pricing')>(
    '../src/store/inventory/pricing',
  );
  return { ...actual, lookupMarketData: jest.fn() };
});

jest.mock('../src/db/database', () => {
  const actual = jest.requireActual<typeof import('../src/db/database')>('../src/db/database');
  // initializeDatabase stays real — the getDb() null path relies on it
  // failing under jest (openDatabaseAsync is absent from the setup mock).
  return { ...actual, wipeLocalAccountData: jest.fn() };
});

jest.mock('../src/services/showVendorService', () => {
  const actual = jest.requireActual<typeof import('../src/services/showVendorService')>(
    '../src/services/showVendorService',
  );
  return { ...actual, deleteVendorAccount: jest.fn() };
});

const mockPush = jest.mocked(pushLocalChanges);
const mockPull = jest.mocked(pullRemoteChanges);
const mockDeleteCloud = jest.mocked(deleteCloudAccount);
const mockLoadActive = jest.mocked(loadActiveInventory);
const mockLoadCompleted = jest.mocked(loadCompletedSales);
const mockLookup = jest.mocked(lookupMarketData);
const mockWipe = jest.mocked(wipeLocalAccountData);
const mockDeleteVendor = jest.mocked(deleteVendorAccount);

const errSpy = jest.spyOn(logModule, 'logError').mockImplementation(() => {});
const toErrorMessage = logModule.toErrorMessage;

const store = () => useInventoryStore.getState();
const order = (fn: jest.Mock) => fn.mock.invocationCallOrder[0];

let db: FakeSQLite;

// The pending recount reads the watermark then COUNT(*); find the COUNT
// call's position in the global invocation order.
const countReadOrder = () => {
  const idx = db.getFirstAsync.mock.calls.findIndex(([sql]) => String(sql).includes('COUNT(*)'));
  return idx === -1 ? -1 : db.getFirstAsync.mock.invocationCallOrder[idx];
};

const mkPersisted = (over: Partial<PersistedInventory> = {}): PersistedInventory => ({
  id: 'p1',
  name: 'Pikachu',
  liveMarket: 10,
  amountPaid: 5,
  stickerPrice: 12,
  isBulk: false,
  productId: null,
  ...over,
});

const mkSale = (over: Partial<PersistedCompletedSale> = {}): PersistedCompletedSale => ({
  id: 's1',
  name: 'Pikachu',
  acquiredCost: 5,
  soldPrice: 9,
  dateSold: '2026-01-02',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  db = new FakeSQLite();
  inventorySession.db = db as unknown as SQLiteDatabase;
  inventorySession.userId = 'u1';
  inventorySession.syncQueueTail = Promise.resolve();
  if (inventorySession.syncDebounceTimer) {
    clearTimeout(inventorySession.syncDebounceTimer);
    inventorySession.syncDebounceTimer = null;
  }
  useInventoryStore.setState({
    inventory: [],
    activeInventory: [],
    completedSales: [],
    pendingSyncCount: 0,
    isSyncing: false,
    syncFatalError: null,
  });
  mockPush.mockResolvedValue(0);
  mockPull.mockResolvedValue(0);
  mockLoadActive.mockResolvedValue([]);
  mockLoadCompleted.mockResolvedValue([]);
  mockLookup.mockResolvedValue({ marketMap: {}, imageUrlMap: {} });
  mockDeleteVendor.mockResolvedValue(undefined);
  mockDeleteCloud.mockResolvedValue(undefined);
  mockWipe.mockResolvedValue(undefined);
});

afterAll(() => {
  inventorySession.db = null;
  inventorySession.userId = null;
  inventorySession.syncQueueTail = Promise.resolve();
});

test('triggerSync pushes, pulls, reloads and recounts in that order', async () => {
  await store().triggerSync();

  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush.mock.calls[0][0]).toBe(db);
  expect(mockPush.mock.calls[0][1]).toBe('u1');
  expect(mockPull).toHaveBeenCalledTimes(1);
  expect(mockPull.mock.calls[0][0]).toBe(db);
  expect(mockPull.mock.calls[0][1]).toBe('u1');

  expect(order(mockPush)).toBeLessThan(order(mockPull));
  expect(order(mockPull)).toBeLessThan(order(mockLoadActive));
  expect(order(mockLoadActive)).toBeLessThan(countReadOrder());

  expect(store().isSyncing).toBe(false);
  expect(store().syncFatalError).toBeNull();
});

test('isSyncing is true while the push is in flight', async () => {
  const gate = deferred<number>();
  mockPush.mockImplementationOnce(() => gate.promise);

  const p = store().triggerSync();
  await tick();

  expect(store().isSyncing).toBe(true);
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPull).not.toHaveBeenCalled();

  gate.resolve(0);
  await p;

  expect(store().isSyncing).toBe(false);
  expect(mockPull).toHaveBeenCalledTimes(1);
});

test('a push failure is swallowed: pull never runs, no fatal flag', async () => {
  mockPush.mockRejectedValueOnce(new Error('boom'));

  await store().triggerSync();

  expect(mockPull).not.toHaveBeenCalled();
  expect(mockLoadActive).not.toHaveBeenCalled();
  expect(store().isSyncing).toBe(false);
  expect(store().syncFatalError).toBeNull();
  expect(errSpy).toHaveBeenCalledWith('triggerSync failed:', 'boom');
});

test('a SyncFatalError flags the store; the next healthy run clears it', async () => {
  const fatal = new SyncFatalError('constraint failed: inventory.id');
  mockPull.mockRejectedValueOnce(fatal);

  await store().triggerSync();

  expect(store().syncFatalError).toBe(toErrorMessage(fatal));
  expect(store().syncFatalError).not.toBeNull();
  expect(mockLoadActive).not.toHaveBeenCalled();
  expect(store().isSyncing).toBe(false);

  await store().triggerSync();

  expect(store().syncFatalError).toBeNull();
});

test('no user is a no-op; an override id stamps the session user', async () => {
  inventorySession.userId = null;

  await store().triggerSync();
  expect(mockPush).not.toHaveBeenCalled();
  expect(mockPull).not.toHaveBeenCalled();
  expect(store().isSyncing).toBe(false);

  await store().triggerSync('u2');
  expect(inventorySession.userId).toBe('u2');
  expect(mockPush.mock.calls[0][0]).toBe(db);
  expect(mockPush.mock.calls[0][1]).toBe('u2');
});

test('no obtainable db handle exits before touching isSyncing', async () => {
  inventorySession.db = null;

  await store().triggerSync();

  expect(mockPush).not.toHaveBeenCalled();
  expect(store().isSyncing).toBe(false);
  expect(errSpy).toHaveBeenCalledWith(
    'Failed to initialize SQLite for inventory:',
    expect.anything(),
  );
});

test('concurrent triggerSync calls serialize through syncQueueTail', async () => {
  const gate = deferred<number>();
  mockPush.mockImplementationOnce(() => gate.promise);

  const p1 = store().triggerSync();
  const p2 = store().triggerSync();
  await tick();

  // The second run parks behind the first — only one push so far.
  expect(mockPush).toHaveBeenCalledTimes(1);

  gate.resolve(0);
  await p1;
  await tick();

  expect(mockPush).toHaveBeenCalledTimes(2);
  await p2;
});

test('a failed run does not poison the queue', async () => {
  mockPush.mockRejectedValueOnce(new Error('boom'));

  await store().triggerSync();
  await store().triggerSync();

  expect(mockPush).toHaveBeenCalledTimes(2);
  expect(mockPull).toHaveBeenCalledTimes(1);
});

test('the pending count follows the push watermark', async () => {
  db.inventory = [
    { user_id: 'u1', id: 'a', updated_at: 100 },
    { user_id: 'u1', id: 'b', updated_at: 200 },
  ];
  useInventoryStore.setState({ pendingSyncCount: 2 });

  // Mocked push resolves without touching the watermark → still 2 pending.
  await store().triggerSync();
  expect(store().pendingSyncCount).toBe(2);

  // A push that advances the real watermark drains the count.
  mockPush.mockImplementationOnce(async (d, userId) => {
    await setLastPush(d, userId, 200);
    return 2;
  });
  await store().triggerSync();
  expect(store().pendingSyncCount).toBe(0);
});

test('hydrated rows land in inventory/activeInventory/completedSales', async () => {
  mockLoadActive.mockResolvedValueOnce([mkPersisted({ amountPaid: 5, stickerPrice: 12 })]);
  mockLoadCompleted.mockResolvedValueOnce([mkSale()]);

  await store().triggerSync();

  expect(store().inventory[0].projProfit).toBe(7);
  expect(store().inventory[0].stock).toBe(1);
  expect(store().activeInventory).toBe(store().inventory);
  expect(store().completedSales).toEqual([mkSale()]);
});

test('hydration merges catalog market data when a productId is present', async () => {
  mockLoadActive.mockResolvedValueOnce([
    mkPersisted({ productId: 42, condition: 'NM', productType: 'Normal', liveMarket: 1 }),
  ]);
  mockLookup.mockResolvedValueOnce({
    marketMap: { 42: { marketPrice: 20, matchedSubType: 'Holofoil' } },
    imageUrlMap: { 42: 'file:///mock/img/42.jpg' },
  } as unknown as Awaited<ReturnType<typeof lookupMarketData>>);

  await store().triggerSync();

  expect(mockLookup).toHaveBeenCalledWith([42], { 42: 'Normal' });
  const card = store().inventory[0];
  expect(card.productType).toBe('Holofoil');
  expect(card.imageUrl).toBe('file:///mock/img/42.jpg');
  expect(card.liveMarket).toBe(useVendorStore.getState().getConditionedMarket(20, 'NM'));
});

test('loadForUser(null) clears inventory state and stamps the session', async () => {
  useInventoryStore.setState({
    inventory: [mkInventoryCard()],
    activeInventory: [mkInventoryCard()],
    completedSales: [mkSale()],
    pendingSyncCount: 3,
    syncFatalError: 'old',
  });

  await store().loadForUser(null);

  expect(inventorySession.userId).toBeNull();
  expect(store().inventory).toEqual([]);
  expect(store().activeInventory).toEqual([]);
  expect(store().completedSales).toEqual([]);
  expect(store().pendingSyncCount).toBe(0);
  expect(store().syncFatalError).toBeNull();
  expect(mockLoadActive).not.toHaveBeenCalled();
});

test('loadForUser(id) hydrates + recounts; a hydration failure is logged, state untouched', async () => {
  db.inventory = [
    { user_id: 'u1', id: 'a', updated_at: 100 },
    { user_id: 'u1', id: 'b', updated_at: 200 },
  ];

  await store().loadForUser('u1');

  expect(mockLoadActive.mock.calls[0][0]).toBe(db);
  expect(mockLoadActive.mock.calls[0][1]).toBe('u1');
  expect(store().pendingSyncCount).toBe(2);
  expect(inventorySession.userId).toBe('u1');

  mockLoadActive.mockRejectedValueOnce('rows gone');
  useInventoryStore.setState({ pendingSyncCount: 7 });

  await store().loadForUser('u1');

  expect(errSpy).toHaveBeenCalledWith('Inventory hydration failed:', 'rows gone');
  expect(store().pendingSyncCount).toBe(7);
});

test('refreshInventoryState reloads + recounts without syncing; no session is a no-op', async () => {
  await store().refreshInventoryState();

  expect(mockLoadActive).toHaveBeenCalledTimes(1);
  expect(mockPush).not.toHaveBeenCalled();
  expect(mockPull).not.toHaveBeenCalled();

  inventorySession.userId = null;
  mockLoadActive.mockClear();

  await store().refreshInventoryState();
  expect(mockLoadActive).not.toHaveBeenCalled();
});

test('clearPendingSyncs raises the push watermark to MAX(updated_at)', async () => {
  db.inventory = [
    { user_id: 'u1', id: 'a', updated_at: 100 },
    { user_id: 'u1', id: 'b', updated_at: 200 },
  ];
  useInventoryStore.setState({ pendingSyncCount: 2, syncFatalError: 'old' });

  await store().clearPendingSyncs();

  const row = db.sync_metadata.find((r) => r.user_id === 'u1');
  expect(row?.last_pushed_local_updated_at).toBe(200);
  expect(store().pendingSyncCount).toBe(0);
  expect(store().syncFatalError).toBeNull();
  expect(store().isSyncing).toBe(false);

  // No session → no db traffic at all.
  inventorySession.userId = null;
  db.runAsync.mockClear();
  db.getFirstAsync.mockClear();
  await store().clearPendingSyncs();
  expect(db.runAsync).not.toHaveBeenCalled();
  expect(db.getFirstAsync).not.toHaveBeenCalled();
});

test('forceWipeAndResync wipes inventory + watermarks inside one transaction, then syncs', async () => {
  db.inventory = [
    { user_id: 'u1', id: 'a', updated_at: 100 },
    { user_id: 'u1', id: 'b', updated_at: 200 },
  ];
  await setLastPush(db as unknown as SQLiteDatabase, 'u1', 500);
  await setLastSync(db as unknown as SQLiteDatabase, 'u1', 500);
  db.runAsync.mockClear();
  db.getFirstAsync.mockClear();
  db.withTransactionAsync.mockClear();

  await store().forceWipeAndResync();

  expect(db.withTransactionAsync).toHaveBeenCalledTimes(1);
  expect(db.runAsync.mock.calls.map((c) => c[0])).toEqual([
    'DELETE FROM inventory WHERE user_id = ?',
    'UPDATE sync_metadata SET last_updated = 0, last_pushed_local_updated_at = 0 WHERE user_id = ?',
  ]);
  expect(db.runAsync.mock.calls[0][1]).toBe('u1');
  expect(db.runAsync.mock.calls[1][1]).toBe('u1');

  expect(db.inventory).toEqual([]);
  const row = db.sync_metadata.find((r) => r.user_id === 'u1');
  expect(row?.last_updated).toBe(0);
  expect(row?.last_pushed_local_updated_at).toBe(0);

  // The watermark reset lands before the resync's push.
  expect(db.runAsync.mock.invocationCallOrder[1]).toBeLessThan(order(mockPush));
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPull).toHaveBeenCalledTimes(1);
  expect(store().isSyncing).toBe(false);
  expect(store().syncFatalError).toBeNull();
});

test('a failed wipe aborts before the resync', async () => {
  db.withTransactionAsync.mockRejectedValueOnce(new Error('locked'));

  await store().forceWipeAndResync();

  expect(mockPush).not.toHaveBeenCalled();
  expect(store().isSyncing).toBe(false);
  expect(errSpy).toHaveBeenCalledWith('forceWipeAndResync failed:', 'locked');
});

test('deleteAccount removes vendor, cloud, and local data in order', async () => {
  await store().deleteAccount();

  expect(order(mockDeleteVendor)).toBeLessThan(order(mockDeleteCloud));
  expect(order(mockDeleteCloud)).toBeLessThan(order(mockWipe));
  expect(mockDeleteCloud).toHaveBeenCalledWith('u1');
  expect(mockWipe).toHaveBeenCalledWith(db, 'u1');
  expect(store().inventory).toEqual([]);
  expect(store().activeInventory).toEqual([]);
  expect(store().completedSales).toEqual([]);
  expect(store().pendingSyncCount).toBe(0);
  expect(store().isSyncing).toBe(false);
});

test('a vendor-delete failure maps to a friendly error and stops the chain', async () => {
  mockDeleteVendor.mockRejectedValueOnce('Forbidden');

  await expect(store().deleteAccount()).rejects.toThrow("You don't have access to do that.");

  expect(mockDeleteCloud).not.toHaveBeenCalled();
  expect(mockWipe).not.toHaveBeenCalled();
  expect(store().isSyncing).toBe(false);
});

test('scheduleSync debounces rapid calls into a single sync (real timers)', async () => {
  store().scheduleSync();
  store().scheduleSync();

  await new Promise((r) => setTimeout(r, AUTO_SYNC_DEBOUNCE_MS + 600));

  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(inventorySession.syncDebounceTimer).toBeNull();
});
