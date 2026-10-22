import { File } from 'expo-file-system';
import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import {
  ensureCatalogDownloaded,
  downloadLatestMarketPrices,
} from '../src/services/CatalogDownloadService';
import { closeCatalogDatabase, setCatalogDatabase } from '../src/db/catalogDb';
import { closeEventImageDb } from '../src/db/eventCatalogDb';
import { useProgressStore } from '../src/store/progressStore';

jest.mock('../src/db/catalogDb', () => ({
  closeCatalogDatabase: jest.fn(async () => {}),
  setCatalogDatabase: jest.fn(),
  purgeCodeCards: jest.fn(async () => {}),
}));

jest.mock('../src/db/eventCatalogDb', () => ({
  closeEventImageDb: jest.fn(),
}));

const CATALOG_URI = 'file:///mock/document/SQLite/pokequant_catalog.db';
const WAL_URI = `${CATALOG_URI}-wal`;
const SHM_URI = `${CATALOG_URI}-shm`;
const CATALOG_URL_RE =
  /^https:\/\/pub-81d2f5a4ba9a4821bc03f0c3375f9536\.r2\.dev\/mobile_catalog\.db\?v=\d+$/;

const download = jest.mocked(File.downloadFileAsync);
const mockClose = jest.mocked(closeCatalogDatabase);
const mockSetDb = jest.mocked(setCatalogDatabase);
const mockCloseEventImage = jest.mocked(closeEventImageDb);
const mockOpenDb = jest.mocked(openDatabaseSync);

// Mutable existence set — the exists getter reads it so a test can make files
// "appear" mid-flight (e.g. after a download resolves).
let existing: Set<string>;
let deletedFiles: string[];

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

async function flushUntil(cond: () => boolean, max = 50): Promise<void> {
  for (let i = 0; i < max && !cond(); i += 1) {
    await tick();
  }
}

function fakeDb(rows: { name: string }[] | Error): SQLiteDatabase {
  return {
    getAllAsync:
      rows instanceof Error
        ? jest.fn(async () => {
            throw rows;
          })
        : jest.fn(async () => rows),
    closeSync: jest.fn(),
  } as unknown as SQLiteDatabase;
}

const VALID_ROWS = [{ name: 'cards' }, { name: 'price_history' }];

