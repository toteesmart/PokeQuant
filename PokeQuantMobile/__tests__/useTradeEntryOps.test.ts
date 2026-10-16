import { act } from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  mkCatalogCard,
  mkInventoryCard,
  mkSignal,
  mkTradeEntry,
} from './helpers/builders';
import { flushAsync, renderHook } from './helpers/renderHook';
import { useTradeEntryOps } from '../src/hooks/useTradeEntryOps';
import {
  getCardSignals,
  openCatalogDatabase,
  searchCatalogCards,
  type SearchCatalogResult,
} from '../src/db/catalogDb';
import { CATALOG_IMAGE_BASE } from '../src/constants/api';
import type { TradePick } from '../src/scanner/services/deal/tradeEntry';
import type { TradeEntry } from '../src/scanner/services/deal/tradeEval';
import type { InventoryCard } from '../src/store/inventoryStore';

// catalogDb is partially mocked at the seams the hook (and the real
// tradeEntry helper it composes) hit: openCatalogDatabase, the debounced
// searchCatalogCards, and getCardSignals for finish-variant hydration.
// getCatalogImageUri and displayCardName stay real — the image-pack index
// is empty under jest so the CDN fallback path is what gets pinned.
jest.mock('../src/db/catalogDb', () => {
  const actual = jest.requireActual<typeof import('../src/db/catalogDb')>(
    '../src/db/catalogDb'
  );
  return {
    ...actual,
    openCatalogDatabase: jest.fn(),
    searchCatalogCards: jest.fn(),
    getCardSignals: jest.fn(),
  };
});

const mockOpen = jest.mocked(openCatalogDatabase);
const mockSearch = jest.mocked(searchCatalogCards);
const mockSignals = jest.mocked(getCardSignals);

const catalogDbHandle = {} as SQLiteDatabase;

// 250ms real-time debounce on the "their" picker — park just past it.
const flushSearch = () =>
  act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
  });

type OpsProps = { yours: TradeEntry[]; theirs: TradeEntry[]; inventory: InventoryCard[] };

const renderOps = (props: Partial<OpsProps> = {}) => {
  const onChangeYours = jest.fn();
  const onChangeTheirs = jest.fn();
  const harness = renderHook(
    (p: OpsProps) =>
      useTradeEntryOps({
        yours: p.yours,
        theirs: p.theirs,
        inventory: p.inventory,
        onChangeYours,
        onChangeTheirs,
      }),
    { yours: [], theirs: [], inventory: [], ...props }
  );
  return { ...harness, onChangeYours, onChangeTheirs };
};

const mkPick = (over: Partial<TradePick> = {}): TradePick => ({
  productId: 9,
  name: 'Charizard - 004/102',
  number: '004/102',
  set: 'Base Set',
  marketPrice: 80,
  imageUrl: 'https://img.example/9.jpg',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockOpen.mockResolvedValue(catalogDbHandle);
  mockSearch.mockResolvedValue({ cards: [], hasMore: false, nextOffset: 0 });
  mockSignals.mockResolvedValue({});
});

test('your-side picker is local and instant — name/set substring, capped at 6', () => {
  const inventory = Array.from({ length: 8 }, (_, i) =>
    mkInventoryCard({ id: `p${i}`, name: `Pikachu ${i}` })
  );
  inventory.push(mkInventoryCard({ id: 'z', name: 'Zubat', set: 'Pikachu Deck' }));
  const { result } = renderOps({ inventory });

  act(() => result.current.setYourQuery('p'));
  expect(result.current.yourResults).toEqual([]);

  act(() => result.current.setYourQuery('PIKACHU'));
  // 8 name matches + 1 set match → sliced to 6.
  expect(result.current.yourResults).toHaveLength(6);
  expect(result.current.yourResults.every((c) => c.id !== 'z')).toBe(true);
});

test('your-side picker matches on set when the name misses', () => {
  const inventory = [
    mkInventoryCard({ id: 'a', name: 'Pikachu', set: 'Base Set' }),
    mkInventoryCard({ id: 'b', name: 'Zubat', set: 'Fossil' }),
  ];
  const { result } = renderOps({ inventory });

  act(() => result.current.setYourQuery('fossil'));
  expect(result.current.yourResults.map((c) => c.id)).toEqual(['b']);
});

