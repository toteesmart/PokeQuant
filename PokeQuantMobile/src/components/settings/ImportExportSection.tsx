// Import & export — the CSV/Excel bulk wizard plus the one-tap
// inventory+sales CSV export. The wizard modal lives inside this
// section so the screen never tracks its visibility.
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors } from '../../constants/colors';
import { CollapsibleSection } from '../CollapsibleSection';
import { BulkImportWizard } from '../BulkImportWizard';
import {
  exportInventoryCsv,
  exportSalesCsv,
} from '../../services/ExportService';
import { toErrorMessage } from '../../utils/log';
import { styles } from './settingsStyles';

type Props = {
  expanded: boolean;
  onToggle: () => void;
};

export function ImportExportSection({ expanded, onToggle }: Props) {
  const [importVisible, setImportVisible] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);

  const handleExportCsv = async () => {
    setExportingCsv(true);
    try {
      await exportInventoryCsv();
      await exportSalesCsv();
    } catch (err) {
      Alert.alert('Export failed', toErrorMessage(err));
    } finally {
      setExportingCsv(false);
    }
  };

  return (
    <>
      <CollapsibleSection
        title="Import & export"
        expanded={expanded}
        onToggle={onToggle}
        maxHeight={400}>
        <Text style={styles.sectionSubtitle}>
          Import a CSV or Excel file and check each row against the
          price list before adding it to your inventory.
        </Text>
        <TouchableOpacity
          style={styles.primaryButton}
          activeOpacity={0.8}
          onPress={() => setImportVisible(true)}>
          <Text style={styles.primaryButtonText}>
            Open the import wizard
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.primaryButton,
            { marginTop: 10 },
            exportingCsv && styles.primaryButtonDisabled,
          ]}
          activeOpacity={0.8}
          onPress={handleExportCsv}
          disabled={exportingCsv}>
          {exportingCsv ? (
            <View style={styles.buttonRow}>
              <ActivityIndicator
                color={colors.text}
                size="small"
                style={{ marginRight: 8 }}
              />
              <Text style={styles.primaryButtonText}>Exporting...</Text>
            </View>
          ) : (
            <Text style={styles.primaryButtonText}>
              Export Inventory &amp; Sales (CSV)
            </Text>
          )}
        </TouchableOpacity>
      </CollapsibleSection>

      <BulkImportWizard
        visible={importVisible}
        onClose={() => setImportVisible(false)}
      />
    </>
  );
}
