import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  deleteShowListing,
  getMyBalances,
  getTeam,
  getVendorListings,
  getVendorProfile,
  getVendorShows,
  leaveTeam as svcLeaveTeam,
  redeemTeamCode,
  regenerateTeamCode,
  removeTeamMember,
  renameTeam,
  requestShowAccess,
  triggerShowSnapshot,
  updateShowListing,
  uploadShowInventory,
  type ShowListingItem,
  type ShowVendorProfile,
  type Team,
  type VendorBalance,
} from '../src/services/showVendorService';
import { useShowVendorStore } from '../src/store/showVendorStore';
import { useSubscriptionStore } from '../src/store/subscriptionStore';
import * as logModule from '../src/utils/log';
import { deferred, tick } from './helpers/async';
import {
  mkCustomerInfo,
  mkInventoryCard,
  mkSelection,
  mkVendorProfile,
  mkVendorShow,
} from './helpers/builders';

// showVendorStore characterization pins — showVendorService is the whole
// network seam and is fully mocked; useSubscriptionStore stays real so the
// paymentsLive → isVendor/isTeamMember → entitlement gate chain exercises
// genuinely. AsyncStorage is the setup-level mock: the persist partialize
// (profile + setups only) is pinned through the real write. No React.
jest.mock('../src/services/showVendorService', () => ({
  deleteShowListing: jest.fn(),
  getTeam: jest.fn(),
  getMyBalances: jest.fn(),
  getVendorListings: jest.fn(),
  getVendorProfile: jest.fn(),
  getVendorShows: jest.fn(),
  requestShowAccess: jest.fn(),
  leaveTeam: jest.fn(),
  redeemTeamCode: jest.fn(),
  regenerateTeamCode: jest.fn(),
  removeTeamMember: jest.fn(),
  renameTeam: jest.fn(),
  triggerShowSnapshot: jest.fn(),
  updateShowListing: jest.fn(),
  uploadShowInventory: jest.fn(),
  syncVendorSubscription: jest.fn(),
}));

const mockDeleteListing = jest.mocked(deleteShowListing);
const mockGetBalances = jest.mocked(getMyBalances);
const mockGetTeam = jest.mocked(getTeam);
const mockGetListings = jest.mocked(getVendorListings);
const mockGetProfile = jest.mocked(getVendorProfile);
const mockGetShows = jest.mocked(getVendorShows);
const mockLeave = jest.mocked(svcLeaveTeam);
const mockRedeem = jest.mocked(redeemTeamCode);
const mockRegen = jest.mocked(regenerateTeamCode);
const mockRemoveMember = jest.mocked(removeTeamMember);
const mockRename = jest.mocked(renameTeam);
const mockRequestAccess = jest.mocked(requestShowAccess);
const mockTrigger = jest.mocked(triggerShowSnapshot);
const mockUpdateListing = jest.mocked(updateShowListing);
const mockUpload = jest.mocked(uploadShowInventory);
const mockSetItem = jest.mocked(AsyncStorage.setItem);

const errSpy = jest.spyOn(logModule, 'logError').mockImplementation(() => {});
const infoSpy = jest.spyOn(logModule, 'logInfo').mockImplementation(() => {});

const store = () => useShowVendorStore.getState();
const order = (fn: jest.Mock) => fn.mock.invocationCallOrder[0];

// The service's snake_case profile shape — distinct from the store's
// camelCase VendorProfile that mkVendorProfile builds.
const mkServiceProfile = (over: Partial<ShowVendorProfile> = {}): ShowVendorProfile => ({
  id: 'vendor-1',
  user_id: 'user-1',
  name: 'Vendor One',
  table_default: '4',
  is_founder: 0,
  founder_seat_number: null,
  payments_live: 0,
  founder_seats_remaining: 0,
  is_vendor: 0,
  is_team_member: 0,
  is_organizer: 0,
  team_id: null,
  team: null,
  ...over,
});

const mkTeam = (over: Partial<Team> = {}): Team => ({
  team_id: 'team-1',
  owner_user_id: 'user-1',
  name: 'Team One',
  owner_name: 'Owner',
  product_id: null,
  seats_total: 3,
  expires_at: null,
  updated_at: null,
  created_at: null,
  is_member: true,
  ...over,
});

