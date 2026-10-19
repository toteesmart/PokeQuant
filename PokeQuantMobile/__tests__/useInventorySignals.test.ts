import AsyncStorage from '@react-native-async-storage/async-storage';
import { act } from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';
import rawSignalFixture from './fixtures/inventorySignals.json';
import { mkInventoryCard, mkSignal } from './helpers/builders';
import { hydrateSignal } from './helpers/hydrate';
import { renderHook } from './helpers/renderHook';
import { useInventorySignals } from '../src/hooks/useInventorySignals';
import {
  getCardSignals,
  getProductMarketData,
  openCatalogDatabase,
  type CardSignal,
  type ProductMarketMap,
} from '../src/db/catalogDb';
import { classifyDeal, type DealClassId } from '../src/scanner/services/deal/dealClassify';
import { useInventoryStore } from '../src/store/inventoryStore';
import { useWatchlistStore } from '../src/store/watchlistStore';
import { DEFAULT_VELOCITY } from '../src/services/portfolioVelocity';
import * as logModule from '../src/utils/log';

// catalogDb is partially mocked at the three seams the debounced load hits.
// Everything downstream stays real: pickSignalForFinish finish fallback,
// dealShiftTracker on the jest-mocked AsyncStorage (the persisted class map
// is seeded through getItem), buildVelocityWindows, and the stores.
jest.mock('../src/db/catalogDb', () => {
  const actual = jest.requireActual<typeof import('../src/db/catalogDb')>('../src/db/catalogDb');
  return {
    ...actual,
    openCatalogDatabase: jest.fn(),
    getProductMarketData: jest.fn(),
    getCardSignals: jest.fn(),
  };
});

const mockOpen = jest.mocked(openCatalogDatabase);
const mockMarket = jest.mocked(getProductMarketData);
const mockSignals = jest.mocked(getCardSignals);
const mockGetItem = jest.mocked(AsyncStorage.getItem);
const mockSetItem = jest.mocked(AsyncStorage.setItem);

const catalogDbHandle = {} as SQLiteDatabase;

// The load pass debounces 500ms of real time.
const flushSignals = () =>
  act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 600));
  });
const insideDebounce = () =>
  act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  });

const seedClassMap = (map: Record<string, unknown>) =>
  mockGetItem.mockImplementation((key: string) =>
    Promise.resolve(key === 'deal_class_map_v1' ? JSON.stringify(map) : null),
  );

// AsyncStorage.setItem also carries the watchlist store's persist writes —
// find the class-map write by key rather than trusting call order.
const persistedClassMap = () => {
  const call = mockSetItem.mock.calls.find(([key]) => key === 'deal_class_map_v1');
  expect(call).toBeDefined();
  return JSON.parse(call![1]);
};

// A card still bleeding off a months-old peak — classifies POST_SPIKE_BLEED.
const bleedSignal = (productId: number) =>
  mkSignal({
    productId,
    ret7d: -10,
    ret30d: -15,
    ret90d: -20,
    drawdown: -30,
    daysSinceHigh: 60,
    pctile1y: 20,
    low90d: 2,
  });

const market = (
  marketPrice: number,
  over: Partial<ProductMarketMap[number]> = {},
): ProductMarketMap[number] => ({
  marketPrice,
  matchedSubType: 'Normal',
  date: '2026-10-01',
  price1d: marketPrice,
  price3d: marketPrice,
  price7d: marketPrice,
  price30d: marketPrice,
  range90dHigh: marketPrice,
  range90dLow: marketPrice,
  ...over,
});

// Catalog-signal fixtures — raw card_signals rows (the cycler also
// carries the card_deep LEFT JOIN d_* fields) hydrated through the same
// row→signal mapping catalogDb uses, so the populated-map pins run on
// real-shaped rows, not mkSignal literals. Each fixture declares the
// DealClassId the scalar classifyDeal path lands on — the class set the
// hook's shift diff maps.
type SignalFixture = {
  cards: Record<string, { cls: DealClassId; signal: Record<string, unknown> }>;
};
const fixtureSignals = Object.values((rawSignalFixture as unknown as SignalFixture).cards).map(
  (entry) => ({ declared: entry.cls, signal: hydrateSignal(entry.signal) }),
);
const fixtureSignalMap: Record<number, Record<string, CardSignal>> = {};
for (const { signal } of fixtureSignals) {
  fixtureSignalMap[signal.productId] = { [signal.subType]: signal };
}
const fixtureHeld = fixtureSignals.map(({ signal }, i) =>
  mkInventoryCard({ id: `fx-${i}`, productId: signal.productId, productType: 'Normal' }),
);
const fixtureIds = fixtureSignals.map(({ signal }) => signal.productId).sort((a, b) => a - b);

