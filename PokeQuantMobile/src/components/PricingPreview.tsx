import { useCallback, useEffect, useMemo, useState } from 'react';
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
  COLLECTOR_OFFERING_ID,
  FOUNDER_OFFERING_ID,
  PRICING_PACKAGE_IDS,
  PRO_OFFERING_ID,
  REVENUECAT_PRODUCTS,
  TEAM_EXTRA_OFFERING_ID,
  VENDOR_ENTITLEMENT_ID,
  isExtraSeatProduct,
  isFounderProduct,
  isScanProduct,
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
    offering: 'collector',
    title: 'Collector',
    subtitle: 'Unlimited offline card scanning',
    packages: [
      { id: REVENUECAT_PRODUCTS.scanMonthly, title: 'Monthly', price: '$4.99' },
      { id: REVENUECAT_PRODUCTS.scanYearly, title: 'Yearly', price: '$29.99' },
    ],
  },
  {
    offering: 'founders',
    title: 'Founders',
    subtitle: 'First 50 sign-ups only',
    packages: [
      { id: REVENUECAT_PRODUCTS.founderIndividual, title: 'Individual', price: '$7.99' },
      { id: REVENUECAT_PRODUCTS.founderTeam, title: '3 seats', price: '$14.99' },
    ],
  },
  {
    offering: 'pro',
    title: 'Pro',
    subtitle: 'Full vendor access',
    packages: [
      { id: REVENUECAT_PRODUCTS.proIndividual, title: 'Individual', price: '$14.99' },
      { id: REVENUECAT_PRODUCTS.proIndividualYearly, title: 'Individual · Yearly', price: '$119.99' },
      { id: REVENUECAT_PRODUCTS.proTeam, title: '3 Pro seats', price: '$34.99' },
    ],
  },
  {
    offering: 'teams_extra_seat',
    title: 'Extra Team Seat',
    subtitle: 'Add to a Pro Team plan',
    packages: [
      { id: REVENUECAT_PRODUCTS.proExtraSeat, title: 'Extra Pro seat', price: '$9.99 / mo' },
    ],
  },
];

function getOfferingLabel(offering: string): string {
  if (offering === COLLECTOR_OFFERING_ID) return 'Collector';
  if (offering === FOUNDER_OFFERING_ID) return 'Founder';
  if (offering === PRO_OFFERING_ID) return 'Pro';
  if (offering === TEAM_EXTRA_OFFERING_ID) return 'Extra seat';
  return offering;
}

function getPackageTitle(productId: string, fallback: string): string {
  // Section headers carry the plan name, so card titles stay terse.
  if (productId === REVENUECAT_PRODUCTS.scanMonthly) return 'Monthly';
  if (productId === REVENUECAT_PRODUCTS.scanYearly) return 'Yearly';
  if (productId === REVENUECAT_PRODUCTS.founderIndividual) return 'Founder Individual';
  if (productId === REVENUECAT_PRODUCTS.founderTeam) return 'Founder Team (3 seats)';
  if (productId === REVENUECAT_PRODUCTS.proIndividual) return 'Monthly';
  if (productId === REVENUECAT_PRODUCTS.proIndividualYearly) return 'Yearly';
  if (productId === REVENUECAT_PRODUCTS.proTeam) return 'Pro Team (3 seats)';
  if (productId === REVENUECAT_PRODUCTS.proExtraSeat) return 'Extra Seat';
  return fallback;
}

function billingPeriod(productId: string): string {
  return productId.endsWith('_yearly') ? '/ yr' : '/ mo';
}

