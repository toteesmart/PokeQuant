import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { colors } from '../constants/colors';
import { formatCurrency } from '../utils/formatCurrency';
import type { TestCatalogCard } from '../types/catalog';

const CARD_ASPECT_WIDTH = 2.5;
const CARD_ASPECT_HEIGHT = 3.5;
const CARD_ASPECT_RATIO = CARD_ASPECT_WIDTH / CARD_ASPECT_HEIGHT;

type Props = {
  card: TestCatalogCard;
  width: number;
};

export const CatalogCardItem = memo(function CatalogCardItem({ card, width }: Props) {
  const imageHeight = Math.max(1, Math.min(180, width / CARD_ASPECT_RATIO));
  const variant = card.variants[0];
  const marketPrice = variant?.marketPrice ?? 0;

  return (
    <View style={[styles.container, { width }]}>
      <Image
        source={{ uri: card.imageUrl }}
        style={[styles.image, { width, height: imageHeight }]}
        contentFit="contain"
        cachePolicy="memory-disk"
      />
      <Text style={styles.name} numberOfLines={2}>
        {card.name}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {card.number} · {card.set}
      </Text>
      <Text style={styles.rarity} numberOfLines={1}>
        {card.rarity || 'Unknown'}
      </Text>
      {marketPrice > 0 ? (
        <Text style={styles.price}>{formatCurrency(marketPrice)}</Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 8,
    margin: 6,
    alignItems: 'center',
  },
  image: {
    borderRadius: 6,
    backgroundColor: colors.surfaceLight,
  },
  name: {
    color: colors.text,
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 8,
  },
  meta: {
    color: colors.textMuted,
    fontSize: 10,
    textAlign: 'center',
    marginTop: 2,
  },
  rarity: {
    color: colors.textMuted,
    fontSize: 10,
    textAlign: 'center',
    marginTop: 2,
  },
  price: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: 'bold',
    marginTop: 4,
  },
});
