import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useRecyclingState } from '@shopify/flash-list';
import {
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
import {
  buildInventoryImageUrl,
  useInventoryStore,
  type InventoryCard as InventoryCardType,
} from '../store/inventoryStore';
import { formatCurrency } from '../screens/HomeScreen';
import { CardImageViewer } from './CardImageViewer';
import { JpBadge } from './JpBadge';
import { isJpSetName } from '../utils/jp';

type Props = {
  card: InventoryCardType;
  width: number;
  height?: number;
  onEdit: (card: InventoryCardType) => void;
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

const CARD_ASPECT_WIDTH = 2.5;
const CARD_ASPECT_HEIGHT = 3.5;
const CARD_ASPECT_RATIO = CARD_ASPECT_WIDTH / CARD_ASPECT_HEIGHT; // width / height

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

  const profitColor = card.projProfit >= 0 ? colors.success : colors.error;

  useFocusEffect(
    useCallback(() => {
      return () => {
        setConfirmDelete(false);
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
      };
    }, [])
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
  const meta = [card.number, card.set, variant, card.condition]
    .filter(Boolean)
    .join(' · ');
  const viewerUri = buildInventoryImageUrl(card.imageUrl, card.productId);

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
          onPress={() => setViewerOpen(true)}>
          <CardImage
            imageUrl={card.imageUrl}
            productId={card.productId}
            name={card.name}
            set={card.set}
            width={imageWidth}
            maxHeight={maxImageHeight}
          />
        </TouchableOpacity>
        <View style={styles.details}>
          <View style={styles.nameRow}>
            <Text style={styles.cardName} numberOfLines={1}>
              {card.name}
            </Text>
            {isJpSetName(card.set) ? <JpBadge /> : null}
          </View>
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
          <Text style={styles.sticker}>{formatCurrency(card.stickerPrice)}</Text>

          <View style={styles.metrics}>
            <MetricRow label="Live Market" value={formatCurrency(card.liveMarket)} />
            <MetricRow label="Amount Paid" value={formatCurrency(card.amountPaid)} />
            <MetricRow
              label="Proj. Profit"
              value={formatCurrency(card.projProfit)}
              valueColor={profitColor}
            />
            <MetricRow label="Stock" value={String(card.stock)} />
          </View>
        </View>
      </View>

      {!selecting && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionButton, styles.actionSell]}
            activeOpacity={0.7}
            onPress={handleSell}>
            <Text style={styles.sellText}>Sell</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.actionMain]}
            activeOpacity={0.7}
            onPress={handleEdit}>
            <Text style={styles.actionText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.actionButton,
              styles.actionDelete,
              confirmDelete && styles.actionDeleteConfirm,
            ]}
            activeOpacity={0.7}
            onPress={handleDelete}>
            <Text
              style={[
                styles.deleteText,
                confirmDelete && styles.deleteTextConfirm,
              ]}
              numberOfLines={1}>
              {confirmDelete ? 'Sure?' : 'Del'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <CardImageViewer
        visible={viewerOpen}
        uri={viewerUri}
        name={card.name}
        caption={meta}
        onClose={() => setViewerOpen(false)}
      />
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    justifyContent: 'space-between',
  },
  cardSelected: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(59, 130, 246, 0.08)',
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
    fontWeight: 'bold',
    lineHeight: 17,
    marginBottom: 2,
    flexShrink: 1,
  },
  meta: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 13,
    marginBottom: 4,
  },
  sticker: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 22,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  metrics: {
    width: '100%',
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
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  actionMain: {
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionSell: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    borderWidth: 1,
    borderColor: colors.success,
  },
  sellText: {
    color: colors.success,
    fontSize: 12,
    fontWeight: '600',
  },
  actionDelete: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: colors.error,
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
    fontWeight: 'bold',
  },
});
