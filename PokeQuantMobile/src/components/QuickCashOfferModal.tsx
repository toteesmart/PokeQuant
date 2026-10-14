import { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors } from '../constants/colors';
import { useVendorStore } from '../store/vendorStore';
import { formatCurrency } from '../utils/format';
import { AppButton, GlassSheet } from './ui';

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
  const getCashOffer = useVendorStore((state) => state.getCashOffer);
  const [rawPrice, setRawPrice] = useState('');

  const marketPrice = Number.parseFloat(rawPrice);
  const isValid = !Number.isNaN(marketPrice) && marketPrice > 0;

  const primaryOffer = isValid ? getCashOffer(marketPrice) : 0;

  const handleClose = () => {
    setRawPrice('');
    onClose();
  };

  if (!visible) return null;

  return (
    <GlassSheet
      title="Quick offer"
      onClose={handleClose}
      keyboardAware
      scrollProps={{
        keyboardDismissMode: 'interactive',
        keyboardShouldPersistTaps: 'handled',
      }}
      footer={<AppButton title="Done" onPress={handleClose} />}>
      <>
        <Text style={styles.body}>
          Enter a card's market price to see your buy offer on it instantly.
        </Text>

        <View style={styles.inputWrapper}>
          <Text style={styles.inputLabel}>Market price</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={colors.textMuted}
            value={rawPrice}
            onChangeText={(text) =>
              setRawPrice(normalizeCurrencyInput(text))
            }
            autoFocus
          />
        </View>

        <View style={styles.primaryOfferBox}>
          <Text style={styles.primaryOfferLabel}>You offer</Text>
          <Text style={styles.primaryOfferValue}>
            {formatCurrency(primaryOffer)}
          </Text>
          <Text style={styles.primaryOfferHint}>
            {isValid
              ? 'Based on the matching buy tier.'
              : 'Enter a market price to calculate.'}
          </Text>
        </View>
      </>
    </GlassSheet>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: colors.overlay3,
    color: colors.text,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  primaryOfferBox: {
    backgroundColor: colors.primaryStrong,
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
    fontSize: 24,
    fontWeight: '700',
  },
  primaryOfferHint: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 4,
  },
});
