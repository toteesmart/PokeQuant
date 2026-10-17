import type { SQLiteDatabase } from 'expo-sqlite';
import { getCardSignals, openCatalogDatabase } from '../src/db/catalogDb';
import { generateId } from '../src/db/database';
import {
  getInventoryItem,
  markInventorySold,
  softDeleteInventoryItem,
  unmarkInventorySold,
  upsertInventoryItem,
  type PersistedInventory,
} from '../src/db/inventoryDb';
import { recordDealGrades } from '../src/scanner/services/deal/dealGradeDb';
import { classifyDeal } from '../src/scanner/services/deal/dealClassify';
import { inventorySession } from '../src/store/inventory/session';
import { lookupMarketData } from '../src/store/inventory/pricing';
import { useInventoryStore, type InventoryInput } from '../src/store/inventoryStore';
import { useVendorStore } from '../src/store/vendorStore';
import * as logModule from '../src/utils/log';
import { mkInventoryCard, mkSignal } from './helpers/builders';
import { FakeSQLite } from './helpers/fakeSqlite';

// cardActions characterization pins — the store actions run for real.
// Cut seams: the tenant-DB write/read fns (payloads pinned verbatim), the
// catalog lookups, the grade recorder, and generateId. Kept real: the
// vendor-store offer math (derivePaidAndSticker / resolveCardMarket /
// buildVariantMap run against DEFAULT_TIERS + sticker rules), syncDb's
// pending recount against FakeSQLite, and classifyDeal — the signal→grade
// mapping is asserted through the real classifier, not a re-derivation.
// No React, no act().

jest.mock('../src/db/inventoryDb', () => {
  const actual =
    jest.requireActual<typeof import('../src/db/inventoryDb')>('../src/db/inventoryDb');
  return {
    ...actual,
    upsertInventoryItem: jest.fn(),
    softDeleteInventoryItem: jest.fn(),
    markInventorySold: jest.fn(),
    unmarkInventorySold: jest.fn(),
    getInventoryItem: jest.fn(),
  };
});

jest.mock('../src/db/database', () => {
  const actual = jest.requireActual<typeof import('../src/db/database')>('../src/db/database');
  // initializeDatabase stays real — the no-session tests pass purely on
  // the `if (db && userId)` guard; if a tested action ever calls getDb(),
  // the real init still fails safely (openDatabaseAsync is absent from
  // the setup mock).
  return { ...actual, generateId: jest.fn() };
});

jest.mock('../src/store/inventory/pricing', () => {
  const actual = jest.requireActual<typeof import('../src/store/inventory/pricing')>(
    '../src/store/inventory/pricing',
  );
  return { ...actual, lookupMarketData: jest.fn() };
});

jest.mock('../src/db/catalogDb', () => {
  const actual = jest.requireActual<typeof import('../src/db/catalogDb')>('../src/db/catalogDb');
  return { ...actual, openCatalogDatabase: jest.fn(), getCardSignals: jest.fn() };
});

jest.mock('../src/scanner/services/deal/dealGradeDb', () => {
  const actual = jest.requireActual<typeof import('../src/scanner/services/deal/dealGradeDb')>(
    '../src/scanner/services/deal/dealGradeDb',
  );
  return { ...actual, recordDealGrades: jest.fn() };
});

const mockUpsert = jest.mocked(upsertInventoryItem);
const mockSoftDelete = jest.mocked(softDeleteInventoryItem);
const mockMarkSold = jest.mocked(markInventorySold);
const mockUnmarkSold = jest.mocked(unmarkInventorySold);
const mockGetItem = jest.mocked(getInventoryItem);
const mockId = jest.mocked(generateId);
const mockLookup = jest.mocked(lookupMarketData);
const mockOpenCatalog = jest.mocked(openCatalogDatabase);
const mockSignals = jest.mocked(getCardSignals);
const mockGrades = jest.mocked(recordDealGrades);

const errSpy = jest.spyOn(logModule, 'logError').mockImplementation(() => {});

const store = () => useInventoryStore.getState();
const order = (fn: jest.Mock) => fn.mock.invocationCallOrder[0];

let db: FakeSQLite;

