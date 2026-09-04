import { useEffect, useState } from 'react';
import {
  Image,
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
import { useInventoryStore } from '../store/inventoryStore';
import type { InventoryCard } from '../store/inventoryStore';

const PRIMARY_TEXT = '#c9d1d9';
const PLACEHOLDER_TEXT = colors.text;

function normalizeCurrencyInput(text: string): string {
  return text.replace(/[^0-9.]/g, '').replace(/(\..*?)\./g, '$1');
}

function parsePositiveNumber(text: string): number | null {
  const v = Number.parseFloat(text);
  if (Number.isNaN(v) || v < 0) return null;
  return v;
}

type EditAssetModalProps = {
  visible: boolean;
  card: InventoryCard | null;
  onClose: () => void;
};

export function EditAssetModal({
  visible,
  card,
  onClose,
}: EditAssetModalProps) {
  const updateInventoryCard = useInventoryStore(
    (state) => state.updateInventoryCard
  );

  const [cardName, setCardName] = useState('');
  const [setName, setSetName] = useState('');
  const [condition, setCondition] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [stickerPrice, setStickerPrice] = useState('');

  // Sync local form state whenever the card being edited changes.
  useEffect(() => {
    if (!card) return;
    setCardName(card.name);
    setSetName(card.set ?? '');
    setCondition(card.condition ?? '');
    setPurchasePrice(String(card.amountPaid));
    setStickerPrice(String(card.stickerPrice));
  }, [card]);

  const handleSave = () => {
    if (!card) return;
    const price = parsePositiveNumber(purchasePrice);
    const sticker = parsePositiveNumber(stickerPrice);
    if (!cardName.trim() || price === null || sticker === null) return;

    updateInventoryCard({
      id: card.id,
      name: cardName.trim(),
      set: setName.trim() || undefined,
      condition: condition.trim() || undefined,
      amountPaid: price,
      stickerPrice: sticker,
    });

    onClose();
  };

  const imageSource = card?.imageUrl
    ? { uri: card.imageUrl }
    : require('../../logo.png');

  return (
    <Modal
      animationType="slide"
      transparent
      visible={visible}
      onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}>
        <ScrollView
          style={styles.sheet}
          contentContainerStyle={styles.content}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          alwaysBounceVertical>
          {/* 1. Image Wrapper (Hardcoded Height) */}
          <View style={styles.imageWrapper}>
            <Image
              source={imageSource}
              style={styles.cardImage}
              resizeMode="contain"
            />
          </View>

          {/* 2. Form Wrapper (width: '100%') containing TextInputs */}
          <View style={styles.formWrapper}>
            <View style={styles.field}>
              <Text style={styles.label}>Card Name</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Eevee VMAX"
                placeholderTextColor={PLACEHOLDER_TEXT}
                value={cardName}
                onChangeText={setCardName}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Set Name / Number</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. cn 114"
                placeholderTextColor={PLACEHOLDER_TEXT}
                value={setName}
                onChangeText={setSetName}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Condition</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. NM"
                placeholderTextColor={PLACEHOLDER_TEXT}
                value={condition}
                onChangeText={setCondition}
              />
            </View>

            <View style={styles.row}>
              <View style={[styles.field, { flex: 1, marginRight: 8 }]}>
                <Text style={styles.label}>Purchase Price ($)</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={PLACEHOLDER_TEXT}
                  value={purchasePrice}
                  onChangeText={(text) =>
                    setPurchasePrice(normalizeCurrencyInput(text))
                  }
                />
              </View>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={styles.label}>Proj. Sticker Price ($)</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={PLACEHOLDER_TEXT}
                  value={stickerPrice}
                  onChangeText={(text) =>
                    setStickerPrice(normalizeCurrencyInput(text))
                  }
                />
              </View>
            </View>
          </View>

          {/* 3. Action Buttons Row */}
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={styles.cancelButton}
              activeOpacity={0.8}
              onPress={onClose}>
              <Text style={styles.buttonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.saveButton}
              activeOpacity={0.8}
              onPress={handleSave}>
              <Text style={styles.buttonText}>Save Changes</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  sheet: {
    flex: 1,
    maxHeight: '90%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  content: {
    flexGrow: 1,
    padding: 16,
    paddingBottom: 28,
  },
  imageWrapper: {
    height: 160,
    width: '100%',
    alignItems: 'center',
    marginBottom: 20,
  },
  cardImage: {
    width: 100,
    height: 140,
  },
  formWrapper: {
    width: '100%',
  },
  field: {
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
  },
  label: {
    color: PRIMARY_TEXT,
    fontSize: 12,
    marginBottom: 4,
  },
  input: {
    backgroundColor: colors.surfaceLight,
    color: PRIMARY_TEXT,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveButton: {
    flex: 1,
    backgroundColor: colors.success,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: PRIMARY_TEXT,
    fontSize: 14,
    fontWeight: '600',
  },
});
