// RotationSheet — the stock drill-down. Three tabs over the health
// buckets: Sell First (rotate + dead, sorted by dollars locked),
// Watching (holding with a live sell trigger), Healthy (compounders +
// keepers — the money that's working). Every entry carries a small
// card-art module underneath its headline row — thumb taps open the
// viewer, the rest of the row taps through to the owner analysis.
import { memo, useCallback, useRef, useState } from 'react';
import {
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { FlashList, useRecyclingState } from '@shopify/flash-list';
import { colors } from '../constants/colors';
import {
  CARD_ASPECT_RATIO,
  radius,
  spacing,
  type_,
  weight,
} from '../constants/theme';
import { GlassSheet, SegmentedPills, type SegmentedPill } from './ui';
import { CardImageViewer } from './CardImageViewer';
import { formatCurrency } from '../utils/format';
import { displayCardName } from '../scanner/services/catalog/catalogMatcher';
import { buildInventoryImageUrl } from '../store/inventoryStore';
import {
  BUCKET_COLOR,
  BUCKET_LABEL,
  type StockHealthItem,
} from '../scanner/services/deal/stockHealth';

type RotationTab = 'sell' | 'watch' | 'healthy';

const TABS: readonly SegmentedPill<RotationTab>[] = [
  { key: 'sell', label: 'Sell First', icon: 'repeat-outline' },
  { key: 'watch', label: 'Watching', icon: 'eye-outline' },
  { key: 'healthy', label: 'Healthy', icon: 'trending-up-outline' },
];
const TAB_ORDER = TABS.map((t) => t.key);

const TAB_TITLE: Record<RotationTab, string> = {
  sell: 'Sell First',
  watch: 'Watching',
  healthy: 'Healthy',
};

const TAB_SUB: Record<RotationTab, string> = {
  sell: 'Sorted by money tied up — selling the top cards frees the most cash.',
  watch: 'Still holding — each has a live trigger that flips it to a sell.',
  healthy: 'Compounding or holding steady — the part of your stock doing its job.',
};

const TAB_EMPTY: Record<RotationTab, string> = {
  sell: 'Nothing flagged — your stock is working.',
  watch: 'Nothing on watch — no live sell triggers right now.',
  healthy: 'No growers yet — these reads sharpen as price data lands.',
};

const THUMB_WIDTH = 48;
const THUMB_HEIGHT = Math.round(THUMB_WIDTH / CARD_ASPECT_RATIO);
// The art module nests under the name column — rank width + row gap.
const MODULE_INDENT = 26;

const RotationRow = memo(function RotationRow({
  item,
  rank,
  onSelect,
}: {
  item: StockHealthItem;
  rank: number;
  onSelect: (item: StockHealthItem) => void;
}) {
  const uri = buildInventoryImageUrl(item.card.imageUrl, item.card.productId);
  const [viewerOpen, setViewerOpen] = useRecyclingState(false, [item.card.id]);
  const [imageError, setImageError] = useRecyclingState(false, [item.card.id, uri]);
  const name = displayCardName(item.card.name);
  const vs = item.value - item.cost;
  return (
    <>
      <TouchableOpacity
        style={rotationStyles.entry}
        activeOpacity={0.85}
        onPress={() => onSelect(item)}
        accessibilityRole="button"
        accessibilityLabel={`${name} — ${item.read.label}`}
      >
        <View style={rotationStyles.topRow}>
          <Text style={rotationStyles.rank}>{rank + 1}</Text>
          {/* Name tap → analysis: underline + glyph is the affordance. */}
          <View style={rotationStyles.nameWrap}>
            <Text style={[rotationStyles.name, rotationStyles.nameLink]} numberOfLines={1}>
              {name}
            </Text>
            <Ionicons name="analytics-outline" size={13} color={colors.primary} />
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
        </View>
        {/* Card-art module — the inner thumb touchable wins the tap and
            opens the viewer; the copy beside it is the read + trigger. */}
        <View style={rotationStyles.imageModule}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => setViewerOpen(true)}
            disabled={!uri}
            hitSlop={6}
            accessibilityLabel={`View ${name} image`}
            accessibilityRole="imagebutton"
          >
            {uri && !imageError ? (
              <Image
                source={{ uri }}
                style={rotationStyles.thumb}
                contentFit="contain"
                cachePolicy="memory-disk"
                onError={() => setImageError(true)}
              />
            ) : (
              <View style={[rotationStyles.thumb, rotationStyles.fallbackThumb]}>
                <Ionicons name="image-outline" size={22} color={colors.textMuted} />
              </View>
            )}
          </TouchableOpacity>
          <View style={rotationStyles.moduleText}>
            <Text style={rotationStyles.readLabel} numberOfLines={1}>
              {item.read.label}
            </Text>
            {item.trigger ? (
              <Text style={rotationStyles.trigger} numberOfLines={2}>
                {item.trigger}
              </Text>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
      {/* Mount on demand — a big Healthy tab would otherwise park a
          hidden Modal per row. Mount-as-visible still plays the fade. */}
      {viewerOpen ? (
        <CardImageViewer visible uri={uri} name={name} onClose={() => setViewerOpen(false)} />
      ) : null}
    </>
  );
});

export function RotationSheet({
  visible,
  ...props
}: {
  visible: boolean;
  sellItems: StockHealthItem[];
  watchItems: StockHealthItem[];
  healthyItems: StockHealthItem[];
  onSelect: (item: StockHealthItem) => void;
  onClose: () => void;
}) {
  if (!visible) return null;
  // Fresh mount per open so the sheet always lands on the Sell First tab.
  return <RotationSheetBody {...props} />;
}

function RotationSheetBody({
  sellItems,
  watchItems,
  healthyItems,
  onSelect,
  onClose,
}: {
  sellItems: StockHealthItem[];
  watchItems: StockHealthItem[];
  healthyItems: StockHealthItem[];
  onSelect: (item: StockHealthItem) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<RotationTab>('sell');
  // The pager owns tab order — measure the container so each page is
  // exactly one viewport wide and snaps land clean with no neighbor bleed.
  const [pagerW, setPagerW] = useState(0);
  const pagerRef = useRef<ScrollView>(null);
  // The pills' highlight rides the same offset the pager scrolls, so the
  // indicator glides under the drag instead of snapping on tab change.
  const [scrollX] = useState(() => new Animated.Value(0));
  const [onPagerScroll] = useState(() =>
    Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
      useNativeDriver: false,
    }),
  );
  // A plain paged ScrollView owns the tab swipe — FlashList-as-pager
  // swallowed vertical drags before the per-tab lists could claim them.
  // The active pill lands when the page snap settles.
  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const key = TAB_ORDER[Math.round(e.nativeEvent.contentOffset.x / pagerW)];
      if (key) setTab(key);
    },
    [pagerW],
  );
  const itemsFor = (t: RotationTab) =>
    t === 'sell' ? sellItems : t === 'watch' ? watchItems : healthyItems;
  const items = itemsFor(tab);
  const changeTab = (t: RotationTab) => {
    setTab(t);
    pagerRef.current?.scrollTo({ x: TAB_ORDER.indexOf(t) * pagerW, animated: true });
  };
  // Same art bleed as the analysis sheet — the active tab's top card
  // washes the backdrop; an empty tab borrows a sibling's top card so
  // the frost stays on instead of falling flat.
  const artOf = (list: StockHealthItem[]) =>
    list.length > 0
      ? buildInventoryImageUrl(list[0].card.imageUrl, list[0].card.productId)
      : undefined;
  const artUri = artOf(items) ?? artOf(sellItems) ?? artOf(watchItems) ?? artOf(healthyItems) ?? null;

  return (
    <GlassSheet
      title={TAB_TITLE[tab]}
      onClose={onClose}
      scrollable={false}
      artUri={artUri}
      enterFrom="top"
    >
      <SegmentedPills
        tabs={TABS}
        activeTab={tab}
        onChange={changeTab}
        style={rotationStyles.tabs}
        scrollX={scrollX}
        pageWidth={pagerW}
      />
      <Text style={rotationStyles.sub}>{TAB_SUB[tab]}</Text>
      <View
        style={rotationStyles.listScroll}
        onLayout={(e) => setPagerW(e.nativeEvent.layout.width)}
      >
        {pagerW > 0 ? (
          <ScrollView
            ref={pagerRef}
            horizontal
            pagingEnabled
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={onPagerScroll}
            scrollEventThrottle={16}
            onMomentumScrollEnd={onMomentumEnd}
            style={rotationStyles.listScroll}
          >
            {TAB_ORDER.map((t) => (
              <View key={t} style={[rotationStyles.page, { width: pagerW }]}>
                <FlashList
                  data={itemsFor(t)}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={rotationStyles.listContent}
                  keyExtractor={(i) => i.card.id}
                  renderItem={({ item, index }) => (
                    <RotationRow item={item} rank={index} onSelect={onSelect} />
                  )}
                  ListEmptyComponent={
                    <Text style={rotationStyles.empty}>{TAB_EMPTY[t]}</Text>
                  }
                  style={rotationStyles.listScroll}
                />
              </View>
            ))}
          </ScrollView>
        ) : null}
      </View>
    </GlassSheet>
  );
}