const mkInput = (over: Partial<InventoryInput> = {}): InventoryInput => ({
  name: 'Pikachu',
  liveMarket: 10,
  ...over,
});

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

const countReadOrder = () => {
  const idx = db.getFirstAsync.mock.calls.findIndex(([sql]) => String(sql).includes('COUNT(*)'));
  return idx === -1 ? -1 : db.getFirstAsync.mock.invocationCallOrder[idx];
};

beforeEach(() => {
  jest.clearAllMocks();
  db = new FakeSQLite();
  inventorySession.db = db as unknown as SQLiteDatabase;
  inventorySession.userId = 'u1';
  useInventoryStore.setState({
    inventory: [],
    activeInventory: [],
    completedSales: [],
    pendingSyncCount: 0,
    isSyncing: false,
    syncFatalError: null,
  });
  useVendorStore.setState({
    tiers: [
      { minDollar: 0, maxDollar: 10, marginPercent: 50 },
      { minDollar: 10, maxDollar: 50, marginPercent: 60 },
      { minDollar: 50, maxDollar: 999, marginPercent: 70 },
    ],
    stickerRules: { roundingMethod: 'Custom Cutoff', cutoff: 0.3, minSticker: 1.0 },
  });
  let n = 0;
  mockId.mockImplementation(() => `gen-${++n}`);
  mockLookup.mockResolvedValue({ marketMap: {}, imageUrlMap: {} });
  mockOpenCatalog.mockResolvedValue({ __catalog: true } as unknown as SQLiteDatabase);
  mockSignals.mockResolvedValue({});
  mockUpsert.mockResolvedValue(undefined);
  mockSoftDelete.mockResolvedValue(undefined);
  mockMarkSold.mockResolvedValue(undefined);
  mockUnmarkSold.mockResolvedValue(undefined);
  mockGetItem.mockResolvedValue(null);
  mockGrades.mockResolvedValue(undefined);
});

afterAll(() => {
  inventorySession.db = null;
  inventorySession.userId = null;
});

