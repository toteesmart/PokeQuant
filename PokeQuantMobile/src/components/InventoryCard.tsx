import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useRecyclingState } from '@shopify/flash-list';
import {
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { colors } from '../constants/colors';
import { CARD_ASPECT_RATIO, radius } from '../constants/theme';
import {
  buildInventoryImageUrl,
  useInventoryStore,
  type InventoryCard as InventoryCardType,
} from '../store/inventoryStore';
import { formatCurrency, formatSignedCurrency } from '../utils/format';
import { CardImageViewer } from './CardImageViewer';
import { DeltaPill } from './ui';
import { JpBadge } from './JpBadge';
import { SetBadge } from './SetBadge';
import { displayCardName } from '../scanner/services/catalog/catalogMatcher';
import { isJpSetName } from '../utils/jp';
import { classifyDeal } from '../scanner/services/deal/dealClassify';
import { DealClassBadge } from '../scanner/atoms/DealClassBadge';
import type { CardSignal } from '../db/catalogDb';

type Props = {
  card: InventoryCardType;
  width: number;
  height?: number;
  onEdit: (card: InventoryCardType) => void;
  onAnalyze?: (card: InventoryCardType) => void;
  signal?: CardSignal;
  selecting?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onStartSelect?: () => void;
};

function MetricRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text
        style={[
          styles.metricValue,
          valueColor ? { color: valueColor } : undefined,
        ]}>
        {value}
      </Text>
    </View>
  );
}

