import { act } from 'react';
import { Alert } from 'react-native';
import { File } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { mkCatalogCard } from './helpers/builders';
import { flushAsync, renderHook } from './helpers/renderHook';
import { useBulkImport } from '../src/hooks/useBulkImport';
import { initializeDatabase, getDrizzle } from '../src/db/database';
import { openCatalogDatabase } from '../src/db/catalogDb';
import { bulkInsertInventory } from '../src/db/inventoryDb';
import { parseSpreadsheetRows, resolveCatalogMatches } from '../src/components/import/importRows';
import { inventory } from '../src/db/schema';
import { useAuthStore } from '../src/store/authStore';
import { useInventoryStore } from '../src/store/inventoryStore';
import { useProgressStore } from '../src/store/progressStore';
import { useVendorStore } from '../src/store/vendorStore';

// Seam map: the parser/matcher pair is mocked at the importRows boundary —
// parseNumber stays real because the commit mapping leans on it. The tenant
// DB opens through initializeDatabase (mocked) and the write path is split:
// hook-level pins capture the payload handed to bulkInsertInventory, then a
// separate describe runs the real bulkInsertInventory against a fake drizzle
// handle to pin the InventoryInsert mapping itself.

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(),
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(),
}));

jest.mock('../src/components/import/importRows', () => {
  const actual = jest.requireActual<typeof import('../src/components/import/importRows')>(
    '../src/components/import/importRows',
  );
  return {
    ...actual,
    parseSpreadsheetRows: jest.fn(),
    resolveCatalogMatches: jest.fn(),
  };
});

jest.mock('../src/db/catalogDb', () => {
  const actual = jest.requireActual<typeof import('../src/db/catalogDb')>('../src/db/catalogDb');
  return { ...actual, openCatalogDatabase: jest.fn() };
});

jest.mock('../src/db/database', () => {
  const actual = jest.requireActual<typeof import('../src/db/database')>('../src/db/database');
  return {
    ...actual,
    initializeDatabase: jest.fn(),
    getDrizzle: jest.fn(),
  };
});

jest.mock('../src/db/inventoryDb', () => {
  const actual =
    jest.requireActual<typeof import('../src/db/inventoryDb')>('../src/db/inventoryDb');
  return { ...actual, bulkInsertInventory: jest.fn() };
});

const mockGetDocument = jest.mocked(DocumentPicker.getDocumentAsync);
const mockUUID = jest.mocked(Crypto.randomUUID);
const mockParse = jest.mocked(parseSpreadsheetRows);
const mockResolve = jest.mocked(resolveCatalogMatches);
const mockOpenCatalog = jest.mocked(openCatalogDatabase);
const mockInitDb = jest.mocked(initializeDatabase);
const mockGetDrizzle = jest.mocked(getDrizzle);
const mockBulkInsert = jest.mocked(bulkInsertInventory);

const realBulkInsert =
  jest.requireActual<typeof import('../src/db/inventoryDb')>(
    '../src/db/inventoryDb',
  ).bulkInsertInventory;

const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
const base64Spy = jest.spyOn(File.prototype, 'base64');

const catalogDb = { __catalog: true } as unknown as SQLiteDatabase;
const tenantDb = { __tenant: true } as unknown as SQLiteDatabase;
const mockRefreshInventory = jest.fn(async () => {});

type CatalogCardT = ReturnType<typeof mkCatalogCard>;
type RawRow = ReturnType<typeof parseSpreadsheetRows>[number];
type Hook = ReturnType<typeof useBulkImport>;

const rawRow = (over: Partial<RawRow> = {}): RawRow => ({
  name: 'Pikachu',
  set: 'SV151',
  number: '025',
  condition: 'NM',
  costBasis: '',
  stickerPrice: '',
  variant: 'Normal',
  ...over,
});

// row ids come from the mocked randomUUID — deterministic sequence, dashed,
// so the hook's dash-strip shows up in the expected values.
let uuidSeq = 0;
const uuidFor = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const idFor = (n: number) => uuidFor(n).replace(/-/g, '');

const pickedFile = () => ({
  canceled: false as const,
  assets: [{ uri: 'file:///cache/import.csv', name: 'import.csv', lastModified: 0 }],
});

