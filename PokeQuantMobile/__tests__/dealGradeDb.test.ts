import type { SQLiteDatabase } from 'expo-sqlite';
import { recordDealGrades, type DealGradeInsert } from '../src/scanner/services/deal/dealGradeDb';
import { generateId } from '../src/db/database';
import type { CardSignal } from '../src/db/catalogDb';
import * as logModule from '../src/utils/log';

// generateId is the only runtime dep recordDealGrades pulls from the
// tenant-db module; the catalogDb/dealClassify imports are type-only.
jest.mock('../src/db/database', () => ({
  generateId: jest.fn(),
}));

const mockId = jest.mocked(generateId);

type FakeDb = SQLiteDatabase & { execAsync: jest.Mock; runAsync: jest.Mock };

const mkDb = (): FakeDb =>
  ({
    execAsync: jest.fn(async () => {}),
    runAsync: jest.fn(async () => ({ changes: 1, lastInsertRowId: 1 })),
  }) as unknown as FakeDb;

const mkRow = (over: Partial<DealGradeInsert> = {}): DealGradeInsert => ({
  inventoryId: 'inv-1',
  userId: 'user-1',
  productId: 42,
  subType: 'Normal',
  offerGiven: 8,
  signal: null,
  cls: 'DIP_BUY',
  risk: 'good',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  let n = 0;
  mockId.mockImplementation(() => `id-${++n}`);
});

// Runs first: ensurePromise memoizes on the first real insert, so the
// early-return pin only proves itself while execAsync is still countable.
test('empty input returns before touching the db', async () => {
  const db = mkDb();
  await recordDealGrades(db, []);
  expect(db.execAsync).not.toHaveBeenCalled();
  expect(db.runAsync).not.toHaveBeenCalled();
});

test('rows land as one multi-row INSERT with flattened per-row args', async () => {
  const db = mkDb();
  const signal = {
    price: 9.5,
    action: 'buy',
    confidence: 'high',
  } as unknown as CardSignal;

  await recordDealGrades(db, [
    mkRow({ signal }),
    mkRow({
      inventoryId: 'inv-2',
      productId: null,
      subType: null,
      offerGiven: null,
      cls: 'DORMANT',
      risk: 'risky',
    }),
  ]);

  // Two rows used to mean two runAsync calls — now one statement.
  expect(db.runAsync).toHaveBeenCalledTimes(1);
  const [sql, ...args] = db.runAsync.mock.calls[0] as [string, ...(string | number | null)[]];
  expect(sql).toContain('INSERT INTO deal_grades');
  expect(sql).toContain('VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?,?,?,?,?,?)');
  expect(args).toHaveLength(26);
  expect(args.slice(0, 13)).toEqual([
    'id-1',
    'inv-1',
    'user-1',
    42,
    'Normal',
    'DIP_BUY',
    'good',
    9.5,
    8,
    'buy',
    'high',
    JSON.stringify(signal),
    expect.any(Number),
  ]);
  // The signal-less row maps every signal column to null.
  expect(args.slice(13)).toEqual([
    'id-2',
    'inv-2',
    'user-1',
    null,
    null,
    'DORMANT',
    'risky',
    null,
    null,
    null,
    null,
    null,
    expect.any(Number),
  ]);
});

test('a failed insert warns and resolves — grade writes never block', async () => {
  const warn = jest.spyOn(logModule, 'logWarn').mockImplementation(() => {});
  const db = mkDb();
  db.runAsync.mockRejectedValueOnce(new Error('disk full'));

  await expect(recordDealGrades(db, [mkRow()])).resolves.toBeUndefined();
  expect(warn).toHaveBeenCalledWith('recordDealGrades failed (non-fatal):', expect.any(Error));
  warn.mockRestore();
});
