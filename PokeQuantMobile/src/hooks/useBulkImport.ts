// Wizard brain for BulkImportWizard — owns step/rows/loading state, the
// catalog handle, and every handler. The component is a composition shell:
// pick / verify / done bodies + footer.

import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useAuth } from './useAuth';
import { useVendorStore } from '../store/vendorStore';
import { useProgressStore } from '../store/progressStore';
import { useInventoryStore } from '../store/inventoryStore';
import { initializeDatabase } from '../db/database';
import { openCatalogDatabase } from '../db/catalogDb';
import { bulkInsertInventory } from '../db/inventoryDb';
import {
  parseNumber,
  parseSpreadsheetRows,
  resolveCatalogMatches,
  type VerificationRow,
} from '../components/import/importRows';
import { toErrorMessage } from '../utils/log';

type BulkImportStep = 'pick' | 'verify' | 'done';

export function useBulkImport(visible: boolean, onComplete?: () => void) {
  const { userId } = useAuth();
  const getCashOffer = useVendorStore((state) => state.getCashOffer);
  const getStickerPrice = useVendorStore((state) => state.getStickerPrice);
  const getConditionedMarket = useVendorStore(
    (state) => state.getConditionedMarket
  );
  const isCatalogReady = useProgressStore((state) => state.isCatalogReady);
  const isExtracting = useProgressStore((state) => state.isExtracting);

  const [step, setStep] = useState<BulkImportStep>('pick');
  const [rows, setRows] = useState<VerificationRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const catalogDbRef = useRef<SQLiteDatabase | null>(null);

  // Opening or closing the sheet resets the wizard — an in-flight parse
  // finishing after close must not greet the next open on a stale step.
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    setStep('pick');
    setRows([]);
    setError(null);
    setIsLoading(false);
  }

  useEffect(() => {
    if (!visible) return;

    if (!isCatalogReady || isExtracting) {
      catalogDbRef.current = null;
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
  }, [visible, isCatalogReady, isExtracting]);

  const pickFile = useCallback(async () => {
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
        setError("Couldn't read that file — try picking it again.");
        return;
      }

      setIsLoading(true);
      const base64 = await new File(fileUri).base64();

      const rawRows = parseSpreadsheetRows(base64);
      if (rawRows.length === 0) {
        setError('No card rows found in that file.');
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
        const matchableRows = verificationRows.map((r) => ({
          id: r.id,
          name: r.name,
          set: r.set,
          number: r.number,
          variant: r.variant,
        }));
        const matches = await resolveCatalogMatches(catalogDb, matchableRows);
        setRows((prev) =>
          prev.map((r) => {
            const matched = matches.get(r.id) ?? null;
            return {
              ...r,
              productId: matched?.productId ?? null,
              matchedCard: matched,
              isResolving: false,
            };
          })
        );
      } else {
        setRows((prev) => prev.map((r) => ({ ...r, isResolving: false })));
      }
    } catch (err) {
      setError("Couldn't read that file — check it's a CSV or Excel sheet.");
      console.error('Bulk import parse failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const searchCard = useCallback(
    async (rowId: string) => {
      const row = rows.find((r) => r.id === rowId);
      if (!row || !catalogDbRef.current) return;

      setRows((prev) =>
        prev.map((r) => (r.id === rowId ? { ...r, isResolving: true } : r))
      );

      const matched = await resolveCatalogMatches(catalogDbRef.current, [
        {
          id: row.id,
          name: row.name,
          set: row.set,
          number: row.number,
          variant: row.variant,
        },
      ]);
      setRows((prev) =>
        prev.map((r) =>
          r.id === rowId
            ? {
                ...r,
                productId: matched.get(row.id)?.productId ?? null,
                matchedCard: matched.get(row.id) ?? null,
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

  const commit = useCallback(async () => {
    if (!userId) {
      Alert.alert('Not signed in', 'Sign in to import cards.');
      return;
    }
    if (!canCommit) {
      Alert.alert('Unmatched rows', 'Match every row to a card before importing.');
      return;
    }

    setIsLoading(true);
    try {
      const { db } = await initializeDatabase();

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
      await useInventoryStore.getState().refreshInventoryState();
      setStep('done');
      onComplete?.();
    } catch (err) {
      Alert.alert('Import failed', toErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [canCommit, getCashOffer, getConditionedMarket, getStickerPrice, onComplete, rows, userId]);

  return {
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
  };
}
