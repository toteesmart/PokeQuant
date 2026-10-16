import type { SQLiteDatabase } from 'expo-sqlite';
import { mkInventoryCard } from './helpers/builders';
import { flushAsync, renderHook } from './helpers/renderHook';
import { useBuyScout } from '../src/hooks/useBuyScout';
import {
  getCardSignals,
  getScoutRows,
  pickSignalForFinish,
  type ScoutRow,
} from '../src/db/catalogDb';
import {
  scoutCandidates,
  scoutFloorBuys,
  type ScoutCandidate,
} from '../src/scanner/services/deal/buyScout';
import { buildStockHealth, type StockHealth } from '../src/scanner/services/deal/stockHealth';
import type { InventoryCard } from '../src/store/inventoryStore';

// Seam map: every deal-engine piece is a jest.fn — getScoutRows is the SQL
// funnel, scoutCandidates/scoutFloorBuys the classify pass, getCardSignals +
// pickSignalForFinish the held-row signal read, buildStockHealth the bucket
// pass. The pins here are the orchestration: gating, run-once ref, ownedId
// construction, fan-out args, and redeployValue = rotate + dead. The math
// inside each seam has its own deep suite (buyScout/stockHealth tests).

jest.mock('../src/db/catalogDb', () => ({
  getCardSignals: jest.fn(),
  getScoutRows: jest.fn(),
  pickSignalForFinish: jest.fn(),
}));

jest.mock('../src/scanner/services/deal/buyScout', () => ({
  scoutCandidates: jest.fn(),
  scoutFloorBuys: jest.fn(),
}));

jest.mock('../src/scanner/services/deal/stockHealth', () => ({
  buildStockHealth: jest.fn(),
}));

const mockRows = jest.mocked(getScoutRows);
const mockSignals = jest.mocked(getCardSignals);
const mockPick = jest.mocked(pickSignalForFinish);
const mockScout = jest.mocked(scoutCandidates);
const mockFloors = jest.mocked(scoutFloorBuys);
const mockHealth = jest.mocked(buildStockHealth);

const DB = { __catalog: true } as unknown as SQLiteDatabase;
const ROWS = [{ signal: { productId: 1 } }] as unknown as ScoutRow[];
const CANDS = [{ productId: 1 }] as unknown as ScoutCandidate[];
const FLOORS = [{ productId: 2 }] as unknown as ScoutCandidate[];

const mkHealth = (rotate: number, dead: number): StockHealth => ({
  totalValue: 0,
  totalCost: 0,
  coverage: 0,
  buckets: {
    grow: { count: 0, value: 0, cost: 0 },
    keep: { count: 0, value: 0, cost: 0 },
    watch: { count: 0, value: 0, cost: 0 },
    rotate: { count: 0, value: rotate, cost: 0 },
    dead: { count: 0, value: dead, cost: 0 },
  },
  rotateOut: [],
  items: [],
  headline: '',
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRows.mockResolvedValue(ROWS);
  mockSignals.mockResolvedValue({});
  mockScout.mockReturnValue(CANDS);
  mockFloors.mockReturnValue(FLOORS);
  mockHealth.mockReturnValue(mkHealth(30, 12));
});

test('does nothing until both a handle and catalog-readiness arrive', async () => {
  renderHook(() => useBuyScout(null, false, []));
  await flushAsync();
  renderHook(() => useBuyScout(DB, false, []));
  await flushAsync();
  renderHook(() => useBuyScout(null, true, []));
  await flushAsync();
  expect(mockRows).not.toHaveBeenCalled();
});

test('the funnel runs once per mount even when the inventory prop churns', async () => {
  const { rerender } = renderHook((p: { inv: InventoryCard[] }) => useBuyScout(DB, true, p.inv), {
    inv: [mkInventoryCard({ productId: 10 })],
  });
  await flushAsync();
  expect(mockRows).toHaveBeenCalledTimes(1);

  rerender({ inv: [mkInventoryCard({ productId: 10 }), mkInventoryCard({ productId: 22 })] });
  await flushAsync();
  expect(mockRows).toHaveBeenCalledTimes(1);
  expect(mockScout).toHaveBeenCalledTimes(1);
});

