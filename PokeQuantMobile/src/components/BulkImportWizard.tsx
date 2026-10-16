// Bulk import wizard — composition shell. State/handlers live in
// useBulkImport, row cards in import/ImportRowCard, parsing + catalog
// matching in import/importRows.

import { useCallback } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { colors } from '../constants/colors';
import { AppButton, GlassSheet } from './ui';
import { useBulkImport } from '../hooks/useBulkImport';
import { ImportRowCard } from './import/ImportRowCard';
import type { VerificationRow } from './import/importRows';

type BulkImportWizardProps = {
  visible: boolean;
  onClose: () => void;
  onComplete?: () => void;
};

export function BulkImportWizard({ visible, onClose, onComplete }: BulkImportWizardProps) {
  const {
    step,
    rows,
    isLoading,
    error,
    unresolvedCount,
    canCommit,
    pickFile,
    searchCard,
    updateRow,
    commit,
  } = useBulkImport(visible, onComplete);

  const handleClose = useCallback(() => {
    if (step === 'done') {
      onClose();
      return;
    }

    if (rows.length > 0) {
      Alert.alert('Discard import?', 'Any uncommitted changes will be lost.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onClose },
      ]);
      return;
    }
    onClose();
  }, [onClose, rows.length, step]);

  const renderRow = useCallback(
    ({ item, index }: { item: VerificationRow; index: number }) => (
      <ImportRowCard item={item} index={index} onUpdate={updateRow} onSearch={searchCard} />
    ),
    [searchCard, updateRow],
  );

  if (!visible) return null;

  // The verify step hosts a FlashList, so the sheet renders a fixed body
  // instead of its own ScrollView — the list owns scrolling.
  return (
    <GlassSheet
      title="Bulk import"
      onClose={handleClose}
      scrollable={false}
      keyboardAware
      footer={
        step === 'pick' ? (
          <AppButton
            title="Select spreadsheet"
            onPress={pickFile}
            disabled={isLoading}
            loading={isLoading}
          />
        ) : step === 'verify' ? (
          <AppButton
            title={`Import ${rows.length} card${rows.length !== 1 ? 's' : ''}`}
            onPress={commit}
            disabled={!canCommit || isLoading}
            loading={isLoading}
          />
        ) : (
          <AppButton title="Done" onPress={onClose} />
        )
      }
    >
      <>
        {step === 'pick' && (
          <View style={styles.pickBody}>
            <Text style={styles.subtitle}>
              Pick a CSV or Excel (.xlsx) file with your cards. The first row should have headers
              like Card Name, Set, Condition, Cost Basis, and Sticker Price.
            </Text>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </View>
        )}

        {step === 'verify' && (
          <>
            <View style={styles.verifyHeader}>
              <Text style={styles.verifyCount}>
                {rows.length} row{rows.length !== 1 ? 's' : ''}
                {unresolvedCount > 0 ? ` · ${unresolvedCount} need a match` : ' · all matched'}
              </Text>
            </View>
            <FlashList
              data={rows}
              keyExtractor={(item) => item.id}
              renderItem={renderRow}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Text style={styles.emptyText}>No rows loaded.</Text>}
              style={{ flex: 1 }}
            />
          </>
        )}

        {step === 'done' && (
          <View style={styles.doneBody}>
            <Text style={styles.doneText}>
              {rows.length} card{rows.length !== 1 ? 's' : ''} added to your inventory.
            </Text>
          </View>
        )}
      </>
    </GlassSheet>
  );
}

const styles = StyleSheet.create({
  pickBody: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 12,
  },
  verifyHeader: {
    marginBottom: 12,
  },
  verifyCount: {
    color: colors.textMuted,
    fontSize: 13,
  },
  listContent: {
    paddingBottom: 12,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 24,
  },
  doneBody: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  doneText: {
    color: colors.text,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
  },
});
