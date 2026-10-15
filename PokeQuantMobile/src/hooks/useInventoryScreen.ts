// InventoryScreen's brain: edit/analysis sheet state, bulk-select wiring,
// search + filtered inventory, portfolio metrics/hero art, stock health,
// rotation sheet, and layout measurement. The screen keeps tab switching,
// chrome, and JSX.
//
// Boundary: owns all store subscriptions and derived state; the shell
// renders what it returns.

import { useCallback, useMemo, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { useWindowDimensions } from 'react-native';
import {
  buildInventoryImageUrl,
  useInventoryStore,
  type InventoryCard as InventoryCardType,
} from '../store/inventoryStore';
import { normalizeSearchTerm } from '../utils/search';
import { useProgressStore } from '../store/progressStore';
import type { WatchedCard } from '../store/watchlistStore';
import { useAnalysisSheet } from '../scanner/hooks/useAnalysisSheet';
import { buildStockHealth } from '../scanner/services/deal/stockHealth';
import { buildSearchIndex } from '../services/inventorySearch';
import {
  featuresForCard,
  signalForCard,
} from '../services/inventoryReads';
import { useBulkSelection } from './useBulkSelection';
import { useDeepFeatures } from './useDeepFeatures';
import { useInventorySignals } from './useInventorySignals';
import { GRID_GAP } from '../components/InventoryCell';
import { layout } from '../constants/theme';

type Card = InventoryCardType;

export function useInventoryScreen() {
  const { width, height } = useWindowDimensions();
  const activeInventory = useInventoryStore((state) => state.activeInventory);
  const isSyncing = useInventoryStore((state) => state.isSyncing);
  const pendingSyncCount = useInventoryStore(
    (state) => state.pendingSyncCount
  );
  const isCatalogReady = useProgressStore((state) => state.isCatalogReady);
  const isExtracting = useProgressStore((state) => state.isExtracting);

  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const handleEdit = useCallback((card: Card) => setEditingCard(card), []);

  // Name tap → deal analysis in owner language (cost basis, days held).
  const { analysisFor, openAnalysis, closeAnalysis } = useAnalysisSheet();
  const handleAnalyze = useCallback(
    (card: Card) =>
      openAnalysis(
        {
          productId: card.productId,
          name: card.name,
          number: card.number,
          set: card.set,
          rarity: card.rarity,
          imageUrl: card.imageUrl,
          subType: card.productType,
          marketPrice: card.liveMarket,
        },
        card.productType,
        {
          paid: card.amountPaid,
          since: card.dateBought,
          sticker: card.stickerPrice,
        }
      ),
    [openAnalysis]
  );

  // Watched-card shift rows open the same sheet, minus the owner frame.
  const handleWatchAnalyze = useCallback(
    (w: WatchedCard) =>
      openAnalysis(
        {
          productId: w.productId,
          name: w.name,
          number: w.number,
          set: w.set,
          imageUrl: w.imageUrl,
          subType: w.subType,
        },
        w.subType
      ),
    [openAnalysis]
  );

  // Bulk-select mode: long-press a card OR the header "Select" button
  // to enter, tap cards to toggle. Entered via long-press, deselecting
  // the last card exits; entered via the button it stays until Cancel.
  const bulk = useBulkSelection();

  const [searchQuery, setSearchQuery] = useState('');

  const [viewport, setViewport] = useState({ width, height });

  const signals = useInventorySignals(isCatalogReady, isExtracting);

  const searchIndex = useMemo(
    () => buildSearchIndex(activeInventory),
    [activeInventory]
  );

  const filteredInventory = useMemo(() => {
    const raw = searchQuery.trim();
    if (!raw) return activeInventory;
    const needle = normalizeSearchTerm(raw);
    if (!needle) return activeInventory;
    return searchIndex
      .filter((entry) => entry.haystack.includes(needle))
      .map((entry) => entry.card);
  }, [activeInventory, searchIndex, searchQuery]);

  const metrics = useMemo(
    () => ({
      activeAssets: activeInventory.length,
      totalCostBasis: activeInventory.reduce((sum, c) => sum + c.amountPaid, 0),
      projectedSticker: activeInventory.reduce((sum, c) => sum + c.stickerPrice, 0),
      projectedProfit: activeInventory.reduce((sum, c) => sum + c.projProfit, 0),
    }),
    [activeInventory]
  );

  // The hero bleeds the top-value card's art — same resolution the card
  // itself uses, so the wash always matches what's on screen.
  const heroArtUri = useMemo(() => {
    const top = activeInventory.reduce<InventoryCardType | null>(
      (t, c) => (c.stickerPrice > (t?.stickerPrice ?? 0) ? c : t),
      null
    );
    return top
      ? buildInventoryImageUrl(top.imageUrl, top.productId)
      : undefined;
  }, [activeInventory]);

  // Portfolio triage — first a synchronous scalar pass over the stamped
  // signals, then the held cards' price_series hydrates in the
  // background and the buckets refine to the same deep read the
  // analysis sheet uses (floors, failed bounces, bounce memory).
  const deepFeatures = useDeepFeatures(activeInventory);
  const health = useMemo(
    () =>
      buildStockHealth(
        activeInventory,
        (c) => signalForCard(signals.signalMap, c as Card),
        (c) => featuresForCard(deepFeatures, c)
      ),
    [activeInventory, signals.signalMap, deepFeatures]
  );
  const [rotationOpen, setRotationOpen] = useState(false);
  const watchItems = useMemo(
    () =>
      health.items
        .filter((i) => i.bucket === 'watch')
        .sort((a, b) => b.value - a.value),
    [health]
  );

  const handleScrollLayout = useCallback((e: LayoutChangeEvent) => {
    setViewport(e.nativeEvent.layout);
  }, []);

  // Two-up grid cells — the card receives the exact column width so
  // FlashList can lay out flat rows without pre-chunking pairs.
  const cellWidth = Math.max(
    0,
    Math.floor((width - layout.screenPadding * 2 - GRID_GAP) / 2)
  );

  return {
    isSyncing,
    pendingSyncCount,
    editingCard,
    setEditingCard,
    handleEdit,
    analysisFor,
    closeAnalysis,
    handleAnalyze,
    handleWatchAnalyze,
    bulk,
    searchQuery,
    setSearchQuery,
    viewport,
    handleScrollLayout,
    signals,
    filteredInventory,
    metrics,
    heroArtUri,
    health,
    rotationOpen,
    setRotationOpen,
    watchItems,
    cellWidth,
  };
}