test('rows funnel through both scout arms with the owned set and fixed limits', async () => {
  const inv = [
    mkInventoryCard({ id: 'a', productId: 10 }),
    mkInventoryCard({ id: 'b', productId: 10 }), // dup productId dedupes
    mkInventoryCard({ id: 'c', productId: 22 }),
    mkInventoryCard({ id: 'd', productId: null }),
    mkInventoryCard({ id: 'e' }), // productId undefined
  ];
  const { result } = renderHook(() => useBuyScout(DB, true, inv));
  await flushAsync();

  expect(mockRows).toHaveBeenCalledWith(DB);
  expect(mockScout).toHaveBeenCalledWith(ROWS, new Set([10, 22]), 40);
  expect(mockFloors).toHaveBeenCalledWith(ROWS, new Set([10, 22]), 15);
  expect(result.current.scout).toBe(CANDS);
  expect(result.current.floorBuys).toBe(FLOORS);
});

test('stock health reads through the finish picker; redeploy = rotate + dead', async () => {
  const signals = { 10: { Normal: {} } };
  mockSignals.mockResolvedValue(signals as never);
  const inv = [mkInventoryCard({ id: 'a', productId: 10 })];
  const { result } = renderHook(() => useBuyScout(DB, true, inv));
  await flushAsync();

  expect(mockSignals).toHaveBeenCalledWith(DB, [10]);
  expect(mockHealth).toHaveBeenCalledTimes(1);
  const [invArg, picker] = mockHealth.mock.calls[0];
  expect(invArg).toBe(inv);

  // The picker the hook hands to buildStockHealth delegates to
  // pickSignalForFinish against the fetched signal map.
  const card = mkInventoryCard({ id: 'z', productId: 10 });
  mockPick.mockReturnValue('SIG' as never);
  expect(picker(card)).toBe('SIG');
  expect(mockPick).toHaveBeenCalledWith(signals, card);

  expect(result.current.redeployValue).toBe(42); // 30 rotate + 12 dead
});

test('empty inventory still runs the funnel but skips the signal fetch', async () => {
  const { result } = renderHook(() => useBuyScout(DB, true, []));
  await flushAsync();

  expect(mockRows).toHaveBeenCalledTimes(1);
  expect(mockSignals).not.toHaveBeenCalled();
  expect(mockHealth).toHaveBeenCalledWith([], expect.any(Function));
  expect(result.current.redeployValue).toBe(42);
});

test('the signal fetch starts in parallel with the funnel, not after it', async () => {
  let resolveRows!: (rows: ScoutRow[]) => void;
  mockRows.mockImplementation(
    () =>
      new Promise<ScoutRow[]>((resolve) => {
        resolveRows = resolve;
      }),
  );

  renderHook(() => useBuyScout(DB, true, [mkInventoryCard({ productId: 10 })]));
  await flushAsync();

  // getScoutRows is still pending, but the independent getCardSignals
  // read has already launched — the two run under one Promise.all.
  expect(mockSignals).toHaveBeenCalledWith(DB, [10]);
  expect(mockHealth).not.toHaveBeenCalled();

  resolveRows(ROWS);
  await flushAsync();
  expect(mockHealth).toHaveBeenCalledTimes(1);
});

test('a funnel failure settles to empty lists without throwing', async () => {
  mockRows.mockRejectedValueOnce(new Error('db gone'));
  const { result } = renderHook(() => useBuyScout(DB, true, [mkInventoryCard()]));
  await flushAsync();

  expect(result.current.scout).toEqual([]);
  expect(result.current.floorBuys).toEqual([]);
  expect(result.current.redeployValue).toBe(0);
  expect(mockScout).not.toHaveBeenCalled();
  expect(mockHealth).not.toHaveBeenCalled();
});
