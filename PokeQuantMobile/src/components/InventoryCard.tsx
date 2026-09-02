import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors } from '../constants/colors';
import {
  useInventory,
  type InventoryCard as InventoryCardType,
} from '../context/InventoryContext';
import { formatCurrency } from '../screens/HomeScreen';

type Props = {
  card: InventoryCardType;
  width: number;
  height: number;
  onEdit: (card: InventoryCardType) => void;
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

const BASE_IMAGE_WIDTH = 120;
const BASE_IMAGE_HEIGHT = 168;
const IMAGE_MAX_HEIGHT = 180;
const IMAGE_MIN_HEIGHT = 120;

function CardImage({
  imageUrl,
  maxWidth,
}: {
  imageUrl?: string;
  maxWidth: number;
}) {
  const [failed, setFailed] = useState(false);

  const rawHeight = Math.round(
    maxWidth * (BASE_IMAGE_HEIGHT / BASE_IMAGE_WIDTH)
  );
  const imageHeight = Math.min(
    IMAGE_MAX_HEIGHT,
    Math.max(IMAGE_MIN_HEIGHT, rawHeight)
  );
  const imageWidth = Math.round(
    imageHeight * (BASE_IMAGE_WIDTH / BASE_IMAGE_HEIGHT)
  );

  if (imageUrl && !failed) {
    return (
      <View style={[styles.thumb, { width: imageWidth, height: imageHeight }]}>
        <Image
          source={{ uri: imageUrl }}
          style={styles.thumbImage}
          resizeMode="contain"
          onError={() => setFailed(true)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.thumb, { width: imageWidth, height: imageHeight }]}>
      <Text style={styles.thumbText}>IMG</Text>
    </View>
  );
}

export const InventoryCard = memo(function InventoryCard({
  card,
  width,
  height,
  onEdit,
}: Props) {
  const { removeInventoryCard, sellInventoryCard } = useInventory();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  return (
    <View style={[styles.card, { width, minHeight: Math.max(height, 320) }]}>
      <View style={styles.body}>
        <CardImage imageUrl={card.imageUrl} maxWidth={width - 32} />
        <View style={styles.details}>
          <Text style={styles.cardName} numberOfLines={1}>
            {card.name}
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

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionButton, styles.actionMain]}
          activeOpacity={0.7}
          onPress={handleSell}>
          <Text style={styles.actionText}>Sell</Text>
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
            {confirmDelete ? 'Are you sure?' : 'Delete'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
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
  thumbText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  details: {
    width: '100%',
    alignItems: 'center',
  },
  cardName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: 'bold',
    lineHeight: 17,
    marginBottom: 2,
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
  actionDelete: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: colors.error,
  },
  actionDeleteConfirm: {
    backgroundColor: '#ff7b72',
    borderColor: '#ff7b72',
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