// Drives pickFile to completion: picker → base64 → parse → verify step →
// match merge. Raw rows get uuid ids in order (1..n).
const pickRows = async (
  result: { current: Hook },
  raw: RawRow[],
  matches: Map<string, CatalogCardT | null>,
) => {
  mockGetDocument.mockResolvedValue(pickedFile());
  base64Spy.mockResolvedValue('QkI=');
  mockParse.mockReturnValue(raw);
  mockResolve.mockResolvedValue(matches);
  await act(async () => {
    await result.current.pickFile();
  });
};

// Fake drizzle handle for the real bulkInsertInventory — captures what the
// insert builder is asked to persist.
const inserted: { table: unknown; values: unknown[] }[] = [];
const fakeDrizzle = {
  insert: jest.fn((table: unknown) => ({
    values: jest.fn((values: unknown[]) => {
      inserted.push({ table, values });
      return {
        run: jest.fn(async () => ({})),
        onConflictDoUpdate: jest.fn(() => ({
          run: jest.fn(async () => ({})),
        })),
      };
    }),
  })),
};

beforeEach(() => {
  jest.clearAllMocks();
  uuidSeq = 0;
  inserted.length = 0;
  mockUUID.mockImplementation(() => uuidFor(++uuidSeq));
  base64Spy.mockResolvedValue('QkI=');
  mockOpenCatalog.mockResolvedValue(catalogDb);
  mockInitDb.mockResolvedValue({ db: tenantDb, ok: true, message: 'ok' });
  mockGetDrizzle.mockReturnValue(fakeDrizzle as never);
  mockBulkInsert.mockResolvedValue(0);

  act(() => {
    useAuthStore.setState({ userId: 'user-1' });
    useProgressStore.setState({ isCatalogReady: true, isExtracting: false });
    useInventoryStore.setState({
      refreshInventoryState: mockRefreshInventory,
    });
    // Real offer math: 50/60/70% tiers + Custom Cutoff (0.3) rounding.
    useVendorStore.setState({
      tiers: [
        { minDollar: 0, maxDollar: 10, marginPercent: 50 },
        { minDollar: 10, maxDollar: 50, marginPercent: 60 },
        { minDollar: 50, maxDollar: 999, marginPercent: 70 },
      ],
      stickerRules: {
        roundingMethod: 'Custom Cutoff',
        cutoff: 0.3,
        minSticker: 1.0,
      },
    });
  });
});

test('opening the sheet warms the catalog handle only when the catalog is ready', async () => {
  const { result, rerender } = renderHook<Hook, boolean>((v) => useBulkImport(v), false);
  await flushAsync();
  expect(mockOpenCatalog).not.toHaveBeenCalled();

  rerender(true);
  await flushAsync();
  expect(mockOpenCatalog).toHaveBeenCalledTimes(1);
  expect(result.current.step).toBe('pick');
});

test('a catalog that is not ready (or still extracting) opens no handle', async () => {
  act(() => {
    useProgressStore.setState({ isCatalogReady: false });
  });
  renderHook(() => useBulkImport(true));
  await flushAsync();
  expect(mockOpenCatalog).not.toHaveBeenCalled();

  act(() => {
    useProgressStore.setState({ isCatalogReady: true, isExtracting: true });
  });
  renderHook(() => useBulkImport(true));
  await flushAsync();
  expect(mockOpenCatalog).not.toHaveBeenCalled();
});

test('a cancelled pick leaves the wizard untouched', async () => {
  mockGetDocument.mockResolvedValue({ canceled: true, assets: null });
  const { result } = renderHook(() => useBulkImport(true));
  await flushAsync();

  await act(async () => {
    await result.current.pickFile();
  });

  expect(result.current.step).toBe('pick');
  expect(result.current.rows).toEqual([]);
  expect(result.current.error).toBeNull();
  expect(mockParse).not.toHaveBeenCalled();
});

test('an asset with no uri sets a friendly pick error', async () => {
  mockGetDocument.mockResolvedValue({
    canceled: false,
    assets: [{ uri: '', name: 'import.csv', lastModified: 0 }],
  });
  const { result } = renderHook(() => useBulkImport(true));
  await flushAsync();

  await act(async () => {
    await result.current.pickFile();
  });

  expect(result.current.error).toBe("Couldn't read that file — try picking it again.");
  expect(result.current.step).toBe('pick');
  expect(result.current.isLoading).toBe(false);
});

test('a parse with zero rows reports the file as empty', async () => {
  const { result } = renderHook(() => useBulkImport(true));
  await flushAsync();
  await pickRows(result, [], new Map());

  expect(result.current.error).toBe('No card rows found in that file.');
  expect(result.current.step).toBe('pick');
  expect(result.current.isLoading).toBe(false);
});

