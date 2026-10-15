// Reactive vendor-feature gating — the component-side counterpart to the
// store's imperative canUseVendorFeatures() action. Both subscriptions are
// reactive (unlike the action's one-shot getState() read), so UI updates
// the moment an entitlement arrives.

import { useShowVendorStore } from '../store/showVendorStore';
import { useSubscriptionStore } from '../store/subscriptionStore';

export function useVendorFeatures() {
  const profile = useShowVendorStore((state) => state.profile);
  const hasVendorEntitlement = useSubscriptionStore((state) =>
    state.hasVendorEntitlement()
  );

  const paymentsLive = profile?.paymentsLive ?? false;
  const canUseVendorFeatures =
    !paymentsLive ||
    !!profile?.isVendor ||
    !!profile?.isTeamMember ||
    hasVendorEntitlement;

  return { paymentsLive, canUseVendorFeatures };
}
