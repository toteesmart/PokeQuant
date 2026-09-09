import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import { PRIVACY_POLICY_URL, TERMS_OF_USE_URL } from '../constants/legal';
import {
  FOUNDER_OFFERING_ID,
  PRICING_PACKAGE_IDS,
  PRO_OFFERING_ID,
  REVENUECAT_PRODUCTS,
  TEAM_EXTRA_OFFERING_ID,
  VENDOR_ENTITLEMENT_ID,
  isExtraSeatProduct,
  isFounderProduct,
} from '../constants/revenuecat';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { useShowVendorStore } from '../store/showVendorStore';
import { formatPrice } from '../services/revenueCat';
import type { PurchasesPackage } from 'react-native-purchases';

export type PricingPreviewProps = {
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

function getOfferingLabel(offering: string): string {
  if (offering === FOUNDER_OFFERING_ID) return 'Founder';
  if (offering === PRO_OFFERING_ID) return 'Pro';
  if (offering === TEAM_EXTRA_OFFERING_ID) return 'Extra seat';
  return offering;
}

function PackageCard({
  title,
  price,
  offering,
  selected,
  disabled,
  onPress,
}: {
  title: string;
  price: string;
  offering: string;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const isFounder = offering === FOUNDER_OFFERING_ID;
  return (
    <TouchableOpacity
      activeOpacity={disabled ? 1 : 0.8}
      onPress={disabled ? undefined : onPress}
      style={[
        styles.packageCard,
        selected && styles.packageCardSelected,
        disabled && styles.packageCardDisabled,
      ]}>
      <View style={styles.packageBadgeRow}>
        <View
          style={[
            styles.packageBadge,
            isFounder && styles.packageBadgeFounder,
          ]}>
          <Text
            style={[
              styles.packageBadgeText,
              isFounder && styles.packageBadgeTextFounder,
            ]}>
            {getOfferingLabel(offering)}
          </Text>
        </View>
      </View>
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
  const restorePurchases = useSubscriptionStore((s) => s.restorePurchases);
  const lastPurchaseError = useSubscriptionStore((s) => s.lastPurchaseError);
  const [isRestoring, setIsRestoring] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [isRedeeming, setIsRedeeming] = useState(false);
  const profile = useShowVendorStore((s) => s.profile);
  const isFounder = profile?.isFounder ?? false;
  const paymentsLive = profile?.paymentsLive ?? false;
  const founderSeatNumber = profile?.founderSeatNumber;
  const founderSeatsRemaining = profile?.founderSeatsRemaining ?? 0;
  const hasVendor = useSubscriptionStore((s) => s.hasVendorEntitlement());
  const isVendor = hasVendor || profile?.isVendor || profile?.isFounder || profile?.isTeamMember;
  const redeemCode = useShowVendorStore((s) => s.redeemCode);
  const loadVendorProfile = useShowVendorStore((s) => s.loadVendorProfile);

  const activeProductId = useMemo(() => {
    if (!customerInfo) return null;
    const entitlement = customerInfo.entitlements.active[VENDOR_ENTITLEMENT_ID];
    return entitlement?.productIdentifier ?? null;
  }, [customerInfo]);

  const isActiveTeamOwner = useMemo(() => {
    if (!profile?.team?.is_owner) return false;
    const expiresAt = profile.team.expires_at;
    if (expiresAt == null) return true;
    return Math.floor(Date.now() / 1000) < Number(expiresAt);
  }, [profile?.team]);

  const allowedProductIds = useMemo(
    () => new Set<string>(PRICING_PACKAGE_IDS as unknown as string[]),
    []
  );

  const livePackages = useMemo(() => {
    const list: { offering: string; pkg: PurchasesPackage }[] = [];
    if (!offerings?.all) return list;
    for (const id of [FOUNDER_OFFERING_ID, PRO_OFFERING_ID, TEAM_EXTRA_OFFERING_ID]) {
      const offering = offerings.all[id];
      if (!offering) continue;
      for (const pkg of offering.availablePackages) {
        if (allowedProductIds.has(pkg.product.identifier)) {
          list.push({ offering: id, pkg });
        }
      }
    }
    return list;
  }, [offerings, allowedProductIds]);

  // Purchases are enabled whenever the store has live offerings; the
  // payments_live flag only controls feature gating, not the ability to buy.
  // This also lets App Review complete a purchase before payments go live.
  const onSelect = useCallback(
    async (pkg: PurchasesPackage) => {
      try {
        await purchasePackage(pkg);
        onComplete?.();
      } catch {
        // purchasePackage already stores the error in the store.
      }
    },
    [purchasePackage, onComplete]
  );

  const onRestore = useCallback(async () => {
    setIsRestoring(true);
    try {
      await restorePurchases();
      Alert.alert('Purchases restored', 'Your subscription status is up to date.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Restore failed', message);
    } finally {
      setIsRestoring(false);
    }
  }, [restorePurchases]);

  const handleRedeem = useCallback(async () => {
    const code = inviteCode.trim();
    if (!code) return;
    setIsRedeeming(true);
    try {
      await redeemCode(code);
      await loadVendorProfile();
      setInviteCode('');
      if (onComplete) {
        onComplete();
      } else if (onClose) {
        onClose();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Could not redeem team code', message);
    } finally {
      setIsRedeeming(false);
    }
  }, [inviteCode, redeemCode, loadVendorProfile, onComplete, onClose]);

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
      o.packages
        .filter((p) => allowedProductIds.has(p.id))
        .map((p) => ({
          id: p.id,
          title: p.title,
          price: p.price,
          offering: o.offering,
          isFallback: true,
        }))
    );
  }, [hasLiveData, livePackages, allowedProductIds]);

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
            : paymentsLive
            ? 'Choose a vendor plan.'
            : 'Choose a vendor plan. Subscribing early locks in launch pricing.'}
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        {!paymentsLive && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              All features stay free until payments go live. Subscribing now locks in launch pricing and counts toward Founder seats.
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
          const isFounderPlan = isFounderProduct(item.id);
          const isExtraSeat = isExtraSeatProduct(item.id);
          const isActive =
            !item.isFallback &&
            !!item.pkg &&
            activeProductId === item.pkg.product.identifier;
          const isFounderEligible =
            isFounder ||
            founderSeatNumber != null ||
            founderSeatsRemaining > 0;

          const disabled =
            !item.pkg ||
            isActive ||
            (isFounderPlan && !isFounderEligible) ||
            (isExtraSeat && !isActiveTeamOwner);

          return (
            <PackageCard
              key={item.id}
              title={item.title}
              price={item.price}
              offering={item.offering}
              selected={isActive}
              disabled={disabled}
              onPress={item.pkg && !disabled ? () => onSelect(item.pkg!) : undefined}
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

        {paymentsLive && !isVendor && (
          <View style={styles.teamInviteBox}>
            {!showInvite ? (
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => setShowInvite(true)}>
                <Text style={styles.teamInviteText}>
                  Have a team invite code?
                </Text>
              </TouchableOpacity>
            ) : (
              <>
                <Text style={styles.teamInviteLabel}>
                  Enter your 6-digit team invite code
                </Text>
                <View style={styles.teamInviteRow}>
                  <TextInput
                    style={styles.teamInviteInput}
                    placeholder="000000"
                    placeholderTextColor={colors.textMuted}
                    value={inviteCode}
                    onChangeText={setInviteCode}
                    keyboardType="number-pad"
                    maxLength={6}
                    editable={!isRedeeming}
                  />
                  <TouchableOpacity
                    style={[
                      styles.teamInviteButton,
                      (!inviteCode.trim() || isRedeeming) &&
                        styles.teamInviteButtonDisabled,
                    ]}
                    activeOpacity={0.8}
                    onPress={handleRedeem}
                    disabled={!inviteCode.trim() || isRedeeming}>
                    {isRedeeming ? (
                      <ActivityIndicator color={colors.text} size="small" />
                    ) : (
                      <Text style={styles.teamInviteButtonText}>Redeem</Text>
                    )}
                  </TouchableOpacity>
                </View>
                {lastPurchaseError ? null : null}
                <TouchableOpacity
                  style={styles.teamInviteCancel}
                  activeOpacity={0.7}
                  onPress={() => {
                    setShowInvite(false);
                    setInviteCode('');
                  }}>
                  <Text style={styles.teamInviteCancelText}>
                    Back to plans
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {allowSkip && (
          <TouchableOpacity activeOpacity={0.7} onPress={onSkip} style={styles.skipButton}>
            <Text style={styles.skipButtonText}>Continue with free features</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.disclosureText}>
          Payment will be charged to your Apple ID account at confirmation of
          purchase. Subscriptions are billed monthly and automatically renew
          unless canceled at least 24 hours before the end of the current
          period. Manage or cancel anytime in your App Store account settings.
        </Text>

        <View style={styles.legalRow}>
          {PRIVACY_POLICY_URL ? (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}>
              <Text style={styles.legalLink}>Privacy Policy</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => Linking.openURL(TERMS_OF_USE_URL)}>
            <Text style={styles.legalLink}>Terms of Use (EULA)</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.7}
            disabled={isRestoring}
            onPress={onRestore}>
            {isRestoring ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <Text style={styles.legalLink}>Restore Purchases</Text>
            )}
          </TouchableOpacity>
        </View>
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
  packageBadgeRow: {
    marginBottom: 8,
  },
  packageBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceLight,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  packageBadgeFounder: {
    backgroundColor: 'rgba(101, 67, 246, 0.15)',
    borderColor: colors.primary,
  },
  packageBadgeText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  packageBadgeTextFounder: {
    color: colors.primary,
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
  disclosureText: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
    marginTop: 8,
  },
  legalRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
    gap: 20,
  },
  legalLink: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  teamInviteBox: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginTop: 8,
    alignItems: 'center',
  },
  teamInviteText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  teamInviteLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 10,
  },
  teamInviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  teamInviteInput: {
    width: 120,
    backgroundColor: colors.background,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 18,
    textAlign: 'center',
    letterSpacing: 3,
  },
  teamInviteButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  teamInviteButtonDisabled: {
    opacity: 0.5,
  },
  teamInviteButtonText: {
    color: colors.background,
    fontSize: 15,
    fontWeight: '600',
  },
  teamInviteCancel: {
    marginTop: 12,
  },
  teamInviteCancelText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
});
