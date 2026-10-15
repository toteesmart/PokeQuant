// SearchCatalogRow — a two-up row of SearchCards for the search grid.
// Owns its own layout style so components/ never imports screen styles.
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { CatalogCard } from '../db/catalogDb';
import { SearchCard, type SearchLogPayload } from './SearchCard';

export type CatalogCardPair = [CatalogCard, CatalogCard?];

type SearchCatalogRowProps = {
  pair: CatalogCardPair;
  rowWidth: number;
  cardWidth: number;
  catalogDb: SQLiteDatabase | null;
  onAnalyze: (card: CatalogCard, variant: string) => void;
  onLogToInventory: (payload: SearchLogPayload) => void;
};

export const SearchCatalogRow = memo(function SearchCatalogRow({
  pair,
  rowWidth,
  cardWidth,
  catalogDb,
  onAnalyze,
  onLogToInventory,
}: SearchCatalogRowProps) {
  const justifyContent = pair[1] ? 'space-between' : 'center';
  return (
    <View style={[styles.cardRow, { width: rowWidth, justifyContent }]}>
      <SearchCard
        card={pair[0]}
        width={cardWidth}
        catalogDb={catalogDb}
        onAnalyze={onAnalyze}
        onLogToInventory={onLogToInventory}
      />
      {pair[1] && (
        <SearchCard
          card={pair[1]}
          width={cardWidth}
          catalogDb={catalogDb}
          onAnalyze={onAnalyze}
          onLogToInventory={onLogToInventory}
        />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  cardRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    gap: 10,
    minHeight: 362,
  },
});