test('a throw while reading the file lands the generic pick error', async () => {
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  mockGetDocument.mockResolvedValue(pickedFile());
  base64Spy.mockRejectedValue(new Error('fs gone'));
  const { result } = renderHook(() => useBulkImport(true));
  await flushAsync();

  await act(async () => {
    await result.current.pickFile();
  });

  expect(result.current.error).toBe("Couldn't read that file — check it's a CSV or Excel sheet.");
  expect(result.current.step).toBe('pick');
  expect(result.current.isLoading).toBe(false);
  errSpy.mockRestore();
});

test('pickFile spins isLoading while the file is being read', async () => {
  let resolveB64!: (v: string) => void;
  mockGetDocument.mockResolvedValue(pickedFile());
  base64Spy.mockImplementation(() => new Promise<string>((resolve) => (resolveB64 = resolve)));
  const { result } = renderHook(() => useBulkImport(true));
  await flushAsync();

  act(() => {
    void result.current.pickFile();
  });
  await flushAsync();
  expect(result.current.isLoading).toBe(true);

  mockParse.mockReturnValue([rawRow()]);
  mockResolve.mockResolvedValue(new Map());
  await act(async () => resolveB64('QkI='));
  await flushAsync();
  expect(result.current.isLoading).toBe(false);
});

test('picked rows get dashless uuid ids and move the wizard to verify', async () => {
  const { result } = renderHook(() => useBulkImport(true));
  await flushAsync();

  await pickRows(result, [rawRow({ name: 'Pikachu' }), rawRow({ name: 'Charizard' })], new Map());

  expect(mockGetDocument).toHaveBeenCalledWith({
    type: '*/*',
    copyToCacheDirectory: true,
    multiple: false,
  });
  expect(mockParse).toHaveBeenCalledWith('QkI=');
  expect(result.current.step).toBe('verify');
  expect(result.current.rows).toEqual([
    {
      id: idFor(1),
      name: 'Pikachu',
      set: 'SV151',
      number: '025',
      condition: 'NM',
      costBasis: '',
      stickerPrice: '',
      variant: 'Normal',
      productId: null,
      matchedCard: null,
      isResolving: false,
    },
    {
      id: idFor(2),
      name: 'Charizard',
      set: 'SV151',
      number: '025',
      condition: 'NM',
      costBasis: '',
      stickerPrice: '',
      variant: 'Normal',
      productId: null,
      matchedCard: null,
      isResolving: false,
    },
  ]);
});

test('matching goes through the catalog handle with a 5-field row projection', async () => {
  const { result } = renderHook(() => useBulkImport(true));
  await flushAsync();

  const pika = mkCatalogCard({ productId: 42, name: 'Pikachu' });
  await pickRows(
    result,
    [rawRow({ name: 'Pikachu' }), rawRow({ name: 'Ghost' })],
    new Map([[idFor(1), pika]]),
  );

  expect(mockResolve).toHaveBeenCalledWith(catalogDb, [
    { id: idFor(1), name: 'Pikachu', set: 'SV151', number: '025', variant: 'Normal' },
    { id: idFor(2), name: 'Ghost', set: 'SV151', number: '025', variant: 'Normal' },
  ]);
  expect(result.current.rows[0].productId).toBe(42);
  expect(result.current.rows[0].matchedCard).toBe(pika);
  // A missing map key lands as an unresolved row — never an exception.
  expect(result.current.rows[1].matchedCard).toBeNull();
  expect(result.current.unresolvedCount).toBe(1);
  expect(result.current.canCommit).toBe(false);
});

test('no catalog handle still resolves the sheet — every row unmatched', async () => {
  act(() => {
    useProgressStore.setState({ isCatalogReady: false });
  });
  const { result } = renderHook(() => useBulkImport(true));
  await flushAsync();
  expect(mockOpenCatalog).not.toHaveBeenCalled();

  await pickRows(result, [rawRow(), rawRow()], new Map());

  expect(mockResolve).not.toHaveBeenCalled();
  expect(result.current.step).toBe('verify');
  expect(result.current.rows.every((r) => !r.isResolving)).toBe(true);
  expect(result.current.unresolvedCount).toBe(2);
});

