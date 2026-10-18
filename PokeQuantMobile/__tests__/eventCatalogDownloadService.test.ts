import { Directory, File } from 'expo-file-system';
import { subscribe, unzip } from 'react-native-zip-archive';
import type { NativeEventSubscription } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { ensureEventCatalogDownloaded } from '../src/services/EventCatalogDownloadService';
import { closeEventCatalogDatabase, openEventCatalogDatabase } from '../src/db/eventCatalogDb';
import { useProgressStore } from '../src/store/progressStore';

jest.mock('../src/db/eventCatalogDb', () => ({
  closeEventCatalogDatabase: jest.fn(),
  openEventCatalogDatabase: jest.fn(),
}));

const EVENT_DB_URI = 'file:///mock/document/SQLite/event_catalog.db';
const EVENT_DIR_URI = 'file:///mock/cache/event_catalogs';
const ZIP_URI = `${EVENT_DIR_URI}/event_catalog.zip`;
const EXTRACTED_URI = `${EVENT_DIR_URI}/extracted`;

const extractedDir = new Directory(EVENT_DIR_URI, 'extracted');

const download = jest.mocked(File.downloadFileAsync);
const mockCloseDb = jest.mocked(closeEventCatalogDatabase);
const mockOpenDb = jest.mocked(openEventCatalogDatabase);
const mockUnzip = jest.mocked(unzip);
const mockSubscribe = jest.mocked(subscribe);

// Mutable existence set — the File/Directory exists getters read it so a test
// can make files "appear" mid-flight (e.g. the zip and extracted JSON after
// the download resolves).
let existing: Set<string>;
let deleted: string[];
let listings: Record<string, (File | Directory)[]>;
let removeMock: jest.Mock;
let unzipCb: ((event: { progress: number; filePath: string }) => void) | undefined;
let db: SQLiteDatabase & {
  getFirstAsync: jest.Mock;
  runSync: jest.Mock;
  withTransactionSync: jest.Mock;
  execSync: jest.Mock;
  closeSync: jest.Mock;
};

const st = () => useProgressStore.getState();
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

async function flushUntil(cond: () => boolean, max = 50): Promise<void> {
  for (let i = 0; i < max && !cond(); i += 1) {
    await tick();
  }
}

function eventUrlRe(showId: string): RegExp {
  return new RegExp(
    `^https://pub-81d2f5a4ba9a4821bc03f0c3375f9536\\.r2\\.dev/shows/${showId}/event_catalog\\.json\\.zip\\?v=\\d+$`,
  );
}

// Wire an extracted dir listing that surfaces one JSON file carrying `rows`.
function arrangeJson(rows: unknown, fileName = 'event_catalog.json'): File {
  const f = new File(extractedDir, fileName);
  (f as File & { json: jest.Mock }).json = jest.fn().mockResolvedValue(rows);
  existing.add(EXTRACTED_URI);
  listings[EXTRACTED_URI] = [f];
  return f;
}

const ROW = { id: 'r1', product_id: 1, name: 'Pikachu', sticker_price: 9.5, quantity: 2 };