test('their-side search debounces 250ms and ships the raw query', async () => {
  const { result } = renderOps();

  act(() => result.current.setTheirQuery('ch'));
  // The render-adjusted claim marks the search in flight up front.
  expect(result.current.searching).toBe(true);

  await act(async () => {
    await new Promise((r) => setTimeout(r, 100));
  });
  expect(mockSearch).not.toHaveBeenCalled();

  // A retype inside the window restarts the clock — one fetch total.
  act(() => result.current.setTheirQuery('char'));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 100));
  });
  expect(mockSearch).not.toHaveBeenCalled();

  await flushSearch();
  expect(mockSearch).toHaveBeenCalledTimes(1);
  expect(mockSearch).toHaveBeenCalledWith(
    catalogDbHandle,
    { query: 'char', rarity: 'All', sortBy: 'Name A-Z' },
    8
  );
  expect(result.current.searching).toBe(false);
});

test('their-side results map catalog cards into TradePicks', async () => {
  mockSearch.mockResolvedValue({
    cards: [
      mkCatalogCard({ productId: 42, name: 'Pikachu', imageUrl: '' }),
      mkCatalogCard({
        productId: 7,
        name: 'Mew',
        liveMarket: 33,
        imageUrl: 'https://img.example/7.jpg',
      }),
    ],
    hasMore: false,
    nextOffset: 2,
  });
  const { result } = renderOps();

  act(() => result.current.setTheirQuery('pika'));
  await flushSearch();

  expect(result.current.theirResults).toEqual([
    {
      productId: 42,
      name: 'Pikachu',
      number: '025',
      set: 'SV151',
      marketPrice: 10,
      // Empty imageUrl falls back to the product CDN URL.
      imageUrl: `${CATALOG_IMAGE_BASE}/42_400w.jpg`,
    },
    {
      productId: 7,
      name: 'Mew',
      number: '025',
      set: 'SV151',
      marketPrice: 33,
      imageUrl: 'https://img.example/7.jpg',
    },
  ]);
});

test('sub-2-char queries never fetch and clear the picks', async () => {
  mockSearch.mockResolvedValue({
    cards: [mkCatalogCard()],
    hasMore: false,
    nextOffset: 1,
  });
  const { result } = renderOps();

  act(() => result.current.setTheirQuery('pi'));
  await flushSearch();
  expect(result.current.theirResults).toHaveLength(1);

  act(() => result.current.setTheirQuery('p'));
  expect(result.current.theirResults).toEqual([]);
  expect(result.current.searching).toBe(false);
  await flushSearch();
  expect(mockSearch).toHaveBeenCalledTimes(1);
});

test('a stale fetch cancelled by a cleared query cannot repopulate', async () => {
  let resolveFirst!: (r: SearchCatalogResult) => void;
  mockSearch.mockImplementationOnce(
    () => new Promise<SearchCatalogResult>((resolve) => (resolveFirst = resolve))
  );
  const { result } = renderOps();

  act(() => result.current.setTheirQuery('pika'));
  await flushSearch();
  expect(mockSearch).toHaveBeenCalledTimes(1);

  act(() => result.current.setTheirQuery(''));
  act(() =>
    resolveFirst({
      cards: [mkCatalogCard()],
      hasMore: false,
      nextOffset: 1,
    })
  );
  await flushAsync();
  expect(result.current.theirResults).toEqual([]);
});

test('a failed search empties the picks and drops the spinner', async () => {
  mockSearch.mockRejectedValue(new Error('disk i/o'));
  const { result } = renderOps();

  act(() => result.current.setTheirQuery('pika'));
  await flushSearch();

  expect(result.current.theirResults).toEqual([]);
  expect(result.current.searching).toBe(false);
});