const mkListing = (over: Partial<ShowListingItem> = {}): ShowListingItem => ({
  id: 'row-1',
  showId: 'show-1',
  productId: 42,
  name: 'Pikachu',
  number: '025',
  set: 'SV151',
  rarity: 'Illustration Rare',
  condition: 'NM',
  stickerPrice: 10,
  quantity: 1,
  vendorName: 'Vendor One',
  vendorTable: '4',
  ...over,
});

const mkBalance = (over: Partial<VendorBalance> = {}): VendorBalance => ({
  showId: 'show-1',
  showName: 'Test Show',
  organizerName: 'Organizer',
  payInstructions: '',
  tableNumber: '4',
  totalDue: 50,
  paidAmount: 20,
  remaining: 30,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  useShowVendorStore.setState({
    profile: null,
    isLoadingProfile: false,
    profileError: null,
    team: null,
    teamLoading: false,
    teamError: null,
    showsWithAccess: [],
    requestsByShow: {},
    balances: [],
    balancesLoading: false,
    setups: {},
    selections: {},
    listings: {},
    listingsError: {},
    isLoadingListings: {},
    isUploading: {},
    uploadError: {},
    isTriggering: {},
  });
  useSubscriptionStore.setState({ customerInfo: null });
  mockGetProfile.mockResolvedValue(mkServiceProfile());
  mockGetListings.mockResolvedValue([]);
});

describe('canUseVendorFeatures — the offline-capable gate chain', () => {
  it.each<{
    label: string;
    profile: Parameters<typeof mkVendorProfile>[0] | null;
    entitlements: string[];
    expected: boolean;
  }>([
    { label: 'no profile at all → open', profile: null, entitlements: [], expected: true },
    {
      label: 'payments_live off → open',
      profile: { paymentsLive: false },
      entitlements: [],
      expected: true,
    },
    {
      label: 'live + isVendor → open',
      profile: { paymentsLive: true, isVendor: true },
      entitlements: [],
      expected: true,
    },
    {
      label: 'live + isTeamMember → open',
      profile: { paymentsLive: true, isTeamMember: true },
      entitlements: [],
      expected: true,
    },
    {
      label: 'live + pro entitlement → open',
      profile: { paymentsLive: true },
      entitlements: ['Cardcache_pro'],
      expected: true,
    },
    {
      label: 'live + scan-only entitlement → closed',
      profile: { paymentsLive: true },
      entitlements: ['Cardcache_scan'],
      expected: false,
    },
    {
      label: 'live + nothing → closed',
      profile: { paymentsLive: true },
      entitlements: [],
      expected: false,
    },
    // The documented quirk: founder is a seat/discount label, not a pass —
    // with no membership or entitlement the gate still closes.
    {
      label: 'live + isFounder only → closed',
      profile: { paymentsLive: true, isFounder: true },
      entitlements: [],
      expected: false,
    },
  ])('$label', ({ profile, entitlements, expected }) => {
    useShowVendorStore.setState({ profile: profile && mkVendorProfile(profile) });
    useSubscriptionStore.setState({ customerInfo: mkCustomerInfo(entitlements) });
    expect(store().canUseVendorFeatures()).toBe(expected);
  });
});

describe('loadVendorProfile', () => {
  test('maps the service row onto the store profile and mirrors team state', async () => {
    const team = mkTeam();
    mockGetProfile.mockResolvedValueOnce(
      mkServiceProfile({
        is_founder: 1,
        founder_seat_number: 7,
        payments_live: 1,
        founder_seats_remaining: 12,
        is_vendor: 1,
        is_team_member: 1,
        is_organizer: 1,
        team_id: 'team-1',
        team,
      }),
    );

    await store().loadVendorProfile();

    expect(store().profile).toEqual({
      id: 'vendor-1',
      userId: 'user-1',
      name: 'Vendor One',
      tableDefault: '4',
      isFounder: true,
      founderSeatNumber: 7,
      paymentsLive: true,
      founderSeatsRemaining: 12,
      isVendor: true,
      isTeamMember: true,
      isOrganizer: true,
      teamId: 'team-1',
      team,
    });
    // Quirk: the team lands in two places — profile.team and the top-level
    // team slot the team actions own.
    expect(store().team).toBe(team);
    expect(store().isLoadingProfile).toBe(false);
    expect(store().profileError).toBeNull();
  });

  test('concurrent loads dedupe on the in-flight flag', async () => {
    const gate = deferred<ShowVendorProfile>();
    mockGetProfile.mockReturnValueOnce(gate.promise);

    const p1 = store().loadVendorProfile();
    const p2 = store().loadVendorProfile();
    await tick();

    expect(store().isLoadingProfile).toBe(true);
    expect(mockGetProfile).toHaveBeenCalledTimes(1);

    gate.resolve(mkServiceProfile());
    await Promise.all([p1, p2]);
    expect(store().isLoadingProfile).toBe(false);
  });

  test('an offline failure gets the friendly message; other failures map verbatim', async () => {
    mockGetProfile.mockRejectedValueOnce('Network request failed');
    await expect(store().loadVendorProfile()).rejects.toBe('Network request failed');
    expect(store().profileError).toBe('No internet — seller profile unavailable.');
    expect(store().isLoadingProfile).toBe(false);

    mockGetProfile.mockRejectedValueOnce('Forbidden');
    await expect(store().loadVendorProfile()).rejects.toBe('Forbidden');
    expect(store().profileError).toBe("You don't have access to do that.");
  });
});

