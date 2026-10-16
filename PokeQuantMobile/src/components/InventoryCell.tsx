// InventoryCell — one grid cell; FlashList renders two per row via
// numColumns. The wrapper carries the gaps (v2 dropped
// columnWrapperStyle): marginRight on the left column, marginBottom
// on every row.
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { CardSignal } from '../db/catalogDb';
import { signalForCard } from '../services/inventoryReads';
import { InventoryCard } from './InventoryCard';
import type { InventoryCard as InventoryCardType } from '../store/inventoryStore';

export const GRID_GAP = 12;

type Card = InventoryCardType;

export type InventoryCellProps = {
  card: Card;
  cellWidth: number;
  isLeftColumn: boolean;
  selected: boolean;
  onEdit: (card: Card) => void;
  onAnalyze: (card: Card) => void;
  selecting: boolean;
  onToggleSelect: (card: Card) => void;
  onStartSelect: (card: Card) => void;
  signalMap: Record<number, Record<string, CardSignal>>;
};

export const InventoryCell = memo(function InventoryCell({
  card,
  cellWidth,
  isLeftColumn,
  selected,
  onEdit,
  onAnalyze,
  selecting,
  onToggleSelect,
  onStartSelect,
  signalMap,
}: InventoryCellProps) {
  return (
    <View style={[styles.gridCell, isLeftColumn ? styles.gridCellLeft : styles.gridCellRight]}>
      <InventoryCard
        card={card}
        width={cellWidth}
        onEdit={onEdit}
        onAnalyze={onAnalyze}
        signal={signalForCard(signalMap, card)}
        selecting={selecting}
        selected={selected}
        onToggleSelect={() => onToggleSelect(card)}
        onStartSelect={() => onStartSelect(card)}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  gridCell: {
    marginBottom: GRID_GAP,
  },
  // Half-gap on each column edge — a full GAP marginRight on the left
  // cell alone left ~6pt of dead space at the right screen edge.
  gridCellLeft: {
    marginRight: GRID_GAP / 2,
  },
  gridCellRight: {
    marginLeft: GRID_GAP / 2,
  },
});