test('searchCard re-resolves only the targeted row', async () => {
  const { result } = renderHook(() => useBulkImport(true));
  await flushAsync();
  await pickRows(result, [rawRow(), rawRow({ name: 'Charizard' })], new Map());
  mockResolve.mockClear();

  const charizard = mkCatalogCard({ productId: 6, name: 'Charizard' });
  mockResolve.mockResolvedValue(new Map([[idFor(2), charizard]]));
  await act(async () => {
    await result.current.searchCard(idFor(2));
  });

  expect(mockResolve).toHaveBeenCalledWith(catalogDb, [
    { id: idFor(2), name: 'Charizard', set: 'SV151', number: '025', variant: 'Normal' },
  ]);
  expect(result.current.rows[1].matchedCard).toBe(charizard);
  expect(result.current.rows[1].productId).toBe(6);
  expect(result.current.rows[0].matchedCard).toBeNull();
});

test('searchCard without a catalog handle is a no-op', async () => {
  act(() => {
    useProgressStore.setState({ isCatalogReady: false });
  });
  const { result } = renderHook(() => useBulkImport(true));
  await flushAsync();
  await pickRows(result, [rawRow()], new Map());
  mockResolve.mockClear();

  await act(async () => {
    await result.current.searchCard(idFor(1));
  });
  expect(mockResolve).not.toHaveBeenCalled();
});

test('updateRow merges partial edits into the targeted row only', async () => {
  const { result } = renderHook(() => useBulkImport(true));
  await flushAsync();
  await pickRows(result, [rawRow(), rawRow({ name: 'Charizard' })], new Map());

  act(() => {
    result.current.updateRow(idFor(2), { condition: 'LP', costBasis: '9.99' });
  });

  expect(result.current.rows[1].condition).toBe('LP');
  expect(result.current.rows[1].costBasis).toBe('9.99');
  expect(result.current.rows[0].condition).toBe('NM');
});

test('canCommit requires rows that are all matched and none resolving', async () => {
  const { result } = renderHook(() => useBulkImport(true));
  await flushAsync();
  expect(result.current.canCommit).toBe(false);

  const pika = mkCatalogCard();
  await pickRows(result, [rawRow()], new Map([[idFor(1), pika]]));
  expect(result.current.canCommit).toBe(true);
  expect(result.current.unresolvedCount).toBe(0);
});

test('commit without a user alerts instead of writing', async () => {
  act(() => {
    useAuthStore.setState({ userId: null });
  });
  const { result } = renderHook(() => useBulkImport(true));
  await flushAsync();
  await pickRows(result, [rawRow()], new Map([[idFor(1), mkCatalogCard()]]));

  await act(async () => {
    await result.current.commit();
  });

  expect(alertSpy).toHaveBeenCalledWith('Not signed in', 'Sign in to import cards.');
  expect(mockInitDb).not.toHaveBeenCalled();
  expect(mockBulkInsert).not.toHaveBeenCalled();
  expect(result.current.step).toBe('verify');
});

test('commit with unmatched rows alerts instead of writing', async () => {
  const { result } = renderHook(() => useBulkImport(true));
  await flushAsync();
  await pickRows(result, [rawRow()], new Map<string, CatalogCardT | null>([[idFor(1), null]]));

  await act(async () => {
    await result.current.commit();
  });

  expect(alertSpy).toHaveBeenCalledWith(
    'Unmatched rows',
    'Match every row to a card before importing.',
  );
  expect(mockBulkInsert).not.toHaveBeenCalled();
});