describe('loadVendorShows', () => {
  test('only owner/approved grant access; every show gets a request entry', async () => {
    mockGetShows.mockResolvedValueOnce([
      mkVendorShow({ id: 'a', my_status: 'owner', my_table: '1' }),
      mkVendorShow({ id: 'b', my_status: 'approved', my_table: '2' }),
      mkVendorShow({ id: 'c', my_status: 'pending' }),
      mkVendorShow({ id: 'd', my_status: 'rejected' }),
      // Missing my_status/my_table → empty-string fallbacks, no access.
      mkVendorShow({ id: 'e' }),
    ]);

    await store().loadVendorShows();

    expect(store().showsWithAccess).toEqual(['a', 'b']);
    expect(store().requestsByShow).toEqual({
      a: { status: 'owner', table: '1' },
      b: { status: 'approved', table: '2' },
      c: { status: 'pending', table: '' },
      d: { status: 'rejected', table: '' },
      e: { status: '', table: '' },
    });
  });

  test('failures rethrow; offline logs info, anything else logs error', async () => {
    mockGetShows.mockRejectedValueOnce('Network request failed');
    await expect(store().loadVendorShows()).rejects.toBe('Network request failed');
    expect(infoSpy).toHaveBeenCalledWith('Offline: vendor shows not loaded.');
    expect(errSpy).not.toHaveBeenCalled();

    mockGetShows.mockRejectedValueOnce('boom');
    await expect(store().loadVendorShows()).rejects.toBe('boom');
    expect(errSpy).toHaveBeenCalledWith('Failed to load vendor shows:', 'boom');
  });
});

describe('loadBalances', () => {
  test('stores the balances; concurrent loads dedupe', async () => {
    const gate = deferred<VendorBalance[]>();
    mockGetBalances.mockReturnValueOnce(gate.promise);

    const p1 = store().loadBalances();
    const p2 = store().loadBalances();
    await tick();
    expect(store().balancesLoading).toBe(true);
    expect(mockGetBalances).toHaveBeenCalledTimes(1);

    gate.resolve([mkBalance()]);
    await Promise.all([p1, p2]);
    expect(store().balances).toEqual([mkBalance()]);
    expect(store().balancesLoading).toBe(false);
  });

  test('a failure rethrows and logs only when it is not offline', async () => {
    mockGetBalances.mockRejectedValueOnce('boom');
    await expect(store().loadBalances()).rejects.toBe('boom');
    expect(store().balancesLoading).toBe(false);
    expect(errSpy).toHaveBeenCalledWith('Failed to load show balances:', 'boom');

    errSpy.mockClear();
    mockGetBalances.mockRejectedValueOnce('Network request failed');
    await expect(store().loadBalances()).rejects.toBe('Network request failed');
    expect(errSpy).not.toHaveBeenCalled();
  });
});

