import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PurchasesOfferings, PurchasesPackage } from 'react-native-purchases';
import { getRevenueCatApiKey } from '../src/constants/revenuecat';
import {
  configure as rcConfigure,
  getCustomerInfo,
  getOfferings,
  isConfigured,
  login as rcLogin,
  logout as rcLogout,
  purchasePackage as rcPurchasePackage,
  restorePurchases as rcRestorePurchases,
} from '../src/services/revenueCat';
import { syncVendorSubscription } from '../src/services/showVendorService';
import { useSubscriptionStore } from '../src/store/subscriptionStore';
import * as logModule from '../src/utils/log';
import { deferred, tick } from './helpers/async';
import { mkCustomerInfo } from './helpers/builders';

// subscriptionStore characterization pins — the revenueCat service module
// is seam-mocked except hasActiveEntitlement (the entitlement→boolean
// mapping is real and under test); getRevenueCatApiKey is cut so no env
// or expo-constants surface leaks in; syncVendorSubscription is mocked.
// AsyncStorage is the setup-level mock driven via jest.mocked handles —
// the persist partialize and the rehydrate race are pinned for real.

jest.mock('../src/services/revenueCat', () => {
  const actual = jest.requireActual<typeof import('../src/services/revenueCat')>(
    '../src/services/revenueCat',
  );
  return {
    ...actual,
    configure: jest.fn(),
    isConfigured: jest.fn(),
    login: jest.fn(),
    logout: jest.fn(),
    getCustomerInfo: jest.fn(),
    getOfferings: jest.fn(),
    purchasePackage: jest.fn(),
    restorePurchases: jest.fn(),
  };
});

jest.mock('../src/constants/revenuecat', () => {
  const actual = jest.requireActual<typeof import('../src/constants/revenuecat')>(
    '../src/constants/revenuecat',
  );
  return { ...actual, getRevenueCatApiKey: jest.fn() };
});

jest.mock('../src/services/showVendorService', () => {
  const actual = jest.requireActual<typeof import('../src/services/showVendorService')>(
    '../src/services/showVendorService',
  );
  return { ...actual, syncVendorSubscription: jest.fn() };
});

const mockRcConfigure = jest.mocked(rcConfigure);
const mockIsConfigured = jest.mocked(isConfigured);
const mockRcLogin = jest.mocked(rcLogin);
const mockRcLogout = jest.mocked(rcLogout);
const mockGetCustomerInfo = jest.mocked(getCustomerInfo);
const mockGetOfferings = jest.mocked(getOfferings);
const mockPurchase = jest.mocked(rcPurchasePackage);
const mockRestore = jest.mocked(rcRestorePurchases);
const mockGetApiKey = jest.mocked(getRevenueCatApiKey);
const mockSync = jest.mocked(syncVendorSubscription);
const mockSetItem = jest.mocked(AsyncStorage.setItem);
const mockGetItem = jest.mocked(AsyncStorage.getItem);

const errSpy = jest.spyOn(logModule, 'logError').mockImplementation(() => {});
const warnSpy = jest.spyOn(logModule, 'logWarn').mockImplementation(() => {});
const infoSpy = jest.spyOn(logModule, 'logInfo').mockImplementation(() => {});

const store = () => useSubscriptionStore.getState();
const order = (fn: jest.Mock) => fn.mock.invocationCallOrder[0];

const pro = mkCustomerInfo(['Cardcache_pro']);
const scan = mkCustomerInfo(['Cardcache_scan']);
const offerings = { current: null, all: {} } as unknown as PurchasesOfferings;
const pkg = { identifier: 'pkg' } as unknown as PurchasesPackage;
const OFFLINE_MSG = 'No internet connection — check your connection and try again.';
const NOT_CONFIGURED_MSG = 'RevenueCat is not configured';

beforeEach(() => {
  jest.clearAllMocks();
  useSubscriptionStore.setState({
    isConfigured: false,
    isLoadingCustomerInfo: false,
    isLoadingOfferings: false,
    customerInfo: null,
    offerings: null,
    hasSeenPricingPreview: false,
    lastPurchaseError: null,
    error: null,
  });
  mockIsConfigured.mockReturnValue(true);
  mockGetApiKey.mockReturnValue('rc_test_key');
  mockSync.mockResolvedValue(undefined);
  mockGetOfferings.mockResolvedValue(null);
});

