import { File } from 'expo-file-system';
import { Share } from 'react-native';
import * as Sharing from 'expo-sharing';
import { exportInventoryCsv, exportSalesCsv, toCsv } from '../src/services/ExportService';
import { useInventoryStore, type CompletedSale } from '../src/store/inventoryStore';
import { mkInventoryCard } from './helpers/builders';

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}));

const isAvailable = jest.mocked(Sharing.isAvailableAsync);
const shareAsync = jest.mocked(Sharing.shareAsync);

let existing: Set<string>;
let createdUris: string[];
let written: Record<string, string>;
let deletedUris: string[];
let shareSpy: jest.SpyInstance;

const mkSale = (over: Partial<CompletedSale> = {}): CompletedSale => ({
  id: 'sale-1',
  name: 'Pikachu',
  acquiredCost: 5,
  soldPrice: 12,
  dateSold: '2026-10-01',
  ...over,
});

function stamp(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}${mm}${dd}`;
}

beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks keeps mockImplementation — reseed inert defaults.
  isAvailable.mockReset();
  shareAsync.mockReset();
  existing = new Set();
  createdUris = [];
  written = {};
  deletedUris = [];
  jest.spyOn(File.prototype, 'exists', 'get').mockImplementation(function (this: File) {
    return existing.has(this.uri);
  });
  jest.spyOn(File.prototype, 'create').mockImplementation(function (this: File) {
    createdUris.push(this.uri);
  });
  jest.spyOn(File.prototype, 'write').mockImplementation(function (
    this: File,
    contents: string | Uint8Array,
  ) {
    written[this.uri] = String(contents);
  });
  jest.spyOn(File.prototype, 'delete').mockImplementation(function (this: File) {
    deletedUris.push(this.uri);
  });
  shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
  useInventoryStore.setState({ activeInventory: [], completedSales: [] });
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('toCsv', () => {
  type Row = { name?: string | null; num?: number };

  const cols = [
    { header: 'Name', value: (r: Row) => r.name },
    { header: 'Num', value: (r: Row) => r.num },
  ];

  test('emits a BOM header row and CRLF joins with a trailing CRLF', () => {
    const csv = toCsv([{ name: 'a', num: 1 }], cols);
    expect(csv).toBe('﻿Name,Num\r\na,1\r\n');
  });

  test('RFC 4180 quoting: commas, doubled quotes, newlines; null/undefined empty; numbers bare', () => {
    const csv = toCsv(
      [{ name: 'Pikachu, Captain', num: 3 }, { name: 'a"b' }, { name: 'x\ny' }, { name: null }, {}],
      cols,
    );
    expect(csv).toBe('﻿Name,Num\r\n"Pikachu, Captain",3\r\n"a""b",\r\n"x\ny",\r\n,\r\n,\r\n');
  });
});

describe('exportInventoryCsv', () => {
  test('writes the header + Variant fallback rows and shares via expo-sharing', async () => {
    useInventoryStore.setState({
      activeInventory: [
        mkInventoryCard({ name: 'Pikachu', number: '025', rarity: 'Illustration Rare' }),
        mkInventoryCard({ name: 'Bulba', productType: 'Normal' }),
      ],
    });
    isAvailable.mockResolvedValue(true);
    const fileName = `cardcache_inventory_${stamp()}.csv`;
    const fileUri = `file:///mock/cache/${fileName}`;
    existing.add(fileUri);

    await exportInventoryCsv();

    expect(createdUris).toEqual([fileUri]);
    const csv = written[fileUri];
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(
      '﻿Name,Number,Set,Condition,Variant,Qty,Amount Paid,Sticker Price,Live Market,Proj Profit,Product ID,Acquired',
    );
    // rarity ?? productType: first row carries rarity, second falls back.
    expect(lines[1].split(',')[4]).toBe('Illustration Rare');
    expect(lines[2].split(',')[4]).toBe('Normal');

    expect(shareAsync).toHaveBeenCalledWith(fileUri, {
      mimeType: 'text/csv',
      dialogTitle: fileName,
      UTI: 'public.comma-separated-values-text',
    });
    expect(shareSpy).not.toHaveBeenCalled();
    // The cache copy existed at cleanup time → deleted.
    expect(deletedUris).toEqual([fileUri]);
  });

  test('create() is called with intermediates + overwrite', async () => {
    isAvailable.mockResolvedValue(true);
    const createSpy = jest.spyOn(File.prototype, 'create');

    await exportInventoryCsv();

    expect(createSpy).toHaveBeenCalledWith({ intermediates: true, overwrite: true });
  });

  test('falls back to Share.share when expo-sharing is unavailable', async () => {
    isAvailable.mockResolvedValue(false);
    const fileName = `cardcache_inventory_${stamp()}.csv`;
    const fileUri = `file:///mock/cache/${fileName}`;

    await exportInventoryCsv();

    expect(shareAsync).not.toHaveBeenCalled();
    expect(shareSpy).toHaveBeenCalledWith({ url: fileUri, title: fileName });
  });

  test('a rejecting shareAsync still deletes the file and propagates', async () => {
    const fileName = `cardcache_inventory_${stamp()}.csv`;
    const fileUri = `file:///mock/cache/${fileName}`;
    existing.add(fileUri);
    isAvailable.mockResolvedValue(true);
    shareAsync.mockRejectedValue(new Error('share failed'));

    await expect(exportInventoryCsv()).rejects.toThrow('share failed');
    expect(deletedUris).toEqual([fileUri]);
  });

  test('cleanup is skipped when the file does not exist and a throwing delete is swallowed', async () => {
    isAvailable.mockResolvedValue(true);
    // exists=false → delete not attempted.
    await exportInventoryCsv();
    expect(deletedUris).toEqual([]);

    // delete throwing must not propagate (best-effort cleanup).
    const fileUri = `file:///mock/cache/cardcache_inventory_${stamp()}.csv`;
    existing.add(fileUri);
    jest.spyOn(File.prototype, 'delete').mockImplementation(() => {
      throw new Error('delete failed');
    });
    await expect(exportInventoryCsv()).resolves.toBeUndefined();
  });
});

describe('exportSalesCsv', () => {
  test('writes the sales header and shares the dated file', async () => {
    useInventoryStore.setState({
      completedSales: [mkSale({ name: 'Charizard', soldPrice: 200 })],
    });
    isAvailable.mockResolvedValue(true);
    const fileName = `cardcache_sales_${stamp()}.csv`;
    const fileUri = `file:///mock/cache/${fileName}`;
    existing.add(fileUri);

    await exportSalesCsv();

    const csv = written[fileUri];
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('﻿Name,Number,Set,Condition,Acquired Cost,Sold Price,Date Sold');
    expect(lines[1]).toBe('Charizard,,,,5,200,2026-10-01');
    expect(shareAsync).toHaveBeenCalledWith(
      fileUri,
      expect.objectContaining({ dialogTitle: fileName }),
    );
    expect(deletedUris).toEqual([fileUri]);
  });
});
