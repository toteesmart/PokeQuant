import { act } from 'react';
import {
  mkCustomerInfo,
  mkInventoryCard,
  mkSelection,
  mkShow,
  mkVendorProfile,
} from './helpers/builders';
import { flushAsync, renderHook } from './helpers/renderHook';
import { useShowVendor } from '../src/hooks/useShowVendor';
import { useInventoryStore } from '../src/store/inventoryStore';
import { useShowVendorStore } from '../src/store/showVendorStore';
import { useSubscriptionStore } from '../src/store/subscriptionStore';

// Store slices and network actions are driven through the real zustand
// stores — the actions are swapped for jest.fns so nothing leaves the
// device. useVendorFeatures stays real, so gating tests exercise the
// actual paymentsLive/isVendor/entitlement branches.

const SHOW = mkShow({ id: 'show-1' });

const mockLoadVendorProfile = jest.fn(async () => {});
const mockLoadListings = jest.fn(async (_showId: string) => {});
const mockUploadToShow = jest.fn(
  async (_showId: string, _name: string, _table: string): Promise<string[]> => [],
);
const mockTriggerSnapshot = jest.fn(async (_showId: string) => {});
const mockRefreshInventory = jest.fn(async () => {});

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadVendorProfile.mockResolvedValue(undefined);
  mockLoadListings.mockResolvedValue(undefined);
  mockUploadToShow.mockResolvedValue([]);
  mockTriggerSnapshot.mockResolvedValue(undefined);
  mockRefreshInventory.mockResolvedValue(undefined);
  act(() => {
    useShowVendorStore.setState({
      profile: null,
      setups: {},
      requestsByShow: {},
      selections: {},
      listings: {},
      listingsError: {},
      isLoadingListings: {},
      isUploading: {},
      uploadError: {},
      isTriggering: {},
      loadVendorProfile: mockLoadVendorProfile,
      loadListings: mockLoadListings,
      uploadToShow: mockUploadToShow,
      triggerSnapshot: mockTriggerSnapshot,
    });
    useInventoryStore.setState({
      activeInventory: [],
      refreshInventoryState: mockRefreshInventory,
    });
    useSubscriptionStore.setState({ customerInfo: null });
  });
});

test('effectiveVendorName falls through typed → setup → profile → empty', async () => {
  act(() => {
    useShowVendorStore.setState({
      profile: mkVendorProfile({ name: 'Profile Name' }),
    });
  });
  const { result } = renderHook(() => useShowVendor(SHOW));
  await flushAsync();

  expect(result.current.effectiveVendorName).toBe('Profile Name');

  act(() => {
    useShowVendorStore.setState({
      setups: {
        'show-1': { showId: 'show-1', vendorName: 'Setup Name', vendorTable: '' },
      },
    });
  });
  expect(result.current.effectiveVendorName).toBe('Setup Name');

  act(() => result.current.setVendorName('Typed Name'));
  expect(result.current.effectiveVendorName).toBe('Typed Name');
});

test('effectiveVendorTable falls through typed → setup → request → profile', async () => {
  act(() => {
    useShowVendorStore.setState({
      profile: mkVendorProfile({ tableDefault: '7' }),
      requestsByShow: { 'show-1': { status: 'approved', table: '12' } },
    });
  });
  const { result } = renderHook(() => useShowVendor(SHOW));
  await flushAsync();

  // Organizer-assigned table beats the profile default.
  expect(result.current.effectiveVendorTable).toBe('12');

  act(() => {
    useShowVendorStore.setState({
      setups: {
        'show-1': { showId: 'show-1', vendorName: '', vendorTable: '3' },
      },
    });
  });
  expect(result.current.effectiveVendorTable).toBe('3');

  act(() => result.current.setVendorTable('9'));
  expect(result.current.effectiveVendorTable).toBe('9');
});

test('an empty organizer table falls through to the profile default', async () => {
  act(() => {
    useShowVendorStore.setState({
      profile: mkVendorProfile({ tableDefault: '7' }),
      requestsByShow: { 'show-1': { status: 'pending', table: '' } },
    });
  });
  const { result } = renderHook(() => useShowVendor(SHOW));
  await flushAsync();

  expect(result.current.effectiveVendorTable).toBe('7');
});