it.each<[string[], boolean, boolean]>([
  [[], false, false],
  [['Cardcache_pro'], true, false],
  [['Cardcache_scan'], false, true],
  [['Cardcache_pro', 'Cardcache_scan'], true, true],
  // A product id in entitlements.active unlocks nothing — the map is
  // keyed by entitlement id, not product id.
  [['cc_scan_unlimited_monthly'], false, false],
])('entitlements %j → vendor=%s scan=%s', (activeIds, vendorExpected, scanExpected) => {
  useSubscriptionStore.setState({ customerInfo: mkCustomerInfo(activeIds) });
  expect(store().hasVendorEntitlement()).toBe(vendorExpected);
  expect(store().hasScanEntitlement()).toBe(scanExpected);
});

test('null customerInfo unlocks nothing', () => {
  useSubscriptionStore.setState({ customerInfo: null });
  expect(store().hasVendorEntitlement()).toBe(false);
  expect(store().hasScanEntitlement()).toBe(false);
});

test('configure() gates on the api key, the store flag, and the service flag', () => {
  // (a) No key → warn, service untouched, store flag stays false.
  mockIsConfigured.mockReturnValue(false);
  mockGetApiKey.mockReturnValue(null);
  store().configure();
  expect(mockRcConfigure).not.toHaveBeenCalled();
  expect(store().isConfigured).toBe(false);
  expect(warnSpy).toHaveBeenCalledWith(
    '[subscriptionStore] RevenueCat public API key not configured.',
  );

  // (b) Key present + service unconfigured → configures + flags the store.
  mockGetApiKey.mockReturnValue('rc_test_key');
  store().configure();
  expect(mockRcConfigure).toHaveBeenCalledWith('rc_test_key', null);
  expect(store().isConfigured).toBe(true);

  // (c) Store flag already true → early return, service untouched.
  mockRcConfigure.mockClear();
  store().configure();
  expect(mockRcConfigure).not.toHaveBeenCalled();
});

test('a configured service does not backfill the store flag (quirk)', () => {
  // (d) Store flag false but the service reports configured → early
  // return BEFORE the flag syncs, so isConfigured stays false.
  store().configure();
  expect(mockRcConfigure).not.toHaveBeenCalled();
  expect(store().isConfigured).toBe(false);
});

test('login() short-circuits when RevenueCat cannot configure', async () => {
  mockIsConfigured.mockReturnValue(false);
  mockGetApiKey.mockReturnValue(null);

  await store().login('user-1');

  expect(mockRcLogin).not.toHaveBeenCalled();
  expect(store().isLoadingCustomerInfo).toBe(false);
  expect(store().isLoadingOfferings).toBe(false);
  expect(store().error).toBeNull();
});

test('login() stores customerInfo, kicks a vendor sync, then loads offerings', async () => {
  mockRcLogin.mockResolvedValueOnce(pro);
  mockGetOfferings.mockResolvedValueOnce(offerings);

  await store().login('user-1');

  expect(mockRcLogin).toHaveBeenCalledWith('user-1');
  expect(store().customerInfo).toBe(pro);
  expect(store().offerings).toBe(offerings);
  expect(store().isLoadingCustomerInfo).toBe(false);
  expect(store().isLoadingOfferings).toBe(false);
  expect(store().error).toBeNull();
  expect(mockSync).toHaveBeenCalledTimes(1);
  expect(order(mockRcLogin)).toBeLessThan(order(mockSync));
  expect(order(mockSync)).toBeLessThan(order(mockGetOfferings));
});

test('login() raises both loading flags while in flight', async () => {
  const gate = deferred<Awaited<ReturnType<typeof rcLogin>>>();
  mockRcLogin.mockReturnValueOnce(gate.promise);

  const p = store().login('user-1');
  await tick();

  expect(store().isLoadingCustomerInfo).toBe(true);
  expect(store().isLoadingOfferings).toBe(true);

  gate.resolve(pro);
  await p;

  expect(store().isLoadingCustomerInfo).toBe(false);
  expect(store().isLoadingOfferings).toBe(false);
});

