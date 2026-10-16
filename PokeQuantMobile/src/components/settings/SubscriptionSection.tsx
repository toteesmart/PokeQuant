// Your plan — founder/pro status line, founder-seat notice, cancel
// warning, manage-plan + restore buttons. Owns the paywall modal so
// the screen never sees it.
import { useState } from 'react';
import { Alert, Modal, Text, TouchableOpacity, View } from 'react-native';
import { CollapsibleSection } from '../CollapsibleSection';
import { PricingPreview } from '../PricingPreview';
import { useShowVendorStore } from '../../store/showVendorStore';
import { useSubscriptionStore } from '../../store/subscriptionStore';
import { toErrorMessage } from '../../utils/log';
import { styles } from './settingsStyles';

type Props = {
  expanded: boolean;
  onToggle: () => void;
};

export function SubscriptionSection({ expanded, onToggle }: Props) {
  const [showPaywall, setShowPaywall] = useState(false);

  const profile = useShowVendorStore((state) => state.profile);
  const paymentsLive = profile?.paymentsLive ?? false;
  const isFounder = profile?.isFounder ?? false;
  const founderSeatNumber = profile?.founderSeatNumber;
  const hasFounderSeat = founderSeatNumber != null;
  const founderSeatsRemaining = profile?.founderSeatsRemaining ?? 0;
  const hasVendorEntitlement = useSubscriptionStore((state) => state.hasVendorEntitlement());
  const isVendor = profile?.isVendor || hasVendorEntitlement || profile?.isTeamMember;

  return (
    <>
      <CollapsibleSection title="Your plan" expanded={expanded} onToggle={onToggle} maxHeight={800}>
        <Text style={styles.devSubtitle}>
          {isFounder
            ? `Founder #${founderSeatNumber ?? '—'} · ${founderSeatsRemaining} founder spots left`
            : hasFounderSeat
              ? `Founder #${founderSeatNumber ?? '—'} is held but inactive. Subscribe to a Founder plan to reactivate.`
              : isVendor
                ? 'Card Cache Pro is active.'
                : paymentsLive
                  ? 'Cloud backup and show uploads need a Pro plan.'
                  : 'Pricing preview is enabled. Purchases are not live yet.'}
        </Text>

        {!isFounder && !hasFounderSeat && paymentsLive && (
          <Text style={styles.noticeText}>
            {founderSeatsRemaining > 0
              ? `${founderSeatsRemaining} founder spots left — lock in founder pricing before they're gone.`
              : 'Founder spots are gone. Upgrade to Pro to unlock vendor features.'}
          </Text>
        )}

        {isFounder && isVendor && (
          <Text style={styles.warningText}>
            Your Founder discount is active while subscribed. If you cancel, you will lose it and
            pay full price if you return.
          </Text>
        )}

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.primaryButton, { flex: 1, marginRight: 8 }]}
            activeOpacity={0.7}
            onPress={() => setShowPaywall(true)}
          >
            <Text style={styles.primaryButtonText}>
              {paymentsLive ? 'Manage your plan' : 'View pricing preview'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.secondaryButton, { flex: 1 }]}
            activeOpacity={0.7}
            onPress={() => {
              useSubscriptionStore
                .getState()
                .restorePurchases()
                .catch((err) => {
                  Alert.alert('Restore failed', toErrorMessage(err));
                });
            }}
          >
            <Text style={styles.secondaryButtonText}>Restore purchases</Text>
          </TouchableOpacity>
        </View>
      </CollapsibleSection>

      <Modal
        visible={showPaywall}
        animationType="slide"
        onRequestClose={() => setShowPaywall(false)}
      >
        <PricingPreview
          allowSkip
          onSkip={() => setShowPaywall(false)}
          onClose={() => setShowPaywall(false)}
        />
      </Modal>
    </>
  );
}
