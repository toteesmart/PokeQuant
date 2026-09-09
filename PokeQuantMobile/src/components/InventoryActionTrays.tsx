import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AddAssetForm } from './AddAssetForm';
import { CollapsibleSection } from './CollapsibleSection';

export function InventoryActionTrays() {
  const [addExpanded, setAddExpanded] = useState(false);

  return (
    <View style={styles.container}>
      <CollapsibleSection
        title="Add Asset (Manual Entry)"
        expanded={addExpanded}
        onToggle={() => setAddExpanded((v) => !v)}
        maxHeight={600}>
        <AddAssetForm
          onComplete={() => setAddExpanded(false)}
          onCancel={() => setAddExpanded(false)}
        />
      </CollapsibleSection>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 4,
    zIndex: 1,
  },
});