test('an offline vendor-sync rejection is swallowed as info; others log an error', async () => {
  mockRcLogin.mockResolvedValue(pro);
  mockSync.mockRejectedValueOnce('network request failed');

  await store().login('user-1');
  await tick();
  expect(infoSpy).toHaveBeenCalledWith(
    '[subscriptionStore] syncVendorSubscription skipped (offline).',
  );
  expect(store().error).toBeNull();

  mockSync.mockRejectedValueOnce('boom');
  await store().login('user-1');
  await tick();
  expect(errSpy).toHaveBeenCalledWith('[subscriptionStore] syncVendorSubscription failed:', 'boom');
});

test('an offerings failure degrades to null with an info log', async () => {
  mockRcLogin.mockResolvedValueOnce(pro);
  mockGetOfferings.mockRejectedValueOnce(new Error('products not linked'));

  await store().login('user-1');

  expect(store().offerings).toBeNull();
  expect(store().isLoadingOfferings).toBe(false);
  expect(store().customerInfo).toBe(pro);
  expect(store().error).toBeNull();
  expect(infoSpy).toHaveBeenCalledWith(
    '[subscriptionStore] getOfferings skipped:',
    'products not linked',
  );
});

test('a login failure maps the error and leaves stale customerInfo in place (quirk)', async () => {
  useSubscriptionStore.setState({ customerInfo: scan });
  mockRcLogin.mockRejectedValueOnce('Network request failed');

  await store().login('user-1');

  expect(store().error).toBe(OFFLINE_MSG);
  expect(store().isLoadingCustomerInfo).toBe(false);
  expect(store().isLoadingOfferings).toBe(false);
  expect(store().customerInfo).toBe(scan);
  expect(mockGetOfferings).not.toHaveBeenCalled();
  expect(mockSync).not.toHaveBeenCalled();
});

test('logout() no-ops unconfigured, clears state configured, swallows a rejection', async () => {
  // (a) Unconfigured → early return; stale customerInfo survives (quirk).
  mockIsConfigured.mockReturnValue(false);
  useSubscriptionStore.setState({ customerInfo: pro });
  await store().logout();
  expect(mockRcLogout).not.toHaveBeenCalled();
  expect(store().customerInfo).toBe(pro);

  // (b) Configured → service logout + cleared state.
  mockIsConfigured.mockReturnValue(true);
  await store().logout();
  expect(mockRcLogout).toHaveBeenCalledTimes(1);
  expect(store().customerInfo).toBeNull();
  expect(store().offerings).toBeNull();
  expect(store().error).toBeNull();

  // (c) Rejection is swallowed; the state still clears in the finally.
  useSubscriptionStore.setState({ customerInfo: pro, error: 'old' });
  mockRcLogout.mockRejectedValueOnce('offline');
  await store().logout();
  expect(store().customerInfo).toBeNull();
  expect(store().error).toBeNull();
});

test('refreshCustomerInfo replaces info on success, sets error on failure, no-ops unconfigured', async () => {
  mockGetCustomerInfo.mockResolvedValueOnce(pro);
  await store().refreshCustomerInfo();
  expect(store().customerInfo).toBe(pro);
  expect(store().isLoadingCustomerInfo).toBe(false);

  mockGetCustomerInfo.mockRejectedValueOnce('boom');
  await store().refreshCustomerInfo();
  expect(store().error).toBe('boom');
  expect(store().isLoadingCustomerInfo).toBe(false);
  expect(store().customerInfo).toBe(pro);

  mockIsConfigured.mockReturnValue(false);
  mockGetCustomerInfo.mockClear();
  await store().refreshCustomerInfo();
  expect(mockGetCustomerInfo).not.toHaveBeenCalled();
});

test('refreshOfferings replaces offerings on success, sets error on failure, no-ops unconfigured', async () => {
  mockGetOfferings.mockResolvedValueOnce(offerings);
  await store().refreshOfferings();
  expect(store().offerings).toBe(offerings);
  expect(store().isLoadingOfferings).toBe(false);

  mockGetOfferings.mockRejectedValueOnce('boom');
  await store().refreshOfferings();
  expect(store().error).toBe('boom');
  expect(store().isLoadingOfferings).toBe(false);
  expect(store().offerings).toBe(offerings);

  mockIsConfigured.mockReturnValue(false);
  mockGetOfferings.mockClear();
  await store().refreshOfferings();
  expect(mockGetOfferings).not.toHaveBeenCalled();
});