test('blank defaults produce empty name/table strings', async () => {
  const { result } = renderHook(() => useShowVendor(SHOW));
  await flushAsync();
  expect(result.current.effectiveVendorName).toBe('');
  expect(result.current.effectiveVendorTable).toBe('');
});

test('filteredInventory searches the normalized haystack', async () => {
  const pika = mkInventoryCard({ id: 'a', name: 'Pikachu', number: '025' });
  const farfetch = mkInventoryCard({
    id: 'b',
    name: "Farfetch'd",
    number: '083',
    set: 'Base Set',
  });
  act(() => {
    useInventoryStore.setState({ activeInventory: [pika, farfetch] });
  });
  const { result } = renderHook(() => useShowVendor(SHOW));
  await flushAsync();

  expect(result.current.filteredInventory).toEqual([pika, farfetch]);

  act(() => result.current.setSearchQuery('pika'));
  expect(result.current.filteredInventory).toEqual([pika]);

  // Apostrophe stripped by normalizeSearchTerm — "farfetchd" matches.
  act(() => result.current.setSearchQuery('farfetchd'));
  expect(result.current.filteredInventory).toEqual([farfetch]);

  act(() => result.current.setSearchQuery('083'));
  expect(result.current.filteredInventory).toEqual([farfetch]);

  act(() => result.current.setSearchQuery('zzz'));
  expect(result.current.filteredInventory).toEqual([]);

  act(() => result.current.setSearchQuery('   '));
  expect(result.current.filteredInventory).toEqual([pika, farfetch]);
});

test('empty inventory triggers a refresh; stocked inventory does not', async () => {
  const { unmount } = renderHook(() => useShowVendor(SHOW));
  await flushAsync();
  expect(mockRefreshInventory).toHaveBeenCalledTimes(1);
  unmount();

  mockRefreshInventory.mockClear();
  act(() => {
    useInventoryStore.setState({
      activeInventory: [mkInventoryCard()],
    });
  });
  renderHook(() => useShowVendor(SHOW));
  await flushAsync();
  expect(mockRefreshInventory).not.toHaveBeenCalled();
});

test('handleUpload opens the paywall instead of uploading without access', async () => {
  act(() => {
    useShowVendorStore.setState({
      profile: mkVendorProfile({ paymentsLive: true }),
      // Selection + name would pass the other guards — the paywall is
      // what stops the upload here.
      selections: { 'show-1': { 'card-1': mkSelection() } },
    });
  });
  const { result } = renderHook(() => useShowVendor(SHOW));
  await flushAsync();
  act(() => result.current.setVendorName('My Booth'));

  let ret: boolean | undefined = true;
  await act(async () => {
    ret = await result.current.handleUpload();
  });

  expect(ret).toBeUndefined();
  expect(result.current.showPaywall).toBe(true);
  expect(mockUploadToShow).not.toHaveBeenCalled();
});

test('handlePublish opens the paywall instead of triggering without access', async () => {
  act(() => {
    useShowVendorStore.setState({
      profile: mkVendorProfile({ paymentsLive: true }),
    });
  });
  const { result } = renderHook(() => useShowVendor(SHOW));
  await flushAsync();

  await act(async () => {
    await result.current.handlePublish();
  });

  expect(result.current.showPaywall).toBe(true);
  expect(mockTriggerSnapshot).not.toHaveBeenCalled();
  expect(result.current.publishMessage).toBeNull();
});

test('a late-arriving entitlement closes an open paywall', async () => {
  act(() => {
    useShowVendorStore.setState({
      profile: mkVendorProfile({ paymentsLive: true }),
    });
  });
  const { result } = renderHook(() => useShowVendor(SHOW));
  await flushAsync();
  act(() => result.current.setShowPaywall(true));
  expect(result.current.showPaywall).toBe(true);

  act(() => {
    useSubscriptionStore.setState({
      customerInfo: mkCustomerInfo(['Cardcache_pro']),
    });
  });
  expect(result.current.showPaywall).toBe(false);
});