beforeAll(() => {
  // The service logs on handled failure paths (download rejections, missing
  // tables) by design.
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks keeps mockImplementation — drop any resolved/deferred impl
  // a previous test left on the download mock.
  download.mockReset();
  existing = new Set();
  deletedFiles = [];
  jest.spyOn(File.prototype, 'exists', 'get').mockImplementation(function (this: File) {
    return existing.has(this.uri);
  });
  jest.spyOn(File.prototype, 'delete').mockImplementation(function (this: File) {
    deletedFiles.push(this.uri);
  });
  useProgressStore.setState({
    isExtracting: false,
    isCatalogReady: false,
    catalogDownloadProgress: 0,
    catalogDownloadLabel: '',
    catalogDownloadPhase: 'download',
    catalogLastUpdated: null,
  });
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('ensureCatalogDownloaded', () => {
  test('catalog file present → no download, ready flag set', async () => {
    existing.add(CATALOG_URI);

    const res = await ensureCatalogDownloaded();

    expect(res).toEqual({ exists: true, path: CATALOG_URI, downloaded: false });
    expect(download).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
    expect(useProgressStore.getState().isCatalogReady).toBe(true);
  });

  test('download contract: closes DBs first, deletes only existing stale files, downloads with anti-cache options', async () => {
    // The download path only runs when the file check doesn't short-circuit —
    // force a refresh while the catalog + -wal exist so the stale sweep
    // deletes exactly those two.
    existing.add(CATALOG_URI);
    existing.add(WAL_URI);
    download.mockResolvedValue({} as File);

    const res = await ensureCatalogDownloaded(true);

    expect(res).toEqual({ exists: true, path: CATALOG_URI, downloaded: true });
    expect(download).toHaveBeenCalledTimes(1);

    const firstDownloadOrder = download.mock.invocationCallOrder[0];
    expect(mockClose.mock.invocationCallOrder[0]).toBeLessThan(firstDownloadOrder);
    expect(mockCloseEventImage.mock.invocationCallOrder[0]).toBeLessThan(firstDownloadOrder);

    // Stale sweep: catalog + -wal existed, -shm did not → exactly 2 deletes.
    expect(deletedFiles).toEqual([CATALOG_URI, WAL_URI]);
    expect(deletedFiles).not.toContain(SHM_URI);

    const [url, destination, options] = download.mock.calls[0];
    expect(url).toMatch(CATALOG_URL_RE);
    expect(destination.uri).toBe(CATALOG_URI);
    expect(options?.idempotent).toBe(true);
    expect(options?.headers).toEqual({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(typeof options?.onProgress).toBe('function');

    options?.onProgress?.({ bytesWritten: 50, totalBytes: 200 });
    expect(useProgressStore.getState().catalogDownloadProgress).toBe(0.25);
    options?.onProgress?.({ bytesWritten: 50, totalBytes: 0 });
    expect(useProgressStore.getState().catalogDownloadProgress).toBe(0);

    const state = useProgressStore.getState();
    expect(state.catalogDownloadPhase).toBe('complete');
    expect(state.isCatalogReady).toBe(true);
    expect(typeof state.catalogLastUpdated).toBe('number');
    expect(state.isExtracting).toBe(false);
  });

  test('while the download is in flight the store claims extraction with the download label', async () => {
    let resolve!: (f: File) => void;
    download.mockReturnValueOnce(
      new Promise<File>((r) => {
        resolve = r;
      }),
    );

    const p = ensureCatalogDownloaded();
    await flushUntil(() => download.mock.calls.length > 0);

    const state = useProgressStore.getState();
    expect(state.isExtracting).toBe(true);
    expect(state.catalogDownloadLabel).toBe('Downloading price list...');
    expect(state.catalogDownloadPhase).toBe('download');

    resolve({} as File);
    await p;
    expect(useProgressStore.getState().isExtracting).toBe(false);
  });

  test('concurrent ensure calls coalesce onto one download and resolve to the same object', async () => {
    let resolve!: (f: File) => void;
    download.mockReturnValueOnce(
      new Promise<File>((r) => {
        resolve = r;
      }),
    );

    const p1 = ensureCatalogDownloaded();
    const p2 = ensureCatalogDownloaded();
    await flushUntil(() => download.mock.calls.length > 0);

    resolve({} as File);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(download).toHaveBeenCalledTimes(1);
    expect(r2).toBe(r1);
  });

  test('downloadLatestMarketPrices joins an in-flight ensure download', async () => {
    let resolve!: (f: File) => void;
    download.mockReturnValueOnce(
      new Promise<File>((r) => {
        resolve = r;
      }),
    );

    const p1 = ensureCatalogDownloaded();
    await flushUntil(() => download.mock.calls.length > 0);
    const p2 = downloadLatestMarketPrices();
    await tick();

    expect(mockOpenDb).not.toHaveBeenCalled();

    resolve({} as File);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(download).toHaveBeenCalledTimes(1);
    expect(r2).toBe(r1);
    expect(mockOpenDb).not.toHaveBeenCalled();
  });

  test('ensureCatalogDownloaded joins an in-flight price refresh', async () => {
    let resolve!: (f: File) => void;
    download.mockReturnValueOnce(
      new Promise<File>((r) => {
        resolve = r;
      }),
    );
    const db = fakeDb(VALID_ROWS);
    mockOpenDb.mockReturnValue(db);

    const p1 = downloadLatestMarketPrices();
    await flushUntil(() => download.mock.calls.length > 0);
    const p2 = ensureCatalogDownloaded();

    resolve({} as File);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(download).toHaveBeenCalledTimes(1);
    expect(r2).toBe(r1);
    expect(mockOpenDb).toHaveBeenCalledTimes(1);
  });

  test('offline download failure maps to the offline message and resets the phase', async () => {
    download.mockRejectedValueOnce(new Error('Network request failed'));

    await expect(ensureCatalogDownloaded()).rejects.toThrow('No internet — connect to download.');

    const state = useProgressStore.getState();
    expect(state.catalogDownloadPhase).toBe('download');
    expect(state.isExtracting).toBe(false);
    expect(state.catalogDownloadProgress).toBe(0);
  });

  test('non-offline download failure rethrows the same error instance', async () => {
    const err = new Error('disk full');
    download.mockRejectedValueOnce(err);

    await expect(ensureCatalogDownloaded()).rejects.toBe(err);

    expect(useProgressStore.getState().catalogDownloadPhase).toBe('download');
    expect(useProgressStore.getState().isExtracting).toBe(false);
  });

  test('the single-flight slot clears after a failure — the next call downloads again', async () => {
    download.mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce({} as File);

    await expect(ensureCatalogDownloaded()).rejects.toThrow('disk full');
    const res = await ensureCatalogDownloaded();

    expect(download).toHaveBeenCalledTimes(2);
    expect(res.downloaded).toBe(true);
  });

  test('a joiner on a failed download swallows the rejection and runs its own attempt', async () => {
    download.mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce({} as File);

    const p1 = ensureCatalogDownloaded();
    const p2 = ensureCatalogDownloaded();

    await expect(p1).rejects.toThrow('disk full');
    const r2 = await p2;

    expect(download).toHaveBeenCalledTimes(2);
    expect(r2).toEqual({ exists: true, path: CATALOG_URI, downloaded: true });
  });
});

describe('downloadLatestMarketPrices', () => {
  test('happy path: validates cards + price_history then adopts the handle', async () => {
    download.mockResolvedValue({} as File);
    const db = fakeDb(VALID_ROWS);
    mockOpenDb.mockReturnValue(db);

    const res = await downloadLatestMarketPrices();

    expect(res).toEqual({ exists: true, path: CATALOG_URI, downloaded: true });
    expect(mockOpenDb).toHaveBeenCalledWith('pokequant_catalog.db');
    expect(db.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining('FROM sqlite_master'),
      'cards',
      'price_history',
    );
    expect(db.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining('IN (?,?)'),
      'cards',
      'price_history',
    );
    expect(mockSetDb).toHaveBeenCalledTimes(1);
    expect(mockSetDb).toHaveBeenCalledWith(db);
    expect(db.closeSync).not.toHaveBeenCalled();

    const state = useProgressStore.getState();
    expect(state.isCatalogReady).toBe(true);
    expect(state.catalogDownloadPhase).toBe('complete');
    expect(state.isExtracting).toBe(false);
  });

  test('missing tables on the first file → closes the handle and retries once', async () => {
    download.mockResolvedValue({} as File);
    const db1 = fakeDb([{ name: 'cards' }]);
    const db2 = fakeDb(VALID_ROWS);
    mockOpenDb.mockReturnValueOnce(db1).mockReturnValueOnce(db2);

    const res = await downloadLatestMarketPrices();

    expect(res.downloaded).toBe(true);
    expect(download).toHaveBeenCalledTimes(2);
    expect(mockOpenDb).toHaveBeenCalledTimes(2);
    expect(db1.closeSync).toHaveBeenCalledTimes(1);
    expect(db2.closeSync).not.toHaveBeenCalled();
    expect(mockSetDb).toHaveBeenCalledTimes(1);
    expect(mockSetDb).toHaveBeenCalledWith(db2);
  });

  test('a throwing getAllAsync is treated as an invalid catalog (same retry path)', async () => {
    download.mockResolvedValue({} as File);
    const db1 = fakeDb(new Error('sqlite exploded'));
    const db2 = fakeDb(VALID_ROWS);
    mockOpenDb.mockReturnValueOnce(db1).mockReturnValueOnce(db2);

    const res = await downloadLatestMarketPrices();

    expect(res.downloaded).toBe(true);
    expect(download).toHaveBeenCalledTimes(2);
    expect(db1.closeSync).toHaveBeenCalledTimes(1);
    expect(mockSetDb).toHaveBeenCalledWith(db2);
  });

  test('both downloads invalid → rejects after retry and closes both handles', async () => {
    download.mockResolvedValue({} as File);
    const db1 = fakeDb([{ name: 'cards' }]);
    const db2 = fakeDb([{ name: 'cards' }]);
    mockOpenDb.mockReturnValueOnce(db1).mockReturnValueOnce(db2);

    await expect(downloadLatestMarketPrices()).rejects.toThrow(
      'Downloaded catalog missing required tables after retry',
    );

    expect(download).toHaveBeenCalledTimes(2);
    expect(db1.closeSync).toHaveBeenCalledTimes(1);
    expect(db2.closeSync).toHaveBeenCalledTimes(1);
    expect(mockSetDb).not.toHaveBeenCalled();
    expect(useProgressStore.getState().catalogDownloadPhase).toBe('download');
  });

  test('a failed first download retries and succeeds', async () => {
    download.mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce({} as File);
    const db = fakeDb(VALID_ROWS);
    mockOpenDb.mockReturnValue(db);

    const res = await downloadLatestMarketPrices();

    expect(res.downloaded).toBe(true);
    expect(download).toHaveBeenCalledTimes(2);
  });

  test('both downloads fail → rejects with the second error', async () => {
    const errB = new Error('b');
    download.mockRejectedValueOnce(new Error('a')).mockRejectedValueOnce(errB);

    await expect(downloadLatestMarketPrices()).rejects.toBe(errB);
    expect(download).toHaveBeenCalledTimes(2);
  });

  test('offline on both attempts maps to the offline message', async () => {
    download.mockRejectedValue(new Error('Network request failed'));

    await expect(downloadLatestMarketPrices()).rejects.toThrow(
      'No internet — connect to download.',
    );
    expect(download).toHaveBeenCalledTimes(2);
    expect(useProgressStore.getState().catalogDownloadPhase).toBe('download');
  });
});