beforeAll(() => {
  // The service logs on handled failure paths (unzip rejections, missing
  // JSON, offline downloads) by design.
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks keeps mockImplementation — re-seed defaults so a deferred
  // promise from one test can't leak a pending download/unzip into the next.
  download.mockReset();
  mockUnzip.mockReset();
  mockUnzip.mockResolvedValue('');
  mockSubscribe.mockReset();
  existing = new Set();
  deleted = [];
  listings = {};
  removeMock = jest.fn();
  unzipCb = undefined;
  db = {
    getFirstAsync: jest.fn(),
    runSync: jest.fn(),
    withTransactionSync: jest.fn((fn: () => void) => fn()),
    execSync: jest.fn(),
    closeSync: jest.fn(),
  } as unknown as typeof db;
  mockOpenDb.mockReturnValue(db);

  jest.spyOn(File.prototype, 'exists', 'get').mockImplementation(function (this: File) {
    return existing.has(this.uri);
  });
  jest.spyOn(Directory.prototype, 'exists', 'get').mockImplementation(function (this: Directory) {
    return existing.has(this.uri);
  });
  jest.spyOn(File.prototype, 'delete').mockImplementation(function (this: File) {
    deleted.push(this.uri);
  });
  jest.spyOn(Directory.prototype, 'delete').mockImplementation(function (this: Directory) {
    deleted.push(this.uri);
  });
  jest.spyOn(Directory.prototype, 'list').mockImplementation(function (this: Directory) {
    return listings[this.uri] ?? [];
  });
  mockSubscribe.mockImplementation((cb) => {
    unzipCb = cb;
    return { remove: removeMock } as unknown as NativeEventSubscription;
  });

  useProgressStore.setState({
    isEventExtracting: false,
    eventDownloadProgress: 0,
    eventDownloadLabel: '',
    eventDownloadPhase: 'download',
  });
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('fast path', () => {
  test('existing rows for the show short-circuit to ready without a download', async () => {
    existing.add(EVENT_DB_URI);
    db.getFirstAsync.mockResolvedValue({ count: 3 });

    const res = await ensureEventCatalogDownloaded('show-1');

    expect(res).toEqual({ ready: true, downloaded: false });
    expect(db.getFirstAsync).toHaveBeenCalledWith(
      'SELECT COUNT(*) as count FROM show_inventory WHERE show_id = ?',
      'show-1',
    );
    expect(download).not.toHaveBeenCalled();
    expect(st().eventDownloadPhase).toBe('complete');
  });

  test('a zero row count falls through to the download path', async () => {
    existing.add(EVENT_DB_URI);
    db.getFirstAsync.mockResolvedValue({ count: 0 });
    download.mockResolvedValue({} as File);
    arrangeJson([ROW]);

    const res = await ensureEventCatalogDownloaded('show-1');

    expect(res).toEqual({ ready: true, downloaded: true });
    expect(download).toHaveBeenCalledTimes(1);
  });

  test('force=true skips the row-count query entirely', async () => {
    existing.add(EVENT_DB_URI);
    download.mockResolvedValue({} as File);
    arrangeJson([ROW]);

    const res = await ensureEventCatalogDownloaded('show-1', true);

    expect(res.downloaded).toBe(true);
    expect(db.getFirstAsync).not.toHaveBeenCalled();
    expect(download).toHaveBeenCalledTimes(1);
  });
});

describe('download → extract → hydrate contract', () => {
  test('ordering, options, progress, hydration and cleanup', async () => {
    const jsonFile = arrangeJson([ROW]);
    // The stale zip + extracted dir exist before the run; the unzip mock
    // recreates the zip and JSON so post-hydration cleanup deletes them.
    existing.add(ZIP_URI);
    let resolveUnzip!: (s: string) => void;
    mockUnzip.mockImplementation(
      () =>
        new Promise<string>((r) => {
          existing.add(jsonFile.uri);
          resolveUnzip = r;
        }),
    );
    let resolveDl!: (f: File) => void;
    download.mockReturnValueOnce(
      new Promise<File>((r) => {
        resolveDl = r;
      }),
    );

    const p = ensureEventCatalogDownloaded('show-1');
    await flushUntil(() => download.mock.calls.length > 0);

    // Ordering + stale sweep ran before the download was issued.
    expect(mockCloseDb.mock.invocationCallOrder[0]).toBeLessThan(
      download.mock.invocationCallOrder[0],
    );
    expect(deleted).toEqual([ZIP_URI, EXTRACTED_URI]);
    expect(st().isEventExtracting).toBe(true);
    expect(st().eventDownloadLabel).toBe('Downloading show listings...');
    expect(st().eventDownloadPhase).toBe('download');

    const [url, destination, options] = download.mock.calls[0];
    expect(url).toMatch(eventUrlRe('show-1'));
    expect(destination.uri).toBe(ZIP_URI);
    expect(options?.idempotent).toBe(true);
    expect(options?.headers).toEqual({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(typeof options?.onProgress).toBe('function');
    options?.onProgress?.({ bytesWritten: 1, totalBytes: 4 });
    expect(st().eventDownloadProgress).toBe(0.25);

    resolveDl({} as File);
    await flushUntil(() => mockUnzip.mock.calls.length > 0);

    // Extraction phase: progress now reports unzip progress via subscribe.
    expect(st().eventDownloadPhase).toBe('extract');
    expect(st().eventDownloadLabel).toBe('Unpacking show listings...');
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(mockUnzip).toHaveBeenCalledWith(ZIP_URI, EXTRACTED_URI);
    unzipCb?.({ progress: 0.4, filePath: ZIP_URI });
    expect(st().eventDownloadProgress).toBe(0.4);

    resolveUnzip('');
    const res = await p;

    // Hydration inside one transaction: DELETE first, then INSERT.
    expect(db.withTransactionSync).toHaveBeenCalledTimes(1);
    expect(db.runSync).toHaveBeenNthCalledWith(
      1,
      'DELETE FROM show_inventory WHERE show_id = ?',
      'show-1',
    );
    expect(db.runSync).toHaveBeenCalledTimes(2);
    expect(db.runSync.mock.calls[1][0]).toContain('INSERT OR REPLACE INTO show_inventory');

    // Post-hydration cleanup deleted the recreated zip and JSON.
    expect(deleted).toEqual([ZIP_URI, EXTRACTED_URI, ZIP_URI, jsonFile.uri]);
    expect(removeMock).toHaveBeenCalledTimes(1);
    expect(mockCloseDb).toHaveBeenCalledTimes(2);

    expect(res).toEqual({ ready: true, downloaded: true });
    expect(st().isEventExtracting).toBe(false);
    expect(st().eventDownloadPhase).toBe('complete');
  });

  test('recurses into nested directories and accepts an uppercase .JSON extension', async () => {
    const subDir = new Directory(extractedDir, 'nested');
    const jsonFile = new File(subDir, 'EVENT_CATALOG.JSON');
    (jsonFile as File & { json: jest.Mock }).json = jest.fn().mockResolvedValue([ROW]);
    const readme = new File(extractedDir, 'readme.txt');
    existing.add(EXTRACTED_URI);
    existing.add(subDir.uri);
    listings[EXTRACTED_URI] = [subDir, readme];
    listings[subDir.uri] = [jsonFile];
    download.mockResolvedValue({} as File);

    const res = await ensureEventCatalogDownloaded('show-1');

    expect(res.downloaded).toBe(true);
    expect(db.withTransactionSync).toHaveBeenCalledTimes(1);
  });

  test('no JSON anywhere in the extracted tree → error names the listed uris', async () => {
    const readme = new File(extractedDir, 'readme.txt');
    existing.add(EXTRACTED_URI);
    listings[EXTRACTED_URI] = [readme];
    download.mockResolvedValue({} as File);

    let err: unknown;
    try {
      await ensureEventCatalogDownloaded('show-1');
    } catch (e) {
      err = e;
    }
    expect(String(err)).toMatch(/Event catalog JSON missing after extraction/);
    expect(String(err)).toContain(readme.uri);
    expect(removeMock).toHaveBeenCalledTimes(1);
    expect(st().eventDownloadPhase).toBe('download');
    expect(st().isEventExtracting).toBe(false);
  });

  test('a non-array JSON payload is rejected', async () => {
    arrangeJson({ not: 'an array' });
    download.mockResolvedValue({} as File);

    await expect(ensureEventCatalogDownloaded('show-1')).rejects.toThrow(
      'Event catalog JSON is not an array',
    );
    expect(st().eventDownloadPhase).toBe('download');
  });

  test('an unzip rejection still removes the progress subscription and leaves the zip', async () => {
    // Simulate the file the download wrote: after it resolves the zip exists
    // on disk, so a cleanup delete would be recorded if it ran.
    download.mockImplementation(async () => {
      existing.add(ZIP_URI);
      return {} as File;
    });
    mockUnzip.mockRejectedValue(new Error('corrupt zip'));

    await expect(ensureEventCatalogDownloaded('show-1')).rejects.toThrow('corrupt zip');

    expect(removeMock).toHaveBeenCalledTimes(1);
    expect(st().eventDownloadPhase).toBe('download');
    expect(st().isEventExtracting).toBe(false);
    // Pin observed: post-hydration cleanup never runs on this path, so the
    // downloaded zip is left in cache even though it exists (only the
    // pre-download stale sweep — which ran before it was written — deletes).
    expect(existing.has(ZIP_URI)).toBe(true);
    expect(deleted).not.toContain(ZIP_URI);
  });

  test('an offline download maps to the offline message', async () => {
    download.mockRejectedValueOnce(new Error('Network request failed'));

    await expect(ensureEventCatalogDownloaded('show-1')).rejects.toThrow(
      'No internet — connect to download.',
    );
    expect(st().eventDownloadPhase).toBe('download');
  });
});

describe('insertInventoryRows chunking and coercion', () => {
  test('81 rows → DELETE + two INSERTs chunked at 80 rows / 960 params', async () => {
    const rows = Array.from({ length: 81 }, (_, i) => ({
      id: `r${i}`,
      product_id: i,
      name: `card ${i}`,
    }));
    arrangeJson(rows);
    download.mockResolvedValue({} as File);

    await ensureEventCatalogDownloaded('show-1');

    expect(db.runSync).toHaveBeenCalledTimes(3);
    const insert1 = db.runSync.mock.calls[1];
    expect(insert1[0].match(/\(\?/g)).toHaveLength(80);
    expect(insert1.slice(1)).toHaveLength(960);
    const insert2 = db.runSync.mock.calls[2];
    expect(insert2[0].match(/\(\?/g)).toHaveLength(1);
    expect(insert2.slice(1)).toHaveLength(12);
  });

  test('coerces JSON values into the 12-column arg order with show_id injected', async () => {
    arrangeJson([
      {
        id: 7,
        product_id: '123',
        name: undefined,
        sticker_price: 'abc',
        quantity: '2',
        set_name: null,
      },
    ]);
    download.mockResolvedValue({} as File);

    await ensureEventCatalogDownloaded('show-1');

    expect(db.runSync).toHaveBeenCalledTimes(2);
    expect(db.runSync.mock.calls[1].slice(1)).toEqual([
      '7',
      'show-1',
      123,
      '',
      '',
      '',
      '',
      '',
      0,
      2,
      '',
      '',
    ]);
  });

  test('empty rows still clear the show inside the transaction (DELETE only)', async () => {
    arrangeJson([]);
    download.mockResolvedValue({} as File);

    const res = await ensureEventCatalogDownloaded('show-1');

    expect(res.downloaded).toBe(true);
    expect(db.withTransactionSync).toHaveBeenCalledTimes(1);
    expect(db.runSync).toHaveBeenCalledTimes(1);
    expect(db.runSync).toHaveBeenCalledWith(
      'DELETE FROM show_inventory WHERE show_id = ?',
      'show-1',
    );
  });
});

describe('single-flight', () => {
  test('two concurrent calls for the same show coalesce to one download and one result object', async () => {
    arrangeJson([ROW]);
    let resolve!: (f: File) => void;
    download.mockReturnValueOnce(
      new Promise<File>((r) => {
        resolve = r;
      }),
    );

    const p1 = ensureEventCatalogDownloaded('show-1');
    const p2 = ensureEventCatalogDownloaded('show-1');
    await flushUntil(() => download.mock.calls.length > 0);

    resolve({} as File);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(download).toHaveBeenCalledTimes(1);
    expect(r2).toBe(r1);
  });

  test('a call for a different show waits for the in-flight download', async () => {
    arrangeJson([ROW]);
    let resolve!: (f: File) => void;
    download
      .mockReturnValueOnce(
        new Promise<File>((r) => {
          resolve = r;
        }),
      )
      .mockResolvedValue({} as File);

    const p1 = ensureEventCatalogDownloaded('show-1');
    await flushUntil(() => download.mock.calls.length > 0);
    const p2 = ensureEventCatalogDownloaded('show-2');
    await tick();

    expect(download).toHaveBeenCalledTimes(1);

    resolve({} as File);
    await p1;
    await p2;

    expect(download).toHaveBeenCalledTimes(2);
    expect(download.mock.calls[1][0]).toContain('/shows/show-2/');
  });
});
