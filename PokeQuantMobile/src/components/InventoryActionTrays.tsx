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
import { useInventory } from '../context/InventoryContext';
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

type ActionTrayProps = {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
};

function ActionTray({ title, expanded, onToggle, children }: ActionTrayProps) {
  return (
    <View style={trayStyles.tray}>
      <TouchableOpacity
        style={trayStyles.header}
        activeOpacity={0.7}
        onPress={onToggle}>
        <Text style={trayStyles.arrow}>{expanded ? '▼' : '▶'}</Text>
        <Text style={trayStyles.title}>{title}</Text>
      </TouchableOpacity>
      {expanded && <View style={trayStyles.body}>{children}</View>}
    </View>
  );
}

export function InventoryActionTrays() {
  const { addInventoryCard } = useInventory();
  const { getStickerPrice } = useVendorSettings();

  const [addExpanded, setAddExpanded] = useState(false);
  const [bulkExpanded, setBulkExpanded] = useState(false);

  const [cardName, setCardName] = useState('');
  const [setName, setSetName] = useState('');
  const [condition, setCondition] = useState('NM');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [stickerPrice, setStickerPrice] = useState('');
  const [isBulk, setIsBulk] = useState(false);

  const projectedSticker = Number.parseFloat(stickerPrice);
  const finalSticker = !Number.isNaN(projectedSticker)
    ? getStickerPrice(projectedSticker)
    : null;

  const handleAdd = () => {
    const price = parsePositiveNumber(purchasePrice);
    const sticker = parsePositiveNumber(stickerPrice);
    if (!cardName.trim() || price === null || sticker === null) return;

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
    setAddExpanded(false);
  };

  const handleBulkImport = () => {
    const rows = [
      { name: 'Charmander OB 023', set: 'OB 023', condition: 'NM', cost: 1.5, sticker: 3.0 },
      { name: 'Squirtle CN 007', set: 'CN 007', condition: 'LP', cost: 1.2, sticker: 2.5 },
      { name: 'Bulbasaur PA 001', set: 'PA 001', condition: 'NM', cost: 2.0, sticker: 4.0 },
    ];
    rows.forEach((row) =>
      addInventoryCard({
        name: row.name,
        set: row.set,
        condition: row.condition,
        liveMarket: row.sticker,
        amountPaid: row.cost,
        stickerPrice: row.sticker,
        isBulkDeal: false,
      })
    );
    setBulkExpanded(false);
  };

  return (
    <View style={styles.container}>
      <ActionTray
        title="Add Asset (Manual Entry)"
        expanded={addExpanded}
        onToggle={() => setAddExpanded((v) => !v)}>
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

          {finalSticker !== null && stickerPrice !== '' && (
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

          <TouchableOpacity
            style={styles.addButton}
            activeOpacity={0.8}
            onPress={handleAdd}>
            <Text style={styles.addButtonText}>Add to Inventory</Text>
          </TouchableOpacity>
        </View>
      </ActionTray>

      <ActionTray
        title="Bulk Import (Excel Wizard)"
        expanded={bulkExpanded}
        onToggle={() => setBulkExpanded((v) => !v)}>
        <View style={styles.dropzone}>
          <Text style={styles.uploadIcon}>⇪</Text>
          <TouchableOpacity
            style={styles.selectButton}
            activeOpacity={0.8}
            onPress={handleBulkImport}>
            <Text style={styles.selectButtonText}>
              Select Spreadsheet (.xlsx / .csv)
            </Text>
          </TouchableOpacity>
          <Text style={styles.helper}>
            Map columns: Card Name, Set, Condition, Cost Basis, Sticker Price
          </Text>
        </View>
      </ActionTray>
    </View>
  );
}

const trayStyles = StyleSheet.create({
  tray: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  arrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: 'bold',
    marginRight: 10,
  },
  title: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  body: {
    padding: 14,
    paddingTop: 0,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});

const styles = StyleSheet.create({
  container: {
    marginBottom: 4,
  },
  form: {
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
  addButton: {
    backgroundColor: colors.success,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  addButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: 'bold',
  },
  dropzone: {
    paddingTop: 12,
    paddingBottom: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: 12,
    padding: 20,
    marginTop: 4,
  },
  uploadIcon: {
    color: colors.textMuted,
    fontSize: 32,
    marginBottom: 12,
  },
  selectButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  selectButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  helper: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
  },
});