test('purchasePackage throws unconfigured; success purchases → syncs → refreshes info', async () => {
  // Unconfigured → throws before touching the service.
  mockIsConfigured.mockReturnValue(false);
  await expect(store().purchasePackage(pkg)).rejects.toThrow(NOT_CONFIGURED_MSG);
  expect(mockPurchase).not.toHaveBeenCalled();

  // Success → purchase, vendor sync, then refreshCustomerInfo.
  mockIsConfigured.mockReturnValue(true);
  useSubscriptionStore.setState({ lastPurchaseError: 'old' });
  mockPurchase.mockResolvedValueOnce({ customerInfo: pro });
  mockGetCustomerInfo.mockResolvedValueOnce(scan);

  await store().purchasePackage(pkg);

  expect(mockPurchase.mock.calls[0][0]).toBe(pkg);
  expect(mockSync).toHaveBeenCalledTimes(1);
  expect(order(mockPurchase)).toBeLessThan(order(mockSync));
  expect(order(mockSync)).toBeLessThan(order(mockGetCustomerInfo));
  expect(store().customerInfo).toBe(scan);
  expect(store().lastPurchaseError).toBeNull();
});

test('a cancelled purchase pins lastPurchaseError and stops the chain', async () => {
  mockPurchase.mockRejectedValueOnce('Purchase was cancelled');

  await expect(store().purchasePackage(pkg)).rejects.toBe('Purchase was cancelled');

  expect(store().lastPurchaseError).toBe('Purchase was cancelled');
  expect(mockSync).not.toHaveBeenCalled();
  expect(store().customerInfo).toBeNull();
});

test('a vendor-sync failure after purchase keeps the new info but pins the error (quirk)', async () => {
  mockPurchase.mockResolvedValueOnce({ customerInfo: pro });
  mockSync.mockRejectedValueOnce('boom');

  await expect(store().purchasePackage(pkg)).rejects.toBe('boom');

  expect(store().customerInfo).toBe(pro);
  expect(store().lastPurchaseError).toBe('boom');
  expect(mockGetCustomerInfo).not.toHaveBeenCalled();
});

test('restorePurchases throws unconfigured, syncs on success, maps offline errors', async () => {
  mockIsConfigured.mockReturnValue(false);
  await expect(store().restorePurchases()).rejects.toThrow(NOT_CONFIGURED_MSG);

  mockIsConfigured.mockReturnValue(true);
  mockRestore.mockResolvedValueOnce(pro);
  await store().restorePurchases();
  expect(store().customerInfo).toBe(pro);
  expect(mockSync).toHaveBeenCalledTimes(1);
  expect(store().error).toBeNull();

  mockRestore.mockRejectedValueOnce('Network request failed');
  await expect(store().restorePurchases()).rejects.toBe('Network request failed');
  expect(store().error).toBe(OFFLINE_MSG);
  expect(infoSpy).toHaveBeenCalledWith('[subscriptionStore] restorePurchases skipped (offline).');
});

test('markPricingPreviewSeen persists only that flag through the real write', async () => {
  useSubscriptionStore.setState({ customerInfo: pro });

  store().markPricingPreviewSeen();
  await tick();

  expect(store().hasSeenPricingPreview).toBe(true);
  const [key, raw] = mockSetItem.mock.calls.at(-1)!;
  expect(key).toBe('subscription-storage');
  expect(JSON.parse(raw)).toEqual({
    state: { hasSeenPricingPreview: true },
    version: 0,
  });
});

test('a stale persisted snapshot overwrites an in-memory skip (the SubscriptionGate race)', async () => {
  store().markPricingPreviewSeen();
  expect(store().hasSeenPricingPreview).toBe(true);

  // Rehydration replays the persisted snapshot over live state — exactly
  // why SubscriptionGate keeps hasSkippedThisSession instead of trusting
  // the store flag after a skip.
  mockGetItem.mockResolvedValueOnce(
    JSON.stringify({ state: { hasSeenPricingPreview: false }, version: 0 }),
  );
  await useSubscriptionStore.persist.rehydrate();

  expect(store().hasSeenPricingPreview).toBe(false);
});
