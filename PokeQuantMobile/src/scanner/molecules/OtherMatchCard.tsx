// OtherMatchCard — one switchable card row in MatchReviewSheet. Serves
// both the same-number variant list (selected ring + fused score) and
// the other-matches list (match confidence); the row shape is shared,
// only the score source and the selected ring differ.

import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { displayCardName } from '../services/catalog/catalogMatcher';
import { resolveCardImageUri } from '../services/catalog/ScannerCatalogProvider';
import type { ScanCatalogCard } from '../types/catalog';
import { SetBadge } from '../../components/SetBadge';
import { styles } from './matchReviewSheetStyles';

type Props = {
  card: ScanCatalogCard;
  /** 0..1 score — null renders the score slot empty (unscored variant). */
  score: number | null;
  selected?: boolean;
  onPress: () => void;
};

export const OtherMatchCard = memo(function OtherMatchCard({
  card,
  score,
  selected,
  onPress,
}: Props) {
  const imageUri = resolveCardImageUri(card);
  return (
    <Pressable onPress={onPress} style={[styles.altRow, selected && styles.altRowSelected]}>
      {imageUri ? (
        <Image
          source={{ uri: imageUri }}
          style={styles.altThumb}
          contentFit="contain"
          cachePolicy="memory-disk"
        />
      ) : (
        <View style={[styles.altThumb, styles.altThumbPlaceholder]} />
      )}
      <View style={styles.altInfo}>
        <Text style={styles.altName} numberOfLines={1}>
          {displayCardName(card.name)} · {card.number}
        </Text>
        <SetBadge set={card.set} style={styles.altSetBadge} />
      </View>
      <Text style={styles.altScore}>{score != null ? `${Math.round(score * 100)}% sure` : ''}</Text>
    </Pressable>
  );
});
