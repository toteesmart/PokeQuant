import { Ionicons } from '@expo/vector-icons';
import { memo, useEffect, useMemo, useState } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors } from '../constants/colors';
import { Dropdown } from '../components/Dropdown';
import { useVendorStore } from '../store/vendorStore';
import type { CartItemInput } from '../store/cartStore';
import type { CatalogCard } from '../db/catalogDb';

const CARD_ASPECT_WIDTH = 2.5;
const CARD_ASPECT_HEIGHT = 3.5;
const CARD_ASPECT_RATIO = CARD_ASPECT_WIDTH / CARD_ASPECT_HEIGHT;

const CONDITION_CODES = ['NM', 'LP', 'MP', 'HP', 'DMG'];
const CONDITION_LABELS: Record<string, string> = {
  NM: 'Near Mint',
  LP: 'Lightly Played',
  MP: 'Moderately Played',
  HP: 'Heavily Played',
  DMG: 'Damaged',
};

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

type Props = {
  card: CatalogCard;
  width: number;
  marginHorizontal: number;
  onAddToLot: (item: CartItemInput) => void;
  onLogToInventory?: (
    card: CatalogCard,
    variant: string,
    condition: string
  ) => void;
};

function CardImage({
  imageUrl,
  name,
  maxWidth,
  maxHeight,
}: {
  imageUrl?: string;
  name: string;
  maxWidth: number;
  maxHeight: number;
}) {
  const [hasError, setHasError] = useState(false);

  const naturalHeight = maxWidth / CARD_ASPECT_RATIO;
  const imageHeight = Math.max(1, Math.min(maxHeight, naturalHeight));
  const imageWidth = Math.max(1, imageHeight * CARD_ASPECT_RATIO);

  if (imageUrl && !hasError) {
    return (
      <View
        style={[styles.thumb, { width: imageWidth, height: imageHeight }]}
      >
        <Image
          source={{ uri: imageUrl }}
          style={{ width: imageWidth, height: imageHeight }}
          resizeMode="contain"
          onError={() => setHasError(true)}
        />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.thumb,
        styles.fallbackThumb,
        { width: imageWidth, height: imageHeight },
      ]}>
      <Ionicons name="image-outline" size={36} color={colors.textMuted} />
      <Text style={styles.fallbackName} numberOfLines={2}>
        {name}
      </Text>
    </View>
  );
}

