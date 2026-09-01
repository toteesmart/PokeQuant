import { useEffect, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors } from '../constants/colors';
import { Dropdown } from './Dropdown';
import { useInventory } from '../context/InventoryContext';
import type { InventoryCard } from '../context/InventoryContext';

const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'Other'];
const PRIMARY_TEXT = '#c9d1d9';

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
  const { updateInventoryCard } = useInventory();

  const [cardName, setCardName] = useState('');
  const [setName, setSetName] = useState('');
  const [condition, setCondition] = useState('NM');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [stickerPrice, setStickerPrice] = useState('');
  const [isBulk, setIsBulk] = useState(false);

  // Sync local form state whenever the card being edited changes.
  useEffect(() => {
    if (!card) return;
    setCardName(card.name);
    setSetName(card.set ?? '');
    setCondition(card.condition ?? 'NM');
    setPurchasePrice(card.amountPaid.toFixed(2));
    setStickerPrice(card.stickerPrice.toFixed(2));
    setIsBulk(card.isBulk ?? false);
  }, [card]);

  if (!card) return null;

  const imageSource = card.imageUrl
    ? { uri: card.imageUrl }
    : require('../../logo.png');

  const handleSave = () => {
    const price = parsePositiveNumber(purchasePrice);
    const sticker = parsePositiveNumber(stickerPrice);
    if (!cardName.trim() || price === null || sticker === null) return;

    updateInventoryCard({
      id: card.id,
      name: cardName.trim(),
      set: setName.trim() || undefined,
      condition,
      amountPaid: price,
      stickerPrice: sticker,
      isBulkDeal: isBulk,
      imageUrl: card.imageUrl,
    });

    onClose();
  };

  const canSubmit =
    cardName.trim() !== '' &&
    parsePositiveNumber(purchasePrice) !== null &&
    parsePositiveNumber(stickerPrice) !== null;

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
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          alwaysBounceVertical>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Edit Asset</Text>
            <TouchableOpacity
              style={styles.closeButton}
              activeOpacity={0.7}
              onPress={onClose}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.imageWrapper}>
            <Image
              source={imageSource}
              style={styles.cardImage}
              resizeMode="contain"
            />
          </View>

          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={styles.label}>Card Name</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Eevee VMAX"
                placeholderTextColor={colors.textMuted}
                value={cardName}
                onChangeText={setCardName}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Set Name / Number</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. cn 114"
                placeholderTextColor={colors.textMuted}
                value={setName}
                onChangeText={setSetName}
              />
            </View>

            <View style={styles.field}>
              <Dropdown
                label="Condition"
                options={CONDITIONS}
                value={condition}
                onChange={setCondition}
              />
            </View>

            <View style={styles.row}>
              <View style={[styles.field, { flex: 1, marginRight: 8 }]}>
                <Text style={styles.label}>Purchase Price ($)</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={colors.textMuted}
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
                  placeholderTextColor={colors.textMuted}
                  value={stickerPrice}
                  onChangeText={(text) =>
                    setStickerPrice(normalizeCurrencyInput(text))
                  }
                />
              </View>
            </View>

            <View style={styles.bulkRow}>
              <Text style={styles.label}>Bulk Deal</Text>
              <Switch
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={isBulk ? colors.text : colors.textMuted}
                value={isBulk}
                onValueChange={setIsBulk}
              />
            </View>

            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={styles.cancelButton}
                activeOpacity={0.8}
                onPress={onClose}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveButton, !canSubmit && styles.saveButtonDisabled]}
                activeOpacity={canSubmit ? 0.8 : 1}
                onPress={handleSave}
                disabled={!canSubmit}>
                <Text style={styles.saveButtonText}>Save Changes</Text>
              </TouchableOpacity>
            </View>
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
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    maxHeight: '90%',
  },
  content: {
    flexGrow: 1,
    padding: 16,
    paddingBottom: 28,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    flex: 1,
    color: PRIMARY_TEXT,
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
  imageWrapper: {
    alignItems: 'center',
    marginBottom: 12,
  },
  cardImage: {
    width: '100%',
    aspectRatio: 2.5 / 3.5,
    maxHeight: 150,
  },
  form: {
    paddingTop: 8,
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
  bulkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
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
  cancelButtonText: {
    color: PRIMARY_TEXT,
    fontSize: 14,
    fontWeight: '600',
  },
  saveButton: {
    flex: 1,
    backgroundColor: colors.success,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    backgroundColor: 'rgba(34, 197, 94, 0.35)',
  },
  saveButtonText: {
    color: PRIMARY_TEXT,
    fontSize: 14,
    fontWeight: 'bold',
  },
});
