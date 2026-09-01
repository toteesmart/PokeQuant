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
import {
  METRICS,
  VELOCITY_DATA,
  MiniMoverCard,
  formatCurrency,
  formatSignedCurrency,
  type Period,
} from './HomeScreen';

type Card = InventoryCard;

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
    <View style={[styles.page, { width: pageWidth, height: pageHeight }]}>
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
    </View>
  );
}

function QuickViewPanel({
  metrics,
}: {
  metrics: typeof METRICS;
}) {
  const profitColor = metrics.profit24h >= 0 ? colors.success : colors.error;
  const profitBg =
    metrics.profit24h >= 0
      ? 'rgba(34, 197, 94, 0.15)'
      : 'rgba(239, 68, 68, 0.15)';

  return (
    <View style={quickViewStyles.container}>
      <View style={quickViewStyles.header}>
        <Text style={quickViewStyles.title}>Quick View: Active Inventory</Text>
        <View
          style={[
            quickViewStyles.profitPill,
            { backgroundColor: profitBg, borderColor: profitColor },
          ]}>
          <Text
            style={[quickViewStyles.profitPillText, { color: profitColor }]}>
            {metrics.profit24h >= 0 ? '↑' : '↓'} {formatSignedCurrency(metrics.profit24h)}
          </Text>
        </View>
      </View>

      <View style={quickViewStyles.stats}>
        <View style={quickViewStyles.stat}>
          <Text style={quickViewStyles.statValue}>{metrics.activeAssets}</Text>
          <Text style={quickViewStyles.statLabel}>Active</Text>
        </View>
        <View style={quickViewStyles.stat}>
          <Text style={quickViewStyles.statValue}>
            {formatCurrency(metrics.totalCostBasis)}
          </Text>
          <Text style={quickViewStyles.statLabel}>Cost Basis</Text>
        </View>
        <View style={quickViewStyles.stat}>
          <Text style={quickViewStyles.statValue}>
            {formatCurrency(metrics.projectedSticker)}
          </Text>
          <Text style={quickViewStyles.statLabel}>Sticker Price</Text>
        </View>
        <View style={quickViewStyles.stat}>
          <Text style={quickViewStyles.statValue}>
            {formatCurrency(metrics.projectedProfit)}
          </Text>
          <Text style={quickViewStyles.statLabel}>Profit</Text>
          <View
            style={[
              quickViewStyles.changePill,
              { backgroundColor: profitBg, borderColor: profitColor },
            ]}>
            <Text
              style={[
                quickViewStyles.changePillText,
                { color: profitColor },
              ]}>
              {metrics.profit24h >= 0 ? '↑' : '↓'} {formatSignedCurrency(metrics.profit24h)} (24h)
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function VelocityBreakdown() {
  const [velocityExpanded, setVelocityExpanded] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<Period>('1d');

  const current = VELOCITY_DATA[selectedPeriod];

  return (
    <View style={velocityStyles.container}>
      <TouchableOpacity
        style={velocityStyles.header}
        onPress={() => setVelocityExpanded((v) => !v)}>
        <Text style={velocityStyles.title}>
          Velocity Breakdown (Live Market Shifts)
        </Text>
        <View style={velocityStyles.summaryPills}>
          {(Object.keys(VELOCITY_DATA) as Period[]).map((p) => {
            const data = VELOCITY_DATA[p];
            const isPositive = data.change >= 0;
            return (
              <View
                key={p}
                style={[
                  velocityStyles.summaryPill,
                  {
                    backgroundColor: isPositive
                      ? 'rgba(34, 197, 94, 0.12)'
                      : 'rgba(239, 68, 68, 0.12)',
                    borderColor: isPositive ? colors.success : colors.error,
                  },
                ]}>
                <Text
                  style={[
                    velocityStyles.summaryPillText,
                    { color: isPositive ? colors.success : colors.error },
                  ]}>
                  {data.label}: {formatSignedCurrency(data.change)}
                </Text>
              </View>
            );
          })}
        </View>
      </TouchableOpacity>

      {velocityExpanded && (
        <View style={velocityStyles.body}>
          <View style={velocityStyles.tabRow}>
            {(Object.keys(VELOCITY_DATA) as Period[]).map((p) => {
              const isActive = p === selectedPeriod;
              return (
                <TouchableOpacity
                  key={p}
                  style={[velocityStyles.tab, isActive && velocityStyles.tabActive]}
                  onPress={() => setSelectedPeriod(p)}>
                  <Text
                    style={[
                      velocityStyles.tabText,
                      isActive && velocityStyles.tabTextActive,
                    ]}>
                    {VELOCITY_DATA[p].label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            nestedScrollEnabled
            contentContainerStyle={velocityStyles.moverScroll}>
            {current.movers.map((mover, index) => (
              <MiniMoverCard key={index} mover={mover} />
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

export function InventoryScreen() {
  const { width } = useWindowDimensions();
  const [pageHeight, setPageHeight] = useState(0);
  const { inventory } = useInventory();

  const metrics = useMemo(
    () => ({
      activeAssets: inventory.length,
      totalCostBasis: inventory.reduce((sum, c) => sum + c.amountPaid, 0),
      projectedSticker: inventory.reduce((sum, c) => sum + c.stickerPrice, 0),
      projectedProfit: inventory.reduce((sum, c) => sum + c.projProfit, 0),
      profit24h: METRICS.profit24h,
    }),
    [inventory]
  );

  const pages = useMemo<Card[][]>(() => {
    const chunks: Card[][] = [];
    for (let i = 0; i < inventory.length; i += 4) {
      chunks.push(inventory.slice(i, i + 4));
    }
    return chunks;
  }, [inventory]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}>
      <QuickViewPanel metrics={metrics} />

      <View
        style={styles.carouselWrapper}
        onLayout={(e) => setPageHeight(e.nativeEvent.layout.height)}>
        <FlatList
          data={pages}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          nestedScrollEnabled
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

      <VelocityBreakdown />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    padding: 16,
  },
  carouselWrapper: {
    flex: 1,
    minHeight: 460,
    marginVertical: 12,
  },
  carousel: {
    flex: 1,
  },
  page: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
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
    padding: 8,
    minHeight: 210,
    alignSelf: 'stretch',
    justifyContent: 'space-between',
  },
  body: {
    flex: 1,
  },
  thumb: {
    flex: 1,
    minHeight: 60,
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
    fontSize: 12,
    fontWeight: 'bold',
    lineHeight: 14,
    marginBottom: 2,
  },
  sticker: {
    color: colors.text,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  metrics: {
    marginBottom: 0,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 0,
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: 10,
  },
  metricValue: {
    color: colors.text,
    fontSize: 10,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
  },
  actionButton: {
    flex: 1,
    borderRadius: 6,
    paddingVertical: 5,
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
    fontSize: 10,
    fontWeight: '600',
  },
  deleteText: {
    color: colors.error,
    fontSize: 10,
    fontWeight: '600',
  },
});

const quickViewStyles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  profitPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  profitPillText: {
    fontSize: 10,
    fontWeight: '600',
  },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  stat: {
    width: '50%',
    alignItems: 'center',
    paddingVertical: 6,
  },
  statValue: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  changePill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 2,
    paddingHorizontal: 6,
    marginTop: 4,
  },
  changePillText: {
    fontSize: 9,
    fontWeight: '600',
  },
});

const velocityStyles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  header: {
    padding: 12,
  },
  title: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  summaryPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  summaryPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 3,
    paddingHorizontal: 6,
    marginRight: 6,
    marginBottom: 3,
  },
  summaryPillText: {
    fontSize: 10,
    fontWeight: '600',
  },
  body: {
    padding: 12,
    paddingTop: 0,
  },
  tabRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
  },
  tabActive: {
    borderBottomColor: colors.primary,
  },
  tabText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '500',
  },
  tabTextActive: {
    color: colors.text,
    fontWeight: 'bold',
  },
  moverScroll: {
    paddingVertical: 2,
  },
});
