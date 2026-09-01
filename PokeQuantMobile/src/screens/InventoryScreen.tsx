import { useMemo, useState } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { colors } from '../constants/colors';
import { useInventory, type InventoryCard } from '../context/InventoryContext';

type Card = InventoryCard;

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

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

function FloatingCard({ card, width }: { card: Card; width: number }) {
  const profitColor = card.projProfit >= 0 ? colors.success : colors.error;

  return (
    <View style={[styles.card, { width }]}>
      <View style={styles.body}>
        <View style={styles.thumb}>
          <Text style={styles.thumbText}>IMG</Text>
        </View>

        <Text style={styles.cardName} numberOfLines={2}>
          {card.name}
        </Text>
        <Text style={styles.sticker}>{formatCurrency(card.stickerPrice)}</Text>

        <View style={styles.metrics}>
          <MetricRow label="Live Market" value={formatCurrency(card.liveMarket)} />
          <MetricRow label="Amount Paid" value={formatCurrency(card.amountPaid)} />
          <MetricRow label="Sticker Price" value={formatCurrency(card.stickerPrice)} />
          <MetricRow
            label="Proj. Profit"
            value={formatCurrency(card.projProfit)}
            valueColor={profitColor}
          />
          <MetricRow label="Stock" value={String(card.stock)} />
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionButton, styles.actionMain]}
          activeOpacity={0.7}>
          <Text style={styles.actionText}>Sell</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.actionMain]}
          activeOpacity={0.7}>
          <Text style={styles.actionText}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.actionDelete]}
          activeOpacity={0.7}>
          <Text style={styles.deleteText}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function InventoryPage({
  page,
  pageWidth,
  pageHeight,
}: {
  page: Card[];
  pageWidth: number;
  pageHeight: number;
}) {
  const cardWidth = (pageWidth - 40) / 2;
  const top = page.slice(0, 2);
  const bottom = page.slice(2, 4);

  return (
    <ScrollView
      style={{ width: pageWidth, height: pageHeight }}
      contentContainerStyle={[styles.pageContent, { minHeight: pageHeight }]}
      showsVerticalScrollIndicator={false}
      nestedScrollEnabled
      directionalLockEnabled>
      <View style={styles.row}>
        {top.map((card) => (
          <FloatingCard key={card.id} card={card} width={cardWidth} />
        ))}
      </View>
      <View style={styles.row}>
        {bottom.map((card) => (
          <FloatingCard key={card.id} card={card} width={cardWidth} />
        ))}
      </View>
    </ScrollView>
  );
}

export function InventoryScreen() {
  const { width } = useWindowDimensions();
  const [pageHeight, setPageHeight] = useState(0);
  const { inventory } = useInventory();

  const pages = useMemo<Card[][]>(() => {
    const chunks: Card[][] = [];
    for (let i = 0; i < inventory.length; i += 4) {
      chunks.push(inventory.slice(i, i + 4));
    }
    return chunks;
  }, [inventory]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.count}>Active: {inventory.length}</Text>
      </View>

      <View
        style={styles.carouselWrapper}
        onLayout={(e) => setPageHeight(e.nativeEvent.layout.height)}>
        <FlatList
          data={pages}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          style={styles.carousel}
          extraData={pageHeight}
          getItemLayout={(_, index) => ({
            length: width,
            offset: width * index,
            index,
          })}
          keyExtractor={(_, index) => String(index)}
          renderItem={({ item }) => (
            <InventoryPage
              page={item}
              pageWidth={width}
              pageHeight={pageHeight}
            />
          )}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  count: {
    color: colors.textMuted,
    fontSize: 14,
  },
  carouselWrapper: {
    flex: 1,
  },
  carousel: {
    flex: 1,
  },
  pageContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'stretch',
    marginBottom: 6,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    minHeight: 260,
    alignSelf: 'stretch',
    justifyContent: 'space-between',
  },
  body: {
    flex: 1,
  },
  thumb: {
    flex: 1,
    minHeight: 80,
    backgroundColor: colors.surfaceLight,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  thumbText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  cardName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  sticker: {
    color: colors.text,
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  metrics: {
    marginBottom: 8,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 1,
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: 11,
  },
  metricValue: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
  },
  actionButton: {
    flex: 1,
    borderRadius: 6,
    paddingVertical: 6,
    alignItems: 'center',
    marginHorizontal: 2,
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
  actionText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
  },
  deleteText: {
    color: colors.error,
    fontSize: 11,
    fontWeight: '600',
  },
});