test('addYours hydrates finish variants and prefers the held finish', async () => {
  const card = mkInventoryCard({
    id: 'inv-1',
    name: 'Pikachu',
    productId: 42,
    productType: 'Reverse Holo',
    amountPaid: 5,
    liveMarket: 12,
    number: '025',
    set: 'SV151',
    imageUrl: 'https://img.example/pika.jpg',
  });
  const sigNormal = mkSignal({ productId: 42, subType: 'Normal', price: 10 });
  const sigReverse = mkSignal({
    productId: 42,
    subType: 'Reverse Holo',
    price: 30,
  });
  mockSignals.mockResolvedValue({
    42: { Normal: sigNormal, 'Reverse Holo': sigReverse },
  });

  const existing = mkTradeEntry({ key: 'te-old' });
  const { result, onChangeYours } = renderOps({
    yours: [existing],
    inventory: [card],
  });

  act(() => result.current.setYourQuery('pika'));
  await act(async () => {
    await result.current.addYours('inv-1');
  });

  expect(result.current.yourQuery).toBe('');
  // tradeVariantsFor sorts the held finish ahead of the cheaper Normal.
  expect(mockSignals).toHaveBeenCalledWith(catalogDbHandle, [42]);
  expect(onChangeYours).toHaveBeenCalledTimes(1);
  const entries = onChangeYours.mock.calls[0][0];
  expect(entries).toHaveLength(2);
  expect(entries[0]).toBe(existing);
  expect(entries[1]).toMatchObject({
    inventoryId: 'inv-1',
    paidPrice: 5,
    productId: 42,
    subType: 'Reverse Holo',
    name: 'Pikachu',
    number: '025',
    set: 'SV151',
    imageUrl: 'https://img.example/pika.jpg',
    qty: 1,
    price: 12,
    signal: sigReverse,
  });
  expect(entries[1].variants.map((v: { subType: string }) => v.subType)).toEqual([
    'Reverse Holo',
    'Normal',
  ]);
});

test('addYours on a card with no productId skips variant hydration', async () => {
  const card = mkInventoryCard({ id: 'inv-9', productId: null, productType: undefined });
  const { result, onChangeYours } = renderOps({ inventory: [card] });

  await act(async () => {
    await result.current.addYours('inv-9');
  });

  expect(mockSignals).not.toHaveBeenCalled();
  const entries = onChangeYours.mock.calls[0][0];
  expect(entries[0]).toMatchObject({
    inventoryId: 'inv-9',
    productId: null,
    subType: null,
    signal: undefined,
  });
  expect(entries[0].variants).toBeUndefined();
});

test('addYours on an unknown inventory id is a no-op', async () => {
  const { result, onChangeYours } = renderOps({
    inventory: [mkInventoryCard({ id: 'inv-1' })],
  });

  await act(async () => {
    await result.current.addYours('nope');
  });
  expect(onChangeYours).not.toHaveBeenCalled();
});

test('addTheirs takes the priciest variant and strips the number suffix', async () => {
  const sigNormal = mkSignal({ productId: 9, subType: 'Normal', price: 50 });
  const sigHolo = mkSignal({ productId: 9, subType: 'Holofoil', price: 120 });
  mockSignals.mockResolvedValue({ 9: { Normal: sigNormal, Holofoil: sigHolo } });

  const { result, onChangeTheirs } = renderOps();
  act(() => result.current.setTheirQuery('char'));
  await flushSearch();

  await act(async () => {
    await result.current.addTheirs(mkPick());
  });

  expect(result.current.theirQuery).toBe('');
  expect(result.current.theirResults).toEqual([]);
  const entries = onChangeTheirs.mock.calls[0][0];
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    productId: 9,
    subType: 'Holofoil',
    name: 'Charizard', // displayCardName strips " - 004/102"
    number: '004/102',
    set: 'Base Set',
    imageUrl: 'https://img.example/9.jpg',
    qty: 1,
    price: 120, // variant signal price beats the pick's marketPrice
    signal: sigHolo,
  });
  expect(
    entries[0].variants.map((v: { subType: string }) => v.subType)
  ).toEqual(['Holofoil', 'Normal']);
});

test('addTheirs with no signals falls back to Normal + the pick price', async () => {
  mockSignals.mockResolvedValue({});
  const { result, onChangeTheirs } = renderOps();

  await act(async () => {
    await result.current.addTheirs(mkPick());
  });

  const entries = onChangeTheirs.mock.calls[0][0];
  expect(entries[0]).toMatchObject({
    productId: 9,
    subType: 'Normal',
    price: 80,
    signal: undefined,
  });
  expect(entries[0].variants).toBeUndefined();
});

