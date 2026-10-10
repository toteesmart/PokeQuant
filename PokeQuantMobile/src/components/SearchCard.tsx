import { Ionicons } from '@expo/vector-icons';
import { memo, useEffect, useMemo } from 'react';
import { useRecyclingState } from '@shopify/flash-list';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import type { SQLiteDatabase } from 'expo-sqlite';
import { colors } from '../constants/colors';
import { useVendorStore } from '../store/vendorStore';
import { useProgressStore } from '../store/progressStore';
import {
  getCardMarketAnalytics,
  type CardMarketAnalytics,
  type CatalogCard,
} from '../db/catalogDb';
import { CardImageViewer } from './CardImageViewer';
import { JpBadge } from './JpBadge';
import { SetBadge } from './SetBadge';
import { displayCardName } from '../scanner/services/catalog/catalogMatcher';
import { isJpSetName } from '../utils/jp';

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

const ACTION_BLUE = '#1f6feb';
const DELTA_GREEN = '#3fb950';

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

export type SearchLogPayload = {
  productId: number;
  cardName: string;
  cardNumber: string;
  setName: string;
  variant: string;
  condition: string;
  liveMarket: number;
  cashOffer: number;
  stickerPrice: number;
  imageUrl?: string;
};

type Props = {
  card: CatalogCard;
  width: number;
  catalogDb: SQLiteDatabase | null;
  onAnalyze: (card: CatalogCard, variant: string) => void;
  onLogToInventory: (payload: SearchLogPayload) => void;
};

function CardImage({
  imageUrl,
  name,
  set,
  width,
  height,
}: {
  imageUrl?: string;
  name: string;
  set?: string;
  width: number;
  height: number;
}) {
  const [hasError, setHasError] = useRecyclingState(false, [imageUrl]);

  if (imageUrl && !hasError && width > 0 && height > 0) {
    return (
      <View style={[styles.thumb, { width, height }]}>
        <Image
          source={{ uri: imageUrl }}
          recyclingKey={imageUrl}
          style={{ width: '100%', height: '100%' }}
          contentFit="contain"
          cachePolicy="memory-disk"
          onError={() => setHasError(true)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.thumb, styles.fallbackThumb, { width, height }]}>
      <Ionicons name="image-outline" size={28} color={colors.textMuted} />
      <Text style={styles.fallbackName} numberOfLines={2}>
        {name}
      </Text>
      {set ? (
        <Text style={styles.fallbackSet} numberOfLines={1}>
          {set}
        </Text>
      ) : null}
    </View>
  );
}

