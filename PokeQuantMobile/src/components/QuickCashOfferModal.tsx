import { useMemo, useState } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors } from '../constants/colors';
import { useVendorSettings } from '../context/VendorSettingsContext';

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function normalizeCurrencyInput(text: string): string {
  return text
    .replace(/[^0-9.]/g, '')
    .replace(/(\..*?)\./g, '$1');
}

type QuickCashOfferModalProps = {
  visible: boolean;
  onClose: () => void;
};

export function QuickCashOfferModal({
  visible,
  onClose,
}: QuickCashOfferModalProps) {
  const { tiers, getCashOffer } = useVendorSettings();
  const [rawPrice, setRawPrice] = useState('');

  const marketPrice = Number.parseFloat(rawPrice);
  const isValid = !Number.isNaN(marketPrice) && marketPrice > 0;

  const primaryOffer = isValid ? getCashOffer(marketPrice) : 0;

  const sortedTiers = useMemo(
    () => [...tiers].sort((a, b) => a.minDollar - b.minDollar),
    [tiers]
  );

  const tierPayouts = useMemo(() => {
    if (!isValid) return [];
    return sortedTiers.map((tier) => ({
      ...tier,
      payout: Number((marketPrice * (tier.marginPercent / 100)).toFixed(2)),
      matches:
        marketPrice >= tier.minDollar && marketPrice <= tier.maxDollar,
    }));
  }, [sortedTiers, marketPrice, isValid]);

  const handleClose = () => {
    setRawPrice('');
    onClose();
  };

  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Quick Cash Offer</Text>
            <TouchableOpacity
              style={styles.closeButton}
              activeOpacity={0.7}
              onPress={handleClose}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.body}>
            Enter a raw market price to instantly calculate vendor cash offers
            across your buy tiers.
          </Text>

          <View style={styles.inputWrapper}>
            <Text style={styles.inputLabel}>Enter Raw Market Price</Text>
            <TextInput
              style={styles.input}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.textMuted}
              value={rawPrice}
              onChangeText={(text) => setRawPrice(normalizeCurrencyInput(text))}
              autoFocus
            />
          </View>

          {isValid && (
            <>
              <View style={styles.primaryOfferBox}>
                <Text style={styles.primaryOfferLabel}>Primary Cash Offer</Text>
                <Text style={styles.primaryOfferValue}>
                  {formatCurrency(primaryOffer)}
                </Text>
                <Text style={styles.primaryOfferHint}>
                  Based on the matching buy tier.
                </Text>
              </View>

              <View style={styles.tiersHeader}>
                <Text style={styles.tiersTitle}>Payouts by Tier</Text>
              </View>

              {tierPayouts.map((tier, index) => (
                <View
                  key={index}
                  style={[
                    styles.tierRow,
                    tier.matches && styles.tierRowHighlighted,
                  ]}>
                  <View style={styles.tierInfo}>
                    <Text style={styles.tierRange}>
                      ${tier.minDollar} - ${tier.maxDollar}
                    </Text>
                    <Text style={styles.tierPercent}>
                      {tier.marginPercent}% margin
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.tierPayout,
                      tier.matches && styles.tierPayoutHighlighted,
                    ]}>
                    {formatCurrency(tier.payout)}
                  </Text>
                </View>
              ))}
            </>
          )}

          <TouchableOpacity
            style={styles.doneButton}
            activeOpacity={0.8}
            onPress={handleClose}>
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    padding: 20,
  },
  content: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: 18,
    fontWeight: 'bold',
  },
  closeButton: {
    padding: 6,
  },
  closeText: {
    color: colors.textMuted,
    fontSize: 18,
    fontWeight: 'bold',
  },
  body: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  inputWrapper: {
    marginBottom: 16,
  },
  inputLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.surfaceLight,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  primaryOfferBox: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary,
    padding: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  primaryOfferLabel: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 4,
  },
  primaryOfferValue: {
    color: colors.text,
    fontSize: 32,
    fontWeight: 'bold',
  },
  primaryOfferHint: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 4,
  },
  tiersHeader: {
    marginBottom: 8,
  },
  tiersTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  tierRowHighlighted: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(59, 130, 246, 0.08)',
  },
  tierInfo: {
    flex: 1,
  },
  tierRange: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  tierPercent: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  tierPayout: {
    color: colors.text,
    fontSize: 15,
    fontWeight: 'bold',
  },
  tierPayoutHighlighted: {
    color: colors.primary,
  },
  doneButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  doneButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
});