describe('requestTable', () => {
  test('posts the request then stamps the show pending — even over an approved entry', async () => {
    useShowVendorStore.setState({
      requestsByShow: { 'show-1': { status: 'approved', table: '9' } },
    });
    mockRequestAccess.mockResolvedValueOnce(undefined);

    await store().requestTable('show-1');

    expect(mockRequestAccess).toHaveBeenCalledWith('show-1');
    // Observed quirk: the local stamp is unconditional — it does not check
    // that the server approved; a re-request flattens whatever was there.
    expect(store().requestsByShow['show-1']).toEqual({ status: 'pending', table: '' });
  });

  test('a rejected request leaves requestsByShow untouched', async () => {
    mockRequestAccess.mockRejectedValueOnce('boom');
    await expect(store().requestTable('show-1')).rejects.toBe('boom');
    expect(store().requestsByShow).toEqual({});
  });
});

describe('selection state machine', () => {
  test('setShowSetup stamps one show without touching the others', () => {
    useShowVendorStore.setState({
      setups: { other: { showId: 'other', vendorName: 'Other', vendorTable: '1' } },
    });

    store().setShowSetup('show-1', 'My Booth', '7');

    expect(store().setups['show-1']).toEqual({
      showId: 'show-1',
      vendorName: 'My Booth',
      vendorTable: '7',
    });
    expect(store().setups.other.vendorName).toBe('Other');
  });

  test('toggleCardSelection adds with the derived defaults, then removes', () => {
    const card = mkInventoryCard({
      id: 'card-1',
      productId: 42,
      name: 'Pikachu',
      set: 'SV151',
      number: '025',
      productType: 'Holofoil',
      rarity: 'Rare',
      stickerPrice: 10,
      condition: 'LP',
    });

    store().toggleCardSelection('show-1', card);

    // buildInitialSelection: rarity prefers productType over rarity;
    // condition falls back to 'NM' only when the card has none; quantity 1.
    expect(store().selections['show-1']['card-1']).toEqual({
      cardId: 'card-1',
      productId: 42,
      name: 'Pikachu',
      set: 'SV151',
      number: '025',
      rarity: 'Holofoil',
      condition: 'LP',
      stickerPrice: 10,
      quantity: 1,
    });

    store().toggleCardSelection('show-1', card);
    expect(store().selections['show-1']).toEqual({});
  });

  test('toggleCardSelection fills missing card fields with empty defaults', () => {
    const card = mkInventoryCard({
      id: 'card-2',
      productId: undefined,
      set: undefined,
      number: undefined,
      productType: undefined,
      rarity: 'Rare',
      condition: undefined,
    });

    store().toggleCardSelection('show-1', card);

    expect(store().selections['show-1']['card-2']).toEqual(
      expect.objectContaining({
        productId: 0,
        set: '',
        number: '',
        rarity: 'Rare',
        condition: 'NM',
        quantity: 1,
      }),
    );
  });

  test('selections are scoped per show', () => {
    store().toggleCardSelection('show-1', mkInventoryCard({ id: 'a' }));
    store().toggleCardSelection('show-2', mkInventoryCard({ id: 'b' }));

    expect(Object.keys(store().selections['show-1'])).toEqual(['a']);
    expect(Object.keys(store().selections['show-2'])).toEqual(['b']);
  });

  test('updateSelection merges; an unknown cardId is a no-op', () => {
    store().toggleCardSelection('show-1', mkInventoryCard({ id: 'a', stickerPrice: 10 }));

    store().updateSelection('show-1', 'a', { quantity: 3, stickerPrice: 15 });
    expect(store().selections['show-1'].a).toMatchObject({ quantity: 3, stickerPrice: 15 });
    const merged = store().selections['show-1'];

    // The `return state` early-out leaves the selections object untouched —
    // same reference, not just equal contents.
    store().updateSelection('show-1', 'ghost', { quantity: 9 });
    store().updateSelection('ghost-show', 'a', { quantity: 9 });
    expect(store().selections['show-1']).toBe(merged);
    expect(store().selections['ghost-show']).toBeUndefined();
  });

  test('clearSelection empties only that show', () => {
    store().toggleCardSelection('show-1', mkInventoryCard({ id: 'a' }));
    store().toggleCardSelection('show-2', mkInventoryCard({ id: 'b' }));

    store().clearSelection('show-1');

    expect(store().selections['show-1']).toEqual({});
    expect(Object.keys(store().selections['show-2'])).toEqual(['b']);
  });
});

