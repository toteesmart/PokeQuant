import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '../constants/colors';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { PricingPreview } from './PricingPreview';

export function SubscriptionGate({ children }: { children: React.ReactNode }) {
  const isConfigured = useSubscriptionStore((s) => s.isConfigured);
  const hasSeenPricingPreview = useSubscriptionStore((s) => s.hasSeenPricingPreview);
  const markPricingPreviewSeen = useSubscriptionStore((s) => s.markPricingPreviewSeen);

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

  const showPreview = !hasSeenPricingPreview && !hasSkippedThisSession;

  return (
    <View style={styles.container}>
      {children}
      {showPreview ? (
        <View style={styles.overlay}>
          <PricingPreview
            allowSkip
            onSkip={handleSkip}
            onComplete={handleComplete}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
