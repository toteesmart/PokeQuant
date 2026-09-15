import { memo } from 'react';
import { useRecyclingState } from '@shopify/flash-list';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import type { EventInventoryItem } from '../db/eventCatalogDb';
import { CardImageViewer } from './CardImageViewer';
import { JpBadge } from './JpBadge';
import { isJpSetName } from '../utils/jp';

const CARD_ASPECT_WIDTH = 2.5;
const CARD_ASPECT_HEIGHT = 3.5;
const CARD_ASPECT_RATIO = CARD_ASPECT_WIDTH / CARD_ASPECT_HEIGHT;

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

type Props = {
  item: EventInventoryItem;
  width: number;
  height: number;
};

export const EventSearchCard = memo(function EventSearchCard({
  item,
  width,
  height,
}: Props) {
  const [imageError, setImageError] = useRecyclingState(false, [item.id, item.imageUrl]);
  const [viewerOpen, setViewerOpen] = useRecyclingState(false, [item.id]);

  const imageWidth = Math.max(0, width - 32);
  const imageHeight =
    imageWidth > 0
      ? Math.max(1, Math.min(120, imageWidth / CARD_ASPECT_RATIO))
      : 1;

  return (
    <View style={[styles.card, { width, height }]}>
      <View style={styles.topSection}>
        <TouchableOpacity
          style={styles.imageWrap}
          activeOpacity={0.9}
          disabled={!item.imageUrl || imageError}
          onPress={() => setViewerOpen(true)}>
          {item.imageUrl && !imageError ? (
            <Image
              source={{ uri: item.imageUrl }}
              recyclingKey={item.id}
              style={{ width: imageWidth, height: imageHeight }}
              contentFit="contain"
              cachePolicy="memory-disk"
              onError={() => setImageError(true)}
            />
          ) : (
            <View
              style={[
                styles.fallbackThumb,
                { width: imageWidth, height: imageHeight },
              ]}>
              <Ionicons name="image-outline" size={32} color={colors.textMuted} />
              <Text style={styles.fallbackName} numberOfLines={2}>
                {item.name}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {item.name}
          </Text>
          {isJpSetName(item.set) ? <JpBadge /> : null}
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {item.number} · {item.set} · {item.rarity}
        </Text>
        <Text style={styles.condition}>{item.condition}</Text>

        {(item.vendorName || item.vendorTable) && (
          <Text style={styles.vendor} numberOfLines={1}>
            {item.vendorName}
            {item.vendorName && item.vendorTable ? ` · ` : ''}
            {item.vendorTable}
          </Text>
        )}
      </View>

      <View style={styles.bottomSection}>
        <View style={styles.rowLine}>
          <Text style={styles.rowLabel}>Qty</Text>
          <Text style={styles.rowValue}>{item.quantity}</Text>
        </View>
        <View style={styles.priceRow}>
          <Text style={styles.priceLabel}>Sticker</Text>
          <Text style={styles.priceValue}>{formatCurrency(item.stickerPrice)}</Text>
        </View>
      </View>

      <CardImageViewer
        visible={viewerOpen}
        uri={item.imageUrl}
        name={item.name}
        caption={[item.number, item.set, item.condition]
          .filter(Boolean)
          .join(' · ')}
        onClose={() => setViewerOpen(false)}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  topSection: {
    width: '100%',
    alignItems: 'center',
  },
  imageWrap: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 6,
  },
  fallbackThumb: {
    backgroundColor: colors.background,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 6,
  },
  fallbackName: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 15,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  name: {
    color: colors.text,
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 1,
    textAlign: 'center',
    flexShrink: 1,
  },
  meta: {
    color: colors.textMuted,
    fontSize: 9,
    lineHeight: 11,
    textAlign: 'center',
  },
  condition: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 1,
  },
  vendor: {
    color: colors.primary,
    fontSize: 9,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 2,
  },
  rowLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginTop: 6,
    paddingHorizontal: 4,
  },
  rowLabel: {
    color: colors.textMuted,
    fontSize: 10,
  },
  rowValue: {
    color: colors.text,
    fontSize: 10,
    fontWeight: 'bold',
  },
  bottomSection: {
    width: '100%',
    marginTop: 'auto',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
    marginTop: 4,
  },
  priceLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  priceValue: {
    color: colors.success,
    fontSize: 12,
    fontWeight: 'bold',
  },
});