describe('addInventoryCard', () => {
  test('derives paid/sticker from the vendor offer math, prepends, persists, recounts', async () => {
    // A pending row sits behind the watermark so the recount has a signal.
    db.inventory = [{ user_id: 'u1', id: 'old', updated_at: 100 }];

    await store().addInventoryCard(mkInput({ condition: 'NM' }));

    const card = store().inventory[0];
    // liveMarket 10 sits on a tier boundary — bounds are inclusive on both
    // ends, so the sorted find picks the lower 0–10 tier: 50% → offer 5.
    expect(card).toMatchObject({
      id: 'gen-1',
      name: 'Pikachu',
      liveMarket: 10,
      amountPaid: 5,
      stickerPrice: 10,
      projProfit: 5,
      stock: 1,
      isBulk: false,
    });
    expect(store().activeInventory[0]).toBe(card);
    expect(mockLookup).not.toHaveBeenCalled();

    // persistCard's row mapping handed to the upsert seam, verbatim.
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert.mock.calls[0][0]).toBe(db);
    expect(mockUpsert.mock.calls[0][1]).toEqual({
      id: 'gen-1',
      userId: 'u1',
      name: 'Pikachu',
      number: undefined,
      set: undefined,
      rarity: undefined,
      productType: undefined,
      condition: 'NM',
      liveMarket: 10,
      amountPaid: 5,
      stickerPrice: 10,
      isBulk: false,
      imageUrl: undefined,
      productId: null,
    });

    // Upsert → pending recount order, and the recount itself lands.
    expect(order(mockUpsert)).toBeLessThan(countReadOrder());
    expect(store().pendingSyncCount).toBe(1);
  });

  test('a catalog hit resolves market price, subtype, and image before persisting', async () => {
    mockLookup.mockResolvedValueOnce({
      marketMap: { 42: { marketPrice: 20, matchedSubType: 'Holofoil' } },
      imageUrlMap: { 42: 'https://img.example/42.jpg' },
    } as unknown as Awaited<ReturnType<typeof lookupMarketData>>);

    await store().addInventoryCard(
      mkInput({ productId: 42, productType: 'Normal', condition: 'LP', liveMarket: 1 }),
    );

    expect(mockLookup).toHaveBeenCalledWith([42], { 42: 'Normal' });
    const card = store().inventory[0];
    // LP modifier 0.85 × 20; productType adopts the matched subtype.
    expect(card.liveMarket).toBe(17);
    expect(card.productType).toBe('Holofoil');
    expect(card.rarity).toBe('Holofoil');
    expect(card.imageUrl).toBe('https://img.example/42.jpg');
  });

  test('a lookup failure is logged and the card lands with input values', async () => {
    mockLookup.mockRejectedValueOnce('catalog gone');

    await store().addInventoryCard(
      mkInput({ productId: 42, liveMarket: 10, amountPaid: 4, stickerPrice: 12 }),
    );

    expect(errSpy).toHaveBeenCalledWith('Catalog price lookup failed:', 'catalog gone');
    const card = store().inventory[0];
    expect(card.liveMarket).toBe(10);
    expect(card.amountPaid).toBe(4);
    // Explicit stickers still pass through getStickerPrice rounding.
    expect(card.stickerPrice).toBe(12);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  test('isBulkDeal lands on the stored isBulk field', async () => {
    await store().addInventoryCard(mkInput({ isBulkDeal: true }));
    expect(store().inventory[0].isBulk).toBe(true);
    expect(mockUpsert.mock.calls[0][1]).toMatchObject({ isBulk: true });
  });

  test('explicit amountPaid/stickerPrice are honored and re-rounded', async () => {
    await store().addInventoryCard(mkInput({ amountPaid: 3, stickerPrice: 10.29 }));
    const card = store().inventory[0];
    // 10.29 → fractional .29 < .3 cutoff → floor → 10.
    expect(card.amountPaid).toBe(3);
    expect(card.stickerPrice).toBe(10);
    expect(card.projProfit).toBe(7);
  });

  test('no session still updates state but skips the write path', async () => {
    inventorySession.db = null;
    inventorySession.userId = null;

    await store().addInventoryCard(mkInput());

    expect(store().inventory).toHaveLength(1);
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(store().pendingSyncCount).toBe(0);
  });

  test('a persist failure is swallowed — the card stays in state', async () => {
    mockUpsert.mockRejectedValueOnce('disk full');

    await store().addInventoryCard(mkInput());

    expect(store().inventory).toHaveLength(1);
    expect(errSpy).toHaveBeenCalledWith('addInventoryItem failed:', 'disk full');
  });
});

describe('addScannedCards', () => {
  test('empty input exits before touching anything', async () => {
    await store().addScannedCards([]);
    expect(mockLookup).not.toHaveBeenCalled();
    expect(mockOpenCatalog).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockGrades).not.toHaveBeenCalled();
  });

  test('one batched lookup, per-card persist, then grade rows in one call', async () => {
    const signal = mkSignal({ productId: 42, subType: 'Holofoil', action: 'BUY' });
    mockLookup.mockResolvedValueOnce({
      marketMap: { 42: { marketPrice: 20, matchedSubType: 'Holofoil' } },
      imageUrlMap: { 42: 'https://img.example/42.jpg' },
    } as unknown as Awaited<ReturnType<typeof lookupMarketData>>);
    mockSignals.mockResolvedValueOnce({ 42: { Holofoil: signal } });

    await store().addScannedCards([
      mkInput({ productId: 42, productType: 'Holofoil', condition: 'NM' }),
      mkInput({ productId: 42, productType: 'Holofoil' }), // same productId — deduped
      mkInput({ name: 'NoPid' }), // no productId — no lookup entry
    ]);

    // One lookup for the deduped id set, one signal fetch for the batch.
    expect(mockLookup).toHaveBeenCalledTimes(1);
    expect(mockLookup).toHaveBeenCalledWith([42], { 42: 'Holofoil' });
    expect(mockSignals).toHaveBeenCalledTimes(1);
    expect(mockSignals.mock.calls[0][1]).toEqual([42]);

    expect(store().inventory).toHaveLength(3);
    expect(mockUpsert).toHaveBeenCalledTimes(3);

    // Every persist lands before the single recordDealGrades call.
    expect(mockGrades).toHaveBeenCalledTimes(1);
    expect(order(mockUpsert)).toBeLessThan(order(mockGrades));
    expect(order(mockGrades)).toBeLessThan(countReadOrder());

    const [gradeDb, rows] = mockGrades.mock.calls[0];
    expect(gradeDb).toBe(db);
    expect(rows).toHaveLength(3);
    // The signal resolves by the resolved subtype; cls/risk come out of the
    // real classifier — asserted, not re-derived.
    expect(rows?.[0]).toMatchObject({
      inventoryId: 'gen-1',
      userId: 'u1',
      productId: 42,
      subType: 'Holofoil',
      signal,
      cls: classifyDeal(signal).cls,
      risk: classifyDeal(signal).risk,
    });
    // A card with no productId gets signal: undefined → LOW_DATA read.
    expect(rows?.[2]).toMatchObject({
      inventoryId: 'gen-3',
      productId: null,
      signal: undefined,
      cls: 'LOW_DATA',
      risk: 'risky',
    });
  });

  test('a lookup failure still adds the cards and records LOW_DATA grades', async () => {
    mockLookup.mockRejectedValueOnce('catalog gone');
    mockSignals.mockResolvedValueOnce({});

    await store().addScannedCards([mkInput({ productId: 42 })]);

    // Promise.all fires both fetches — the lookup rejection still lets the
    // signal call run, but the destructured signalMap is discarded, so the
    // grade lands with no signal.
    expect(mockSignals).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledWith('Scanned card price lookup failed:', 'catalog gone');
    expect(store().inventory).toHaveLength(1);
    expect(mockGrades.mock.calls[0][1]?.[0]).toMatchObject({
      signal: undefined,
      cls: 'LOW_DATA',
    });
  });

  test('no session adds cards but skips persist + grades entirely', async () => {
    inventorySession.db = null;
    inventorySession.userId = null;

    await store().addScannedCards([mkInput()]);

    expect(store().inventory).toHaveLength(1);
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockGrades).not.toHaveBeenCalled();
  });

  test('a persist failure mid-batch is swallowed — all cards stay in state', async () => {
    mockUpsert.mockRejectedValueOnce('disk full');

    await store().addScannedCards([mkInput({ productId: 42 })]);

    // The whole write block is one try — the first failed upsert aborts the
    // loop, so neither the grades call nor the recount runs.
    expect(store().inventory).toHaveLength(1);
    expect(mockGrades).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledWith('addScannedCards failed:', 'disk full');
  });
});

