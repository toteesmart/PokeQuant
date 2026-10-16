// SearchBuyScreen's row-level actions, kept out of the screen so it stays
// a composition shell. `openAnalysis` is injected: useAnalysisSheet holds
// its target in useState, so a second instance here would open a sheet the
// screen never renders.

import { useCallback } from 'react';
import { Alert } from 'react-native';
import type { SearchLogPayload } from '../components/SearchCard';
import type { CatalogCard } from '../db/catalogDb';
import type { ScoutCandidate } from '../scanner/services/deal/buyScout';
import type { useAnalysisSheet } from '../scanner/hooks/useAnalysisSheet';
import { getCatalogImageUri } from '../services/CatalogImageService';
import { useAuth } from './useAuth';
import { useInventoryStore, type InventoryInput } from '../store/inventoryStore';
import { toErrorMessage } from '../utils/log';

type OpenAnalysis = ReturnType<typeof useAnalysisSheet>['openAnalysis'];

export function useSearchBuyActions(openAnalysis: OpenAnalysis) {
  const { userId } = useAuth();
  const addInventoryCard = useInventoryStore((state) => state.addInventoryCard);
  const refreshInventoryState = useInventoryStore((state) => state.refreshInventoryState);

  const handleScoutSelect = useCallback(
    (c: ScoutCandidate) =>
      openAnalysis(
        {
          productId: c.productId,
          name: c.name,
          number: c.number,
          set: c.set,
          rarity: c.rarity,
          imageUrl: getCatalogImageUri(c.productId),
          subType: c.subType,
          marketPrice: c.price,
        },
        c.subType,
      ),
    [openAnalysis],
  );

  // Name tap → deal analysis in general market language (no cost basis —
  // this is a card you're evaluating, not one you own).
  const handleAnalyze = useCallback(
    (card: CatalogCard, variant: string) => {
      const market =
        card.variants.find((v) => v.subType === variant)?.marketPrice ?? card.liveMarket;
      openAnalysis(
        {
          productId: card.productId,
          name: card.name,
          number: card.number,
          set: card.set,
          rarity: card.rarity,
          imageUrl: card.imageUrl,
          subType: variant,
          marketPrice: market,
        },
        variant,
      );
    },
    [openAnalysis],
  );

  const handleLogToInventory = useCallback(
    async (payload: SearchLogPayload) => {
      if (!userId) {
        Alert.alert('Not signed in', 'Sign in to save cards to your inventory.');
        return;
      }

      try {
        const input: InventoryInput = {
          name: payload.cardName,
          number: payload.cardNumber,
          set: payload.setName,
          rarity: payload.variant,
          productType: payload.variant,
          condition: payload.condition,
          liveMarket: payload.liveMarket,
          amountPaid: payload.cashOffer,
          stickerPrice: payload.stickerPrice,
          imageUrl: payload.imageUrl,
          productId: payload.productId,
        };
        await addInventoryCard(input);
        await refreshInventoryState();
        Alert.alert('Added', `${payload.cardName} is in your inventory.`);
      } catch (err) {
        console.error('Log to inventory failed:', err);
        Alert.alert("Couldn't add card", toErrorMessage(err));
      }
    },
    [userId, addInventoryCard, refreshInventoryState],
  );

  return { handleLogToInventory, handleAnalyze, handleScoutSelect };
}
