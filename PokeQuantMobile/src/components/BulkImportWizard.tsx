import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as XLSX from '@stackline/xlsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors } from '../constants/colors';
import { useAuth } from '../context/AuthContext';
import { useVendorStore } from '../store/vendorStore';
import { initializeDatabase } from '../db/database';
import {
  openCatalogDatabase,
  searchCatalogCards,
  type CatalogCard,
  type CatalogFilters,
} from '../db/catalogDb';
import { bulkInsertInventory } from '../db/inventoryDb';

function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[''\-.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function parseNumber(value: string, fallback: number): number {
  const n = Number.parseFloat(value.trim());
  return Number.isNaN(n) ? fallback : n;
}

type RawImportRow = {
  name: string;
  set: string;
  number: string;
  condition: string;
  costBasis: string;
  stickerPrice: string;
  variant: string;
};

type VerificationRow = {
  id: string;
  name: string;
  set: string;
  number: string;
  condition: string;
  costBasis: string;
  stickerPrice: string;
  variant: string;
  productId: number | null;
  matchedCard: CatalogCard | null;
  isResolving: boolean;
};

const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DMG'];

const HEADER_ALIASES: Record<keyof RawImportRow, string[]> = {
  name: [
    'card name',
    'card_name',
    'cardname',
    'name',
    'title',
    'product name',
    'product_name',
  ],
  set: ['set', 'set name', 'set_name', 'setname', 'expansion'],
  number: ['number', 'card number', 'card_number', 'cardnumber', '#', 'no'],
  condition: ['condition', 'cond', 'grade'],
  costBasis: [
    'cost basis',
    'cost',
    'cost_basis',
    'purchase price',
    'purchase_price',
    'amount paid',
    'amount_paid',
    'cash offer',
    'cash_offer',
    'offer',
  ],
  stickerPrice: [
    'sticker price',
    'sticker',
    'sticker_price',
    'stickerprice',
    'price',
    'projected sticker',
  ],
  variant: ['variant', 'rarity', 'product type', 'product_type', 'subtype'],
};

function detectHeaderMap(headers: string[]): Record<keyof RawImportRow, number> {
  const map: Partial<Record<keyof RawImportRow, number>> = {};
  for (let i = 0; i < headers.length; i++) {
    const raw = headers[i];
    if (!raw) continue;
    const normalized = raw.toLowerCase().trim();
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      if (map[key as keyof RawImportRow] !== undefined) continue;
      if (aliases.includes(normalized)) {
        map[key as keyof RawImportRow] = i;
        break;
      }
    }
  }
  return {
    name: map.name ?? -1,
    set: map.set ?? -1,
    number: map.number ?? -1,
    condition: map.condition ?? -1,
    costBasis: map.costBasis ?? -1,
    stickerPrice: map.stickerPrice ?? -1,
    variant: map.variant ?? -1,
  };
}

function parseSpreadsheetRows(
  base64: string,
  fileName: string
): RawImportRow[] {
  const workbook = XLSX.read(base64, { type: 'base64' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
  }) as string[][];

  if (data.length < 2) return [];

  const headers = data[0].map((h) => String(h ?? '').trim());
  const headerMap = detectHeaderMap(headers);

  const get = (row: string[], index: number): string =>
    index >= 0 && index < row.length ? String(row[index] ?? '').trim() : '';

  const rows: RawImportRow[] = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.every((cell) => !String(cell ?? '').trim())) continue;

    const condition = get(row, headerMap.condition).toUpperCase() || 'NM';
    const safeCondition = CONDITIONS.includes(condition) ? condition : 'NM';

    rows.push({
      name: get(row, headerMap.name),
      set: get(row, headerMap.set),
      number: get(row, headerMap.number),
      condition: safeCondition,
      costBasis: get(row, headerMap.costBasis),
      stickerPrice: get(row, headerMap.stickerPrice),
      variant: get(row, headerMap.variant) || 'Normal',
    });
  }

  return rows;
}

