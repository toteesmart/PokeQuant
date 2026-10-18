import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCachedShowsList, getShowsList, type ShowItem } from '../src/services/ShowListService';
import { UPCOMING_SHOWS } from '../src/constants/shows';

const getItem = jest.mocked(AsyncStorage.getItem);
const setItem = jest.mocked(AsyncStorage.setItem);
const fetchMock = jest.fn();
const realFetch = globalThis.fetch;

const SHOWS_URL = 'https://pokequant-pre-show.totees-mart.workers.dev/shows';
const CACHE_KEY = 'pokequant-shows-list';

const FALLBACK: ShowItem[] = UPCOMING_SHOWS.map((s) => ({
  id: s.id,
  vendorId: s.vendorId,
  name: s.name,
  startDate: s.startDate,
  location: s.location,
}));

const CACHED: ShowItem[] = [
  { id: 'cached-1', vendorId: 'v1', name: 'Cached Show', startDate: 'd', location: 'L' },
];

beforeAll(() => {
  // getShowsList logs a warning on every handled failure path by design.
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

afterAll(() => {
  (globalThis as { fetch: unknown }).fetch = realFetch;
  jest.restoreAllMocks();
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getCachedShowsList', () => {
  test('a cached non-empty array is returned verbatim', async () => {
    getItem.mockResolvedValue(JSON.stringify(CACHED));

    const res = await getCachedShowsList();

    expect(getItem).toHaveBeenCalledWith(CACHE_KEY);
    expect(res).toEqual(CACHED);
  });

  test.each([
    ['an empty array', '[]'],
    ['invalid JSON', '{not json'],
    ['a null cache entry', null],
  ])('falls back to UPCOMING_SHOWS on %s', async (_label, cached) => {
    getItem.mockResolvedValue(cached as string | null);

    const res = await getCachedShowsList();

    expect(res).toEqual(FALLBACK);
    // The fallback shape carries no isActive flag.
    expect(res.every((s) => !('isActive' in s))).toBe(true);
  });

  test('a rejecting getItem falls back to UPCOMING_SHOWS', async () => {
    getItem.mockRejectedValue(new Error('storage down'));

    const res = await getCachedShowsList();

    expect(res).toEqual(FALLBACK);
  });
});

describe('getShowsList', () => {
  test('fetches with anti-cache headers, normalizes rows, and caches the result', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          shows: [
            { id: 'a', vendor_id: 'v', name: 'N', start_date: 'd', location: 'L' },
            { id: 'b', name: 'only-required' },
            'junk',
            null,
            { id: 'c' },
          ],
        }),
        { status: 200 },
      ),
    );

    const res = await getShowsList();

    expect(fetchMock).toHaveBeenCalledWith(SHOWS_URL, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
      signal: expect.any(AbortSignal),
    });
    expect(res).toEqual([
      { id: 'a', vendorId: 'v', name: 'N', startDate: 'd', location: 'L' },
      { id: 'b', vendorId: '', name: 'only-required', startDate: '', location: '' },
    ]);
    expect(setItem).toHaveBeenCalledWith(CACHE_KEY, JSON.stringify(res));
  });

  test.each([
    ['a non-ok status', new Response('boom', { status: 500 })],
    ['ok:false', new Response(JSON.stringify({ ok: false, error: 'nope' }), { status: 200 })],
    [
      'a non-array shows field',
      new Response(JSON.stringify({ ok: true, shows: 'nope' }), { status: 200 }),
    ],
  ])('on %s falls back to the cache without writing', async (_label, response) => {
    fetchMock.mockResolvedValue(response);
    getItem.mockResolvedValue(JSON.stringify(CACHED));

    const res = await getShowsList();

    expect(res).toEqual(CACHED);
    expect(setItem).not.toHaveBeenCalled();
  });

  test('a throwing fetch falls back to the static list when the cache is empty', async () => {
    fetchMock.mockRejectedValue(new Error('Network request failed'));
    getItem.mockResolvedValue(null);

    const res = await getShowsList();

    expect(res).toEqual(FALLBACK);
    expect(setItem).not.toHaveBeenCalled();
  });
});
