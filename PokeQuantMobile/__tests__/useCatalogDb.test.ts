import { act } from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';
import { flushAsync, renderHook } from './helpers/renderHook';
import { useCatalogDb } from '../src/hooks/useCatalogDb';
import { openCatalogDatabase } from '../src/db/catalogDb';
import { ensureCatalogDownloaded } from '../src/services/CatalogDownloadService';
import { useProgressStore } from '../src/store/progressStore';

// The hook owns two seams: the auto-download trigger (CatalogDownloadService,
// fully mocked) and the open-once catalog handle (partial catalogDb mock —
// the rest of the module stays real). Progress phases come from the real
// progressStore via setState.
jest.mock('../src/db/catalogDb', () => {
  const actual = jest.requireActual<typeof import('../src/db/catalogDb')>(
    '../src/db/catalogDb'
  );
  return {
    ...actual,
    openCatalogDatabase: jest.fn(),
  };
});

jest.mock('../src/services/CatalogDownloadService', () => ({
  ensureCatalogDownloaded: jest.fn(),
}));

const mockOpen = jest.mocked(openCatalogDatabase);
const mockEnsure = jest.mocked(ensureCatalogDownloaded);

const catalogDbHandle = {} as SQLiteDatabase;

// ProgressState isn't exported — the slice the hook subscribes to is.
type ProgressSlice = {
  isCatalogReady?: boolean;
  isExtracting?: boolean;
  catalogDownloadProgress?: number;
  catalogDownloadPhase?: 'download' | 'extract' | 'complete';
  isDownloadingImages?: boolean;
  imageDownloadProgress?: number;
  imageDownloadPhase?: 'download' | 'extract' | 'complete';
};

const setProgress = (over: ProgressSlice = {}) =>
  act(() =>
    useProgressStore.setState({
      isCatalogReady: false,
      isExtracting: false,
      catalogDownloadProgress: 0,
      catalogDownloadPhase: 'download',
      isDownloadingImages: false,
      imageDownloadProgress: 0,
      imageDownloadPhase: 'download',
      ...over,
    })
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockOpen.mockResolvedValue(catalogDbHandle);
  mockEnsure.mockResolvedValue({
    exists: true,
    path: 'file:///mock/catalog.db',
    downloaded: false,
  });
  setProgress();
});

test('missing catalog auto-triggers the download; nothing opens until ready', async () => {
  const { result } = renderHook(() => useCatalogDb());
  await flushAsync();

  expect(mockEnsure).toHaveBeenCalledTimes(1);
  expect(mockOpen).not.toHaveBeenCalled();
  expect(result.current.catalogDb).toBeNull();
  expect(result.current.isCatalogReady).toBe(false);
  expect(result.current.catalogError).toBeNull();
  expect(result.current.downloadProgress).toBe(0);
  expect(result.current.downloadStatus).toBe('Opening price list...');
});

test('an in-flight extraction suppresses the auto-download', async () => {
  setProgress({ isExtracting: true });
  renderHook(() => useCatalogDb());
  await flushAsync();

  expect(mockEnsure).not.toHaveBeenCalled();
  expect(mockOpen).not.toHaveBeenCalled();
});

test('a ready catalog opens once and the guard absorbs store churn', async () => {
  setProgress({ isCatalogReady: true });
  const { result } = renderHook(() => useCatalogDb());
  await flushAsync();

  expect(mockEnsure).not.toHaveBeenCalled();
  expect(mockOpen).toHaveBeenCalledTimes(1);
  expect(result.current.catalogDb).toBe(catalogDbHandle);
  expect(result.current.isCatalogReady).toBe(true);
  expect(result.current.catalogError).toBeNull();

  // Unrelated store churn re-runs the effect but the open-once ref holds.
  setProgress({ catalogDownloadProgress: 0.5 });
  await flushAsync();
  expect(mockOpen).toHaveBeenCalledTimes(1);
});

test('the open-once guard resets when readiness drops, then opens again', async () => {
  setProgress({ isCatalogReady: true });
  renderHook(() => useCatalogDb());
  await flushAsync();
  expect(mockOpen).toHaveBeenCalledTimes(1);

  // Catalog file swapped out — the guard must release so the next ready
  // flip reopens the new handle instead of serving the stale one.
  setProgress({ isCatalogReady: false });
  await flushAsync();
  setProgress({ isCatalogReady: true });
  await flushAsync();
  expect(mockOpen).toHaveBeenCalledTimes(2);
});

