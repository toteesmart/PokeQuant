import { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import {
  FOUNDER_OFFERING_ID,
  PRO_OFFERING_ID,
  REVENUECAT_PRODUCTS,
  TEAM_EXTRA_OFFERING_ID,
} from '../constants/revenuecat';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { useShowVendorStore } from '../store/showVendorStore';
import { formatPrice } from '../services/revenueCat';
import type { PurchasesPackage } from 'react-native-purchases';

export type PricingPreviewProps = {
  purchaseEnabled?: boolean;
  allowSkip?: boolean;
  onClose?: () => void;
  onSkip?: () => void;
  onComplete?: () => void;
};

const FALLBACK_PLANS = [
  {
    offering: 'founders',
    title: 'Founders',
    subtitle: 'First 50 sign-ups only',
    packages: [
      { id: REVENUECAT_PRODUCTS.founderIndividual, title: 'Individual', price: '$7.99 / mo' },
      { id: REVENUECAT_PRODUCTS.founderTeam, title: 'Teams (3 seats)', price: '$14.99 / mo' },
    ],
  },
  {
    offering: 'pro',
    title: 'Pro',
    subtitle: 'Full vendor access',
    packages: [
      { id: REVENUECAT_PRODUCTS.proIndividual, title: 'Individual', price: '$14.99 / mo' },
      { id: REVENUECAT_PRODUCTS.proTeam, title: 'Teams (3 seats)', price: '$34.99 / mo' },
    ],
  },
  {
    offering: 'teams_extra_seat',
    title: 'Teams Extra Seat',
    subtitle: 'Add to a Pro Team plan',
    packages: [
      { id: REVENUECAT_PRODUCTS.proExtraSeat, title: 'Extra seat', price: '$9.99 / mo' },
    ],
  },
];

function PackageCard({
  title,
  price,
  selected,
  disabled,
  onPress,
}: {
  title: string;
  price: string;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={disabled ? 1 : 0.8}
      onPress={disabled ? undefined : onPress}
      style={[
        styles.packageCard,
        selected && styles.packageCardSelected,
        disabled && styles.packageCardDisabled,
      ]}>
      <View style={styles.packageHeader}>
        <Text style={styles.packageTitle}>{title}</Text>
        <Text style={styles.packagePrice}>{price}</Text>
      </View>
      <View
        style={[
          styles.packageCtaBox,
          (disabled || selected) && styles.packageCtaBoxDisabled,
        ]}>
        <Text
          style={[
            styles.packageCta,
            disabled && styles.packageCtaDisabled,
            selected && styles.packageCtaSelected,
          ]}>
          {selected ? 'Current plan' : disabled ? 'Locked' : 'Select'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export function PricingPreview({
  purchaseEnabled = false,
  allowSkip = false,
  onClose,
  onSkip,
  onComplete,
}: PricingPreviewProps) {
  const isLoading = useSubscriptionStore(
    (s) => s.isLoadingCustomerInfo || s.isLoadingOfferings
  );
  const offerings = useSubscriptionStore((s) => s.offerings);
  const customerInfo = useSubscriptionStore((s) => s.customerInfo);
  const purchasePackage = useSubscriptionStore((s) => s.purchasePackage);
  const lastPurchaseError = useSubscriptionStore((s) => s.lastPurchaseError);
  const isFounder = useShowVendorStore((s) => s.profile?.isFounder ?? false);
  const paymentsLive = useShowVendorStore((s) => s.profile?.paymentsLive ?? false);
  const founderSeatNumber = useShowVendorStore((s) => s.profile?.founderSeatNumber);
  const hasVendor = useSubscriptionStore((s) => s.hasVendorEntitlement());

  const livePackages = useMemo(() => {
    const list: { offering: string; pkg: PurchasesPackage }[] = [];
    if (!offerings?.all) return list;
    for (const id of [FOUNDER_OFFERING_ID, PRO_OFFERING_ID, TEAM_EXTRA_OFFERING_ID]) {
      const offering = offerings.all[id];
      if (!offering) continue;
      for (const pkg of offering.availablePackages) {
        list.push({ offering: id, pkg });
      }
    }
    return list;
  }, [offerings]);

  const onSelect = useCallback(
    async (pkg: PurchasesPackage) => {
      if (!purchaseEnabled) return;
      try {
        await purchasePackage(pkg);
        onComplete?.();
      } catch {
        // purchasePackage already stores the error in the store.
      }
    },
    [purchaseEnabled, purchasePackage, onComplete]
  );

  const isPackageActive = useCallback(
    (productIdentifier: string) => {
      if (!customerInfo) return false;
      const entitlement = customerInfo.entitlements.active;
      // A package is "current" if its product granted the active vendor entitlement.
      for (const key of Object.keys(entitlement)) {
        const e = (entitlement as Record<string, { productIdentifier?: string }>)[key];
        if (e?.productIdentifier === productIdentifier) {
          return true;
        }
      }
      return false;
    },
    [customerInfo]
  );

  const hasLiveData = livePackages.length > 0;

  type DisplayPackage = {
    id: string;
    title: string;
    price: string;
    offering: string;
    pkg?: PurchasesPackage;
    isFallback: boolean;
  };

  const displayPackages = useMemo<DisplayPackage[]>(() => {
    if (hasLiveData) {
      return livePackages.map(({ offering, pkg }) => ({
        id: pkg.product.identifier,
        title: pkg.product.title || pkg.identifier,
        price: formatPrice(pkg.product),
        offering,
        pkg,
        isFallback: false,
      }));
    }
    return FALLBACK_PLANS.flatMap((o) =>
      o.packages.map((p) => ({
        id: p.id,
        title: p.title,
        price: p.price,
        offering: o.offering,
        isFallback: true,
      }))
    );
  }, [hasLiveData, livePackages]);

  return (
    <View style={styles.container}>
      {onClose && (
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Ionicons name="close" size={26} color={colors.text} />
        </TouchableOpacity>
      )}
      <View style={styles.header}>
        <Ionicons name="card-outline" size={40} color={colors.primary} />
        <Text style={styles.title}>Card Cache Plans</Text>
        <Text style={styles.subtitle}>
          {isFounder
            ? 'Your Founder seat locks in 50% off when payments go live.'
            : 'Choose a vendor plan when payments go live.'}
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        {!paymentsLive && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              Pricing preview — purchases are not enabled yet. All local features stay free until we go live.
            </Text>
          </View>
        )}

        {isLoading && !hasLiveData && (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Loading plans...</Text>
          </View>
        )}

        {lastPurchaseError ? (
          <Text style={styles.errorText}>{lastPurchaseError}</Text>
        ) : null}

        {displayPackages.map((item) => {
          const isFounders = item.offering === FOUNDER_OFFERING_ID;
          const disabled = !purchaseEnabled || (isFounders && !isFounder) || hasVendor;
          const isActive = !item.isFallback && item.pkg ? isPackageActive(item.pkg.product.identifier) : false;

          return (
            <PackageCard
              key={item.id}
              title={item.title}
              price={item.price}
              selected={isActive || (hasVendor && !disabled && !isFounders)}
              disabled={disabled}
              onPress={item.pkg ? () => onSelect(item.pkg!) : undefined}
            />
          );
        })}

        {isFounder && hasLiveData && (
          <View style={styles.founderBanner}>
            <Ionicons name="star" size={16} color={colors.background} />
            <Text style={styles.founderBannerText}>
              Founder #{founderSeatNumber ?? '—'}
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {allowSkip && (
          <TouchableOpacity activeOpacity={0.7} onPress={onSkip} style={styles.skipButton}>
            <Text style={styles.skipButtonText}>Continue with free features</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 20,
  },
  closeButton: {
    position: 'absolute',
    top: 48,
    right: 12,
    zIndex: 1,
    padding: 8,
  },
  header: {
    alignItems: 'center',
    paddingTop: 48,
    paddingBottom: 20,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: 'bold',
    marginTop: 12,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 8,
    paddingBottom: 20,
  },
  banner: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 16,
  },
  bannerText: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  packageCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 12,
  },
  packageCardSelected: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(101, 67, 246, 0.08)',
  },
  packageCardDisabled: {
    opacity: 0.55,
  },
  packageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  packageTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  packagePrice: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: 'bold',
  },
  packageCtaBox: {
    marginTop: 12,
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  packageCtaBoxDisabled: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  packageCta: {
    color: colors.background,
    fontSize: 14,
    fontWeight: '600',
  },
  packageCtaDisabled: {
    color: colors.textMuted,
  },
  packageCtaSelected: {
    color: colors.background,
  },
  founderBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    gap: 8,
  },
  founderBannerText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: '600',
  },
  loadingBox: {
    alignItems: 'center',
    padding: 32,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 12,
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 12,
  },
  footer: {
    paddingVertical: 24,
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  skipButtonText: {
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: '600',
  },
});
