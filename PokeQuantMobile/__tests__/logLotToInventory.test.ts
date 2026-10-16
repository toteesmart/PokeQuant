import type { SQLiteDatabase } from 'expo-sqlite';
import { logCartItemsToInventory } from '../src/db/inventoryDb';
import { useCartStore, type CartItemInput } from '../src/store/cartStore';
import { inventorySession } from '../src/store/inventory/session';
import { useInventoryStore } from '../src/store/inventoryStore';

/* eslint-disable @typescript-eslint/no-require-imports -- node builtins via CJS require; tsconfig ships no node types */
const fs = require('node:fs');
const path = require('node:path');
/* eslint-enable @typescript-eslint/no-require-imports */

declare const __dirname: string;

// logLotToInventory — the lot cart's bulk write, moved out of CartDrawer
// into a store action. The seam mock captures the payload handed to
// logCartItemsToInventory; refreshInventoryState is swapped for a jest.fn
// (store-internal effect, mocked like useBulkSelection does); cartStore's
// clearCart/closeDrawer are wrapped jest.fns delegating to the real
// actions so one run pins both the call order and the state effects.
// No mounted hooks — nothing needs act().

jest.mock('../src/db/inventoryDb', () => {
  const actual = jest.requireActual<typeof import('../src/db/inventoryDb')>(
    '../src/db/inventoryDb'
  );
  return { ...actual, logCartItemsToInventory: jest.fn() };
});

const mockLog = jest.mocked(logCartItemsToInventory);

const tenantDb = { __tenant: true } as unknown as SQLiteDatabase;

const realClear = useCartStore.getState().clearCart;
const realClose = useCartStore.getState().closeDrawer;
const realRefresh = useInventoryStore.getState().refreshInventoryState;
const mockClear = jest.fn(() => realClear());
const mockClose = jest.fn(() => realClose());
const mockRefresh = jest.fn(async () => {});

const lotInput = (over: Partial<CartItemInput> = {}): CartItemInput => ({
  productId: 610378,
  cardName: 'Pikachu',
  cardNumber: '025',
  setName: 'SV151',
  variant: 'Normal',
  condition: 'NM',
  marketPrice: 10,
  cashOffer: 7,
  ...over,
});

// Two items through the real addToCart so the cart + drawer state is the
// genuine shape (ids, buyPercentage, totals, isDrawerOpen).
const seedCart = () => {
  useCartStore.getState().addToCart(lotInput(), true);
  useCartStore
    .getState()
    .addToCart(lotInput({ cardName: "Farfetch'd", cashOffer: 3 }));
};

const expectNoCalls = () => {
  expect(mockLog).not.toHaveBeenCalled();
  expect(mockRefresh).not.toHaveBeenCalled();
  expect(mockClear).not.toHaveBeenCalled();
  expect(mockClose).not.toHaveBeenCalled();
};

beforeEach(() => {
  jest.clearAllMocks();
  inventorySession.db = tenantDb;
  inventorySession.userId = 'u1';
  useInventoryStore.setState({ refreshInventoryState: mockRefresh });
  useCartStore.setState({
    clearCart: mockClear,
    closeDrawer: mockClose,
    cartItems: [],
    isDrawerOpen: false,
    itemCount: 0,
    totalMarket: 0,
    totalOffer: 0,
    offerPercent: 0,
  });
});

afterAll(() => {
  useCartStore.setState({ clearCart: realClear, closeDrawer: realClose });
  useInventoryStore.setState({ refreshInventoryState: realRefresh });
  inventorySession.db = null;
  inventorySession.userId = null;
});

test('writes → refresh → clear → close, in that order', async () => {
  seedCart();
  const items = useCartStore.getState().cartItems;

  await useInventoryStore.getState().logLotToInventory();

  // The verbatim write: session db + user, the live cart array unreshaped.
  expect(mockLog).toHaveBeenCalledTimes(1);
  expect(mockLog.mock.calls[0][0]).toBe(tenantDb);
  expect(mockLog.mock.calls[0][1]).toBe('u1');
  expect(mockLog.mock.calls[0][2]).toBe(items);

  const order = (fn: jest.Mock) => fn.mock.invocationCallOrder[0];
  expect(order(mockRefresh)).toBeGreaterThan(order(mockLog));
  expect(order(mockClear)).toBeGreaterThan(order(mockRefresh));
  expect(order(mockClose)).toBeGreaterThan(order(mockClear));

  // The wrapped real actions still produced the real state effects.
  expect(useCartStore.getState().cartItems).toEqual([]);
  expect(useCartStore.getState().isDrawerOpen).toBe(false);
});

test('a failed write propagates and leaves the cart + drawer untouched', async () => {
  seedCart();
  mockLog.mockRejectedValueOnce('write blew up');

  await expect(
    useInventoryStore.getState().logLotToInventory()
  ).rejects.toBe('write blew up');

  expect(mockRefresh).not.toHaveBeenCalled();
  expect(mockClear).not.toHaveBeenCalled();
  expect(mockClose).not.toHaveBeenCalled();
  expect(useCartStore.getState().cartItems).toHaveLength(2);
  expect(useCartStore.getState().isDrawerOpen).toBe(true);
});

test('empty cart is a no-op — zero db or store calls', async () => {
  await useInventoryStore.getState().logLotToInventory();
  expectNoCalls();
});

test('no signed-in user is a no-op — the lot stays put', async () => {
  inventorySession.userId = null;
  seedCart();

  await useInventoryStore.getState().logLotToInventory();

  expectNoCalls();
  expect(useCartStore.getState().cartItems).toHaveLength(2);
});

test('no obtainable db handle propagates — the lot stays put', async () => {
  inventorySession.db = null;
  seedCart();
  // getDb() retries initializeDatabase on the empty slot; the setup-mocked
  // openDatabaseSync returns undefined, so init fails and the action must
  // surface it — a silent no-op would fire a false 'Lot added'.
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await expect(
      useInventoryStore.getState().logLotToInventory()
    ).rejects.toThrow('Local database unavailable');

    expectNoCalls();
    expect(useCartStore.getState().cartItems).toHaveLength(2);
  } finally {
    errSpy.mockRestore();
  }
});

test('CartDrawer stays behind the store — zero db/ imports', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'components', 'CartDrawer.tsx'),
    'utf8'
  );
  expect(src).not.toMatch(/from\s+['"][^'"]*\/db\//);
  expect(src).toContain('logLotToInventory');
});