test('commit maps rows through vendor math into one batch insert', async () => {
  const onComplete = jest.fn();
  const { result } = renderHook<Hook, boolean>((v) => useBulkImport(v, onComplete), true);
  await flushAsync();

  const pika = mkCatalogCard({
    productId: 42,
    name: 'Pikachu',
    number: '025',
    set: 'SV151',
    liveMarket: 100,
    imageUrl: 'https://img.example/42.jpg',
  });
  const zard = mkCatalogCard({
    productId: 6,
    name: 'Charizard',
    number: '004',
    set: 'Base Set',
    liveMarket: 10,
    imageUrl: 'https://img.example/6.jpg',
  });
  await pickRows(
    result,
    [
      // LP → conditioned 85; empty costBasis → cash offer 70% tier → 59.50;
      // empty sticker → conditioned market → 85 under Custom Cutoff.
      rawRow({ name: 'Pikachu', condition: 'LP' }),
      // Explicit prices win: costBasis 3.25, sticker 7.80 → ceil → 8.
      rawRow({
        name: 'Charizard',
        number: '004',
        set: 'Base Set',
        condition: 'NM',
        costBasis: '3.25',
        stickerPrice: '7.80',
      }),
    ],
    new Map([
      [idFor(1), pika],
      [idFor(2), zard],
    ]),
  );

  await act(async () => {
    await result.current.commit();
  });

  expect(mockBulkInsert).toHaveBeenCalledTimes(1);
  const [dbArg, inputs] = mockBulkInsert.mock.calls[0];
  expect(dbArg).toBe(tenantDb);
  expect(inputs).toEqual([
    {
      id: idFor(1),
      userId: 'user-1',
      productId: 42,
      name: 'Pikachu',
      number: '025',
      set: 'SV151',
      variant: 'Normal',
      condition: 'LP',
      liveMarket: 85,
      amountPaid: 59.5,
      stickerPrice: 85,
      isBulk: false,
      imageUrl: 'https://img.example/42.jpg',
    },
    {
      id: idFor(2),
      userId: 'user-1',
      productId: 6,
      name: 'Charizard',
      number: '004',
      set: 'Base Set',
      variant: 'Normal',
      condition: 'NM',
      liveMarket: 10,
      amountPaid: 3.25,
      stickerPrice: 8,
      isBulk: false,
      imageUrl: 'https://img.example/6.jpg',
    },
  ]);

  // The store refresh is strictly after the insert resolves.
  expect(mockRefreshInventory).toHaveBeenCalledTimes(1);
  expect(mockRefreshInventory.mock.invocationCallOrder[0]).toBeGreaterThan(
    mockBulkInsert.mock.invocationCallOrder[0],
  );
  expect(result.current.step).toBe('done');
  expect(onComplete).toHaveBeenCalledTimes(1);
  expect(result.current.isLoading).toBe(false);
});

test('commit falls back through variant → productType → rarity', async () => {
  const { result } = renderHook(() => useBulkImport(true));
  await flushAsync();

  await pickRows(
    result,
    [
      rawRow({ name: 'A', variant: 'Reverse Holo' }),
      rawRow({ name: 'B', variant: '' }),
      rawRow({ name: 'C', variant: '' }),
    ],
    new Map([
      [idFor(1), mkCatalogCard({ productType: 'Holofoil', rarity: 'Rare' })],
      [idFor(2), mkCatalogCard({ productType: 'Holofoil', rarity: 'Rare' })],
      [idFor(3), mkCatalogCard({ productType: '', rarity: 'Promo' })],
    ]),
  );

  await act(async () => {
    await result.current.commit();
  });

  const inputs = mockBulkInsert.mock.calls[0][1];
  expect(inputs.map((i) => i.variant)).toEqual(['Reverse Holo', 'Holofoil', 'Promo']);
});

test('a failed insert alerts with the error and never reaches done', async () => {
  const onComplete = jest.fn();
  mockBulkInsert.mockRejectedValue(new Error('disk full'));
  const { result } = renderHook<Hook, boolean>((v) => useBulkImport(v, onComplete), true);
  await flushAsync();
  await pickRows(result, [rawRow()], new Map([[idFor(1), mkCatalogCard()]]));

  await act(async () => {
    await result.current.commit();
  });

  // Whole-batch abort — no per-row error collection in this contract.
  expect(alertSpy).toHaveBeenCalledWith('Import failed', expect.stringContaining('disk full'));
  expect(mockRefreshInventory).not.toHaveBeenCalled();
  expect(result.current.step).toBe('verify');
  expect(result.current.isLoading).toBe(false);
  expect(onComplete).not.toHaveBeenCalled();
});

test('duplicate rows are not deduped — each gets its own insert id', async () => {
  const { result } = renderHook(() => useBulkImport(true));
  await flushAsync();

  const pika = mkCatalogCard();
  await pickRows(
    result,
    [rawRow(), rawRow()],
    new Map([
      [idFor(1), pika],
      [idFor(2), pika],
    ]),
  );
  await act(async () => {
    await result.current.commit();
  });

  const inputs = mockBulkInsert.mock.calls[0][1];
  expect(inputs).toHaveLength(2);
  expect(inputs[0].id).toBe(idFor(1));
  expect(inputs[1].id).toBe(idFor(2));
});

