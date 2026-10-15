import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { colors } from '../../constants/colors';
import { layout, radius, spacing } from '../../constants/theme';
import { SetBadge } from '../SetBadge';
import { displayCardName } from '../../scanner/services/catalog/catalogMatcher';
import { formatCurrency, formatSignedCurrency } from '../../utils/format';
import type { CompletedSale } from '../../store/inventoryStore';
import type { TradeLogSummary } from '../../scanner/services/deal/tradeLogDb';
import {
  parseSaleDate,
  timeAgo,
} from '../../services/salesAnalytics';
import { COST_GRAY, PROFIT_GREEN } from './palette';
import { carouselStyles } from './ChartCarousel';

const COMPLETED_SALES_PAGE_SIZE = 5;
const COMPLETED_SALES_ROW_HEIGHT = 74;
const COMPLETED_SALES_HEADER_HEIGHT = 50;

const CompletedSaleRow = memo(function CompletedSaleRow({
  sale,
  onUndo,
  isReal,
  now,
  trade,
}: {
  sale: CompletedSale;
  onUndo: (sale: CompletedSale) => void;
  isReal: boolean;
  now: Date;
  trade?: TradeLogSummary;
}) {
  const profit = sale.soldPrice - sale.acquiredCost;
  const margin =
    sale.acquiredCost > 0 ? (profit / sale.acquiredCost) * 100 : 0;
  const relative = timeAgo(parseSaleDate(sale.dateSold), now);
  const tradeColor =
    trade?.verdict === 'win'
      ? PROFIT_GREEN
      : trade?.verdict === 'lose'
        ? colors.warning
        : COST_GRAY;

  return (
    <View style={streamStyles.row}>
      <View style={streamStyles.leftCol}>
        <Text style={streamStyles.name} numberOfLines={1}>
          {displayCardName(sale.name)}
        </Text>
        {sale.set ? (
          <SetBadge set={sale.set} style={streamStyles.setBadge} />
        ) : null}
        <Text style={streamStyles.meta}>{sale.number || 'Unknown'}</Text>
        {trade ? (
          <Text
            style={[streamStyles.tradeTag, { color: tradeColor }]}
            numberOfLines={1}
          >
            {trade.reason || 'Traded'}
          </Text>
        ) : null}
        <Text style={streamStyles.time}>{relative}</Text>
      </View>
      <View style={streamStyles.rightCol}>
        <Text style={streamStyles.soldPrice}>
          {formatCurrency(sale.soldPrice)}
        </Text>
        <View
          style={[
            streamStyles.badge,
            profit < 0 && streamStyles.badgeNegative,
          ]}>
          <Text
            style={[
              streamStyles.badgeText,
              profit < 0 && streamStyles.badgeTextNegative,
            ]}>
            {formatSignedCurrency(profit)} ({profit >= 0 ? '+' : ''}
            {margin.toFixed(0)}%)
          </Text>
        </View>
        <TouchableOpacity
          style={[
            streamStyles.undoButton,
            !isReal && streamStyles.undoButtonDisabled,
          ]}
          activeOpacity={isReal ? 0.7 : 1}
          onPress={() => isReal && onUndo(sale)}
          disabled={!isReal}>
          <Text
            style={[
              streamStyles.undoText,
              !isReal && streamStyles.undoTextDisabled,
            ]}>
            Undo
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

export function CompletedSalesStream({
  sales,
  onUndo,
  realSaleIds,
  now,
  tradeByInvId,
}: {
  sales: CompletedSale[];
  onUndo: (sale: CompletedSale) => void;
  realSaleIds: Set<string>;
  now: Date;
  tradeByInvId: Map<string, TradeLogSummary>;
}) {
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [activePage, setActivePage] = useState(0);
  const pageWidth = Math.max(0, width - 32);

  const pages = useMemo(() => {
    const result: CompletedSale[][] = [];
    for (let i = 0; i < sales.length; i += COMPLETED_SALES_PAGE_SIZE) {
      result.push(sales.slice(i, i + COMPLETED_SALES_PAGE_SIZE));
    }
    return result;
  }, [sales]);

  const maxItemsOnFirstPage = Math.min(
    COMPLETED_SALES_PAGE_SIZE,
    sales.length
  );
  const cardHeight =
    COMPLETED_SALES_HEADER_HEIGHT +
    maxItemsOnFirstPage * COMPLETED_SALES_ROW_HEIGHT;

  useEffect(() => {
    setActivePage(0);
    scrollRef.current?.scrollTo({ x: 0, animated: false });
  }, [sales]);

  if (sales.length === 0) {
    return (
      <View style={[streamStyles.card, { minHeight: cardHeight }]}>
        <Text style={streamStyles.title}>Your sales</Text>
        <View style={streamStyles.emptyState}>
          <Text style={streamStyles.emptyText}>
            No sales in this period yet.
          </Text>
        </View>
      </View>
    );
  }

  if (sales.length <= COMPLETED_SALES_PAGE_SIZE) {
    return (
      <View style={[streamStyles.card, { minHeight: cardHeight }]}>
        <Text style={streamStyles.title}>Your sales</Text>
        {sales.map((sale) => (
          <CompletedSaleRow
            key={sale.id}
            sale={sale}
            onUndo={onUndo}
            isReal={realSaleIds.has(sale.id)}
            now={now}
            trade={tradeByInvId.get(sale.id)}
          />
        ))}
      </View>
    );
  }

  return (
    <View style={[streamStyles.card, { minHeight: cardHeight }]}>
      <Text style={streamStyles.title}>Your sales</Text>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        nestedScrollEnabled
        onMomentumScrollEnd={(e) => {
          const page = Math.round(
            e.nativeEvent.contentOffset.x / pageWidth
          );
          setActivePage(Math.max(0, Math.min(page, pages.length - 1)));
        }}
        contentContainerStyle={{ width: pageWidth * pages.length }}
        style={{
          alignSelf: 'center',
          width: pageWidth,
          height: COMPLETED_SALES_PAGE_SIZE * COMPLETED_SALES_ROW_HEIGHT,
        }}
      >
        {pages.map((page, pageIndex) => (
          <View key={pageIndex} style={{ width: pageWidth, height: '100%' }}>
            {page.map((sale) => (
              <CompletedSaleRow
                key={sale.id}
                sale={sale}
                onUndo={onUndo}
                isReal={realSaleIds.has(sale.id)}
                now={now}
                trade={tradeByInvId.get(sale.id)}
              />
            ))}
          </View>
        ))}
      </ScrollView>
      <View style={carouselStyles.dots}>
        {pages.map((_, i) => (
          <View
            key={i}
            style={[
              carouselStyles.dot,
              i === activePage && carouselStyles.dotActive,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const streamStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.overlay2,
    borderRadius: radius.cardLg,
    padding: layout.cardPadding,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.overlay3,
    borderRadius: radius.card,
    padding: spacing.xl,
    marginBottom: spacing.lg,
  },
  leftCol: {
    flex: 1,
    paddingRight: 8,
  },
  rightCol: {
    alignItems: 'flex-end',
  },
  name: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  meta: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  setBadge: {
    marginTop: 3,
  },
  time: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 2,
  },
  tradeTag: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  soldPrice: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  badge: {
    backgroundColor: colors.successTint,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.success,
    paddingVertical: 2,
    paddingHorizontal: 6,
    marginBottom: 6,
  },
  badgeNegative: {
    backgroundColor: colors.errorTint,
    borderColor: colors.error,
  },
  badgeText: {
    color: colors.success,
    fontSize: 10,
    fontWeight: '600',
  },
  badgeTextNegative: {
    color: colors.error,
  },
  undoButton: {
    backgroundColor: colors.primaryTint,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing['3xl'],
  },
  undoButtonDisabled: {
    borderColor: colors.border,
  },
  undoText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '600',
  },
  undoTextDisabled: {
    color: colors.textMuted,
  },
  emptyState: {
    minHeight: 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 12,
  },
});
