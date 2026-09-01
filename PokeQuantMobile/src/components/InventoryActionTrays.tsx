import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../constants/colors';
import { AddAssetForm } from './AddAssetForm';
import { useInventory } from '../context/InventoryContext';
import { useTour } from '../context/TourContext';

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
  const { tourAddAssetOpen } = useTour();

  const [addExpanded, setAddExpanded] = useState(false);
  const [bulkExpanded, setBulkExpanded] = useState(false);

  // The onboarding tour can expand the Add Asset tray to demonstrate intake.
  useEffect(() => {
    setAddExpanded(tourAddAssetOpen);
  }, [tourAddAssetOpen]);

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
        <AddAssetForm
          onComplete={() => setAddExpanded(false)}
          onCancel={() => setAddExpanded(false)}
        />
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
