import { memo, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { colors } from '../constants/colors';
import { getCatalogImageUri } from '../services/CatalogImageService';
import { SetBadge } from './SetBadge';
import { CardImageViewer } from './CardImageViewer';
import { displayCardName } from '../scanner/services/catalog/catalogMatcher';
import { formatCurrency } from '../utils/format';
import type { Mover } from '../services/portfolioVelocity';

export type { Mover } from '../services/portfolioVelocity';

export const MiniMoverCard = memo(function MiniMoverCard({
  mover,
}: {
  mover: Mover;
}) {
  const isUp = mover.newPrice >= mover.oldPrice;
  const [imageError, setImageError] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const imageUrl = useMemo(
    () => getCatalogImageUri(mover.productId),
    [mover.productId]
  );
  const canOpenViewer = Boolean(imageUrl) && !imageError;
  return (
    <View style={styles.moverCard}>
      <Pressable
        style={styles.moverImage}
        onPress={() => canOpenViewer && setViewerOpen(true)}
        disabled={!canOpenViewer}
        accessibilityLabel={`View ${displayCardName(mover.name)} image`}
        accessibilityRole="imagebutton">
        {imageUrl && !imageError ? (
          <Image
            source={{ uri: imageUrl }}
            style={styles.moverImageFill}
            contentFit="contain"
            cachePolicy="memory-disk"
            onError={() => setImageError(true)}
          />
        ) : (
          <Text style={styles.moverImageText}>No photo</Text>
        )}
      </Pressable>
      <Text style={styles.moverName} numberOfLines={2}>
        {displayCardName(mover.name)}
      </Text>
      <Text style={styles.moverNumber}>{mover.number}</Text>
      <SetBadge set={mover.set} style={styles.moverSetBadge} />
      <View style={styles.moverPillRow}>
        <View style={styles.moverPill}>
          <Text style={styles.moverPillText}>{mover.rarity}</Text>
        </View>
        <View style={styles.moverPill}>
          <Text style={styles.moverPillText}>{mover.condition}</Text>
        </View>
      </View>
      <View style={styles.shiftRow}>
        <Text style={styles.shiftLabel}>Sticker price</Text>
        <View style={styles.shiftPrices}>
          <Text style={styles.oldPrice}>{formatCurrency(mover.oldPrice)}</Text>
          <Text style={styles.shiftArrow}>→</Text>
          <Text
            style={[
              styles.newPrice,
              { color: isUp ? colors.success : colors.error },
            ]}>
            {formatCurrency(mover.newPrice)}
          </Text>
        </View>
      </View>
      <CardImageViewer
        visible={viewerOpen}
        uri={imageUrl}
        name={displayCardName(mover.name)}
        caption={`${mover.number} · ${mover.set}`}
        onClose={() => setViewerOpen(false)}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  moverCard: {
    width: 140,
    backgroundColor: colors.overlay2,
    borderRadius: 12,
    padding: 10,
    marginRight: 10,
  },
  moverImage: {
    height: 80,
    backgroundColor: colors.surfaceLight,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  moverImageFill: {
    width: '100%',
    height: '100%',
    marginBottom: 8,
  },
  moverImageText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  moverName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 1,
  },
  moverNumber: {
    color: colors.textMuted,
    fontSize: 10,
    marginBottom: 4,
  },
  moverSetBadge: {
    marginBottom: 6,
  },
  moverPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 6,
  },
  moverPill: {
    backgroundColor: colors.overlay4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 2,
    paddingHorizontal: 6,
    marginRight: 4,
    marginBottom: 3,
  },
  moverPillText: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '500',
  },
  shiftRow: {
    marginTop: 'auto',
  },
  shiftLabel: {
    color: colors.textMuted,
    fontSize: 9,
    marginBottom: 1,
  },
  shiftPrices: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  oldPrice: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  shiftArrow: {
    color: colors.textMuted,
    fontSize: 12,
    marginHorizontal: 3,
  },
  newPrice: {
    fontSize: 13,
    fontWeight: '700',
  },
});
