import { memo, useMemo } from 'react';
import { useRecyclingState } from '@shopify/flash-list';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import { NumericStepper } from './NumericStepper';
import { SetBadge } from './SetBadge';
import { CardImageViewer } from './CardImageViewer';
import { displayCardName } from '../scanner/services/catalog/catalogMatcher';
import { getCatalogImageUri } from '../services/CatalogImageService';
import { useShowVendorStore } from '../store/showVendorStore';
import type { InventoryCard } from '../store/inventoryStore';

type Props = {
  showId: string;
  card: InventoryCard;
};

const THUMB_HEIGHT = 80;
const THUMB_WIDTH = 58;

export const ShowVendorInventoryRow = memo(function ShowVendorInventoryRow({
  showId,
  card,
}: Props) {
  const imageUrl = useMemo(() => getCatalogImageUri(card.productId), [card.productId]);
  const [imageError, setImageError] = useRecyclingState(false, [card.id, imageUrl]);
  const [viewerOpen, setViewerOpen] = useRecyclingState(false, [card.id]);

  const isSelected = useShowVendorStore((state) => !!state.selections[showId]?.[card.id]);
  const selection = useShowVendorStore((state) => state.selections[showId]?.[card.id] ?? null);
  const toggleCardSelection = useShowVendorStore((state) => state.toggleCardSelection);
  const updateSelection = useShowVendorStore((state) => state.updateSelection);

  const meta = [card.number, card.productType ?? card.rarity, card.condition]
    .filter(Boolean)
    .join(' · ');

  const handleToggle = () => {
    toggleCardSelection(showId, card);
  };

  const handleQuantity = (value: number) => {
    updateSelection(showId, card.id, { quantity: value });
  };

  const handlePrice = (value: number) => {
    updateSelection(showId, card.id, { stickerPrice: value });
  };

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={handleToggle}
        style={[styles.row, isSelected && styles.rowSelected]}
      >
        <View style={styles.checkWrap}>
          <View style={[styles.check, isSelected && styles.checkSelected]}>
            {isSelected && <Ionicons name="checkmark" size={14} color={colors.background} />}
          </View>
        </View>

        {/* Thumb tap opens the card viewer; the row tap still toggles
          selection — the inner touchable wins. */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => setViewerOpen(true)}
          hitSlop={4}
          accessibilityLabel={`View ${displayCardName(card.name)} image`}
          accessibilityRole="imagebutton"
        >
          {imageUrl && !imageError ? (
            <Image
              source={{ uri: imageUrl }}
              recyclingKey={card.id}
              style={styles.thumb}
              contentFit="contain"
              cachePolicy="memory-disk"
              onError={() => setImageError(true)}
            />
          ) : (
            <View style={[styles.thumb, styles.fallbackThumb]}>
              <Ionicons name="image-outline" size={24} color={colors.textMuted} />
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>
            {displayCardName(card.name)}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
          <SetBadge set={card.set} style={styles.setBadge} />

          {isSelected && selection ? (
            <View style={styles.inputs}>
              <View style={styles.stepper}>
                <NumericStepper
                  label="Qty"
                  value={selection.quantity}
                  step={1}
                  min={1}
                  max={Math.max(1, card.stock)}
                  decimalPlaces={0}
                  onChange={handleQuantity}
                />
              </View>
              <View style={styles.stepper}>
                <NumericStepper
                  label="Show price"
                  value={selection.stickerPrice}
                  step={0.25}
                  min={0}
                  decimalPlaces={2}
                  onChange={handlePrice}
                />
              </View>
            </View>
          ) : (
            <Text style={styles.price}>
              {`$${(selection?.stickerPrice ?? card.stickerPrice).toFixed(2)}`}
            </Text>
          )}
        </View>
      </TouchableOpacity>
      <CardImageViewer
        visible={viewerOpen}
        uri={imageUrl}
        name={displayCardName(card.name)}
        onClose={() => setViewerOpen(false)}
      />
    </>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.overlay2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    padding: 12,
    marginBottom: 10,
    minHeight: 100,
  },
  rowSelected: {
    borderColor: colors.primary,
    borderWidth: 1,
    backgroundColor: colors.primarySoft,
  },
  checkWrap: {
    marginRight: 12,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  thumb: {
    width: THUMB_WIDTH,
    height: THUMB_HEIGHT,
    borderRadius: 6,
    backgroundColor: colors.background,
  },
  fallbackThumb: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  info: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  name: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  meta: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  setBadge: {
    marginTop: 4,
  },
  price: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  inputs: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
  },
  stepper: {
    flex: 1,
  },
});
