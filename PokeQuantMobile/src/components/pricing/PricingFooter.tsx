// Paywall footer: auto-renew disclosure (App Review requirement), legal
// links, and Restore Purchases with its own spinner + alert handling.

import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../constants/colors';
import { PRIVACY_POLICY_URL, TERMS_OF_USE_URL } from '../../constants/legal';
import { useSubscriptionStore } from '../../store/subscriptionStore';
import { useShowVendorStore } from '../../store/showVendorStore';
import { toErrorMessage } from '../../utils/log';

export function PricingFooter() {
  const insets = useSafeAreaInsets();
  const [isRestoring, setIsRestoring] = useState(false);
  const restorePurchases = useSubscriptionStore((s) => s.restorePurchases);
  const loadVendorProfile = useShowVendorStore((s) => s.loadVendorProfile);

  const onRestore = useCallback(async () => {
    setIsRestoring(true);
    try {
      await restorePurchases();
      await loadVendorProfile();
      Alert.alert('Purchases restored', 'Your subscription status is up to date.');
    } catch (err) {
      Alert.alert('Restore failed', toErrorMessage(err));
    } finally {
      setIsRestoring(false);
    }
  }, [restorePurchases, loadVendorProfile]);

  return (
    <View style={[styles.footer, { paddingBottom: insets.bottom + 10 }]}>
      <Text style={styles.disclosureText}>
        Subscriptions auto-renew unless canceled at least 24 hours before the
        period ends. Manage or cancel in App Store settings.
      </Text>

      <View style={styles.legalRow}>
        {PRIVACY_POLICY_URL ? (
          <TouchableOpacity
            activeOpacity={0.7}
            hitSlop={8}
            onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
            accessibilityRole="link">
            <Text style={styles.legalLink}>Privacy Policy</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          activeOpacity={0.7}
          hitSlop={8}
          onPress={() => Linking.openURL(TERMS_OF_USE_URL)}
          accessibilityRole="link">
          <Text style={styles.legalLink}>Terms of Use (EULA)</Text>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.7}
          hitSlop={8}
          disabled={isRestoring}
          onPress={onRestore}
          accessibilityRole="button">
          {isRestoring ? (
            <ActivityIndicator color={colors.primary} size="small" />
          ) : (
            <Text style={styles.legalLink}>Restore Purchases</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    paddingTop: 4,
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
});
