// FinishChip — one print-finish choice in MatchReviewSheet (Normal /
// Holofoil / Reverse Holofoil…): subtype label + market price, a deal
// signal dot when the variant is rated, selected ring on the active
// finish. Selection lives in the sheet; `rated` derives from the
// variant's own signal stamp.

import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { classifyDeal } from '../services/deal/dealClassify';
import type { ScanCatalogVariant } from '../types/catalog';
import { styles } from './matchReviewSheetStyles';

type Props = {
  variant: ScanCatalogVariant;
  selected: boolean;
  onPress: (subType: string) => void;
};

export const FinishChip = memo(function FinishChip({ variant, selected, onPress }: Props) {
  const rated = variant.signal?.action && variant.signal.action !== 'UNRATED';
  return (
    <Pressable
      onPress={() => onPress(variant.subType)}
      style={[styles.finishChip, selected && styles.finishChipSelected]}
    >
      <View style={styles.finishChipLabel}>
        {rated ? (
          <View
            style={[
              styles.signalDot,
              {
                backgroundColor: classifyDeal(variant.signal).color,
              },
            ]}
          />
        ) : null}
        <Text style={styles.finishChipText} numberOfLines={1}>
          {variant.subType}
        </Text>
      </View>
      <Text style={styles.finishChipPrice}>${variant.marketPrice.toFixed(2)}</Text>
    </Pressable>
  );
});