test('the many-vs-one guard blocks a second card onto a 1-vs-2 board', async () => {
  const card = mkInventoryCard({ id: 'inv-1', productId: null });
  const yours = [mkTradeEntry({ key: 'y1' })];
  const theirs = [mkTradeEntry({ key: 't1' }), mkTradeEntry({ key: 't2' })];
  const { result, onChangeYours } = renderOps({ yours, theirs, inventory: [card] });

  await act(async () => {
    await result.current.addYours('inv-1');
  });

  expect(onChangeYours).not.toHaveBeenCalled();
  expect(result.current.limitMsg).toBe(
    'Trade eval is many-vs-one — one side stays a single card'
  );
});

test('the guard only bites when the other side is already multi', async () => {
  const card = mkInventoryCard({ id: 'inv-1', productId: null });
  // yours=2, theirs=1 — adding to yours stays many-vs-one, allowed.
  const yours = [mkTradeEntry({ key: 'y1' }), mkTradeEntry({ key: 'y2' })];
  const theirs = [mkTradeEntry({ key: 't1' })];
  const { result, onChangeYours } = renderOps({ yours, theirs, inventory: [card] });

  await act(async () => {
    await result.current.addYours('inv-1');
  });
  expect(onChangeYours).toHaveBeenCalledTimes(1);
  expect(result.current.limitMsg).toBeNull();
});

test('a blocked add clears once a legal add lands', async () => {
  const card = mkInventoryCard({ id: 'inv-1', productId: null });
  const yours = [mkTradeEntry({ key: 'y1' })];
  const twoTheirs = [mkTradeEntry({ key: 't1' }), mkTradeEntry({ key: 't2' })];
  const { result, rerender, onChangeYours } = renderOps({
    yours,
    theirs: twoTheirs,
    inventory: [card],
  });

  await act(async () => {
    await result.current.addYours('inv-1');
  });
  expect(result.current.limitMsg).not.toBeNull();

  // Parent narrows the other side to one — the same add now goes through.
  rerender({ yours, theirs: [twoTheirs[0]], inventory: [card] });
  await act(async () => {
    await result.current.addYours('inv-1');
  });
  expect(onChangeYours).toHaveBeenCalledTimes(1);
  expect(result.current.limitMsg).toBeNull();
});

test('the guard applies symmetrically to their side', async () => {
  const yours = [mkTradeEntry({ key: 'y1' }), mkTradeEntry({ key: 'y2' })];
  const theirs = [mkTradeEntry({ key: 't1' })];
  const { result, onChangeTheirs } = renderOps({ yours, theirs });

  await act(async () => {
    await result.current.addTheirs(mkPick());
  });

  expect(onChangeTheirs).not.toHaveBeenCalled();
  expect(result.current.limitMsg).not.toBeNull();
});

test('bumpQty mutates only the keyed entry and floors at 1', () => {
  const yours = [
    mkTradeEntry({ key: 'y1', qty: 2 }),
    mkTradeEntry({ key: 'y2', qty: 4 }),
  ];
  const { result, onChangeYours } = renderOps({ yours });

  act(() => result.current.bumpQty(yours, onChangeYours)('y1', 1));
  expect(onChangeYours).toHaveBeenLastCalledWith([
    { ...yours[0], qty: 3 },
    yours[1],
  ]);

  act(() => result.current.bumpQty(yours, onChangeYours)('y1', -10));
  expect(onChangeYours).toHaveBeenLastCalledWith([
    { ...yours[0], qty: 1 },
    yours[1],
  ]);
});

test('removeEntry drops only the keyed entry', () => {
  const theirs = [mkTradeEntry({ key: 't1' }), mkTradeEntry({ key: 't2' })];
  const { result, onChangeTheirs } = renderOps({ theirs });

  act(() => result.current.removeEntry(theirs, onChangeTheirs)('t1'));
  expect(onChangeTheirs).toHaveBeenCalledWith([theirs[1]]);
});
