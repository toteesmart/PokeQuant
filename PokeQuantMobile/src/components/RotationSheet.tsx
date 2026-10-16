// RotationSheet — the rotate-out shortlist: cards sorted by dollars
// locked, each carrying the concrete exit trigger. Tap through to the
// full owner analysis for that card.
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../constants/colors';
import { GlassSheet } from './ui';
import { formatCurrency } from '../utils/format';
import { displayCardName } from '../scanner/services/catalog/catalogMatcher';
import {
  BUCKET_COLOR,
  BUCKET_LABEL,
  type StockHealthItem,
} from '../scanner/services/deal/stockHealth';

export function RotationSheet({
  visible,
  items,
  watchItems,
  onSelect,
  onClose,
}: {
  visible: boolean;
  items: StockHealthItem[];
  watchItems: StockHealthItem[];
  onSelect: (item: StockHealthItem) => void;
  onClose: () => void;
}) {
  const renderItem = (item: StockHealthItem, rank: number) => {
    const vs = item.value - item.cost;
    return (
      <TouchableOpacity
        key={item.card.id}
        style={rotationStyles.row}
        onPress={() => onSelect(item)}
      >
        <Text style={rotationStyles.rank}>{rank + 1}</Text>
        <View style={rotationStyles.main}>
          <Text style={rotationStyles.name} numberOfLines={1}>
            {displayCardName(item.card.name)}
          </Text>
          <Text style={rotationStyles.trigger} numberOfLines={1}>
            {item.trigger ? `${item.read.label} · ${item.trigger}` : item.read.label}
          </Text>
        </View>
        <View style={rotationStyles.numbers}>
          <Text style={rotationStyles.value}>{formatCurrency(item.value)}</Text>
          {item.cost > 0 ? (
            <Text
              style={[
                rotationStyles.vs,
                { color: vs >= 0 ? colors.velocityPositive : colors.velocityNegative },
              ]}
            >
              {vs >= 0 ? '+' : ''}
              {formatCurrency(vs)} vs paid
            </Text>
          ) : null}
        </View>
        <Text style={[rotationStyles.tag, { color: BUCKET_COLOR[item.bucket] }]}>
          {BUCKET_LABEL[item.bucket]}
        </Text>
      </TouchableOpacity>
    );
  };

  if (!visible) return null;

  return (
    <GlassSheet title="Sell these first" onClose={onClose}>
      <>
        <Text style={rotationStyles.sub}>
          Sorted by money tied up — selling the top cards frees the most cash.
        </Text>
        {items.map(renderItem)}
        {watchItems.length > 0 ? (
          <>
            <Text style={rotationStyles.section}>
              Almost a sell — holding, but one price drop away
            </Text>
            {watchItems.map(renderItem)}
          </>
        ) : null}
        {items.length === 0 && watchItems.length === 0 ? (
          <Text style={rotationStyles.empty}>Nothing flagged — your stock is working.</Text>
        ) : null}
      </>
    </GlassSheet>
  );
}

const rotationStyles = StyleSheet.create({
  sub: {
    color: colors.textMuted,
    fontSize: 11,
    marginBottom: 10,
  },
  section: {
    color: colors.warning,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rank: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    width: 16,
  },
  main: {
    flex: 1,
    flexShrink: 1,
  },
  name: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  trigger: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 1,
  },
  numbers: {
    alignItems: 'flex-end',
  },
  value: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  vs: {
    fontSize: 10,
    marginTop: 1,
  },
  tag: {
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    width: 58,
    textAlign: 'right',
  },
  empty: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 24,
  },
});