type GateProps = { ready: boolean; extracting: boolean };

const renderSignals = (props: GateProps = { ready: true, extracting: false }) =>
  renderHook((p: GateProps) => useInventorySignals(p.ready, p.extracting), props);

beforeEach(() => {
  jest.clearAllMocks();
  mockOpen.mockResolvedValue(catalogDbHandle);
  mockMarket.mockResolvedValue({});
  mockSignals.mockResolvedValue({});
  mockGetItem.mockResolvedValue(null);
  act(() => {
    useInventoryStore.setState({ activeInventory: [] });
    useWatchlistStore.setState({ cards: {} });
  });
});

test('a closed catalog gate never touches the DB and keeps defaults', async () => {
  act(() => {
    useInventoryStore.setState({
      activeInventory: [mkInventoryCard({ productId: 1 })],
    });
  });
  const { result } = renderSignals({ ready: false, extracting: false });
  await flushSignals();

  expect(mockOpen).not.toHaveBeenCalled();
  expect(result.current.velocityData).toEqual(DEFAULT_VELOCITY);
  expect(result.current.signalMap).toEqual({});
  expect(result.current.classShifts).toEqual([]);
  expect(result.current.watchShifts).toEqual([]);
});

test('an extracting gate never fetches either', async () => {
  act(() => {
    useInventoryStore.setState({
      activeInventory: [mkInventoryCard({ productId: 1 })],
    });
  });
  renderSignals({ ready: true, extracting: true });
  await flushSignals();
  expect(mockOpen).not.toHaveBeenCalled();
});

test('ready with no coverage never fetches', async () => {
  renderSignals();
  await flushSignals();
  expect(mockOpen).not.toHaveBeenCalled();
});

test('the load fans out over sorted unique product ids, held + watched', async () => {
  act(() => {
    useInventoryStore.setState({
      activeInventory: [
        mkInventoryCard({ id: 'a', productId: 9, productType: 'Holofoil' }),
        mkInventoryCard({ id: 'b', productId: 3 }),
        mkInventoryCard({ id: 'c', productId: 9, rarity: 'Rare' }),
        mkInventoryCard({ id: 'd', productId: null }),
      ],
    });
    useWatchlistStore.setState({
      cards: {
        '5|Normal': {
          productId: 5,
          subType: 'Normal',
          name: 'Snorlax',
          addedAt: '2026-10-01',
        },
      },
    });
  });
  renderSignals();
  await flushSignals();

  // Sorted, deduped, held + watched union.
  const ids = [3, 5, 9];
  expect(mockSignals).toHaveBeenCalledWith(catalogDbHandle, ids);
  // variantMap comes from inventory only — first card wins per productId,
  // productType over rarity, 'Normal' as the default.
  expect(mockMarket).toHaveBeenCalledWith(catalogDbHandle, ids, {
    3: 'Normal',
    9: 'Holofoil',
  });
});

test('velocity windows aggregate the real portfolio math', async () => {
  act(() => {
    useInventoryStore.setState({
      activeInventory: [
        mkInventoryCard({
          id: 'a',
          productId: 1,
          stock: 2,
          name: 'Pikachu',
        }),
        // No productId — excluded from the market map entirely.
        mkInventoryCard({ id: 'b', productId: null }),
      ],
    });
  });
  mockMarket.mockResolvedValue({
    1: market(10, { price1d: 8, price3d: 9, price7d: 5 }),
  });

  const { result } = renderSignals();
  await flushSignals();

  // (live - then) * stock per window.
  expect(result.current.velocityData['1d'].change).toBeCloseTo(4);
  expect(result.current.velocityData['3d'].change).toBeCloseTo(2);
  expect(result.current.velocityData['1w'].change).toBeCloseTo(10);
  expect(result.current.velocityData['1d'].movers).toHaveLength(1);
  expect(result.current.velocityData['1d'].movers[0]).toMatchObject({
    name: 'Pikachu',
    productId: 1,
    oldPrice: 8,
    newPrice: 10,
  });
});

