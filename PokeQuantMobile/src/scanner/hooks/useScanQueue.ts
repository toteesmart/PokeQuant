// ScanQueueView's brain: scan-queue store wiring plus every sheet's
// visibility/draft state and async handlers — variant switching (catalog
// options + print finishes), per-card offer editing, whole-queue deal
// totals, deal analysis, image viewing, and the add-to-inventory flush.

import { useCallback, useState } from 'react';
import { useScanQueueStore } from '../store/scanQueueStore';
import {
  hydrateVariantPrices,
  loadScannerCatalog,
} from '../services/catalog/ScannerCatalogProvider';
import { findVariantOptions } from '../services/catalog/catalogMatcher';
import { useAnalysisSheet } from './useAnalysisSheet';
import { scannedCardsToInventoryInputs } from '../utils/toInventoryInput';
import { autoOffer, offerBreakdown } from '../utils/pricing';
import {
  getCardSignals,
  getLatestSubTypePricesForProducts,
  openCatalogDatabase,
} from '../../db/catalogDb';
import { useInventoryStore } from '../../store/inventoryStore';
import { logWarn, toErrorMessage } from '../../utils/log';
import type { ScannedCard } from '../types/scan';
import type { ScanCatalogCard } from '../types/catalog';
import type { FinishOption } from '../molecules/VariantSwitchSheet';

export function useScanQueue(onDone?: () => void) {
  const {
    items,
    remove,
    updateCondition,
    updateQuantity,
    updateSubType,
    updateOffer,
    applyDealTotal,
    replaceCard,
    clear,
    totalCount,
    totalPrice,
  } = useScanQueueStore();

  const [switchItem, setSwitchItem] = useState<ScannedCard | null>(null);
  const { analysisFor, openAnalysis: openAnalysisMatch, closeAnalysis } = useAnalysisSheet();
  const [viewerFor, setViewerFor] = useState<{
    uri: string;
    name: string;
  } | null>(null);
  const [offerItem, setOfferItem] = useState<ScannedCard | null>(null);
  const [offerDraft, setOfferDraft] = useState('');
  const [dealOpen, setDealOpen] = useState(false);
  const [dealDraft, setDealDraft] = useState('');
  const [finishOptions, setFinishOptions] = useState<FinishOption[]>([]);
  const [switchOptions, setSwitchOptions] = useState<ScanCatalogCard[]>([]);
  const [switchLoading, setSwitchLoading] = useState(false);
  const [isFlushing, setIsFlushing] = useState(false);
  const [flushError, setFlushError] = useState<string | null>(null);

  const openSwitcher = useCallback((item: ScannedCard) => {
    setSwitchItem(item);
    setSwitchOptions([]);
    setFinishOptions([]);
    setSwitchLoading(true);
    Promise.all([
      loadScannerCatalog().then(async (catalog) => {
        const options = findVariantOptions(item, catalog);
        // Prices hydrate lazily — without this a switched card would carry a
        // $0 base price into the queue.
        await hydrateVariantPrices(options).catch(() => {});
        return options;
      }),
      // Same product, different print finish (Normal / Holofoil / Reverse
      // Holofoil…) — distinct from the variant printings above.
      openCatalogDatabase()
        .then((db) =>
          Promise.all([
            getLatestSubTypePricesForProducts(db, [item.productId]),
            getCardSignals(db, [item.productId]),
          ]),
        )
        .then(([priceMap, signalMap]) => {
          const signals = signalMap[item.productId] ?? {};
          return Object.entries(priceMap[item.productId] ?? {})
            .map(([subType, p]) => ({
              subType,
              marketPrice: p.marketPrice,
              signal: signals[subType],
            }))
            .sort((a, b) => b.marketPrice - a.marketPrice);
        })
        .catch(() => [] as FinishOption[]),
    ])
      .then(([options, finishes]) => {
        setSwitchOptions(options);
        setFinishOptions(finishes);
      })
      .catch((e) => logWarn('ScanQueueView: variant lookup failed', e))
      .finally(() => setSwitchLoading(false));
  }, []);

  const closeSwitcher = useCallback(() => setSwitchItem(null), []);

  const pickFinish = useCallback(
    (option: FinishOption) => {
      if (switchItem) updateSubType(switchItem.id, option);
    },
    [switchItem, updateSubType],
  );

  const pickVariant = useCallback(
    (card: ScanCatalogCard) => {
      if (switchItem) replaceCard(switchItem.id, card);
    },
    [switchItem, replaceCard],
  );

  const openAnalysis = useCallback(
    (item: ScannedCard) =>
      openAnalysisMatch({ ...item, marketPrice: item.baseMarketPrice }, item.subType),
    [openAnalysisMatch],
  );

  const openViewer = useCallback((uri: string, name: string) => {
    setViewerFor({ uri, name });
  }, []);
  const closeViewer = useCallback(() => setViewerFor(null), []);

  const openOfferEdit = useCallback((item: ScannedCard) => {
    setOfferItem(item);
    const current = item.customOffer ?? offerBreakdown(item.marketPrice).offer;
    setOfferDraft(current > 0 ? String(Math.round(current)) : '');
  }, []);

  const commitOffer = useCallback(() => {
    if (!offerItem) return;
    const parsed = parseFloat(offerDraft.replace(/[^0-9.]/g, ''));
    updateOffer(offerItem.id, Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null);
    setOfferItem(null);
  }, [offerItem, offerDraft, updateOffer]);

  const resetOffer = useCallback(() => {
    if (!offerItem) return;
    updateOffer(offerItem.id, null);
    setOfferItem(null);
  }, [offerItem, updateOffer]);

  const closeOffer = useCallback(() => setOfferItem(null), []);

  // Sum of every card's current effective offer × qty — what the queue
  // would pay out before any deal negotiation.
  const queueOfferTotal = items.reduce(
    (s, i) => s + (i.customOffer ?? autoOffer(i.marketPrice)) * i.quantity,
    0,
  );

  const openDeal = useCallback(() => {
    setDealDraft(String(Math.round(queueOfferTotal)));
    setDealOpen(true);
  }, [queueOfferTotal]);

  const commitDeal = useCallback(() => {
    const parsed = parseFloat(dealDraft.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(parsed)) applyDealTotal(Number(parsed.toFixed(2)));
    setDealOpen(false);
  }, [dealDraft, applyDealTotal]);

  const closeDeal = useCallback(() => setDealOpen(false), []);

  const flush = useCallback(async () => {
    if (isFlushing) return;
    setIsFlushing(true);
    setFlushError(null);
    try {
      await useInventoryStore.getState().addScannedCards(scannedCardsToInventoryInputs(items));
      clear();
      onDone?.();
    } catch (e) {
      setFlushError(toErrorMessage(e));
    } finally {
      setIsFlushing(false);
    }
  }, [isFlushing, items, clear, onDone]);

  return {
    items,
    remove,
    updateCondition,
    updateQuantity,
    totalCount,
    totalPrice,
    queueOfferTotal,
    switchItem,
    switchOptions,
    finishOptions,
    switchLoading,
    openSwitcher,
    closeSwitcher,
    pickFinish,
    pickVariant,
    analysisFor,
    openAnalysis,
    closeAnalysis,
    viewerFor,
    openViewer,
    closeViewer,
    offerItem,
    offerDraft,
    setOfferDraft,
    openOfferEdit,
    commitOffer,
    resetOffer,
    closeOffer,
    dealOpen,
    dealDraft,
    setDealDraft,
    openDeal,
    commitDeal,
    closeDeal,
    isFlushing,
    flushError,
    flush,
  };
}