// Three horizontal rows — collector first (attendees are the majority), then
// individual, then team. Founders sit inside their matching row.
const PLAN_SECTIONS = [
  {
    key: 'collector',
    title: 'Collector',
    blurb: 'Unlimited offline scanning — no daily cap, works with no signal.',
    order: [
      REVENUECAT_PRODUCTS.scanMonthly,
      REVENUECAT_PRODUCTS.scanYearly,
    ],
  },
  {
    key: 'individual',
    title: 'Pro Individual',
    blurb:
      'Vendor tools: publish to shows, buy offers, sticker pricing. Founder locks launch pricing — first 50.',
    order: [
      REVENUECAT_PRODUCTS.founderIndividual,
      REVENUECAT_PRODUCTS.proIndividual,
      REVENUECAT_PRODUCTS.proIndividualYearly,
    ],
  },
  {
    key: 'team',
    title: 'Pro Team',
    blurb:
      'Independent Pro seats for your crew — each teammate gets their own account.',
    order: [
      REVENUECAT_PRODUCTS.founderTeam,
      REVENUECAT_PRODUCTS.proTeam,
      REVENUECAT_PRODUCTS.proExtraSeat,
    ],
  },
] as const;

function PackageCard({
  title,
  price,
  period,
  offering,
  selected,
  disabled,
  onPress,
}: {
  title: string;
  price: string;
  period: string;
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
      <Text style={styles.packageTitle} numberOfLines={2}>
        {title}
      </Text>
      <View style={styles.packagePriceRow}>
        <Text style={styles.packagePrice}>{price}</Text>
        <Text style={styles.packagePeriod}>{period}</Text>
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
  const isVendor = hasVendor || profile?.isVendor || profile?.isTeamMember;
  const redeemCode = useShowVendorStore((s) => s.redeemCode);
  const loadVendorProfile = useShowVendorStore((s) => s.loadVendorProfile);

  useEffect(() => {
    let mounted = true;

    const refresh = async () => {
      try {
        await useSubscriptionStore.getState().refreshCustomerInfo();
      } catch {
        // RevenueCat may not be configured or offline; continue with profile load.
      }

      if (!mounted) return;

      try {
        await loadVendorProfile();
      } catch {
        // Offline or unauthenticated; the paywall will still render.
      }
    };

    refresh();

    return () => {
      mounted = false;
    };
  }, [loadVendorProfile]);

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
    for (const id of [
      COLLECTOR_OFFERING_ID,
      FOUNDER_OFFERING_ID,
      PRO_OFFERING_ID,
      TEAM_EXTRA_OFFERING_ID,
    ]) {
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
        // Reload the vendor profile so the worker-side subscription/team state is
        // reflected immediately in Settings and other screens.
        await loadVendorProfile();
        onComplete?.();
      } catch {
        // purchasePackage already stores the error in the store.
      }
    },
    [purchasePackage, onComplete, loadVendorProfile]
  );

  const onRestore = useCallback(async () => {
    setIsRestoring(true);
    try {
      await restorePurchases();
      await loadVendorProfile();
      Alert.alert('Purchases restored', 'Your subscription status is up to date.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Restore failed', message);
    } finally {
      setIsRestoring(false);
    }
  }, [restorePurchases, loadVendorProfile]);

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
        title: getPackageTitle(pkg.product.identifier, pkg.product.title || pkg.identifier),
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
          title: getPackageTitle(p.id, p.title),
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
        {isFounder || founderSeatNumber != null ? (
          <View style={styles.founderCounterPill}>
            <Ionicons name="star" size={13} color="#E8B94A" />
            <Text style={styles.founderCounter}>
              Founder #{founderSeatNumber ?? '—'}/50
            </Text>
          </View>
        ) : founderSeatsRemaining > 0 ? (
          <View style={styles.founderCounterPill}>
            <Ionicons name="star-outline" size={13} color="#E8B94A" />
            <Text style={styles.founderCounter}>
              {founderSeatsRemaining}/50 Founder seats left
            </Text>
          </View>
        ) : null}
        <Text style={styles.title}>Card Cache Plans</Text>
        <Text style={styles.subtitle}>
          {isFounder ? (
            'Your Founder seat locks in 50% off when payments go live.'
          ) : paymentsLive ? (
            'Unlimited scans for collectors. Vendor tools for dealers.'
          ) : (
            <>
              {'Unlimited scans for collectors. Vendor tools for dealers — '}
              <Text style={styles.subtitleBold}>free during launch.</Text>
            </>
          )}
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        {isLoading && !hasLiveData && (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Loading plans...</Text>
          </View>
        )}

        {lastPurchaseError ? (
          <Text style={styles.errorText}>{lastPurchaseError}</Text>
        ) : null}

        {PLAN_SECTIONS.map((section) => {
          const items = section.order
            .map((id) => displayPackages.find((d) => d.id === id))
            .filter((d): d is DisplayPackage => !!d);
          if (items.length === 0) return null;
          return (
            <View key={section.key} style={styles.planSection}>
              <Text style={styles.planSectionTitle}>{section.title}</Text>
              <Text style={styles.planSectionBlurb}>{section.blurb}</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.planRowScroll}
                contentContainerStyle={styles.planRowContent}>
                {items.map((item) => {
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

                  // Collector plans are redundant for anyone with Pro-level
                  // access — lock rather than letting a Pro user crossgrade
                  // down into a scans-only product.
                  const disabled =
                    !item.pkg ||
                    isActive ||
                    (isFounderPlan && !isFounderEligible) ||
                    (isExtraSeat && !isActiveTeamOwner) ||
                    (isScanProduct(item.id) && isVendor);

                  return (
                    <PackageCard
                      key={item.id}
                      title={item.title}
                      price={item.price}
                      period={billingPeriod(item.id)}
                      offering={item.offering}
                      selected={isActive}
                      disabled={disabled}
                      onPress={
                        item.pkg && !disabled
                          ? () => onSelect(item.pkg!)
                          : undefined
                      }
                    />
                  );
                })}
              </ScrollView>
            </View>
          );
        })}

        {allowSkip && (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={onSkip}
            style={styles.skipButton}>
            <Text style={styles.skipButtonText}>Continue with free features</Text>
          </TouchableOpacity>
        )}

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
                  Have a team seat invite code?
                </Text>
              </TouchableOpacity>
            ) : (
              <>
                <Text style={styles.teamInviteLabel}>
                  Enter your 6-digit team seat invite code
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
        <Text style={styles.disclosureText}>
          Subscriptions auto-renew unless canceled at least 24 hours before the
          period ends. Manage or cancel in App Store settings.
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
    paddingBottom: 5,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: 'bold',
    marginTop: 12,
  },
  founderCounterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#E8B94A',
    borderRadius: 14,
    paddingVertical: 4,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(232, 185, 74, 0.08)',
  },
  founderCounter: {
    color: '#E8B94A',
    fontSize: 14,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
  },
  subtitleBold: {
    color: colors.text,
    fontWeight: '700',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 8,
    paddingBottom: 20,
  },
  planSection: {
    marginBottom: 18,
  },
  planSectionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  planSectionBlurb: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
    marginBottom: 10,
  },
  planRowScroll: {
    marginHorizontal: -20,
  },
  planRowContent: {
    paddingHorizontal: 20,
    gap: 10,
  },
  packageCard: {
    width: 160,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
  },
  packageCardSelected: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(101, 67, 246, 0.08)',
  },
  packageCardDisabled: {
    opacity: 0.55,
  },
  packageBadgeRow: {
    marginBottom: 4,
  },
  packageBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceLight,
    borderRadius: 6,
    paddingVertical: 2,
    paddingHorizontal: 7,
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
  packageTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  packagePriceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 2,
    marginBottom: 8,
  },
  packagePrice: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: 'bold',
  },
  packagePeriod: {
    color: colors.textMuted,
    fontSize: 12,
    marginLeft: 3,
  },
  packageCtaBox: {
    marginTop: 'auto',
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
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
    paddingTop: 4,
    paddingBottom: 10,
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 6,
    marginTop: 2,
    marginBottom: 4,
  },
  skipButtonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  disclosureText: {
    color: colors.textMuted,
    fontSize: 10,
    textAlign: 'center',
    lineHeight: 14,
    marginTop: 4,
  },
  legalRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 6,
    gap: 16,
  },
  legalLink: {
    color: colors.primary,
    fontSize: 12,
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
