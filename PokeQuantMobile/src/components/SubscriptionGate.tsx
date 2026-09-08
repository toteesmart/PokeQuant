import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { colors } from '../constants/colors';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { useShowVendorStore } from '../store/showVendorStore';
import { PricingPreview } from './PricingPreview';

export function SubscriptionGate({ children }: { children: React.ReactNode }) {
  const profile = useShowVendorStore((s) => s.profile);
  const isLoadingProfile = useShowVendorStore((s) => s.isLoadingProfile);
  const isConfigured = useSubscriptionStore((s) => s.isConfigured);
  const isLoadingCustomerInfo = useSubscriptionStore((s) => s.isLoadingCustomerInfo);
  const isLoadingOfferings = useSubscriptionStore((s) => s.isLoadingOfferings);
  const hasSeenPricingPreview = useSubscriptionStore((s) => s.hasSeenPricingPreview);
  const markPricingPreviewSeen = useSubscriptionStore((s) => s.markPricingPreviewSeen);
  const hasVendor = useSubscriptionStore((s) => s.hasVendorEntitlement());
  const paymentsLive = useShowVendorStore((s) => s.profile?.paymentsLive ?? false);

  // Guard against Zustand-persist rehydration flipping hasSeenPricingPreview back
  // to the previously saved value shortly after the user pressed skip.
  const [hasSkippedThisSession, setHasSkippedThisSession] = useState(false);

  const handleSkip = useCallback(() => {
    markPricingPreviewSeen();
    setHasSkippedThisSession(true);
  }, [markPricingPreviewSeen]);

  const handleComplete = useCallback(() => {
    markPricingPreviewSeen();
    setHasSkippedThisSession(true);
  }, [markPricingPreviewSeen]);

  useEffect(() => {
    // Ensure RevenueCat is configured as soon as the gate mounts.
    if (!isConfigured) {
      useSubscriptionStore.getState().configure();
    }
  }, [isConfigured]);

  const isReady = !isLoadingProfile;

  if (!isReady) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  // First login: show the preview once so users see the plan/founder incentive.
  if (!hasSeenPricingPreview && !hasSkippedThisSession) {
    return (
      <PricingPreview
        purchaseEnabled={paymentsLive}
        allowSkip
        onSkip={handleSkip}
        onComplete={handleComplete}
      />
    );
  }

  // Once payments are live, a non-vendor sees the soft paywall.
  if (paymentsLive && !hasVendor) {
    return (
      <PricingPreview
        purchaseEnabled
        allowSkip
        onSkip={() => {}}
        onComplete={() => {}}
      />
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
