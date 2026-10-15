import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';
import { CircleButton } from './ui/CircleButton';
import { VENDOR_ENTITLEMENT_ID } from '../constants/revenuecat';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { useShowVendorStore } from '../store/showVendorStore';
import type { PurchasesPackage } from 'react-native-purchases';
import {
  PLAN_SECTIONS,
  billingPeriod,
  buildDisplayPackages,
  isActivePackage,
  isPackageDisabled,
  type DisplayPackage,
} from './pricing/planData';
import { PackageCard } from './pricing/PackageCard';
import { TeamInviteSection } from './pricing/TeamInviteSection';
import { PricingFooter } from './pricing/PricingFooter';

type PricingPreviewProps = {
  allowSkip?: boolean;
  onClose?: () => void;
  onSkip?: () => void;
  onComplete?: () => void;
};

export function PricingPreview({
  allowSkip = false,
  onClose,
  onSkip,
  onComplete,
}: PricingPreviewProps) {
  const insets = useSafeAreaInsets();
  const isLoading = useSubscriptionStore(
    (s) => s.isLoadingCustomerInfo || s.isLoadingOfferings
  );
  const offerings = useSubscriptionStore((s) => s.offerings);
  const customerInfo = useSubscriptionStore((s) => s.customerInfo);
  const purchasePackage = useSubscriptionStore((s) => s.purchasePackage);
  const lastPurchaseError = useSubscriptionStore((s) => s.lastPurchaseError);
  const profile = useShowVendorStore((s) => s.profile);
  const isFounder = profile?.isFounder ?? false;
  const paymentsLive = profile?.paymentsLive ?? false;
  const founderSeatNumber = profile?.founderSeatNumber;
  const founderSeatsRemaining = profile?.founderSeatsRemaining ?? 0;
  const hasVendor = useSubscriptionStore((s) => s.hasVendorEntitlement());
  const isVendor = hasVendor || profile?.isVendor || profile?.isTeamMember;
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

  // Frozen once per mount — expiry checks must not read the clock
  // mid-render (react-hooks/purity).
  const [nowSec] = useState(() => Math.floor(Date.now() / 1000));
  const team = profile?.team;
  const isActiveTeamOwner = useMemo(() => {
    if (!team?.is_owner) return false;
    const expiresAt = team.expires_at;
    if (expiresAt == null) return true;
    return nowSec < Number(expiresAt);
  }, [team, nowSec]);

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

  const { items: displayPackages, hasLiveData } = useMemo(
    () => buildDisplayPackages(offerings),
    [offerings]
  );

  const eligibility = useMemo(
    () => ({
      activeProductId,
      isFounder,
      founderSeatNumber,
      founderSeatsRemaining,
      isActiveTeamOwner,
      isVendor,
    }),
    [
      activeProductId,
      isFounder,
      founderSeatNumber,
      founderSeatsRemaining,
      isActiveTeamOwner,
      isVendor,
    ]
  );

  return (
    <View style={styles.container}>
      {onClose && (
        <View style={[styles.closeButton, { top: insets.top + 12 }]}>
          <CircleButton
            icon="close"
            onPress={onClose}
            accessibilityLabel="Close plans"
          />
        </View>
      )}
      <View style={[styles.header, { paddingTop: insets.top + 40 }]}>
        {isFounder || founderSeatNumber != null ? (
          <View style={styles.founderCounterPill}>
            <Ionicons name="star" size={13} color={colors.accentGold}/>
            <Text style={styles.founderCounter}>
              Founder #{founderSeatNumber ?? '—'}/50
            </Text>
          </View>
        ) : founderSeatsRemaining > 0 ? (
          <View style={styles.founderCounterPill}>
            <Ionicons name="star-outline" size={13} color={colors.accentGold}/>
            <Text style={styles.founderCounter}>
              {founderSeatsRemaining}/50 Founder spots left
            </Text>
          </View>
        ) : null}
        <Text style={styles.title}>Card Cache Plans</Text>
        <Text style={styles.subtitle}>
          {isFounder ? (
            'Your Founder spot locks in 50% off when payments go live.'
          ) : paymentsLive ? (
            'Unlimited scans for collectors. Selling tools for dealers.'
          ) : (
            <>
              {'Unlimited scans for collectors. Selling tools for dealers — '}
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
                  const disabled = isPackageDisabled(item, eligibility);
                  const isActive = isActivePackage(item, activeProductId);

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
            style={styles.skipButton}
            hitSlop={8}
            accessibilityRole="button">
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
          <TeamInviteSection onComplete={onComplete} onClose={onClose} />
        )}
      </ScrollView>

      <PricingFooter />
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
    right: 16,
    zIndex: 1,
  },
  header: {
    alignItems: 'center',
    paddingBottom: 5,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
    marginTop: 12,
  },
  founderCounterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.accentGold,
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 12,
    backgroundColor: colors.accentGoldTint,
  },
  founderCounter: {
    color: colors.accentGold,
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
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
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
});