async function resolveCatalogMatch(
  catalogDb: any,
  query: string
): Promise<CatalogCard | null> {
  if (!query.trim()) return null;

  const filters: CatalogFilters = {
    query,
    rarity: 'All',
    sortBy: 'Newest',
    productType: 'All',
  };

  try {
    const result = await searchCatalogCards(catalogDb, filters, 20, 0);
    const normalizedQuery = normalizeSearch(query);
    if (!normalizedQuery) return null;

    let best: CatalogCard | null = null;
    let bestScore = -1;

    for (const card of result.cards) {
      const normalizedName = normalizeSearch(card.name);
      const normalizedSet = normalizeSearch(card.set);
      const normalizedNumber = normalizeSearch(card.number);
      const queryParts = normalizedQuery.split(' ');

      let score = 0;
      if (normalizedName === normalizedQuery) score += 100;
      if (normalizedName.includes(normalizedQuery)) score += 50;
      for (const part of queryParts) {
        if (normalizedName.includes(part)) score += 10;
        if (normalizedSet.includes(part)) score += 5;
        if (normalizedNumber.includes(part)) score += 5;
      }
      if (card.liveMarket > 0) score += 1;

      if (score > bestScore) {
        bestScore = score;
        best = card;
      }
    }

    // Require a reasonable match threshold before accepting.
    return bestScore >= 10 ? best : null;
  } catch (err) {
    console.error('Catalog lookup failed:', err);
    return null;
  }
}

type BulkImportWizardProps = {
  visible: boolean;
  onClose: () => void;
  onComplete?: () => void;
};