function CardImage({
  imageUrl,
  productId,
  name,
  set,
  width,
  maxHeight,
}: {
  imageUrl?: string;
  productId?: number | null;
  name: string;
  set?: string;
  width: number;
  maxHeight: number;
}) {
  const resolvedUrl = useMemo(
    () => buildInventoryImageUrl(imageUrl, productId),
    [imageUrl, productId]
  );
  const [imageError, setImageError] = useRecyclingState(false, [resolvedUrl]);
  const { width: windowWidth } = useWindowDimensions();

  // React Native Image nodes collapse to 0x0 unless given a strictly defined
  // bounding box. Use the measured carousel width when available, and fall back
  // to a safe width derived from the screen so the first render is never empty.
  const safeMaxWidth = Math.max(
    1,
    width > 0 ? width : Math.max(0, windowWidth - 64)
  );
  const naturalHeight = safeMaxWidth / CARD_ASPECT_RATIO;
  const imageHeight = Math.max(1, Math.min(maxHeight, naturalHeight));
  const imageWidth = Math.max(1, imageHeight * CARD_ASPECT_RATIO);

  if (resolvedUrl && !imageError) {
    return (
      <View
        style={[styles.thumb, { width: imageWidth, height: imageHeight }]}>
        <Image
          source={{ uri: resolvedUrl }}
          recyclingKey={resolvedUrl}
          style={{ width: imageWidth, height: imageHeight }}
          contentFit="contain"
          cachePolicy="memory-disk"
          onError={() => setImageError(true)}
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
      {set ? (
        <Text style={styles.fallbackSet} numberOfLines={1}>
          {set}
        </Text>
      ) : null}
    </View>
  );
}

export const InventoryCard = memo(function InventoryCard({
  card,
  width,
  height,
  onEdit,
  onAnalyze,
  signal,
  selecting = false,
  selected = false,
  onToggleSelect,
  onStartSelect,
}: Props) {
  const removeInventoryCard = useInventoryStore(
    (state) => state.removeInventoryCard
  );
  const sellInventoryCard = useInventoryStore(
    (state) => state.sellInventoryCard
  );
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [viewerOpen, setViewerOpen] = useRecyclingState(false, [card.id]);
  const [confirmDelete, setConfirmDelete] = useRecyclingState(
    false,
    [card.id],
    () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }
  );

  const profitColor =
    card.projProfit >= 0 ? colors.velocityPositive : colors.velocityNegative;

  useFocusEffect(
    useCallback(() => {
      return () => {
        setConfirmDelete(false);
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
      };
    }, [setConfirmDelete])
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  const handleDelete = () => {
    if (confirmDelete) {
      removeInventoryCard(card.id);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
      timeoutRef.current = setTimeout(() => {
        setConfirmDelete(false);
        timeoutRef.current = null;
      }, 3500);
    }
  };

  const handleSell = () => sellInventoryCard(card.id);
  const handleEdit = () => onEdit(card);

  const { width: windowWidth } = useWindowDimensions();
  const safeCardWidth = width > 0 ? width : Math.max(0, windowWidth - 32);
  const resolvedHeight = height ?? 0;
  const safeCardHeight = resolvedHeight > 0 ? resolvedHeight : 360;
  const cardMinHeight = Math.max(safeCardHeight, 360);
  const imageWidth = Math.max(0, safeCardWidth - 32);
  const maxImageHeight = Math.min(260, cardMinHeight - 170);

  const variant = card.productType ?? card.rarity ?? 'Normal';
  const meta = [card.number, variant, card.condition]
    .filter(Boolean)
    .join(' · ');
  const viewerUri = buildInventoryImageUrl(card.imageUrl, card.productId);
  // Quant-signal badge — unrated cards still get a muted "Low data"
  // badge so the row shows a weak verdict in line with rated cards.
  const dealRead = useMemo(
    () => (signal ? classifyDeal(signal) : null),
    [signal]
  );

  return (
    <TouchableOpacity
      style={[
        styles.card,
        { width: safeCardWidth, minHeight: cardMinHeight },
        selected && styles.cardSelected,
      ]}
      activeOpacity={selecting ? 0.85 : 1}
      delayLongPress={350}
      onLongPress={onStartSelect}
      onPress={selecting ? onToggleSelect : undefined}>
      {selecting ? (
        <View style={[styles.selectBadge, selected && styles.selectBadgeOn]}>
          {selected ? (
            <Ionicons name="checkmark" size={12} color={colors.background} />
          ) : null}
        </View>
      ) : null}
      <View style={styles.body}>
        <TouchableOpacity
          activeOpacity={0.9}
          disabled={!viewerUri || selecting}
          onPress={() => setViewerOpen(true)}
          accessibilityLabel={`View ${displayCardName(card.name)} image`}
          accessibilityRole="imagebutton">
          <CardImage
            imageUrl={card.imageUrl}
            productId={card.productId}
            name={displayCardName(card.name)}
            set={card.set}
            width={imageWidth}
            maxHeight={maxImageHeight}
          />
        </TouchableOpacity>
        <View style={styles.details}>
          <View style={styles.nameRow}>
            {/* Name tap opens deal analysis in owner language. */}
            <Pressable
              onPress={() => onAnalyze?.(card)}
              disabled={selecting || !onAnalyze}
              hitSlop={4}
              style={styles.cardNameLinkWrap}>
              <Text
                style={[styles.cardName, onAnalyze && styles.cardNameLink]}
                numberOfLines={1}>
                {displayCardName(card.name)}
              </Text>
              {onAnalyze ? (
                <Ionicons
                  name="analytics-outline"
                  size={13}
                  color={colors.primary}
                />
              ) : null}
            </Pressable>
            {isJpSetName(card.set) ? <JpBadge /> : null}
          </View>
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
          <SetBadge set={card.set} style={styles.setBadge} />
          {dealRead ? (
            <DealClassBadge read={dealRead} style={styles.dealBadge} />
          ) : null}
          {/* Hero pair — sticker is the number, the profit-vs-paid delta
              rides beside it like the analysis sheet's DeltaPill. */}
          <View style={styles.stickerRow}>
            <Text style={styles.sticker}>{formatCurrency(card.stickerPrice)}</Text>
            <DeltaPill
              text={formatSignedCurrency(card.projProfit)}
              color={profitColor}
              icon={card.projProfit >= 0 ? 'caret-up' : 'caret-down'}
            />
          </View>

          <View style={styles.metrics}>
            <View
              style={[
                styles.metricsAccent,
                { backgroundColor: profitColor },
              ]}
            />
            <MetricRow label="Market now" value={formatCurrency(card.liveMarket)} />
            <MetricRow label="You paid" value={formatCurrency(card.amountPaid)} />
            <MetricRow label="In stock" value={String(card.stock)} />
          </View>
        </View>
      </View>

      {!selecting && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionButton, styles.actionSell]}
            activeOpacity={0.7}
            onPress={handleSell}
            accessibilityLabel={`Sell ${displayCardName(card.name)}`}
            accessibilityRole="button">
            <Ionicons name="cash-outline" size={14} color={colors.success} />
            <Text style={styles.sellText}>Sell</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.actionMain]}
            activeOpacity={0.7}
            onPress={handleEdit}
            accessibilityLabel={`Edit ${displayCardName(card.name)}`}
            accessibilityRole="button">
            <Ionicons name="pencil-outline" size={14} color={colors.text} />
            <Text style={styles.actionText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.actionButton,
              styles.actionDelete,
              confirmDelete && styles.actionDeleteConfirm,
            ]}
            activeOpacity={0.7}
            onPress={handleDelete}
            accessibilityLabel={`Delete ${displayCardName(card.name)}`}
            accessibilityRole="button">
            <Ionicons
              name="trash-outline"
              size={14}
              color={confirmDelete ? colors.background : colors.error}
            />
            <Text
              style={[
                styles.deleteText,
                confirmDelete && styles.deleteTextConfirm,
              ]}
              numberOfLines={1}>
              {confirmDelete ? 'Sure?' : 'Delete'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <CardImageViewer
        visible={viewerOpen}
        uri={viewerUri}
        name={displayCardName(card.name)}
        caption={meta}
        onClose={() => setViewerOpen(false)}
      />
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.overlay2,
    borderRadius: radius.cardLg,
    borderWidth: 1,
    borderColor: 'transparent',
    padding: 12,
    justifyContent: 'space-between',
  },
  cardSelected: {
    borderColor: colors.primary,
    borderWidth: 1,
    backgroundColor: colors.primarySoft,
  },
  selectBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.textMuted,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectBadgeOn: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  body: {
    flex: 1,
    width: '100%',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  thumb: {
    backgroundColor: colors.surfaceLight,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    overflow: 'hidden',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  fallbackThumb: {
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 8,
  },
  fallbackName: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 8,
  },
  fallbackSet: {
    color: colors.textMuted,
    fontSize: 10,
    textAlign: 'center',
    marginTop: 2,
  },
  details: {
    width: '100%',
    alignItems: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  cardName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 17,
    marginBottom: 2,
    flexShrink: 1,
  },
  cardNameLink: {
    textDecorationLine: 'underline',
    textDecorationColor: colors.textMuted,
  },
  cardNameLinkWrap: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dealBadge: {
    alignSelf: 'center',
    marginBottom: 4,
  },
  meta: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 13,
    marginBottom: 4,
  },
  setBadge: {
    marginBottom: 4,
  },
  stickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 8,
  },
  sticker: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
  },
  metrics: {
    width: '100%',
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
    marginVertical: 1,
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 13,
  },
  metricValue: {
    color: colors.text,
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    marginTop: 12,
    width: '100%',
    justifyContent: 'space-between',
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    gap: 5,
    borderRadius: radius.control,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  actionMain: {
    backgroundColor: colors.overlay3,
  },
  actionSell: {
    backgroundColor: colors.successTint,
  },
  sellText: {
    color: colors.success,
    fontSize: 12,
    fontWeight: '600',
  },
  actionDelete: {
    backgroundColor: colors.errorTint,
  },
  actionDeleteConfirm: {
    backgroundColor: colors.velocityNegative,
    borderColor: colors.velocityNegative,
  },
  actionText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  deleteText: {
    color: colors.error,
    fontSize: 12,
    fontWeight: '600',
  },
  deleteTextConfirm: {
    color: colors.background,
    fontWeight: '700',
  },
});
