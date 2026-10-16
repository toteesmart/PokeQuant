// "Have a team invite code?" box in the paywall. Self-contained: owns the
// expand toggle, code draft, and redeem request — resolves through
// onComplete (or onClose) after a successful redemption.

import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors } from '../../constants/colors';
import { useShowVendorStore } from '../../store/showVendorStore';
import { toErrorMessage } from '../../utils/log';

type Props = {
  onComplete?: () => void;
  onClose?: () => void;
};

export function TeamInviteSection({ onComplete, onClose }: Props) {
  const [showInvite, setShowInvite] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [isRedeeming, setIsRedeeming] = useState(false);
  const redeemCode = useShowVendorStore((s) => s.redeemCode);
  const loadVendorProfile = useShowVendorStore((s) => s.loadVendorProfile);

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
      Alert.alert("Couldn't redeem that code", toErrorMessage(err));
    } finally {
      setIsRedeeming(false);
    }
  }, [inviteCode, redeemCode, loadVendorProfile, onComplete, onClose]);

  return (
    <View style={styles.teamInviteBox}>
      {!showInvite ? (
        <TouchableOpacity
          activeOpacity={0.8}
          hitSlop={8}
          onPress={() => setShowInvite(true)}
          accessibilityRole="button"
        >
          <Text style={styles.teamInviteText}>Have a team invite code?</Text>
        </TouchableOpacity>
      ) : (
        <>
          <Text style={styles.teamInviteLabel}>Enter your 6-digit team invite code</Text>
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
                (!inviteCode.trim() || isRedeeming) && styles.teamInviteButtonDisabled,
              ]}
              activeOpacity={0.8}
              onPress={handleRedeem}
              disabled={!inviteCode.trim() || isRedeeming}
              accessibilityRole="button"
              accessibilityLabel="Use invite code"
            >
              {isRedeeming ? (
                <ActivityIndicator color={colors.text} size="small" />
              ) : (
                <Text style={styles.teamInviteButtonText}>Use code</Text>
              )}
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.teamInviteCancel}
            activeOpacity={0.7}
            hitSlop={8}
            onPress={() => {
              setShowInvite(false);
              setInviteCode('');
            }}
            accessibilityRole="button"
          >
            <Text style={styles.teamInviteCancelText}>Back to plans</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  teamInviteBox: {
    backgroundColor: colors.overlay2,
    borderRadius: 12,
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
    backgroundColor: colors.overlay3,
    color: colors.text,
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