test('handleUpload is a no-op without a name or selections', async () => {
  const { result } = renderHook(() => useShowVendor(SHOW));
  await flushAsync();

  // No vendor name → early return even with selections.
  act(() => {
    useShowVendorStore.setState({
      selections: { 'show-1': { 'card-1': mkSelection() } },
    });
  });
  await act(async () => {
    await result.current.handleUpload();
  });
  expect(mockUploadToShow).not.toHaveBeenCalled();

  // Name present but nothing selected → early return.
  act(() => {
    useShowVendorStore.setState({ selections: { 'show-1': {} } });
  });
  act(() => result.current.setVendorName('My Booth'));
  await act(async () => {
    await result.current.handleUpload();
  });
  expect(mockUploadToShow).not.toHaveBeenCalled();
});

test('handleUpload returns true on success so the screen can flip tabs', async () => {
  act(() => {
    useShowVendorStore.setState({
      selections: { 'show-1': { 'card-1': mkSelection() } },
    });
  });
  const { result } = renderHook(() => useShowVendor(SHOW));
  await flushAsync();
  act(() => {
    result.current.setVendorName('  My Booth  ');
    result.current.setVendorTable(' 7 ');
  });

  let ret: boolean | undefined;
  await act(async () => {
    ret = await result.current.handleUpload();
  });

  expect(ret).toBe(true);
  // Names/tables are trimmed before hitting the worker.
  expect(mockUploadToShow).toHaveBeenCalledWith('show-1', 'My Booth', '7');
});

test('handleUpload returns false when the store action throws', async () => {
  act(() => {
    useShowVendorStore.setState({
      selections: { 'show-1': { 'card-1': mkSelection() } },
    });
  });
  const { result } = renderHook(() => useShowVendor(SHOW));
  await flushAsync();
  act(() => result.current.setVendorName('My Booth'));
  mockUploadToShow.mockRejectedValueOnce(new Error('Request quota hit'));

  let ret: boolean | undefined;
  await act(async () => {
    ret = await result.current.handleUpload();
  });

  expect(ret).toBe(false);
});

test('handlePublish reports success and failure through publishMessage', async () => {
  const { result } = renderHook(() => useShowVendor(SHOW));
  await flushAsync();

  await act(async () => {
    await result.current.handlePublish();
  });
  expect(result.current.publishMessage).toEqual({
    text: 'Published! Attendees can refresh to see your listings.',
    isError: false,
  });
  expect(mockTriggerSnapshot).toHaveBeenCalledWith('show-1');

  mockTriggerSnapshot.mockRejectedValueOnce(new Error('request timed out'));
  await act(async () => {
    await result.current.handlePublish();
  });
  expect(result.current.publishMessage).toEqual({
    text: "Publish didn't go through — That took too long — try again.",
    isError: true,
  });
});

test('selections drive selectedCount and selectedTotal', async () => {
  act(() => {
    useShowVendorStore.setState({
      selections: {
        'show-1': {
          'card-1': mkSelection({ cardId: 'card-1', stickerPrice: 10, quantity: 2 }),
          'card-2': mkSelection({ cardId: 'card-2', stickerPrice: 5, quantity: 1 }),
        },
        'other-show': {
          'card-9': mkSelection({ cardId: 'card-9', stickerPrice: 99 }),
        },
      },
    });
  });
  const { result } = renderHook(() => useShowVendor(SHOW));
  await flushAsync();

  expect(result.current.selectedCount).toBe(2);
  expect(result.current.selectedTotal).toBe(25);
});

test('per-show listings and status maps are scoped to this show', async () => {
  const listing = {
    id: 'row-1',
    product_id: 1,
    name: 'Pikachu',
    sticker_price: 10,
  };
  act(() => {
    useShowVendorStore.setState({
      listings: { 'show-1': [listing as never], 'other-show': [] },
      isUploading: { 'show-1': true },
      uploadError: { 'show-1': 'Upload quota hit' },
      isLoadingListings: { 'show-1': true },
      listingsError: { 'show-1': 'Listings quota hit' },
      isTriggering: { 'show-1': true },
    });
  });
  const { result } = renderHook(() => useShowVendor(SHOW));
  await flushAsync();

  expect(result.current.listingData).toEqual([listing]);
  expect(result.current.isUploading).toBe(true);
  expect(result.current.uploadError).toBe('Upload quota hit');
  expect(result.current.isLoadingListings).toBe(true);
  expect(result.current.listingsError).toBe('Listings quota hit');
  expect(result.current.isTriggering).toBe(true);
});