test('signal map lands verbatim; a signals failure is swallowed to {}', async () => {
  const sig = mkSignal({ productId: 1 });
  mockSignals.mockResolvedValue({ 1: { Normal: sig } });
  act(() => {
    useInventoryStore.setState({
      activeInventory: [mkInventoryCard({ productId: 1 })],
    });
  });
  const ok = renderSignals();
  await flushSignals();
  expect(ok.result.current.signalMap).toEqual({ 1: { Normal: sig } });
  ok.unmount();

  // Signals rejecting is contained — velocity still builds off market data.
  mockSignals.mockRejectedValue(new Error('table missing'));
  mockMarket.mockResolvedValue({ 1: market(10, { price1d: 9 }) });
  const degraded = renderSignals();
  await flushSignals();
  expect(degraded.result.current.signalMap).toEqual({});
  expect(degraded.result.current.velocityData['1d'].change).toBeCloseTo(1);
});

test('a full pipeline failure logs and leaves the surface at defaults', async () => {
  const errSpy = jest.spyOn(logModule, 'logError').mockImplementation(() => {});
  mockOpen.mockRejectedValue(new Error('catalog gone'));
  act(() => {
    useInventoryStore.setState({
      activeInventory: [mkInventoryCard({ productId: 1 })],
    });
  });
  const { result } = renderSignals();
  await flushSignals();

  expect(errSpy).toHaveBeenCalledWith('Failed to load market velocity:', expect.any(Error));
  expect(result.current.velocityData).toEqual(DEFAULT_VELOCITY);
  errSpy.mockRestore();
});

test('a coverage change inside the debounce collapses to one fetch', async () => {
  act(() => {
    useInventoryStore.setState({
      activeInventory: [mkInventoryCard({ id: 'a', productId: 1 })],
    });
  });
  renderSignals();

  await insideDebounce();
  expect(mockMarket).not.toHaveBeenCalled();

  // Coverage changes before the timer fires — the killed timer never
  // claimed the key, so the rescheduled run ships the latest set.
  act(() => {
    useInventoryStore.setState({
      activeInventory: [
        mkInventoryCard({ id: 'a', productId: 1 }),
        mkInventoryCard({ id: 'b', productId: 2 }),
      ],
    });
  });
  await flushSignals();

  expect(mockMarket).toHaveBeenCalledTimes(1);
  expect(mockMarket).toHaveBeenCalledWith(catalogDbHandle, [1, 2], {
    1: 'Normal',
    2: 'Normal',
  });
});

test('edits that keep coverage do not reload; new coverage does', async () => {
  act(() => {
    useInventoryStore.setState({
      activeInventory: [mkInventoryCard({ id: 'a', productId: 1 })],
    });
  });
  renderSignals();
  await flushSignals();
  expect(mockMarket).toHaveBeenCalledTimes(1);

  // Same productId set — a qty/sticker edit must not re-run the load.
  act(() => {
    useInventoryStore.setState({
      activeInventory: [
        mkInventoryCard({ id: 'a', productId: 1, stickerPrice: 99 }),
        mkInventoryCard({ id: 'b', productId: 1 }),
      ],
    });
  });
  await flushSignals();
  expect(mockMarket).toHaveBeenCalledTimes(1);

  act(() => {
    useInventoryStore.setState({
      activeInventory: [
        mkInventoryCard({ id: 'a', productId: 1 }),
        mkInventoryCard({ id: 'b', productId: 7 }),
      ],
    });
  });
  await flushSignals();
  expect(mockMarket).toHaveBeenCalledTimes(2);
  expect(mockMarket).toHaveBeenLastCalledWith(catalogDbHandle, [1, 7], {
    1: 'Normal',
    7: 'Normal',
  });
});