const rotationStyles = StyleSheet.create({
  page: {
    height: '100%',
  },
  tabs: {
    marginTop: 0,
    marginBottom: spacing.md,
  },
  sub: {
    color: colors.textMuted,
    fontSize: type_.meta,
    marginBottom: spacing.md,
  },
  listScroll: {
    flex: 1,
  },
  listContent: {
    paddingBottom: spacing['8xl'],
  },
  entry: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
  },
  rank: {
    color: colors.textMuted,
    fontSize: type_.meta,
    fontWeight: weight.bold,
    width: 16,
  },
  nameWrap: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  name: {
    color: colors.text,
    fontSize: type_.body,
    fontWeight: weight.semibold,
    flexShrink: 1,
  },
  nameLink: {
    textDecorationLine: 'underline',
    textDecorationColor: colors.textMuted,
  },
  numbers: {
    alignItems: 'flex-end',
  },
  value: {
    color: colors.text,
    fontSize: type_.body,
    fontWeight: weight.bold,
  },
  vs: {
    fontSize: type_.caption,
    marginTop: spacing.xs,
  },
  tag: {
    fontSize: type_.micro,
    fontWeight: weight.heavy,
    textTransform: 'uppercase',
    width: 58,
    textAlign: 'right',
  },
  imageModule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['2xl'],
    backgroundColor: colors.overlay2,
    borderRadius: radius.card,
    padding: spacing.xl,
    marginLeft: MODULE_INDENT,
  },
  thumb: {
    width: THUMB_WIDTH,
    height: THUMB_HEIGHT,
    borderRadius: radius.thumb,
    backgroundColor: colors.surfaceLight,
    overflow: 'hidden',
  },
  fallbackThumb: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  moduleText: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  readLabel: {
    color: colors.text,
    fontSize: type_.label,
    fontWeight: weight.semibold,
  },
  trigger: {
    color: colors.textMuted,
    fontSize: type_.meta,
    lineHeight: 15,
    marginTop: spacing.xs,
  },
  empty: {
    color: colors.textMuted,
    fontSize: type_.label,
    textAlign: 'center',
    paddingVertical: spacing['6xl'],
  },
});