export function BulkImportWizard({
  visible,
  onClose,
  onComplete,
}: BulkImportWizardProps) {
  const { userId } = useAuth();
  const getCashOffer = useVendorStore((state) => state.getCashOffer);
  const getStickerPrice = useVendorStore((state) => state.getStickerPrice);
  const getConditionedMarket = useVendorStore(
    (state) => state.getConditionedMarket
  );

  const [step, setStep] = useState<'pick' | 'verify' | 'done'>('pick');
  const [rows, setRows] = useState<VerificationRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const catalogDbRef = useRef<any>(null);

  useEffect(() => {
    if (!visible) {
      setStep('pick');
      setRows([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    let mounted = true;
    openCatalogDatabase()
      .then((db) => {
        if (mounted) catalogDbRef.current = db;
      })
      .catch((err) => {
        console.error('Failed to open catalog for bulk import:', err);
      });

    return () => {
      mounted = false;
    };
  }, [visible]);

  const handlePickFile = useCallback(async () => {
    setError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      const fileUri = asset.uri;
      if (!fileUri) {
        setError('Selected file has no URI.');
        return;
      }

      setIsLoading(true);
      const base64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: 'base64',
      });

      const rawRows = parseSpreadsheetRows(base64, asset.name ?? 'upload');
      if (rawRows.length === 0) {
        setError('No importable rows found in the selected file.');
        setIsLoading(false);
        return;
      }

      const verificationRows: VerificationRow[] = rawRows.map((r) => ({
        id: Crypto.randomUUID().replace(/-/g, ''),
        ...r,
        productId: null,
        matchedCard: null,
        isResolving: true,
      }));

      setRows(verificationRows);
      setStep('verify');

      const catalogDb = catalogDbRef.current;
      if (catalogDb) {
        for (const row of verificationRows) {
          const matched = await resolveCatalogMatch(catalogDb, row.name);
          setRows((prev) =>
            prev.map((r) =>
              r.id === row.id
                ? {
                    ...r,
                    productId: matched?.productId ?? null,
                    matchedCard: matched,
                    isResolving: false,
                  }
                : r
            )
          );
        }
      } else {
        setRows((prev) => prev.map((r) => ({ ...r, isResolving: false })));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Failed to parse file: ${message}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleSearchCard = useCallback(
    async (rowId: string) => {
      const row = rows.find((r) => r.id === rowId);
      if (!row || !catalogDbRef.current) return;

      setRows((prev) =>
        prev.map((r) => (r.id === rowId ? { ...r, isResolving: true } : r))
      );

      const matched = await resolveCatalogMatch(catalogDbRef.current, row.name);
      setRows((prev) =>
        prev.map((r) =>
          r.id === rowId
            ? {
                ...r,
                productId: matched?.productId ?? null,
                matchedCard: matched,
                isResolving: false,
              }
            : r
        )
      );
    },
    [rows]
  );

  const updateRow = useCallback(
    (rowId: string, updates: Partial<VerificationRow>) => {
      setRows((prev) =>
        prev.map((r) => (r.id === rowId ? { ...r, ...updates } : r))
      );
    },
    []
  );

  const unresolvedCount = useMemo(
    () => rows.filter((r) => !r.matchedCard && !r.isResolving).length,
    [rows]
  );

  const canCommit = useMemo(
    () =>
      rows.length > 0 &&
      rows.every((r) => r.matchedCard != null) &&
      !rows.some((r) => r.isResolving),
    [rows]
  );

  const handleCommit = useCallback(async () => {
    if (!userId) {
      Alert.alert('Not logged in', 'Log in to import inventory.');
      return;
    }
    if (!canCommit) {
      Alert.alert('Unresolved rows', 'Resolve all rows before committing.');
      return;
    }

    setIsLoading(true);
    try {
      const { db } = await initializeDatabase();
      const catalogDb = catalogDbRef.current;

      const inputs = rows.map((row) => {
        const matched = row.matchedCard!;
        const liveMarket = matched.liveMarket || 0;
        const conditionedMarket = getConditionedMarket(liveMarket, row.condition);
        const amountPaid =
          parseNumber(row.costBasis, 0) > 0
            ? parseNumber(row.costBasis, 0)
            : getCashOffer(conditionedMarket);
        const rawSticker =
          parseNumber(row.stickerPrice, 0) > 0
            ? parseNumber(row.stickerPrice, 0)
            : conditionedMarket;
        const stickerPrice = getStickerPrice(rawSticker);

        return {
          id: row.id,
          userId,
          productId: matched.productId,
          name: matched.name,
          number: matched.number,
          set: matched.set,
          variant: row.variant || matched.productType || matched.rarity,
          condition: row.condition,
          liveMarket: conditionedMarket,
          amountPaid,
          stickerPrice,
          isBulk: false,
          imageUrl: matched.imageUrl,
        };
      });

      await bulkInsertInventory(db, inputs);
      setStep('done');
      onComplete?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Import failed', message);
    } finally {
      setIsLoading(false);
    }
  }, [canCommit, getCashOffer, getConditionedMarket, getStickerPrice, onComplete, rows, userId]);

  const handleClose = useCallback(() => {
    if (step === 'done') {
      onClose();
      return;
    }

    if (rows.length > 0) {
      Alert.alert(
        'Discard import?',
        'Any uncommitted changes will be lost.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: onClose },
        ]
      );
      return;
    }
    onClose();
  }, [onClose, rows.length, step]);

  const renderRow = useCallback(
    ({ item, index }: { item: VerificationRow; index: number }) => (
      <View style={styles.rowCard}>
        <View style={styles.rowHeader}>
          <Text style={styles.rowNumber}>Row {index + 1}</Text>
          {item.isResolving ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : item.matchedCard ? (
            <View style={styles.matchedPill}>
              <Text style={styles.matchedText}>Matched</Text>
            </View>
          ) : (
            <View style={styles.unmatchedPill}>
              <Text style={styles.unmatchedText}>Unresolved</Text>
            </View>
          )}
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Card Name</Text>
          <TextInput
            style={styles.input}
            value={item.name}
            onChangeText={(text) => updateRow(item.id, { name: text })}
            placeholder="Searchable card name"
            placeholderTextColor={colors.textMuted}
          />
        </View>

        <View style={styles.rowCols}>
          <View style={[styles.field, { flex: 1, marginRight: 6 }]}>
            <Text style={styles.fieldLabel}>Set</Text>
            <TextInput
              style={styles.input}
              value={item.set}
              onChangeText={(text) => updateRow(item.id, { set: text })}
              placeholderTextColor={colors.textMuted}
            />
          </View>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={styles.fieldLabel}>Number</Text>
            <TextInput
              style={styles.input}
              value={item.number}
              onChangeText={(text) => updateRow(item.id, { number: text })}
              placeholderTextColor={colors.textMuted}
            />
          </View>
        </View>

        <View style={styles.rowCols}>
          <View style={[styles.field, { flex: 1, marginRight: 6 }]}>
            <Text style={styles.fieldLabel}>Condition</Text>
            <TextInput
              style={styles.input}
              value={item.condition}
              onChangeText={(text) =>
                updateRow(item.id, { condition: text.toUpperCase() })
              }
              placeholderTextColor={colors.textMuted}
            />
          </View>
          <View style={[styles.field, { flex: 1, marginRight: 6 }]}>
            <Text style={styles.fieldLabel}>Variant</Text>
            <TextInput
              style={styles.input}
              value={item.variant}
              onChangeText={(text) => updateRow(item.id, { variant: text })}
              placeholderTextColor={colors.textMuted}
            />
          </View>
        </View>

        <View style={styles.rowCols}>
          <View style={[styles.field, { flex: 1, marginRight: 6 }]}>
            <Text style={styles.fieldLabel}>Cost Basis ($)</Text>
            <TextInput
              style={styles.input}
              value={item.costBasis}
              onChangeText={(text) => updateRow(item.id, { costBasis: text })}
              keyboardType="decimal-pad"
              placeholder="Auto"
              placeholderTextColor={colors.textMuted}
            />
          </View>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={styles.fieldLabel}>Sticker ($)</Text>
            <TextInput
              style={styles.input}
              value={item.stickerPrice}
              onChangeText={(text) =>
                updateRow(item.id, { stickerPrice: text })
              }
              keyboardType="decimal-pad"
              placeholder="Auto"
              placeholderTextColor={colors.textMuted}
            />
          </View>
        </View>

        {!item.isResolving && !item.matchedCard && (
          <TouchableOpacity
            style={styles.searchButton}
            activeOpacity={0.7}
            onPress={() => handleSearchCard(item.id)}>
            <Text style={styles.searchButtonText}>Search Catalog</Text>
          </TouchableOpacity>
        )}

        {item.matchedCard && (
          <View style={styles.matchPanel}>
            <Text style={styles.matchName} numberOfLines={1}>
              {item.matchedCard.name}
            </Text>
            <Text style={styles.matchMeta} numberOfLines={1}>
              {item.matchedCard.number} · {item.matchedCard.set} ·{' '}
              {item.matchedCard.productType || item.matchedCard.rarity}
            </Text>
            <Text style={styles.matchMarket}>
              Market: {formatCurrency(item.matchedCard.liveMarket)}
            </Text>
          </View>
        )}
      </View>
    ),
    [handleSearchCard, updateRow]
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
      presentationStyle="overFullScreen">
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Bulk Import Wizard</Text>
            <TouchableOpacity onPress={handleClose} activeOpacity={0.7}>
              <Text style={styles.closeText}>Close</Text>
            </TouchableOpacity>
          </View>

          {step === 'pick' && (
            <View style={styles.pickBody}>
              <Text style={styles.subtitle}>
                Select a CSV or Excel (.xlsx) file to import. The first row
                should contain headers such as Card Name, Set, Condition,
                Cost Basis, and Sticker Price.
              </Text>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  isLoading && styles.primaryButtonDisabled,
                ]}
                activeOpacity={0.8}
                onPress={handlePickFile}
                disabled={isLoading}>
                {isLoading ? (
                  <ActivityIndicator color={colors.text} />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    Select Spreadsheet
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {step === 'verify' && (
            <>
              <View style={styles.verifyHeader}>
                <Text style={styles.verifyCount}>
                  {rows.length} row{rows.length !== 1 ? 's' : ''}
                  {unresolvedCount > 0
                    ? ` · ${unresolvedCount} unresolved`
                    : ' · all matched'}
                </Text>
              </View>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              <FlatList
                data={rows}
                keyExtractor={(item) => item.id}
                renderItem={renderRow}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                  <Text style={styles.emptyText}>No rows loaded.</Text>
                }
              />
              <View style={styles.footer}>
                <TouchableOpacity
                  style={[
                    styles.commitButton,
                    (!canCommit || isLoading) && styles.commitButtonDisabled,
                  ]}
                  activeOpacity={canCommit ? 0.8 : 1}
                  onPress={handleCommit}
                  disabled={!canCommit || isLoading}>
                  {isLoading ? (
                    <ActivityIndicator color={colors.text} />
                  ) : (
                    <Text style={styles.commitButtonText}>
                      Commit {rows.length} Item
                      {rows.length !== 1 ? 's' : ''}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}

          {step === 'done' && (
            <View style={styles.doneBody}>
              <Text style={styles.doneText}>
                {rows.length} item{rows.length !== 1 ? 's' : ''} imported
                successfully.
              </Text>
              <TouchableOpacity
                style={styles.primaryButton}
                activeOpacity={0.8}
                onPress={onClose}>
                <Text style={styles.primaryButtonText}>Done</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    maxHeight: '92%',
    minHeight: '50%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: 'bold',
  },
  closeText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
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
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 28,
    alignItems: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
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
  rowCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 12,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  rowNumber: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  matchedPill: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  matchedText: {
    color: colors.success,
    fontSize: 11,
    fontWeight: '600',
  },
  unmatchedPill: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  unmatchedText: {
    color: colors.error,
    fontSize: 11,
    fontWeight: '600',
  },
  field: {
    marginBottom: 10,
  },
  fieldLabel: {
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
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  rowCols: {
    flexDirection: 'row',
  },
  searchButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  searchButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  matchPanel: {
    backgroundColor: colors.background,
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  matchName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: 'bold',
  },
  matchMeta: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  matchMarket: {
    color: colors.success,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
  },
  commitButton: {
    backgroundColor: colors.success,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  commitButtonDisabled: {
    backgroundColor: 'rgba(34, 197, 94, 0.35)',
  },
  commitButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
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