describe('removeInventoryCard', () => {
  test('filters both lists, soft-deletes, recounts', async () => {
    const card = mkInventoryCard({ id: 'c1' });
    useInventoryStore.setState({ inventory: [card], activeInventory: [card] });
    db.inventory = [{ user_id: 'u1', id: 'c1', updated_at: 100 }];

    await store().removeInventoryCard('c1');

    expect(store().inventory).toEqual([]);
    expect(store().activeInventory).toEqual([]);
    expect(mockSoftDelete).toHaveBeenCalledWith(db, 'c1');
    expect(order(mockSoftDelete)).toBeLessThan(countReadOrder());
    expect(store().pendingSyncCount).toBe(1);
  });

  test('a persist failure leaves the card removed', async () => {
    const card = mkInventoryCard({ id: 'c1' });
    useInventoryStore.setState({ inventory: [card], activeInventory: [card] });
    mockSoftDelete.mockRejectedValueOnce('gone');

    await store().removeInventoryCard('c1');

    expect(store().inventory).toEqual([]);
    expect(errSpy).toHaveBeenCalledWith('removeInventoryItem failed:', 'gone');
  });
});

describe('updateInventoryCard', () => {
  test('an unknown id is a full no-op', async () => {
    await store().updateInventoryCard({ id: 'ghost', name: 'X' });
    expect(mockLookup).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  test('merges fields, recomputes profit, persists with the existing productId', async () => {
    const existing = mkInventoryCard({
      id: 'c1',
      productId: 42,
      name: 'Pikachu',
      amountPaid: 5,
      stickerPrice: 10,
      condition: 'NM',
    });
    useInventoryStore.setState({ inventory: [existing], activeInventory: [existing] });
    mockLookup.mockResolvedValueOnce({
      marketMap: { 42: { marketPrice: 20, matchedSubType: 'Holofoil' } },
      imageUrlMap: { 42: 'https://img.example/42.jpg' },
    } as unknown as Awaited<ReturnType<typeof lookupMarketData>>);

    await store().updateInventoryCard({ id: 'c1', name: 'Pikachu V', stickerPrice: 25 });

    // Variant for the recompute prefers update → existing productType → rarity.
    expect(mockLookup).toHaveBeenCalledWith([42], { 42: 'Normal' });
    const card = store().inventory[0];
    expect(card.name).toBe('Pikachu V');
    expect(card.stickerPrice).toBe(25);
    expect(card.amountPaid).toBe(5);
    expect(card.projProfit).toBe(20);
    expect(card.liveMarket).toBe(20);
    expect(card.productType).toBe('Holofoil');
    expect(card.imageUrl).toBe('https://img.example/42.jpg');

    // The persist keeps the card's productId — updates.productId wins only
    // when the caller passes one.
    expect(mockUpsert.mock.calls[0][1]).toMatchObject({ id: 'c1', productId: 42 });
  });

  test('no productId skips the recompute entirely', async () => {
    const existing = mkInventoryCard({ id: 'c1', liveMarket: 10 });
    useInventoryStore.setState({ inventory: [existing], activeInventory: [existing] });

    await store().updateInventoryCard({ id: 'c1', condition: 'HP' });

    expect(mockLookup).not.toHaveBeenCalled();
    expect(store().inventory[0].condition).toBe('HP');
    expect(mockUpsert.mock.calls[0][1]).toMatchObject({ productId: null });
  });

  test('a recompute failure keeps the caller values; a persist failure keeps the update', async () => {
    const existing = mkInventoryCard({ id: 'c1', productId: 42, liveMarket: 10 });
    useInventoryStore.setState({ inventory: [existing], activeInventory: [existing] });
    mockLookup.mockRejectedValueOnce('catalog gone');

    await store().updateInventoryCard({ id: 'c1', name: 'Pikachu V', stickerPrice: 25 });

    expect(errSpy).toHaveBeenCalledWith('Catalog price recompute failed:', 'catalog gone');
    // Without the catalog read the pre-resolution values land as-is.
    expect(store().inventory[0]).toMatchObject({
      name: 'Pikachu V',
      liveMarket: 10,
      stickerPrice: 25,
      projProfit: 20,
    });
    expect(mockUpsert).toHaveBeenCalledTimes(1);

    mockUpsert.mockRejectedValueOnce('disk full');
    await store().updateInventoryCard({ id: 'c1', name: 'Pikachu V2' });
    expect(store().inventory[0].name).toBe('Pikachu V2');
    expect(errSpy).toHaveBeenCalledWith('updateInventoryItem failed:', 'disk full');
  });
});

describe('sellInventoryCard', () => {
  test('moves the card to completedSales and marks it sold at the given price', async () => {
    const card = mkInventoryCard({
      id: 'c1',
      name: 'Pikachu',
      number: '025',
      set: 'SV151',
      condition: 'NM',
      amountPaid: 5,
      stickerPrice: 10,
    });
    useInventoryStore.setState({ inventory: [card], activeInventory: [card] });

    await store().sellInventoryCard('c1', 15);

    expect(store().inventory).toEqual([]);
    const sale = store().completedSales[0];
    expect(sale).toMatchObject({
      id: 'c1',
      name: 'Pikachu',
      number: '025',
      set: 'SV151',
      condition: 'NM',
      acquiredCost: 5,
      soldPrice: 15,
    });
    expect(typeof sale.dateSold).toBe('string');
    // The same timestamp reaches the persisted row.
    expect(mockMarkSold).toHaveBeenCalledWith(db, 'c1', 15, sale.dateSold);
  });

  test('no price falls back to the sticker', async () => {
    const card = mkInventoryCard({ id: 'c1', stickerPrice: 10 });
    useInventoryStore.setState({ inventory: [card], activeInventory: [card] });

    await store().sellInventoryCard('c1');

    expect(store().completedSales[0].soldPrice).toBe(10);
    expect(mockMarkSold.mock.calls[0][2]).toBe(10);
  });

  test('an unknown id is a no-op', async () => {
    await store().sellInventoryCard('ghost');
    expect(mockMarkSold).not.toHaveBeenCalled();
    expect(store().completedSales).toEqual([]);
  });

  test('a mark-sold failure still records the sale in state', async () => {
    const card = mkInventoryCard({ id: 'c1' });
    useInventoryStore.setState({ inventory: [card], activeInventory: [card] });
    mockMarkSold.mockRejectedValueOnce('gone');

    await store().sellInventoryCard('c1', 15);

    expect(store().inventory).toEqual([]);
    expect(store().completedSales).toHaveLength(1);
    expect(errSpy).toHaveBeenCalledWith('markInventorySold failed:', 'gone');
  });
});

describe('clearInventory', () => {
  test('empties the card lists but leaves completed sales alone', () => {
    const card = mkInventoryCard({ id: 'c1' });
    const sale = {
      id: 's1',
      name: 'Pikachu',
      acquiredCost: 5,
      soldPrice: 9,
      dateSold: '2026-01-02',
    };
    useInventoryStore.setState({
      inventory: [card],
      activeInventory: [card],
      completedSales: [sale],
    });

    store().clearInventory();

    expect(store().inventory).toEqual([]);
    expect(store().activeInventory).toEqual([]);
    expect(store().completedSales).toEqual([sale]);
    expect(mockSoftDelete).not.toHaveBeenCalled();
  });
});

describe('undoCompletedSale', () => {
  const sale = {
    id: 's1',
    name: 'Pikachu',
    number: '025',
    set: 'SV151',
    condition: 'NM',
    acquiredCost: 5,
    soldPrice: 9,
    dateSold: '2026-01-02',
  };

  test('restores from the persisted row when it survives', async () => {
    useInventoryStore.setState({ completedSales: [sale] });
    mockGetItem.mockResolvedValueOnce(
      mkPersisted({ id: 's1', liveMarket: 11, stickerPrice: 14, isBulk: true, imageUrl: 'u' }),
    );

    await store().undoCompletedSale(sale);

    expect(mockGetItem).toHaveBeenCalledWith(db, 's1');
    expect(mockUnmarkSold).toHaveBeenCalledWith(db, 's1');
    expect(store().completedSales).toEqual([]);

    const restored = store().inventory[0];
    expect(restored).toMatchObject({
      id: 's1',
      liveMarket: 11,
      amountPaid: 5,
      stickerPrice: 14,
      projProfit: 9,
      stock: 1,
      isBulk: true,
      imageUrl: 'u',
    });
    expect(store().activeInventory[0]).toBe(restored);
  });

  test('a missing row falls back to sticker math on the sale price', async () => {
    useInventoryStore.setState({ completedSales: [sale] });
    mockGetItem.mockResolvedValueOnce(null);

    await store().undoCompletedSale(sale);

    const restored = store().inventory[0];
    // soldPrice 9 → getStickerPrice(9) = 9; liveMarket falls back to soldPrice.
    expect(restored).toMatchObject({
      liveMarket: 9,
      stickerPrice: 9,
      projProfit: 4,
      isBulk: false,
    });
  });

  test('works with no session — nothing persisted, still restored in state', async () => {
    inventorySession.db = null;
    inventorySession.userId = null;
    useInventoryStore.setState({ completedSales: [sale] });

    await store().undoCompletedSale(sale);

    expect(mockGetItem).not.toHaveBeenCalled();
    expect(mockUnmarkSold).not.toHaveBeenCalled();
    expect(store().inventory).toHaveLength(1);
    expect(store().completedSales).toEqual([]);
  });

  test('a db failure on the undo path falls back to sticker math too', async () => {
    useInventoryStore.setState({ completedSales: [sale] });
    mockGetItem.mockRejectedValueOnce('corrupt');

    await store().undoCompletedSale(sale);

    expect(errSpy).toHaveBeenCalledWith('undoCompletedSale failed:', 'corrupt');
    expect(store().inventory[0]).toMatchObject({ liveMarket: 9, stickerPrice: 9 });
    expect(store().completedSales).toEqual([]);
  });
});