test('a held card shifting classes surfaces in classShifts', async () => {
  const card = mkInventoryCard({ id: 'a', productId: 1, productType: 'Normal' });
  act(() => {
    useInventoryStore.setState({ activeInventory: [card] });
  });
  seedClassMap({
    '1|Normal': { cls: 'BASE_FORMING', label: 'At a low', cracked: false },
  });
  mockSignals.mockResolvedValue({ 1: { Normal: bleedSignal(1) } });

  const { result } = renderSignals();
  await flushSignals();

  expect(result.current.classShifts).toHaveLength(1);
  const shift = result.current.classShifts[0];
  expect(shift.card).toBe(card);
  expect(shift.from.cls).toBe('BASE_FORMING');
  expect(shift.to.cls).toBe('POST_SPIKE_BLEED');
  // A floor-premised class turning into a faller reads as the floor dying.
  expect(shift.kind).toBe('floor_crack');
  expect(result.current.watchShifts).toEqual([]);

  // The merged next map persists — next refresh diffs against this stamp.
  expect(mockSetItem).toHaveBeenCalledWith(
    'deal_class_map_v1',
    expect.stringContaining('"1|Normal"'),
  );
  const persisted = persistedClassMap();
  expect(persisted['1|Normal'].cls).toBe('POST_SPIKE_BLEED');
});

test('LOW_DATA stamps suppress the shift but still restamp', async () => {
  act(() => {
    useInventoryStore.setState({
      activeInventory: [mkInventoryCard({ id: 'a', productId: 1, productType: 'Normal' })],
    });
  });
  seedClassMap({ '1|Normal': { cls: 'LOW_DATA', label: 'Low data' } });
  mockSignals.mockResolvedValue({ 1: { Normal: bleedSignal(1) } });

  const { result } = renderSignals();
  await flushSignals();

  // Gaining data isn't a movement shift.
  expect(result.current.classShifts).toEqual([]);
  const persisted = persistedClassMap();
  expect(persisted['1|Normal'].cls).toBe('POST_SPIKE_BLEED');
});

test('a same-class price crack flags as floor_crack', async () => {
  act(() => {
    useInventoryStore.setState({
      activeInventory: [mkInventoryCard({ id: 'a', productId: 1, productType: 'Normal' })],
    });
  });
  seedClassMap({
    '1|Normal': { cls: 'STABLE_FLAT', label: 'Flat & steady', cracked: false },
  });
  // Flat card parked 3%+ under its stamped 90d floor — the class holds,
  // but the exit trigger fired between refreshes.
  mockSignals.mockResolvedValue({
    1: { Normal: mkSignal({ productId: 1, price: 10, low90d: 12 }) },
  });

  const { result } = renderSignals();
  await flushSignals();

  expect(result.current.classShifts).toHaveLength(1);
  expect(result.current.classShifts[0].kind).toBe('floor_crack');
  expect(result.current.classShifts[0].to.label).toBe('under its floor');
});

test('watched cards shift into watchShifts, not classShifts', async () => {
  act(() => {
    useInventoryStore.setState({ activeInventory: [] });
    useWatchlistStore.setState({
      cards: {
        '9|Normal': {
          productId: 9,
          subType: 'Normal',
          name: 'Snorlax',
          addedAt: '2026-10-01',
        },
      },
    });
  });
  seedClassMap({
    '9|Normal': { cls: 'DORMANT', label: 'Quiet / cheap', cracked: false },
  });
  // Quiet card showing fresh life — classifies REVIVAL.
  mockSignals.mockResolvedValue({
    9: {
      Normal: mkSignal({
        productId: 9,
        ret30d: 15,
        pctile1y: 30,
        trend: 'flat',
        cagr: 0,
      }),
    },
  });

  const { result } = renderSignals();
  await flushSignals();

  expect(result.current.classShifts).toEqual([]);
  expect(result.current.watchShifts).toHaveLength(1);
  expect(result.current.watchShifts[0].kind).toBe('revival');
  expect(result.current.watchShifts[0].to.cls).toBe('REVIVAL');
  expect(result.current.watchShifts[0].card.productId).toBe(9);
});

test('dismissShifts clears both banners', async () => {
  act(() => {
    useInventoryStore.setState({
      activeInventory: [mkInventoryCard({ id: 'a', productId: 1, productType: 'Normal' })],
    });
  });
  seedClassMap({
    '1|Normal': { cls: 'BASE_FORMING', label: 'At a low', cracked: false },
  });
  mockSignals.mockResolvedValue({ 1: { Normal: bleedSignal(1) } });

  const { result } = renderSignals();
  await flushSignals();
  expect(result.current.classShifts).toHaveLength(1);

  act(() => result.current.dismissShifts());
  expect(result.current.classShifts).toEqual([]);
  expect(result.current.watchShifts).toEqual([]);
});

