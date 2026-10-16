import { Ionicons } from '@expo/vector-icons';
import { memo, useEffect, useMemo } from 'react';
import { useRecyclingState } from '@shopify/flash-list';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import type { SQLiteDatabase } from 'expo-sqlite';
import { colors } from '../constants/colors';
import { CARD_ASPECT_RATIO, radius } from '../constants/theme';
import { formatCurrency } from '../utils/format';
import { useVendorStore } from '../store/vendorStore';
import { useProgressStore } from '../store/progressStore';
import {
  getCardMarketAnalytics,
  type CardMarketAnalytics,
  type CatalogCard,
} from '../db/catalogDb';
import { CardImageViewer } from './CardImageViewer';
import { AppButton } from './ui';
import { JpBadge } from './JpBadge';
import { SetBadge } from './SetBadge';
import { displayCardName } from '../scanner/services/catalog/catalogMatcher';
import { isJpSetName } from '../utils/jp';

const CONDITION_CODES = ['NM', 'LP', 'MP', 'HP', 'DMG'];
const CONDITION_LABELS: Record<string, string> = {
  NM: 'Near Mint',
  LP: 'Lightly Played',
  MP: 'Moderately Played',
  HP: 'Heavily Played',
  DMG: 'Damaged',
};

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
  const getConditionedMarket = useVendorStore((state) => state.getConditionedMarket);
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
  const [selectedVariant, setSelectedVariant] = useRecyclingState(variantOptions[0] || 'Normal', [
    card.id,
  ]);
  const [condition, setCondition] = useRecyclingState('NM', [card.id]);
  const [analytics, setAnalytics] = useRecyclingState<CardMarketAnalytics | null>(null, [
    card.id,
    selectedVariant,
  ]);

  useEffect(() => {
    if (!variantOptions.includes(selectedVariant)) {
      setSelectedVariant(variantOptions[0] || 'Normal');
    }
  }, [variantOptions, selectedVariant, setSelectedVariant]);

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
  }, [catalogDb, card.productId, selectedVariant, isExtracting, setAnalytics]);

  const baseMarket =
    analytics?.marketPrice ??
    card.variants.find((v) => v.subType === selectedVariant)?.marketPrice ??
    card.liveMarket;
  const conditionedMarket = getConditionedMarket(baseMarket, condition);
  const cashOffer = getCashOffer(conditionedMarket);
  const stickerPrice = getStickerPrice(conditionedMarket);
  const buyPercentage = conditionedMarket > 0 ? (cashOffer / conditionedMarket) * 100 : 0;

  const imageWidth = Math.max(0, width - 24);
  const imageHeight =
    imageWidth > 0 ? Math.max(1, Math.min(130, imageWidth / CARD_ASPECT_RATIO)) : 1;

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
            onPress={() => setViewerOpen(true)}
            accessibilityLabel={`View ${displayName} image`}
            accessibilityRole="imagebutton"
          >
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
            onPress={() => onAnalyze(card, selectedVariant)}
            style={styles.cardNameLink}
            accessibilityLabel={`Analyze ${displayName}`}
            accessibilityRole="button"
          >
            <Text style={styles.cardName} numberOfLines={1}>
              {displayName}
            </Text>
            <Ionicons name="analytics-outline" size={13} color={colors.primary} />
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
          {/* Your cash offer vs market — green when you're paying
              under market, red when the offer meets or beats it. */}
          <View
            style={[
              styles.metricsAccent,
              {
                backgroundColor:
                  conditionedMarket > 0 && cashOffer < conditionedMarket
                    ? colors.velocityPositive
                    : conditionedMarket > 0 && cashOffer >= conditionedMarket
                      ? colors.velocityNegative
                      : colors.textMuted,
              },
            ]}
          />
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Market price</Text>
            <Text style={styles.metricValue}>{formatCurrency(conditionedMarket)}</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Your offer</Text>
            <Text
              style={[
                styles.metricValue,
                {
                  color:
                    conditionedMarket > 0 && cashOffer < conditionedMarket
                      ? colors.velocityPositive
                      : conditionedMarket > 0 && cashOffer >= conditionedMarket
                        ? colors.velocityNegative
                        : colors.text,
                },
              ]}
            >
              {formatCurrency(cashOffer)}
            </Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Offer vs market</Text>
            <Text style={styles.metricValue}>{buyPercentage.toFixed(1)}%</Text>
          </View>
        </View>
      </View>

      <View style={styles.bottomSection}>
        {variantOptions.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.selectorRow}
          >
            {variantOptions.map((variant) => {
              const active = variant === selectedVariant;
              return (
                <TouchableOpacity
                  key={variant}
                  style={[styles.selectorPill, active && styles.selectorPillActive]}
                  activeOpacity={0.7}
                  hitSlop={8}
                  accessibilityRole="button"
                  onPress={() => setSelectedVariant(variant)}
                >
                  <Text
                    style={[styles.selectorPillText, active && styles.selectorPillTextActive]}
                    numberOfLines={1}
                  >
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
                style={[styles.conditionPill, active && styles.conditionPillActive]}
                activeOpacity={0.7}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Condition ${code}`}
                onPress={() => setCondition(code)}
              >
                <Text style={[styles.conditionPillText, active && styles.conditionPillTextActive]}>
                  {code}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.actions}>
          <AppButton
            title="Add to inventory"
            onPress={handleLogToInventory}
            disabled={!canTrade}
            size="sm"
          />
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
    backgroundColor: colors.overlay2,
    borderRadius: radius.cardLg,
    padding: 12,
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
    backgroundColor: colors.background,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  fallbackThumb: {
    borderWidth: 1,
    borderColor: colors.border,
    padding: 8,
  },
  fallbackName: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 6,
  },
  fallbackSet: {
    color: colors.textMuted,
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
  cardNameLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
  },
  cardName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
    textAlign: 'center',
    flexShrink: 1,
    textDecorationLine: 'underline',
  },
  meta: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 12,
    textAlign: 'center',
  },
  setBadge: {
    marginTop: 3,
  },
  variant: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 2,
  },
  metrics: {
    width: '100%',
    marginTop: 8,
    backgroundColor: colors.overlay1,
    borderRadius: radius.controlLg,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  metricsAccent: {
    width: 24,
    height: 3,
    borderRadius: radius.pill,
    marginTop: 2,
    marginBottom: 6,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: 11,
  },
  metricValue: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '700',
  },
  selectorRow: {
    alignItems: 'center',
    height: 34,
    gap: 4,
  },
  selectorPill: {
    backgroundColor: colors.overlay3,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectorPillActive: {
    backgroundColor: colors.primaryActive,
  },
  selectorPillText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '500',
  },
  selectorPillTextActive: {
    color: colors.primary,
    fontWeight: '700',
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
    backgroundColor: colors.overlay3,
    borderRadius: radius.pill,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  conditionPillActive: {
    backgroundColor: colors.primaryActive,
  },
  conditionPillText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  conditionPillTextActive: {
    color: colors.primary,
    fontWeight: '700',
  },
  actions: {
    gap: 6,
    marginTop: 4,
  },
});