export const SearchCard = memo(function SearchCard({
  card,
  width,
  catalogDb,
  onAnalyze,
  onLogToInventory,
}: Props) {
  const getConditionedMarket = useVendorStore(
    (state) => state.getConditionedMarket
  );
  const getCashOffer = useVendorStore((state) => state.getCashOffer);
  const getStickerPrice = useVendorStore((state) => state.getStickerPrice);
  const isExtracting = useProgressStore((state) => state.isExtracting);

  const variantOptions = useMemo(() => {
    if (card.variants.length > 0) {
      return card.variants.map((v) => v.subType);
    }
    return [card.productType || 'Normal'];
  }, [card.variants, card.productType]);

  const [viewerOpen, setViewerOpen] = useRecyclingState(false, [card.id]);
  const [selectedVariant, setSelectedVariant] = useRecyclingState(
    variantOptions[0] || 'Normal',
    [card.id]
  );
  const [condition, setCondition] = useRecyclingState('NM', [card.id]);
  const [analytics, setAnalytics] =
    useRecyclingState<CardMarketAnalytics | null>(null, [card.id, selectedVariant]);

  useEffect(() => {
    if (!variantOptions.includes(selectedVariant)) {
      setSelectedVariant(variantOptions[0] || 'Normal');
    }
  }, [variantOptions, selectedVariant]);

  useEffect(() => {
    if (!catalogDb || isExtracting) {
      setAnalytics(null);
      return;
    }

    let cancelled = false;
    setAnalytics(null);

    getCardMarketAnalytics(catalogDb, card.productId, selectedVariant)
      .then((data) => {
        if (!cancelled) setAnalytics(data);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Failed to load card market analytics:', err);
          setAnalytics(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [catalogDb, card.productId, selectedVariant, isExtracting]);

  const baseMarket =
    analytics?.marketPrice ??
    card.variants.find((v) => v.subType === selectedVariant)?.marketPrice ??
    card.liveMarket;
  const conditionedMarket = getConditionedMarket(baseMarket, condition);
  const cashOffer = getCashOffer(conditionedMarket);
  const stickerPrice = getStickerPrice(conditionedMarket);
  const buyPercentage =
    conditionedMarket > 0 ? (cashOffer / conditionedMarket) * 100 : 0;

  const imageWidth = Math.max(0, width - 20);
  const imageHeight =
    imageWidth > 0
      ? Math.max(1, Math.min(130, imageWidth / CARD_ASPECT_RATIO))
      : 1;

  const handleLogToInventory = () => {
    onLogToInventory({
      productId: card.productId,
      cardName: card.name,
      cardNumber: card.number,
      setName: card.set,
      variant: selectedVariant,
      condition,
      liveMarket: conditionedMarket,
      cashOffer,
      stickerPrice,
      imageUrl: card.imageUrl,
    });
  };

  const displaySubType = analytics?.subType || selectedVariant;
  const displayName = displayCardName(card.name);

  const canTrade = conditionedMarket > 0 && cashOffer > 0;

  return (
    <View style={[styles.card, { width, minHeight: 350 }]}>
      <View style={styles.topSection}>
        <View style={styles.imageWrap}>
          <TouchableOpacity
            activeOpacity={0.9}
            disabled={!card.imageUrl}
            onPress={() => setViewerOpen(true)}>
            <CardImage
              imageUrl={card.imageUrl}
              name={displayName}
              set={card.set}
              width={imageWidth}
              height={imageHeight}
            />
          </TouchableOpacity>
        </View>

        <View style={styles.nameRow}>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => onAnalyze(card, selectedVariant)}>
            <Text style={styles.cardName} numberOfLines={1}>
              {displayName}
            </Text>
          </TouchableOpacity>
          {isJpSetName(card.set) ? <JpBadge /> : null}
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {card.number} · {card.rarity}
        </Text>
        <SetBadge set={card.set} style={styles.setBadge} />
        <Text style={styles.variant} numberOfLines={1}>
          {displaySubType} · {CONDITION_LABELS[condition] || condition}
        </Text>

        <View style={styles.metrics}>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Market</Text>
            <Text style={styles.metricValue}>
              {formatCurrency(conditionedMarket)}
            </Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Offer</Text>
            <Text style={styles.offerValue}>
              {formatCurrency(cashOffer)}
            </Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Buy %</Text>
            <Text style={styles.metricValue}>
              {buyPercentage.toFixed(1)}%
            </Text>
          </View>
        </View>

      </View>

      <View style={styles.bottomSection}>
        {variantOptions.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.selectorRow}>
            {variantOptions.map((variant) => {
              const active = variant === selectedVariant;
              return (
                <TouchableOpacity
                  key={variant}
                  style={[styles.selectorPill, active && styles.selectorPillActive]}
                  activeOpacity={0.7}
                  onPress={() => setSelectedVariant(variant)}>
                  <Text
                    style={[
                      styles.selectorPillText,
                      active && styles.selectorPillTextActive,
                    ]}
                    numberOfLines={1}>
                    {variant}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        <View style={styles.conditionRow}>
          {CONDITION_CODES.map((code) => {
            const active = code === condition;
            return (
              <TouchableOpacity
                key={code}
                style={[
                  styles.conditionPill,
                  active && styles.conditionPillActive,
                ]}
                activeOpacity={0.7}
                onPress={() => setCondition(code)}>
                <Text
                  style={[
                    styles.conditionPillText,
                    active && styles.conditionPillTextActive,
                  ]}>
                  {code}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[
              styles.actionButton,
              styles.logButton,
              !canTrade && styles.actionButtonDisabled,
            ]}
            activeOpacity={canTrade ? 0.7 : 1}
            onPress={handleLogToInventory}
            disabled={!canTrade}>
            <Text style={styles.logButtonText}>Log to Inventory</Text>
          </TouchableOpacity>
        </View>
      </View>

      <CardImageViewer
        visible={viewerOpen}
        uri={card.imageUrl}
        name={displayName}
        caption={[card.number, card.set, card.rarity].filter(Boolean).join(' · ')}
        onClose={() => setViewerOpen(false)}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#161b22',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#30363d',
    padding: 10,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  topSection: {
    width: '100%',
    alignItems: 'center',
  },
  bottomSection: {
    width: '100%',
    gap: 6,
  },
  imageWrap: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 8,
  },
  thumb: {
    backgroundColor: '#0e1117',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  fallbackThumb: {
    borderWidth: 1,
    borderColor: '#30363d',
    padding: 8,
  },
  fallbackName: {
    color: '#c9d1d9',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 6,
  },
  fallbackSet: {
    color: '#8b949e',
    fontSize: 10,
    textAlign: 'center',
    marginTop: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  cardName: {
    color: '#c9d1d9',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 2,
    textAlign: 'center',
    flexShrink: 1,
    textDecorationLine: 'underline',
  },
  meta: {
    color: '#8b949e',
    fontSize: 10,
    lineHeight: 12,
    textAlign: 'center',
  },
  setBadge: {
    marginTop: 3,
  },
  variant: {
    color: '#8b949e',
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 2,
  },
  metrics: {
    width: '100%',
    marginTop: 8,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 1,
  },
  metricLabel: {
    color: '#8b949e',
    fontSize: 11,
  },
  metricValue: {
    color: '#c9d1d9',
    fontSize: 11,
    fontWeight: 'bold',
  },
  offerValue: {
    color: DELTA_GREEN,
    fontSize: 11,
    fontWeight: 'bold',
  },
  selectorRow: {
    alignItems: 'center',
    height: 34,
    gap: 4,
  },
  selectorPill: {
    backgroundColor: '#0e1117',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#30363d',
    paddingHorizontal: 8,
    paddingVertical: 6,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectorPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  selectorPillText: {
    color: '#c9d1d9',
    fontSize: 10,
    fontWeight: '500',
  },
  selectorPillTextActive: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
  conditionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 34,
    gap: 4,
  },
  conditionPill: {
    flex: 1,
    backgroundColor: '#0e1117',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#30363d',
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  conditionPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  conditionPillText: {
    color: '#c9d1d9',
    fontSize: 10,
    fontWeight: '600',
  },
  conditionPillTextActive: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
  actions: {
    gap: 6,
    marginTop: 4,
  },
  actionButton: {
    height: 34,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionButtonDisabled: {
    opacity: 0.4,
  },
  logButton: {
    backgroundColor: ACTION_BLUE,
  },
  logButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
});
