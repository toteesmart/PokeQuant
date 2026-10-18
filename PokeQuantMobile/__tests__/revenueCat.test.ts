import { mkCustomerInfo } from './helpers/builders';
import { VENDOR_ENTITLEMENT_ID, SCAN_ENTITLEMENT_ID } from '../src/constants/revenuecat';

// `hasConfigured` is module state — every test loads a fresh copy of the
// service (and the purchases mock from the same registry) so the flag starts
// clean without resetModules leaking into other suites.
type Service = typeof import('../src/services/revenueCat');
type PurchasesMock = jest.Mocked<typeof import('react-native-purchases').default>;

let svc: Service;
let Purchases: PurchasesMock;
let LOG_LEVEL: (typeof import('react-native-purchases'))['LOG_LEVEL'];

function loadService() {
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    svc = require('../src/services/revenueCat');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const purchasesModule = require('react-native-purchases');
    Purchases = purchasesModule.default;
    LOG_LEVEL = purchasesModule.LOG_LEVEL;
  });
}

beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

beforeEach(() => {
  jest.clearAllMocks();
  loadService();
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('configure', () => {
  test('an empty api key warns and skips configuration', () => {
    svc.configure('');

    expect(Purchases.configure).not.toHaveBeenCalled();
    expect(Purchases.setLogLevel).not.toHaveBeenCalled();
    expect(svc.isConfigured()).toBe(false);
  });

  test('a key sets INFO log level then configures with the user id', () => {
    svc.configure('key', 'user');

    expect(Purchases.setLogLevel).toHaveBeenCalledWith(LOG_LEVEL.INFO);
    expect(Purchases.configure).toHaveBeenCalledWith({
      apiKey: 'key',
      appUserID: 'user',
      automaticDeviceIdentifierCollectionEnabled: false,
    });
    expect(Purchases.setLogLevel.mock.invocationCallOrder[0]).toBeLessThan(
      Purchases.configure.mock.invocationCallOrder[0],
    );
    expect(svc.isConfigured()).toBe(true);
  });

  test('a second configure call is a no-op', () => {
    svc.configure('key', 'user');
    svc.configure('key2', 'user2');

    expect(Purchases.configure).toHaveBeenCalledTimes(1);
    expect(svc.isConfigured()).toBe(true);
  });

  test('a null user id maps to undefined appUserID', () => {
    svc.configure('key', null);

    expect(Purchases.configure).toHaveBeenCalledWith({
      apiKey: 'key',
      appUserID: undefined,
      automaticDeviceIdentifierCollectionEnabled: false,
    });
  });
});

describe('passthroughs', () => {
  test('login returns the customerInfo from logIn', async () => {
    const info = mkCustomerInfo([VENDOR_ENTITLEMENT_ID]);
    Purchases.logIn.mockResolvedValue({ customerInfo: info } as never);

    expect(await svc.login('user-1')).toBe(info);
    expect(Purchases.logIn).toHaveBeenCalledWith('user-1');
  });

  test('purchasePackage returns only the customerInfo', async () => {
    const info = mkCustomerInfo([]);
    Purchases.purchasePackage.mockResolvedValue({
      customerInfo: info,
      productIdentifier: 'cc_pro',
    } as never);
    const pkg = {} as never;

    const res = await svc.purchasePackage(pkg);

    expect(res).toEqual({ customerInfo: info });
    expect(Object.keys(res)).toEqual(['customerInfo']);
  });

  test('getOfferings / restorePurchases / getCustomerInfo / logout pass through', async () => {
    const offerings = { current: 'off' };
    const info = mkCustomerInfo([]);
    Purchases.getOfferings.mockResolvedValue(offerings as never);
    Purchases.restorePurchases.mockResolvedValue(info as never);
    Purchases.getCustomerInfo.mockResolvedValue(info as never);
    Purchases.logOut.mockResolvedValue(undefined as never);

    expect(await svc.getOfferings()).toBe(offerings);
    expect(await svc.restorePurchases()).toBe(info);
    expect(await svc.getCustomerInfo()).toBe(info);
    await svc.logout();
    expect(Purchases.logOut).toHaveBeenCalledTimes(1);
  });
});

describe('hasActiveEntitlement', () => {
  test('null customerInfo is false', () => {
    expect(svc.hasActiveEntitlement(null)).toBe(false);
  });

  test('the default vendor entitlement id is checked', () => {
    expect(svc.hasActiveEntitlement(mkCustomerInfo(['Cardcache_pro']))).toBe(true);
    expect(svc.hasActiveEntitlement(mkCustomerInfo(['Cardcache_scan']))).toBe(false);
    expect(VENDOR_ENTITLEMENT_ID).toBe('Cardcache_pro');
  });

  test('an explicit entitlement id is honored', () => {
    expect(svc.hasActiveEntitlement(mkCustomerInfo([SCAN_ENTITLEMENT_ID]), 'Cardcache_scan')).toBe(
      true,
    );
  });
});

describe('formatPrice', () => {
  test.each([
    ['null product', null, '$--'],
    ['priceString wins', { priceString: '$4.99', price: 4.99 }, '$4.99'],
    ['empty priceString falls back to price', { priceString: '', price: 3 }, '$3'],
    ['neither field → placeholder', {}, '$--'],
  ])('%s → %s', (_label, product, expected) => {
    expect(svc.formatPrice(product as never)).toBe(expected);
  });
});
