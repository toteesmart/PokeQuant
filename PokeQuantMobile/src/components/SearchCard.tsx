import { Ionicons } from '@expo/vector-icons';
import { memo, useEffect, useMemo } from 'react';
import { useRecyclingState } from '@shopify/flash-list';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { colors } from '../constants/colors';
import { useVendorStore } from '../store/vendorStore';
import { useProgressStore } from '../store/progressStore';
import {
  getCardMarketAnalytics,
  type CardMarketAnalytics,
  type CatalogCard,
} from '../db/catalogDb';
import type { CartItemInput } from '../context/CartContext';

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

type WindowKey = '1d' | '3d' | '7d' | '30d' | '90d';

const WINDOWS: { key: WindowKey; label: string }[] = [
  { key: '1d', label: '1D' },
  { key: '3d', label: '3D' },
  { key: '7d', label: '1W' },
  { key: '30d', label: '30D' },
  { key: '90d', label: '90D' },
];

const ACTION_GREEN = '#238636';
const ACTION_BLUE = '#1f6feb';
const DELTA_GREEN = '#3fb950';
const DELTA_RED = '#f85149';

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatSignedCurrency(value: number): string {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
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
  onAddToLot: (item: CartItemInput) => void;
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
          style={{ width: '100%', height: '100%' }}
          resizeMode="contain"
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
  onAddToLot,
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

  const [selectedVariant, setSelectedVariant] = useRecyclingState(
    variantOptions[0] || 'Normal',
    [card.id]
  );
  const [condition, setCondition] = useRecyclingState('NM', [card.id]);
  const [activeWindow, setActiveWindow] = useRecyclingState<WindowKey>(
    '1d',
    [card.id]
  );
  const [analytics, setAnalytics] =
    useRecyclingState<CardMarketAnalytics | null>(null, [card.id, selectedVariant]);
  const [loadingAnalytics, setLoadingAnalytics] = useRecyclingState(
    true,
    [card.id, selectedVariant]
  );

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
    setLoadingAnalytics(true);

    getCardMarketAnalytics(catalogDb, card.productId, selectedVariant)
      .then((data) => {
        if (!cancelled) setAnalytics(data);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Failed to load card market analytics:', err);
          setAnalytics(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingAnalytics(false);
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

  const windowMetric = useMemo(() => {
    if (!analytics) return null;
    switch (activeWindow) {
      case '1d':
        return {
          delta: analytics.delta1d,
          pct: analytics.delta1dPct,
        };
      case '3d':
        return {
          delta: analytics.delta3d,
          pct: analytics.delta3dPct,
        };
      case '7d':
        return {
          delta: analytics.delta7d,
          pct: analytics.delta7dPct,
        };
      case '30d':
        return {
          delta: analytics.delta30d,
          pct: analytics.delta30dPct,
        };
      case '90d':
        return null;
    }
  }, [analytics, activeWindow]);

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

  const canTrade = conditionedMarket > 0 && cashOffer > 0;

  return (
    <View style={[styles.card, { width, minHeight: 440 }]}>
      <View style={styles.topSection}>
        <View style={styles.imageWrap}>
          <CardImage
            imageUrl={card.imageUrl}
            name={card.name}
            set={card.set}
            width={imageWidth}
            height={imageHeight}
          />
        </View>

        <Text style={styles.cardName} numberOfLines={1}>
          {card.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {card.number} · {card.set} · {card.rarity}
        </Text>
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

        <View style={styles.velocityStrip}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.windowPillRow}>
            {WINDOWS.map((w) => {
              const active = w.key === activeWindow;
              return (
                <TouchableOpacity
                  key={w.key}
                  style={[styles.windowPill, active && styles.windowPillActive]}
                  activeOpacity={0.7}
                  onPress={() => setActiveWindow(w.key)}>
                  <Text
                    style={[
                      styles.windowPillText,
                      active && styles.windowPillTextActive,
                    ]}>
                    {w.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={styles.metricReadout}>
            {activeWindow === '90d' ? (
              <Text style={styles.rangeReadout}>
                <Text style={styles.highLowLabel}>H: </Text>
                {formatCurrency(analytics?.high90d ?? card.range90dHigh)}
                <Text style={styles.highLowSpacer}> / </Text>
                <Text style={styles.highLowLabel}>L: </Text>
                {formatCurrency(analytics?.low90d ?? card.range90dLow)}
              </Text>
            ) : windowMetric ? (
              <Text
                style={[
                  styles.deltaReadout,
                  { color: windowMetric.delta >= 0 ? DELTA_GREEN : DELTA_RED },
                ]}>
                {formatSignedCurrency(windowMetric.delta)}{' '}
                ({formatPercent(windowMetric.pct)})
              </Text>
            ) : (
              <Text style={styles.deltaReadout}>
                {loadingAnalytics ? 'Loading...' : '—'}
              </Text>
            )}
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
              styles.addButton,
              !canTrade && styles.actionButtonDisabled,
            ]}
            activeOpacity={canTrade ? 0.7 : 1}
            onPress={handleAddToLot}
            disabled={!canTrade}>
            <Text style={styles.addButtonText}>Add to Lot</Text>
          </TouchableOpacity>

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
  cardName: {
    color: '#c9d1d9',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 2,
    textAlign: 'center',
  },
  meta: {
    color: '#8b949e',
    fontSize: 10,
    lineHeight: 12,
    textAlign: 'center',
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
  velocityStrip: {
    width: '100%',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#30363d',
  },
  windowPillRow: {
    alignItems: 'center',
    height: 30,
    gap: 4,
  },
  windowPill: {
    backgroundColor: '#0e1117',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#30363d',
    paddingHorizontal: 7,
    paddingVertical: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  windowPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  windowPillText: {
    color: '#8b949e',
    fontSize: 10,
    fontWeight: '600',
  },
  windowPillTextActive: {
    color: '#ffffff',
  },
  metricReadout: {
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  deltaReadout: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  rangeReadout: {
    color: '#c9d1d9',
    fontSize: 12,
    fontWeight: 'bold',
  },
  highLowLabel: {
    color: '#8b949e',
    fontWeight: '600',
  },
  highLowSpacer: {
    color: '#8b949e',
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
  addButton: {
    backgroundColor: ACTION_GREEN,
  },
  addButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
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
