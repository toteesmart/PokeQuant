import Purchases, {
  CustomerInfo,
  LOG_LEVEL,
  PurchasesOfferings,
  PurchasesPackage,
  PurchasesStoreProduct,
} from 'react-native-purchases';
import { VENDOR_ENTITLEMENT_ID } from '../constants/revenuecat';

let hasConfigured = false;

export function isConfigured(): boolean {
  return hasConfigured;
}

export function configure(apiKey: string, appUserID?: string | null): void {
  if (!apiKey) {
    console.warn('[RevenueCat] No public API key configured; skipping configure.');
    return;
  }
  if (hasConfigured) {
    return;
  }
  Purchases.setLogLevel(LOG_LEVEL.INFO);
  Purchases.configure({
    apiKey,
    appUserID: appUserID ?? undefined,
    automaticDeviceIdentifierCollectionEnabled: false,
  });
  hasConfigured = true;
}

export async function login(appUserID: string): Promise<CustomerInfo> {
  const { customerInfo } = await Purchases.logIn(appUserID);
  return customerInfo;
}

export async function logout(): Promise<void> {
  await Purchases.logOut();
}

export async function getCustomerInfo(): Promise<CustomerInfo> {
  return Purchases.getCustomerInfo();
}

export async function getOfferings(): Promise<PurchasesOfferings | null> {
  return Purchases.getOfferings();
}

export async function purchasePackage(
  aPackage: PurchasesPackage
): Promise<{ customerInfo: CustomerInfo }> {
  const result = await Purchases.purchasePackage(aPackage);
  return { customerInfo: result.customerInfo };
}

export async function restorePurchases(): Promise<CustomerInfo> {
  return Purchases.restorePurchases();
}

export function hasActiveEntitlement(customerInfo: CustomerInfo | null): boolean {
  if (!customerInfo) return false;
  const entitlement = customerInfo.entitlements.active[VENDOR_ENTITLEMENT_ID];
  return !!entitlement;
}

export function formatPrice(product: PurchasesStoreProduct | null): string {
  if (!product) return '$--';
  if (typeof product.priceString === 'string' && product.priceString) {
    return product.priceString;
  }
  return `$${product.price ?? '--'}`;
}
