import { File } from 'expo-file-system';

// Per-pack absent-state memoization pins for CatalogImageService. The pack
// objects are module-level, so every test re-requires a fresh module — the
// File class must come from the same post-reset registry or the getter spy
// would attach to a stale prototype.
type Service = typeof import('../src/services/CatalogImageService');
type FileCtor = typeof File;

function loadService(exists = false) {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const FileMock = require('expo-file-system').File as FileCtor;
  const existsSpy = jest
    .spyOn(FileMock.prototype, 'exists', 'get')
    .mockReturnValue(exists);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const svc = require('../src/services/CatalogImageService') as Service;
  return { svc, FileMock, existsSpy };
}

beforeAll(() => {
  // The service logs on handled failure paths (download rejections, manifest
  // write errors) by design.
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

test('an absent ready marker is stat\u2019d once per pack, then never again', () => {
  const { svc, existsSpy } = loadService();

  // First resolution stats each pack's readyFile exactly once.
  expect(svc.getCatalogImageUri(123)).toBe(
    'https://tcgplayer-cdn.tcgplayer.com/product/123_400w.jpg'
  );
  expect(existsSpy).toHaveBeenCalledTimes(2);

  // Further resolutions issue zero FS stats on either pack.
  for (let i = 0; i < 10; i += 1) {
    expect(svc.getCatalogImageUri(1000 + i)).toBe(
      `https://tcgplayer-cdn.tcgplayer.com/product/${1000 + i}_400w.jpg`
    );
    expect(svc.getLocalCatalogImageUri(`${2000 + i}`)).toBeUndefined();
  }
  expect(existsSpy).toHaveBeenCalledTimes(2);

  // Non-numeric ids bail before any filesystem touch.
  expect(svc.getCatalogImageUri('not-a-number')).toBeUndefined();
  expect(existsSpy).toHaveBeenCalledTimes(2);
});

test('a present ready marker indexes once — extractedIds keeps short-circuiting', () => {
  const { svc, existsSpy } = loadService(true);

  // exists=true hits the scan path; the Directory mock stays absent so the
  // index comes back empty and lookups still fall back to the CDN.
  expect(svc.getCatalogImageUri(7)).toBe(
    'https://tcgplayer-cdn.tcgplayer.com/product/7_400w.jpg'
  );
  expect(existsSpy).toHaveBeenCalledTimes(2);

  svc.getCatalogImageUri(8);
  svc.getLocalCatalogImageUri(9);
  expect(existsSpy).toHaveBeenCalledTimes(2);
});

test('warmCatalogImageIndex checks both packs once and primes the absent memo', async () => {
  const { svc, existsSpy } = loadService();

  await svc.warmCatalogImageIndex();
  // Per pack: manifestFile.exists + readyFile.exists.
  expect(existsSpy).toHaveBeenCalledTimes(4);

  existsSpy.mockClear();
  for (let i = 0; i < 5; i += 1) {
    svc.getCatalogImageUri(3000 + i);
  }
  svc.getLocalCatalogImageUri(4000);
  expect(existsSpy).not.toHaveBeenCalled();
});

test('cleanImageWorkspace resets the absent memo for that pack only', async () => {
  const { svc, FileMock, existsSpy } = loadService();

  svc.getCatalogImageUri(1);
  expect(existsSpy).toHaveBeenCalledTimes(2);
  existsSpy.mockClear();

  // cleanImageWorkspace is reached through a forced re-download; the download
  // fails under jest but the workspace wipe (and flag reset) already ran.
  (FileMock as unknown as Record<string, unknown>).downloadFileAsync = jest
    .fn()
    .mockRejectedValue(new Error('offline'));
  await expect(svc.ensureCatalogImagesDownloaded(true)).rejects.toThrow();

  // The wipe itself stats readyFile + manifestFile on the EN pack.
  expect(existsSpy).toHaveBeenCalledTimes(2);
  existsSpy.mockClear();

  // EN re-stats on the next lookup; JP's absent memo is untouched.
  svc.getCatalogImageUri(5);
  expect(existsSpy).toHaveBeenCalledTimes(1);
  svc.getCatalogImageUri(6);
  svc.getLocalCatalogImageUri(7);
  expect(existsSpy).toHaveBeenCalledTimes(1);
});