test('an open failure lands on catalogError and the next ready flip retries', async () => {
  // A plain string survives toErrorMessage verbatim — 'corrupt' maps to
  // the friendly damaged-file line.
  mockOpen.mockRejectedValue('catalog file corrupt');
  setProgress({ isCatalogReady: true });
  const { result } = renderHook(() => useCatalogDb());
  await flushAsync();

  expect(result.current.catalogError).toBe(
    'The file came back damaged — try downloading again.'
  );
  expect(result.current.catalogDb).toBeNull();
  expect(result.current.isCatalogReady).toBe(false);

  // The catch releases the guard, so a fresh ready cycle retries.
  mockOpen.mockResolvedValue(catalogDbHandle);
  setProgress({ isCatalogReady: false });
  await flushAsync();
  setProgress({ isCatalogReady: true });
  await flushAsync();
  expect(mockOpen).toHaveBeenCalledTimes(2);
  expect(result.current.catalogError).toBeNull();
  expect(result.current.isCatalogReady).toBe(true);
});

test('a rejected auto-download is logged, not thrown', async () => {
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  mockEnsure.mockRejectedValue(new Error('fetch failed'));
  const { result } = renderHook(() => useCatalogDb());
  await flushAsync();

  expect(mockEnsure).toHaveBeenCalledTimes(1);
  expect(errSpy).toHaveBeenCalledWith(
    'Auto-download failed:',
    expect.any(Error)
  );
  expect(result.current.catalogError).toBeNull();
  errSpy.mockRestore();
});

test('catalog download progress drives the status line', async () => {
  const { result } = renderHook(() => useCatalogDb());
  setProgress({ catalogDownloadProgress: 0.42 });
  await flushAsync();

  expect(result.current.downloadProgress).toBe(0.42);
  expect(result.current.downloadStatus).toBe('Downloading price list: 42%');
});

test('an extracting catalog reads as unpacking, not opening', async () => {
  const { result } = renderHook(() => useCatalogDb());
  setProgress({ isExtracting: true, catalogDownloadPhase: 'extract' });
  await flushAsync();

  expect(result.current.downloadProgress).toBe(0);
  expect(result.current.downloadStatus).toBe('Unpacking price list...');
});

test('image pack phases take over the status line while downloading', async () => {
  const { result } = renderHook(() => useCatalogDb());

  setProgress({
    isDownloadingImages: true,
    imageDownloadPhase: 'download',
    imageDownloadProgress: 0.3,
  });
  await flushAsync();
  expect(result.current.downloadStatus).toBe('Downloading card photos: 30%');

  setProgress({
    isDownloadingImages: true,
    imageDownloadPhase: 'extract',
    imageDownloadProgress: 0.55,
  });
  await flushAsync();
  expect(result.current.downloadStatus).toBe('Unpacking card photos: 55%');
});

test('a live catalog download outranks the image phase', async () => {
  const { result } = renderHook(() => useCatalogDb());
  setProgress({
    catalogDownloadPhase: 'download',
    catalogDownloadProgress: 0.4,
    isDownloadingImages: true,
    imageDownloadPhase: 'extract',
    imageDownloadProgress: 0.9,
  });
  await flushAsync();

  expect(result.current.downloadStatus).toBe('Downloading price list: 40%');
});

test('either pipeline completing reports ready at full progress', async () => {
  const { result } = renderHook(() => useCatalogDb());

  setProgress({ catalogDownloadPhase: 'complete' });
  await flushAsync();
  expect(result.current.downloadProgress).toBe(1);
  expect(result.current.downloadStatus).toBe('Price list ready.');

  setProgress({
    catalogDownloadPhase: 'extract',
    imageDownloadPhase: 'complete',
  });
  await flushAsync();
  expect(result.current.downloadStatus).toBe('Price list ready.');
});

test('phase download with zero progress falls through to opening', async () => {
  // The download branch needs real progress (or the extract flag) — a
  // bare 'download' phase at 0% still reads as the opening state.
  const { result } = renderHook(() => useCatalogDb());
  setProgress({ catalogDownloadPhase: 'download', catalogDownloadProgress: 0 });
  await flushAsync();

  expect(result.current.downloadStatus).toBe('Opening price list...');
});
