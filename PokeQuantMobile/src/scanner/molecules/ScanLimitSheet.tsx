import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PurchasesPackage } from 'react-native-purchases';
import { colors } from '../../constants/colors';
import {
  COLLECTOR_OFFERING_ID,
  REVENUECAT_PRODUCTS,
  SCAN_ENTITLEMENT_ID,
  VENDOR_ENTITLEMENT_ID,
  isScanProduct,
} from '../../constants/revenuecat';
import { useSubscriptionStore } from '../../store/subscriptionStore';
import { PricingPreview } from '../../components/PricingPreview';
import { formatPrice } from '../../services/revenueCat';

type Props = {
  visible: boolean;
  onClose: () => void;
  onUpgraded: () => void;
};

const FALLBACK_PACKAGES = [
  {
    productId: REVENUECAT_PRODUCTS.scanMonthly,
    title: 'Monthly',
    price: '$4.99 / month',
  },
  {
    productId: REVENUECAT_PRODUCTS.scanYearly,
    title: 'Yearly',
    price: '$29.99 / year — best value',
  },
];

/**
 * Hard-block upgrade sheet shown when a free user hits the daily scan limit.
 * "Not now" returns to the camera but the shutter stays gated — every press
 * re-opens this sheet. Lifts only on entitlement or local-midnight rollover.
 */
export function ScanLimitSheet({ visible, onClose, onUpgraded }: Props) {
  const insets = useSafeAreaInsets();
  const offerings = useSubscriptionStore((s) => s.offerings);
  const purchasePackage = useSubscriptionStore((s) => s.purchasePackage);
  const restorePurchases = useSubscriptionStore((s) => s.restorePurchases);
  const lastPurchaseError = useSubscriptionStore((s) => s.lastPurchaseError);
  const [busy, setBusy] = useState(false);
  const [showAllPlans, setShowAllPlans] = useState(false);
  const [restoredNothing, setRestoredNothing] = useState(false);

  const scanPackages = useMemo(() => {
    const offering = offerings?.all?.[COLLECTOR_OFFERING_ID];
    if (!offering) return [];
    return offering.availablePackages.filter((pkg) =>
      isScanProduct(pkg.product.identifier)
    );
  }, [offerings]);

  const isEntitled = useCallback(() => {
    const info = useSubscriptionStore.getState().customerInfo;
    return (
      !!info?.entitlements.active[SCAN_ENTITLEMENT_ID] ||
      !!info?.entitlements.active[VENDOR_ENTITLEMENT_ID]
    );
  }, []);

  const handlePurchase = useCallback(
    async (pkg: PurchasesPackage) => {
      setBusy(true);
      try {
        await purchasePackage(pkg);
        onUpgraded();
      } catch {
        // lastPurchaseError is rendered from the store.
      } finally {
        setBusy(false);
      }
    },
    [purchasePackage, onUpgraded]
  );

  const handleRestore = useCallback(async () => {
    setBusy(true);
    setRestoredNothing(false);
    try {
      await restorePurchases();
      if (isEntitled()) {
        onUpgraded();
      } else {
        setRestoredNothing(true);
      }
    } catch {
      // Store surfaces the error via `error`/lastPurchaseError.
    } finally {
      setBusy(false);
    }
  }, [restorePurchases, isEntitled, onUpgraded]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}>
      {showAllPlans ? (
        <View style={styles.fullPlans}>
          <PricingPreview
            allowSkip
            onClose={() => setShowAllPlans(false)}
            onSkip={() => setShowAllPlans(false)}
            onComplete={() => {
              setShowAllPlans(false);
              onUpgraded();
            }}
          />
        </View>
      ) : (
        <View style={styles.backdrop}>
          <Pressable style={styles.backdropTouch} onPress={onClose} />
          <View
            style={[
              styles.sheet,
              { paddingBottom: insets.bottom + 16 },
            ]}>
          <View style={styles.iconRow}>
            <Ionicons name="scan-outline" size={32} color={colors.primary} />
          </View>
          <Text style={styles.title}>Daily scan limit reached</Text>
          <Text style={styles.subtitle}>
            Free includes 15 scans a day — they refresh at midnight. Go
            unlimited:
          </Text>

          {lastPurchaseError ? (
            <Text style={styles.errorText}>{lastPurchaseError}</Text>
          ) : null}
          {restoredNothing ? (
            <Text style={styles.errorText}>
              No active purchases found on this account.
            </Text>
          ) : null}

          {scanPackages.length > 0
            ? scanPackages.map((pkg) => (
                <Pressable
                  key={pkg.product.identifier}
                  style={[styles.planButton, busy && styles.planButtonDisabled]}
                  disabled={busy}
                  onPress={() => handlePurchase(pkg)}>
                  <View>
                    <Text style={styles.planTitle}>
                      {pkg.product.identifier ===
                      REVENUECAT_PRODUCTS.scanYearly
                        ? 'Yearly — best value'
                        : 'Monthly'}
                    </Text>
                    <Text style={styles.planPrice}>
                      {formatPrice(pkg.product)} · unlimited offline scans
                    </Text>
                  </View>
                  {busy ? (
                    <ActivityIndicator color={colors.text} size="small" />
                  ) : (
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={colors.textMuted}
                    />
                  )}
                </Pressable>
              ))
            : FALLBACK_PACKAGES.map((p) => (
                <View key={p.productId} style={styles.planButton}>
                  <View>
                    <Text style={styles.planTitle}>{p.title}</Text>
                    <Text style={styles.planPrice}>
                      {p.price} · unlimited offline scans
                    </Text>
                  </View>
                </View>
              ))}

          {scanPackages.length === 0 ? (
            <Text style={styles.offlineHint}>
              Connect to the internet to purchase — or come back tomorrow for
              15 more free scans.
            </Text>
          ) : null}

          <Pressable
            style={styles.linkRow}
            disabled={busy}
            onPress={() => setShowAllPlans(true)}>
            <Text style={styles.linkText}>
              See all plans — vendor tools included
            </Text>
          </Pressable>

          <View style={styles.footerRow}>
            <Pressable
              disabled={busy}
              onPress={handleRestore}
              hitSlop={8}>
              <Text style={styles.footerLink}>Restore purchases</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={onClose} hitSlop={8}>
              <Text style={styles.footerLink}>Not now</Text>
            </Pressable>
          </View>
        </View>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  backdropTouch: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  iconRow: {
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 14,
    lineHeight: 19,
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 10,
  },
  planButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  planButtonDisabled: {
    opacity: 0.6,
  },
  planTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  planPrice: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  offlineHint: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 4,
  },
  linkRow: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  linkText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 6,
  },
  footerLink: {
    color: colors.textMuted,
    fontSize: 13,
  },
  fullPlans: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
