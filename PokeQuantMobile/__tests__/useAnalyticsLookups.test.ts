import { act } from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';
import { flushAsync, renderHook } from './helpers/renderHook';
import { useAnalyticsLookups } from '../src/hooks/useAnalyticsLookups';
import { getDatabase } from '../src/db/database';
import {
  getTradeLogByInventoryIds,
  type TradeLogSummary,
} from '../src/scanner/services/deal/tradeLogDb';
import {
  getClassTrackRecord,
  type ClassTrackRecord,
} from '../src/scanner/services/deal/dealGradeDb';
import type { CompletedSale } from '../src/store/inventoryStore';

// Seam map: getDatabase hands back the tenant handle (or null pre-init);
// the two deal-DB readers are jest.fns. Pins: the null-db gate, the
// empty-sales skip on the trade log only, the ids reaching the seam, and
// the cancelled guard dropping a stale load after completedSales changes.

jest.mock('../src/db/database', () => ({
  getDatabase: jest.fn(),
}));

jest.mock('../src/scanner/services/deal/tradeLogDb', () => ({
  getTradeLogByInventoryIds: jest.fn(),
}));

jest.mock('../src/scanner/services/deal/dealGradeDb', () => ({
  getClassTrackRecord: jest.fn(),
}));

const mockGetDb = jest.mocked(getDatabase);
const mockTradeLog = jest.mocked(getTradeLogByInventoryIds);
const mockTrackRecord = jest.mocked(getClassTrackRecord);

const DB = { __tenant: true } as unknown as SQLiteDatabase;

const mkSale = (over: Partial<CompletedSale> = {}): CompletedSale => ({
  id: 'sale-1',
  name: 'Pikachu',
  acquiredCost: 5,
  soldPrice: 12,
  dateSold: '2026-10-01',
  ...over,
});

const mkSummary = (over: Partial<TradeLogSummary> = {}): TradeLogSummary => ({
  id: 't-1',
  verdict: 'win',
  reason: 'under market',
  tradedAt: '2026-10-10',
  ...over,
});

const mkRecord = (over: Partial<ClassTrackRecord> = {}): ClassTrackRecord => ({
  dealClass: 'REVIVAL',
  graded: 3,
  sold: 1,
  wins: 1,
  avgMargin: 4,
  avgDaysToSell: 9,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetDb.mockReturnValue(DB);
  mockTradeLog.mockResolvedValue(new Map());
  mockTrackRecord.mockResolvedValue([]);
});

test('no db handle → no lookups at all', async () => {
  mockGetDb.mockReturnValue(null);
  const { result } = renderHook(() => useAnalyticsLookups([mkSale()]));
  await flushAsync();

  expect(mockTradeLog).not.toHaveBeenCalled();
  expect(mockTrackRecord).not.toHaveBeenCalled();
  expect(result.current.tradeByInvId.size).toBe(0);
  expect(result.current.trackRecord).toEqual([]);
});

test('empty sales still load the track record but skip the trade log', async () => {
  mockTrackRecord.mockResolvedValue([mkRecord()]);
  const { result } = renderHook(() => useAnalyticsLookups([]));
  await flushAsync();

  expect(mockTradeLog).not.toHaveBeenCalled();
  expect(mockTrackRecord).toHaveBeenCalledWith(DB);
  expect(result.current.trackRecord).toEqual([mkRecord()]);
});

test('sold rows pull the trade log keyed by sale id, against the tenant db', async () => {
  const map = new Map([['sale-1', mkSummary()]]);
  mockTradeLog.mockResolvedValue(map);
  mockTrackRecord.mockResolvedValue([mkRecord()]);

  const { result } = renderHook(() =>
    useAnalyticsLookups([mkSale({ id: 'sale-1' }), mkSale({ id: 'sale-2' })])
  );
  await flushAsync();

  expect(mockTradeLog).toHaveBeenCalledWith(DB, ['sale-1', 'sale-2']);
  expect(result.current.tradeByInvId).toBe(map);
  expect(result.current.trackRecord).toEqual([mkRecord()]);
});

test('changing the sales list refetches the trade log with the new ids', async () => {
  const { rerender } = renderHook(
    (sales: CompletedSale[]) => useAnalyticsLookups(sales),
    [mkSale({ id: 'sale-1' })]
  );
  await flushAsync();

  rerender([mkSale({ id: 'sale-9' }), mkSale({ id: 'sale-10' })]);
  await flushAsync();

  expect(mockTradeLog).toHaveBeenLastCalledWith(DB, ['sale-9', 'sale-10']);
  expect(mockTradeLog).toHaveBeenCalledTimes(2);
});

test('a stale trade-log load is dropped when sales change mid-flight', async () => {
  let resolveFirst!: (m: Map<string, TradeLogSummary>) => void;
  const stale = new Map([['sale-1', mkSummary({ id: 'stale' })]]);
  const fresh = new Map([['sale-2', mkSummary({ id: 'fresh' })]]);
  mockTradeLog
    .mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
    .mockResolvedValueOnce(fresh);

  const { result, rerender } = renderHook(
    (sales: CompletedSale[]) => useAnalyticsLookups(sales),
    [mkSale({ id: 'sale-1' })]
  );
  await flushAsync();

  rerender([mkSale({ id: 'sale-2' })]);
  await flushAsync();
  expect(result.current.tradeByInvId).toBe(fresh);

  // The first load resolves after being superseded — its write is dropped.
  await act(async () => resolveFirst(stale));
  expect(result.current.tradeByInvId).toBe(fresh);
});
