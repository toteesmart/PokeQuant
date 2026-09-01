import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
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
  const { getCashOffer } = useVendorSettings();
  const [rawPrice, setRawPrice] = useState('');

  const marketPrice = Number.parseFloat(rawPrice);
  const isValid = !Number.isNaN(marketPrice) && marketPrice > 0;

  const primaryOffer = isValid ? getCashOffer(marketPrice) : 0;

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
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}>
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.title}>Quick Cash Offer</Text>
          </View>

          <Text style={styles.body}>
            Enter a raw market price to instantly calculate the primary vendor
            cash offer.
          </Text>

          <View style={styles.inputWrapper}>
            <Text style={styles.inputLabel}>Enter Raw Market Price</Text>
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
            <Text style={styles.primaryOfferLabel}>Primary Cash Offer</Text>
            <Text style={styles.primaryOfferValue}>
              {formatCurrency(primaryOffer)}
            </Text>
            <Text style={styles.primaryOfferHint}>
              {isValid
                ? 'Based on the matching buy tier.'
                : 'Enter a raw market price to calculate.'}
            </Text>
          </View>

          <TouchableOpacity
            style={styles.doneButton}
            activeOpacity={0.8}
            onPress={handleClose}>
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
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
    maxHeight: '85%',
    width: '100%',
  },
  contentContainer: {
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
  doneButton: {
    backgroundColor: '#58a6ff',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  doneButtonText: {
    color: colors.background,
    fontSize: 16,
    fontWeight: 'bold',
  },
});