test('closing and reopening the sheet resets the wizard', async () => {
  const { result, rerender } = renderHook<Hook, boolean>((v) => useBulkImport(v), true);
  await flushAsync();
  await pickRows(result, [rawRow()], new Map());
  expect(result.current.step).toBe('verify');

  rerender(false);
  expect(result.current.step).toBe('pick');
  expect(result.current.rows).toEqual([]);
  expect(result.current.error).toBeNull();

  rerender(true);
  await flushAsync();
  // The reopen re-warms the handle but does not resurrect stale rows.
  expect(mockOpenCatalog).toHaveBeenCalledTimes(2);
  expect(result.current.step).toBe('pick');
  expect(result.current.rows).toEqual([]);
});

describe('bulkInsertInventory (real implementation)', () => {
  test('maps inputs into a single atomic values() insert', async () => {
    const count = await realBulkInsert(tenantDb, [
      {
        id: 'row-a',
        userId: 'user-1',
        productId: 42,
        name: 'Pikachu',
        number: '025',
        set: 'SV151',
        variant: 'Normal',
        condition: 'LP',
        liveMarket: 85,
        amountPaid: 59.5,
        stickerPrice: 85,
        isBulk: false,
        imageUrl: 'https://img.example/42.jpg',
      },
      {
        userId: 'user-1',
        name: 'Charizard',
        liveMarket: 10,
        amountPaid: 3.25,
        stickerPrice: 8,
        isBulk: true,
      },
    ]);

    expect(count).toBe(2);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].table).toBe(inventory);

    const [a, b] = inserted[0].values as Record<string, unknown>[];
    expect(a).toEqual({
      id: 'row-a',
      userId: 'user-1',
      productId: 42,
      cardName: 'Pikachu',
      cardNumber: '025',
      setName: 'SV151',
      variant: 'Normal',
      condition: 'LP',
      purchasePrice: 59.5,
      stickerPrice: 85,
      dateBought: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      isBulkDeal: false,
      isSold: false,
      soldPrice: 0,
      dateSold: '',
      // variant doubles as the persisted productType inside customData.
      customImageData: JSON.stringify({
        liveMarket: 85,
        imageUrl: 'https://img.example/42.jpg',
        productType: 'Normal',
      }),
      isDeleted: false,
      updatedAt: expect.any(Number),
    });
    // A missing id falls back to a fresh dashless uuid.
    expect(b.id).toMatch(/^[0-9a-f]{32}$/);
    expect(b.isBulkDeal).toBe(true);
    expect(b.productId).toBeNull();
    expect(b.cardNumber).toBe('');
    expect(b.setName).toBe('');
    expect(b.variant).toBe('');
    expect(b.condition).toBe('');
  });

  test('productId coercion: null stays null, numeric strings truncate, junk lands 0', async () => {
    await realBulkInsert(tenantDb, [
      { userId: 'u', productId: null, name: 'a', liveMarket: 1, amountPaid: 0, stickerPrice: 1 },
      { userId: 'u', productId: 42.9, name: 'b', liveMarket: 1, amountPaid: 0, stickerPrice: 1 },
      {
        userId: 'u',
        productId: 'abc' as unknown as number,
        name: 'c',
        liveMarket: 1,
        amountPaid: 0,
        stickerPrice: 1,
      },
    ]);

    const values = inserted[0].values as Record<string, unknown>[];
    expect(values.map((v) => v.productId)).toEqual([null, 42, 0]);
  });

  test('a file:// imageUrl is persisted as the CDN fallback when productId exists', async () => {
    await realBulkInsert(tenantDb, [
      {
        userId: 'u',
        productId: 42,
        name: 'Pikachu',
        liveMarket: 10,
        amountPaid: 5,
        stickerPrice: 10,
        imageUrl: 'file:///catalog_images/42.jpg',
      },
      {
        userId: 'u',
        productId: null,
        name: 'NoId',
        liveMarket: 10,
        amountPaid: 5,
        stickerPrice: 10,
        imageUrl: 'file:///catalog_images/0.jpg',
      },
    ]);

    const values = inserted[0].values as Record<string, unknown>[];
    expect(values[0].customImageData).toBe(
      JSON.stringify({
        liveMarket: 10,
        imageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/42_400w.jpg',
      }),
    );
    // No productId → nothing portable to swap in; the local path stays.
    expect(values[1].customImageData).toBe(
      JSON.stringify({
        liveMarket: 10,
        imageUrl: 'file:///catalog_images/0.jpg',
      }),
    );
  });

  test('an empty batch returns 0 without touching the database', async () => {
    expect(await realBulkInsert(tenantDb, [])).toBe(0);
    expect(inserted).toHaveLength(0);
  });
});