describe('uploadToShow', () => {
  const seedSelection = () =>
    useShowVendorStore.setState({
      selections: { 'show-1': { 'card-1': mkSelection() } },
    });

  test('rejects with subscription_required before touching the worker', async () => {
    useShowVendorStore.setState({ profile: mkVendorProfile({ paymentsLive: true }) });
    seedSelection();

    await expect(store().uploadToShow('show-1', 'Booth', '4')).rejects.toThrow(
      'subscription_required',
    );
    expect(mockUpload).not.toHaveBeenCalled();
    expect(store().selections['show-1']['card-1']).toBeDefined();
  });

  test('rejects on an empty selection even with access', async () => {
    await expect(store().uploadToShow('show-1', 'Booth', '4')).rejects.toThrow('No cards selected');
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test('maps selections to the ShowInventoryRow wire shape verbatim', async () => {
    seedSelection();
    useShowVendorStore.setState({
      selections: {
        'show-1': {
          'card-1': mkSelection({
            cardId: 'card-1',
            productId: 42,
            name: 'Pikachu',
            set: 'SV151',
            number: '025/165',
            rarity: 'Illustration Rare',
            condition: 'LP',
            stickerPrice: 12.5,
            quantity: 2,
          }),
        },
      },
    });
    mockUpload.mockResolvedValueOnce(['row-9']);

    const rowIds = await store().uploadToShow('show-1', 'My Booth', '7');

    expect(rowIds).toEqual(['row-9']);
    expect(mockUpload).toHaveBeenCalledWith('show-1', 'My Booth', '7', [
      {
        product_id: 42,
        name: 'Pikachu',
        set_name: 'SV151',
        number: '025/165',
        rarity: 'Illustration Rare',
        condition: 'LP',
        sticker_price: 12.5,
        quantity: 2,
      },
    ]);
  });

  test('success clears selections, stamps the setup, then refreshes listings', async () => {
    seedSelection();
    mockUpload.mockResolvedValueOnce(['row-1']);
    mockGetListings.mockResolvedValueOnce([mkListing()]);

    await store().uploadToShow('show-1', 'My Booth', '7');

    expect(store().selections['show-1']).toEqual({});
    expect(store().setups['show-1']).toEqual({
      showId: 'show-1',
      vendorName: 'My Booth',
      vendorTable: '7',
    });
    expect(store().isUploading['show-1']).toBe(false);
    expect(store().uploadError['show-1']).toBeNull();
    expect(order(mockUpload)).toBeLessThan(order(mockGetListings));
    expect(mockGetListings).toHaveBeenCalledWith('show-1');
    expect(store().listings['show-1']).toEqual([mkListing()]);
  });

  test('isUploading is raised while the upload is in flight', async () => {
    seedSelection();
    const gate = deferred<string[]>();
    mockUpload.mockReturnValueOnce(gate.promise);

    const p = store().uploadToShow('show-1', 'Booth', '4');
    await tick();
    expect(store().isUploading['show-1']).toBe(true);
    expect(store().uploadError['show-1']).toBeNull();

    gate.resolve([]);
    await p;
    expect(store().isUploading['show-1']).toBe(false);
  });

  test('a listings-refresh failure never surfaces as an upload error', async () => {
    seedSelection();
    mockUpload.mockResolvedValueOnce(['row-1']);
    mockGetListings.mockRejectedValueOnce('listings gone');

    const rowIds = await store().uploadToShow('show-1', 'Booth', '4');

    expect(rowIds).toEqual(['row-1']);
    expect(store().uploadError['show-1']).toBeNull();
    // The refresh failure lands on the listings channel instead.
    expect(store().listingsError['show-1']).toBe('listings gone');
    expect(errSpy).toHaveBeenCalledWith(
      'Failed to refresh show listings after upload:',
      'listings gone',
    );
  });

  test('an upload failure keeps the selection and pins uploadError', async () => {
    seedSelection();
    mockUpload.mockRejectedValueOnce('quota hit');

    await expect(store().uploadToShow('show-1', 'Booth', '4')).rejects.toBe('quota hit');

    expect(store().isUploading['show-1']).toBe(false);
    expect(store().uploadError['show-1']).toBe('quota hit');
    expect(store().selections['show-1']['card-1']).toBeDefined();
    expect(mockGetListings).not.toHaveBeenCalled();
  });
});

describe('listings', () => {
  test('loadListings stores rows and cycles the loading flag', async () => {
    const gate = deferred<ShowListingItem[]>();
    mockGetListings.mockReturnValueOnce(gate.promise);

    const p = store().loadListings('show-1');
    await tick();
    expect(store().isLoadingListings['show-1']).toBe(true);
    expect(store().listingsError['show-1']).toBeNull();

    gate.resolve([mkListing()]);
    await p;

    expect(store().isLoadingListings['show-1']).toBe(false);
    expect(store().listings['show-1']).toEqual([mkListing()]);
  });

  test('a failure pins listingsError and rethrows', async () => {
    mockGetListings.mockRejectedValueOnce('Forbidden');

    await expect(store().loadListings('show-1')).rejects.toBe('Forbidden');

    expect(store().isLoadingListings['show-1']).toBe(false);
    expect(store().listingsError['show-1']).toBe("You don't have access to do that.");
  });

  test('updateListing maps to the snake_case update body then refreshes', async () => {
    await store().updateListing('show-1', 'row-1', {
      name: 'Charizard',
      set: 'Base Set',
      number: '004',
      rarity: 'Holo Rare',
      condition: 'MP',
      stickerPrice: 99,
      quantity: 1,
      vendorName: 'New Booth',
      vendorTable: '12',
    });

    // Wire-shape pin: inventory fields go snake_case but the vendor name /
    // table keys stay camelCase — the shape the service seam accepts (the
    // service itself translates them to vendor_name/vendor_table upstream).
    expect(mockUpdateListing).toHaveBeenCalledWith('row-1', {
      name: 'Charizard',
      set_name: 'Base Set',
      number: '004',
      rarity: 'Holo Rare',
      condition: 'MP',
      sticker_price: 99,
      quantity: 1,
      vendorName: 'New Booth',
      vendorTable: '12',
    });
    expect(order(mockUpdateListing)).toBeLessThan(order(mockGetListings));
  });

  test('deleteListing removes then refreshes', async () => {
    await store().deleteListing('show-1', 'row-1');

    expect(mockDeleteListing).toHaveBeenCalledWith('row-1');
    expect(order(mockDeleteListing)).toBeLessThan(order(mockGetListings));
    expect(mockGetListings).toHaveBeenCalledWith('show-1');
  });
});

describe('triggerSnapshot', () => {
  test('gates on vendor access before hitting the trigger worker', async () => {
    useShowVendorStore.setState({ profile: mkVendorProfile({ paymentsLive: true }) });

    await expect(store().triggerSnapshot('show-1')).rejects.toThrow('subscription_required');
    expect(mockTrigger).not.toHaveBeenCalled();
  });

  test('fires the publish trigger and always drops the flag', async () => {
    const gate = deferred<void>();
    mockTrigger.mockReturnValueOnce(gate.promise);

    const p = store().triggerSnapshot('show-1');
    await tick();
    expect(store().isTriggering['show-1']).toBe(true);

    gate.resolve();
    await p;
    expect(mockTrigger).toHaveBeenCalledWith('show-1');
    expect(store().isTriggering['show-1']).toBe(false);

    // The finally clears the flag on failure too.
    mockTrigger.mockRejectedValueOnce('boom');
    await expect(store().triggerSnapshot('show-1')).rejects.toBe('boom');
    expect(store().isTriggering['show-1']).toBe(false);
  });
});

describe('team actions', () => {
  test('redeemCode returns the new team, but the profile reload is authoritative', async () => {
    const redeemed = mkTeam({ name: 'Redeemed' });
    // Quirk: set({team: t}) is provisional — loadVendorProfile immediately
    // overwrites team with whatever /vendor/me returns, so a profile read
    // that hasn't caught up yet clobbers the just-redeemed team.
    const profileTeam = mkTeam({ name: 'Profile' });
    mockGetProfile.mockResolvedValue(mkServiceProfile({ team: profileTeam }));
    mockRedeem.mockResolvedValueOnce(redeemed);

    const ret = await store().redeemCode('ABC123');

    expect(ret).toBe(redeemed);
    expect(mockRedeem).toHaveBeenCalledWith('ABC123');
    expect(store().team).toBe(profileTeam);
    // Redeem → profile reload, so entitlements/isTeamMember re-resolve.
    expect(order(mockRedeem)).toBeLessThan(order(mockGetProfile));

    mockRedeem.mockRejectedValueOnce('bad code');
    await expect(store().redeemCode('XXX')).rejects.toBe('bad code');
    expect(store().teamError).toBe('bad code');
  });

  test('regenerateCode stores the team without reloading the profile', async () => {
    const team = mkTeam({ invite_code: 'NEW123' });
    mockRegen.mockResolvedValueOnce(team);

    const ret = await store().regenerateCode();

    expect(ret).toBe(team);
    expect(store().team).toBe(team);
    expect(mockGetProfile).not.toHaveBeenCalled();

    mockRegen.mockRejectedValueOnce('boom');
    await expect(store().regenerateCode()).rejects.toBe('boom');
    expect(store().teamError).toBe('boom');
  });

  test('renameTeam returns the renamed team; the profile reload stays authoritative', async () => {
    const renamed = mkTeam({ name: 'Renamed' });
    const profileTeam = mkTeam({ name: 'Profile' });
    mockGetProfile.mockResolvedValue(mkServiceProfile({ team: profileTeam }));
    mockRename.mockResolvedValueOnce(renamed);

    const ret = await store().renameTeam('Renamed');

    expect(ret).toBe(renamed);
    expect(mockRename).toHaveBeenCalledWith('Renamed');
    expect(store().team).toBe(profileTeam);
    expect(order(mockRename)).toBeLessThan(order(mockGetProfile));

    mockRename.mockRejectedValueOnce('conflict');
    await expect(store().renameTeam('X')).rejects.toBe('conflict');
    expect(store().teamError).toBe('conflict');
  });

  test('removeMember removes then reloads the team', async () => {
    mockRemoveMember.mockResolvedValueOnce(undefined);
    mockGetTeam.mockResolvedValueOnce(mkTeam({ seats_used: 1 }));

    await store().removeMember('member-9');

    expect(mockRemoveMember).toHaveBeenCalledWith('member-9');
    expect(order(mockRemoveMember)).toBeLessThan(order(mockGetTeam));
    expect(store().team?.seats_used).toBe(1);
  });

  test('leaveTeam clears the local team then reloads the profile', async () => {
    useShowVendorStore.setState({ team: mkTeam({ name: 'Old Team' }) });
    // The reload is authoritative: the profile's team lands over the
    // provisional null the leave set.
    const profileTeam = mkTeam({ name: 'Profile Team' });
    mockGetProfile.mockResolvedValue(mkServiceProfile({ team: profileTeam }));
    mockLeave.mockResolvedValueOnce(undefined);

    await store().leaveTeam();

    expect(mockLeave).toHaveBeenCalledTimes(1);
    expect(store().team).toBe(profileTeam);
    expect(order(mockLeave)).toBeLessThan(order(mockGetProfile));
  });

  test('loadTeam dedupes on the in-flight flag and maps offline errors', async () => {
    const gate = deferred<Team | null>();
    mockGetTeam.mockReturnValueOnce(gate.promise);

    const p1 = store().loadTeam();
    const p2 = store().loadTeam();
    await tick();
    expect(store().teamLoading).toBe(true);
    expect(mockGetTeam).toHaveBeenCalledTimes(1);

    gate.resolve(mkTeam());
    await Promise.all([p1, p2]);
    expect(store().teamLoading).toBe(false);

    mockGetTeam.mockRejectedValueOnce('Network request failed');
    await expect(store().loadTeam()).rejects.toBe('Network request failed');
    expect(store().teamError).toBe('No internet — team info unavailable.');
  });
});

describe('persist partialize', () => {
  test('only profile and setups survive the write', async () => {
    mockSetItem.mockClear();
    useShowVendorStore.setState({
      profile: mkVendorProfile(),
      setups: { 'show-1': { showId: 'show-1', vendorName: 'Booth', vendorTable: '4' } },
      selections: { 'show-1': { 'card-1': mkSelection() } },
      listings: { 'show-1': [mkListing()] },
      team: mkTeam(),
      requestsByShow: { 'show-1': { status: 'approved', table: '4' } },
    });
    await tick();

    const calls = mockSetItem.mock.calls.filter(([key]) => key === 'show-vendor-storage');
    const raw = calls.at(-1)?.[1];
    expect(raw).toBeDefined();
    expect(JSON.parse(raw!)).toEqual({
      state: {
        profile: mkVendorProfile(),
        setups: { 'show-1': { showId: 'show-1', vendorName: 'Booth', vendorTable: '4' } },
      },
      version: 0,
    });
  });
});
