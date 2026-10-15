import { act } from 'react';
import { mkShow, mkVendorProfile } from './helpers/builders';
import { flushAsync, renderHook } from './helpers/renderHook';
import { useEventList } from '../src/hooks/useEventList';
import {
  getCachedShowsList,
  getShowsList,
  type ShowItem,
} from '../src/services/ShowListService';
import { useShowVendorStore } from '../src/store/showVendorStore';
import { useSubscriptionStore } from '../src/store/subscriptionStore';

// The service boundary (cache + network) is mocked; useFocusEffect is a
// mount-fire stub from jest.setup.js. The showVendorStore stays real —
// only the network actions are swapped for jest.fns.

jest.mock('../src/services/ShowListService', () => ({
  getCachedShowsList: jest.fn(),
  getShowsList: jest.fn(),
}));

const mockGetCachedShowsList = jest.mocked(getCachedShowsList);
const mockGetShowsList = jest.mocked(getShowsList);

const mockLoadVendorProfile = jest.fn(async () => {});
const mockLoadVendorShows = jest.fn(async () => {});
const mockLoadBalances = jest.fn(async () => {});
const mockRequestTable = jest.fn(async (_showId: string) => {});

const renderList = (
  onSelectShow: (show: ShowItem) => void = jest.fn(),
  onReportShow: (show: ShowItem) => void = jest.fn()
) => renderHook(() => useEventList(onSelectShow, onReportShow));

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadVendorProfile.mockResolvedValue(undefined);
  mockLoadVendorShows.mockResolvedValue(undefined);
  mockLoadBalances.mockResolvedValue(undefined);
  mockRequestTable.mockResolvedValue(undefined);
  mockGetCachedShowsList.mockResolvedValue([]);
  mockGetShowsList.mockResolvedValue([]);
  act(() => {
    useShowVendorStore.setState({
      profile: null,
      showsWithAccess: [],
      requestsByShow: {},
      balances: [],
      loadVendorProfile: mockLoadVendorProfile,
      loadVendorShows: mockLoadVendorShows,
      loadBalances: mockLoadBalances,
      requestTable: mockRequestTable,
    });
    useSubscriptionStore.setState({ customerInfo: null });
  });
});

test('renders the cached list first, then the fresh fetch replaces it', async () => {
  const cached = mkShow({ id: 'cached-show', name: 'Cached Show' });
  const fresh = mkShow({ id: 'fresh-show', name: 'Fresh Show' });
  mockGetCachedShowsList.mockResolvedValue([cached]);
  let resolveFresh!: (shows: ShowItem[]) => void;
  mockGetShowsList.mockImplementation(
    () => new Promise<ShowItem[]>((resolve) => (resolveFresh = resolve))
  );

  const { result } = renderList();

  // Mount fires loadData — the spinner drops as soon as the cache lands,
  // without waiting on the network fetch.
  expect(result.current.isLoading).toBe(true);
  await flushAsync();
  expect(result.current.shows).toEqual([cached]);
  expect(result.current.isLoading).toBe(false);

  resolveFresh([fresh]);
  await flushAsync();
  expect(result.current.shows).toEqual([fresh]);
  expect(result.current.error).toBeNull();
});

test('vendor call failures surface as a notice, never a screen error', async () => {
  const cached = mkShow();
  mockGetCachedShowsList.mockResolvedValue([cached]);
  mockGetShowsList.mockResolvedValue([cached]);
  mockLoadVendorProfile.mockRejectedValue(
    new Error('Network request failed')
  );
  // A plain string rejection survives toErrorMessage verbatim — keeps the
  // joined notice exact rather than toContain()-fuzzy.
  mockLoadVendorShows.mockRejectedValue('Request quota hit');
  mockLoadBalances.mockResolvedValue(undefined);

  const { result } = renderList();
  await flushAsync();

  expect(result.current.vendorNotice).toBe(
    'No internet — selling tools unavailable.; Request quota hit'
  );
  expect(result.current.error).toBeNull();
  expect(result.current.shows).toEqual([cached]);
});

test('identical vendor failures are deduped into one notice', async () => {
  mockLoadVendorProfile.mockRejectedValue(
    new Error('Network request failed')
  );
  mockLoadVendorShows.mockRejectedValue(
    new TypeError('fetch failed')
  );
  mockLoadBalances.mockRejectedValue(new Error('Unable to resolve host'));

  const { result } = renderList();
  await flushAsync();

  // Three offline flavors → one offline sentence.
  expect(result.current.vendorNotice).toBe(
    'No internet — selling tools unavailable.'
  );
});