export const SearchResultCard = memo(function SearchResultCard({
  card,
  width,
  marginHorizontal,
  onAddToLot,
  onLogToInventory,
}: Props) {
  const getConditionedMarket = useVendorStore(
    (state) => state.getConditionedMarket
  );
  const getCashOffer = useVendorStore((state) => state.getCashOffer);
  const [expanded, setExpanded] = useState(false);

  const variantOptions = useMemo(() => {
    if (card.variants.length > 0) {
      return card.variants.map((variant) => variant.subType);
    }
    return [card.productType || 'Normal'];
  }, [card.variants, card.productType]);

  const [selectedVariant, setSelectedVariant] = useState(
    variantOptions[0] || 'Normal'
  );
  const [condition, setCondition] = useState('NM');

  useEffect(() => {
    if (!variantOptions.includes(selectedVariant)) {
      setSelectedVariant(variantOptions[0] || 'Normal');
    }
  }, [variantOptions, selectedVariant]);

  const selectedVariantData = card.variants.find(
    (variant) => variant.subType === selectedVariant
  );
  const baseMarket = selectedVariantData?.marketPrice ?? card.liveMarket;
  const conditionedMarket = getConditionedMarket(baseMarket, condition);
  const cashOffer = getCashOffer(conditionedMarket);
  const buyPercentage =
    conditionedMarket > 0 ? (cashOffer / conditionedMarket) * 100 : 0;

  const handleAddToLot = () => {
    onAddToLot({
      productId: card.productId,
      cardName: card.name,
      cardNumber: card.number,
      setName: card.set,
      variant: selectedVariant,
      condition,
      marketPrice: conditionedMarket,
      cashOffer,
      imageUrl: card.imageUrl,
    });
  };

  const handleLogToInventory = () => {
    onLogToInventory?.(card, selectedVariant, condition);
  };

  const imageWidth = Math.max(0, width - 24);
  const maxImageHeight = 220;

  return (
    <View style={[styles.card, { width, marginHorizontal }]}>
      <View style={styles.topBlock}>
        <View style={styles.imageContainer}>
          <CardImage
            imageUrl={card.imageUrl}
            name={card.name}
            maxWidth={imageWidth}
            maxHeight={maxImageHeight}
          />
        </View>
        <Text style={styles.cardName} numberOfLines={1}>
          {card.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {card.number} · {card.set} · {card.rarity}
        </Text>
        <Text style={styles.variant} numberOfLines={1}>
          {selectedVariant}
        </Text>
      </View>

      <View style={styles.metrics}>
        <View style={styles.metricRow}>
          <Text style={styles.metricLabel}>Market</Text>
          <Text style={styles.metricValue}>{formatCurrency(baseMarket)}</Text>
        </View>
        <View style={styles.metricRow}>
          <Text style={styles.metricLabel}>Offer</Text>
          <Text style={styles.offerValue}>{formatCurrency(cashOffer)}</Text>
        </View>
        <View style={styles.metricRow}>
          <Text style={styles.metricLabel}>Buy %</Text>
          <Text style={styles.metricValue}>{buyPercentage.toFixed(1)}%</Text>
        </View>
      </View>

      {!expanded ? (
        <View style={styles.actionsCollapsed}>
          <TouchableOpacity
            style={[styles.actionButton, styles.configureButton]}
            activeOpacity={0.7}
            onPress={() => setExpanded(true)}>
            <Text style={styles.configureText}>Configure</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.addButton]}
            activeOpacity={0.7}
            onPress={handleAddToLot}>
            <Text style={styles.addButtonText}>Add to Lot</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.actionsExpanded}>
          <View style={styles.selectorRow}>
            <View style={styles.selector}>
              <Dropdown
                label="Variant"
                options={variantOptions}
                value={selectedVariant}
                onChange={setSelectedVariant}
              />
            </View>
            <View style={styles.selector}>
              <Dropdown
                label="Condition"
                options={CONDITION_CODES}
                value={condition}
                onChange={setCondition}
                labels={CONDITION_LABELS}
              />
            </View>
          </View>
          <TouchableOpacity
            style={[styles.actionButton, styles.addButton]}
            activeOpacity={0.7}
            onPress={handleAddToLot}>
            <Text style={styles.addButtonText}>Add to Lot</Text>
          </TouchableOpacity>
          {onLogToInventory && (
            <TouchableOpacity
              style={[styles.actionButton, styles.inventoryButton]}
              activeOpacity={0.7}
              onPress={handleLogToInventory}>
              <Text style={styles.inventoryButtonText}>Log to Inventory</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.collapseButton}
            activeOpacity={0.7}
            onPress={() => setExpanded(false)}>
            <Text style={styles.collapseText}>Collapse</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 12,
  },
  topBlock: {
    marginBottom: 8,
    alignItems: 'center',
  },
  imageContainer: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 8,
  },
  thumb: {
    backgroundColor: colors.surfaceLight,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  fallbackThumb: {
    backgroundColor: '#1f242c',
    borderWidth: 1,
    borderColor: '#30363d',
    padding: 8,
  },
  fallbackName: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 8,
  },
  cardName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: 'bold',
    marginBottom: 2,
    textAlign: 'center',
  },
  meta: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 13,
    textAlign: 'center',
  },
  variant: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 2,
  },
  metrics: {
    marginBottom: 8,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  metricLabel: {
    color: colors.metricLabel,
    fontSize: 12,
  },
  metricValue: {
    color: colors.text,
    fontSize: 12,
    fontWeight: 'bold',
  },
  offerValue: {
    color: colors.success,
    fontSize: 12,
    fontWeight: 'bold',
  },
  actionsCollapsed: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  actionsExpanded: {
    gap: 6,
  },
  selectorRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  selector: {
    flex: 1,
  },
  actionButton: {
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  configureButton: {
    flex: 1,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
  },
  configureText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  addButton: {
    flex: 1,
    backgroundColor: colors.success,
  },
  addButtonText: {
    color: colors.background,
    fontSize: 13,
    fontWeight: 'bold',
  },
  inventoryButton: {
    backgroundColor: colors.primary,
  },
  inventoryButtonText: {
    color: colors.background,
    fontSize: 13,
    fontWeight: 'bold',
  },
  collapseButton: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  collapseText: {
    color: colors.textMuted,
    fontSize: 12,
  },
});