test('closing the gate wipes the loaded surface', async () => {
  mockSignals.mockResolvedValue({ 1: { Normal: mkSignal({ productId: 1 }) } });
  mockMarket.mockResolvedValue({ 1: market(10, { price1d: 9 }) });
  act(() => {
    useInventoryStore.setState({
      activeInventory: [mkInventoryCard({ id: 'a', productId: 1 })],
    });
  });
  const { result, rerender } = renderSignals();
  await flushSignals();
  expect(result.current.signalMap).not.toEqual({});
  expect(result.current.velocityData['1d'].change).toBeCloseTo(1);

  // The gate closing mid-session wipes the derived surface — a stale
  // signal map can't keep dressing rows for a catalog that's gone.
  rerender({ ready: false, extracting: false });
  expect(result.current.signalMap).toEqual({});
  expect(result.current.velocityData).toEqual(DEFAULT_VELOCITY);
});

test('signal fixtures classify to the deal classes they declare', () => {
  // Scalar path — the same read diffDealClasses makes inside the hook.
  // A pipeline stamp drift or a row-shape change fails here first, not
  // mid-suite inside a map assertion.
  for (const { declared, signal } of fixtureSignals) {
    expect(classifyDeal(signal).cls).toBe(declared);
  }
});

test('a closed gate stays empty; an open gate lands the populated map', async () => {
  act(() => {
    useInventoryStore.setState({ activeInventory: fixtureHeld });
  });
  mockSignals.mockResolvedValue(fixtureSignalMap);

  // Gate closed — the populated answer is waiting on the seam and the
  // hook still never reaches for it.
  const closed = renderSignals({ ready: false, extracting: false });
  await flushSignals();
  expect(mockOpen).not.toHaveBeenCalled();
  expect(closed.result.current.signalMap).toEqual({});
  closed.unmount();

  // Gate open — the map lands verbatim, keyed productId → subType.
  const open = renderSignals();
  await flushSignals();
  expect(mockSignals).toHaveBeenCalledWith(catalogDbHandle, fixtureIds);
  expect(open.result.current.signalMap).toEqual(fixtureSignalMap);
  for (const { signal } of fixtureSignals) {
    expect(open.result.current.signalMap[signal.productId][signal.subType]).toBe(signal);
  }
});

test('a populated map diffs held cards into all three shift kinds', async () => {
  act(() => {
    useInventoryStore.setState({ activeInventory: fixtureHeld });
  });
  // Last refresh remembered each card one class behind, so the fixture
  // spread exercises floor_crack / revival / move in a single diff.
  seedClassMap({
    '900001|Normal': { cls: 'BASE_FORMING', label: 'At a low', cracked: false },
    '900002|Normal': { cls: 'DORMANT', label: 'Quiet / cheap', cracked: false },
    '900003|Normal': { cls: 'STABLE_FLAT', label: 'Flat & steady', cracked: false },
  });
  mockSignals.mockResolvedValue(fixtureSignalMap);

  const { result } = renderSignals();
  await flushSignals();

  expect(result.current.classShifts).toHaveLength(3);
  expect(result.current.watchShifts).toEqual([]);
  const byProduct = new Map(result.current.classShifts.map((s) => [s.card.productId, s]));
  // A floor-premised card turning faller is the floor dying.
  expect(byProduct.get(900001)).toMatchObject({
    kind: 'floor_crack',
    from: { cls: 'BASE_FORMING' },
    to: { cls: 'POST_SPIKE_BLEED' },
  });
  expect(byProduct.get(900002)).toMatchObject({
    kind: 'revival',
    from: { cls: 'DORMANT' },
    to: { cls: 'REVIVAL' },
  });
  expect(byProduct.get(900003)).toMatchObject({
    kind: 'move',
    from: { cls: 'STABLE_FLAT' },
    to: { cls: 'RANGE_PLAY' },
  });

  // All three restamp — the next refresh diffs against these classes.
  const persisted = persistedClassMap();
  for (const { declared, signal } of fixtureSignals) {
    expect(persisted[`${signal.productId}|Normal`].cls).toBe(declared);
  }
});