test('a failed fresh fetch keeps the rendered list and flags offline', async () => {
  const cached = mkShow({ id: 'cached-show' });
  mockGetCachedShowsList.mockResolvedValue([cached]);
  mockGetShowsList.mockRejectedValue(new TypeError('fetch failed'));

  const { result } = renderList();
  await flushAsync();

  expect(result.current.error).toBe(
    'No internet — showing the last downloaded show list.'
  );
  expect(result.current.shows).toEqual([cached]);
  expect(result.current.isLoading).toBe(false);
});

test('a non-offline fresh-fetch failure reports the message', async () => {
  mockGetCachedShowsList.mockResolvedValue([mkShow()]);
  mockGetShowsList.mockRejectedValue(new Error('Request quota hit'));

  const { result } = renderList();
  await flushAsync();

  expect(result.current.error).toContain('Request quota hit');
});

test('onRefresh reloads and clears refreshing when done', async () => {
  const fresh = mkShow({ id: 'fresh-show' });
  let resolveFresh!: (shows: ShowItem[]) => void;
  mockGetShowsList.mockImplementation(
    () => new Promise<ShowItem[]>((resolve) => (resolveFresh = resolve))
  );

  const { result } = renderList();
  // Mount's own load reaches the pending fresh fetch first — flush so the
  // promise (and its resolver) exists before we settle it.
  await flushAsync();
  resolveFresh([fresh]);
  await flushAsync();
  expect(result.current.refreshing).toBe(false);

  let resolveRefresh!: (shows: ShowItem[]) => void;
  mockGetShowsList.mockImplementation(
    () => new Promise<ShowItem[]>((resolve) => (resolveRefresh = resolve))
  );
  act(() => {
    result.current.onRefresh();
  });
  expect(result.current.refreshing).toBe(true);
  // loadData awaits the cache read before calling getShowsList — flush so
  // the refresh's resolver is captured while the fetch is still pending.
  await flushAsync();
  expect(result.current.refreshing).toBe(true);

  resolveRefresh([fresh]);
  await flushAsync();
  expect(result.current.refreshing).toBe(false);
  expect(result.current.shows).toEqual([fresh]);
});

test('browse/report handlers invoke the screen callbacks', async () => {
  const onSelect = jest.fn();
  const onReport = jest.fn();
  const { result } = renderList(onSelect, onReport);
  await flushAsync();

  const show = mkShow({ id: 'show-9' });
  act(() => result.current.handleBrowse(show)());
  act(() => result.current.handleReport(show)());

  expect(onSelect).toHaveBeenCalledWith(show);
  expect(onReport).toHaveBeenCalledWith(show);
});

test('request-table failures land on the vendor notice', async () => {
  const { result } = renderList();
  await flushAsync();

  mockRequestTable.mockRejectedValue(new Error('Request quota hit'));
  act(() => {
    result.current.handleRequest(mkShow({ id: 'show-7' }))();
  });
  await flushAsync();

  expect(mockRequestTable).toHaveBeenCalledWith('show-7');
  expect(result.current.vendorNotice).toContain('Request quota hit');
});

test('vendor gating and organizer flag pass through from the profile', async () => {
  act(() => {
    useShowVendorStore.setState({
      profile: mkVendorProfile({
        paymentsLive: true,
        isVendor: true,
        isOrganizer: true,
      }),
      requestsByShow: { 'show-1': { status: 'approved', table: '4' } },
      showsWithAccess: ['show-1'],
    });
  });
  const { result } = renderList();
  await flushAsync();

  expect(result.current.paymentsLive).toBe(true);
  expect(result.current.canUseVendorFeatures).toBe(true);
  expect(result.current.isOrganizer).toBe(true);
  expect(result.current.showsWithAccess).toEqual(['show-1']);
  expect(result.current.requestsByShow['show-1']).toEqual({
    status: 'approved',
    table: '4',
  });
});

test('payments off and no profile leaves vendor features open', async () => {
  const { result } = renderList();
  await flushAsync();
  expect(result.current.paymentsLive).toBe(false);
  expect(result.current.canUseVendorFeatures).toBe(true);
  expect(result.current.isOrganizer).toBe(false);
});
