import { useState } from 'react';
import {
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors } from '../constants/colors';
import { Dropdown } from './Dropdown';
import { useInventory, type InventoryCard } from '../context/InventoryContext';
import { useVendorSettings } from '../context/VendorSettingsContext';

const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'Other'];

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function normalizeCurrencyInput(text: string): string {
  return text
    .replace(/[^0-9.]/g, '')
    .replace(/(\..*?)\./g, '$1');
}

function parsePositiveNumber(text: string): number | null {
  const v = Number.parseFloat(text);
  if (Number.isNaN(v) || v < 0) return null;
  return v;
}

type AddAssetFormProps = {
  initialCard?: InventoryCard;
  onComplete?: () => void;
  onCancel?: () => void;
};

export function AddAssetForm({
  initialCard,
  onComplete,
  onCancel,
}: AddAssetFormProps) {
  const { addInventoryCard, updateInventoryCard } = useInventory();
  const { getStickerPrice } = useVendorSettings();
  const isEdit = initialCard != null;

  const [cardName, setCardName] = useState(initialCard?.name ?? '');
  const [setName, setSetName] = useState(initialCard?.set ?? '');
  const [condition, setCondition] = useState(initialCard?.condition ?? 'NM');
  const [purchasePrice, setPurchasePrice] = useState(
    initialCard ? String(initialCard.amountPaid) : ''
  );
  const [stickerPrice, setStickerPrice] = useState(
    initialCard ? String(initialCard.stickerPrice) : ''
  );
  const [isBulk, setIsBulk] = useState(initialCard?.isBulk ?? false);

  const projectedSticker = Number.parseFloat(stickerPrice);
  const finalSticker =
    !Number.isNaN(projectedSticker) && stickerPrice !== ''
      ? getStickerPrice(projectedSticker)
      : null;

  const handleSave = () => {
    const price = parsePositiveNumber(purchasePrice);
    const sticker = parsePositiveNumber(stickerPrice);
    if (!cardName.trim() || price === null || sticker === null) return;

    if (isEdit && initialCard) {
      updateInventoryCard({
        id: initialCard.id,
        name: cardName.trim(),
        set: setName.trim() || undefined,
        condition,
        amountPaid: price,
        stickerPrice: sticker,
        isBulkDeal: isBulk,
        imageUrl: initialCard.imageUrl,
      });
    } else {
      addInventoryCard({
        name: cardName.trim(),
        set: setName.trim() || undefined,
        condition,
        liveMarket: sticker,
        amountPaid: price,
        stickerPrice: sticker,
        isBulkDeal: isBulk,
      });

      setCardName('');
      setSetName('');
      setCondition('NM');
      setPurchasePrice('');
      setStickerPrice('');
      setIsBulk(false);
    }

    onComplete?.();
  };

  const canSubmit =
    cardName.trim() !== '' &&
    parsePositiveNumber(purchasePrice) !== null &&
    parsePositiveNumber(stickerPrice) !== null;

  return (
    <View style={styles.container}>
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

      {finalSticker !== null && stickerPrice !== '' && !isEdit && (
        <Text style={styles.preview}>
          Final sticker: {formatCurrency(finalSticker)}
        </Text>
      )}

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
        {onCancel && (
          <TouchableOpacity
            style={styles.cancelButton}
            activeOpacity={0.8}
            onPress={onCancel}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.addButton, !canSubmit && styles.addButtonDisabled]}
          activeOpacity={canSubmit ? 0.8 : 1}
          onPress={handleSave}
          disabled={!canSubmit}>
          <Text style={styles.addButtonText}>
            {isEdit ? 'Save Changes' : 'Add to Inventory'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 12,
  },
  field: {
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
  },
  label: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 4,
  },
  input: {
    backgroundColor: colors.surfaceLight,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  preview: {
    color: colors.primary,
    fontSize: 13,
    marginBottom: 12,
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
  addButton: {
    flex: 1,
    backgroundColor: colors.success,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  addButtonDisabled: {
    backgroundColor: 'rgba(34, 197, 94, 0.35)',
  },
  addButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: 'bold',
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
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
});
