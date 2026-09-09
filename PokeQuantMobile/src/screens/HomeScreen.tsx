import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useRecyclingState } from '@shopify/flash-list';
import { FlashList } from '@shopify/flash-list';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { colors } from '../constants/colors';
import { useVendorStore } from '../store/vendorStore';
import { useProgressStore } from '../store/progressStore';
import { getCatalogImageUri } from '../services/CatalogImageService';
import {
  useInventoryStore,
  type CompletedSale,
  type InventoryCard,
} from '../store/inventoryStore';

// --- Shared exports used by other screens/components ---

export type Period = '1d' | '3d' | '1w';

export type Mover = {
  name: string;
  number: string;
  set: string;
  rarity: string;
  condition: string;
  productId?: number;
  oldPrice: number;
  newPrice: number;
};

export type VelocityWindow = {
  label: string;
  change: number;
  movers: Mover[];
};

export const VELOCITY_DATA: Record<Period, VelocityWindow> = {
  '1d': { label: '1-Day', change: 0, movers: [] },
  '3d': { label: '3-Day', change: 0, movers: [] },
  '1w': { label: '1-Week', change: 0, movers: [] },
};

export const METRICS = {
  activeAssets: 0,
  totalCostBasis: 0,
  projectedSticker: 0,
  projectedProfit: 0,
  profit24h: 0,
};

export function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function formatSignedCurrency(value: number): string {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

export function MiniMoverCard({ mover }: { mover: Mover }) {
  const isUp = mover.newPrice >= mover.oldPrice;
  const [imageError, setImageError] = useState(false);
  const imageUrl = useMemo(
    () => getCatalogImageUri(mover.productId),
    [mover.productId]
  );
  return (
    <View style={sharedStyles.moverCard}>
      <View style={sharedStyles.moverImage}>
        {imageUrl && !imageError ? (
          <Image
            source={{ uri: imageUrl }}
            style={sharedStyles.moverImageFill}
            contentFit="contain"
            cachePolicy="memory-disk"
            onError={() => setImageError(true)}
          />
        ) : (
          <Text style={sharedStyles.moverImageText}>IMG</Text>
        )}
      </View>
      <Text style={sharedStyles.moverName} numberOfLines={2}>
        {mover.name}
      </Text>
      <Text style={sharedStyles.moverNumber}>
        {mover.number} · {mover.set}
      </Text>
      <View style={sharedStyles.moverPillRow}>
        <View style={sharedStyles.moverPill}>
          <Text style={sharedStyles.moverPillText}>{mover.rarity}</Text>
        </View>
        <View style={sharedStyles.moverPill}>
          <Text style={sharedStyles.moverPillText}>{mover.condition}</Text>
        </View>
      </View>
      <View style={sharedStyles.shiftRow}>
        <Text style={sharedStyles.shiftLabel}>Sticker</Text>
        <View style={sharedStyles.shiftPrices}>
          <Text style={sharedStyles.oldPrice}>{formatCurrency(mover.oldPrice)}</Text>
          <Text style={sharedStyles.shiftArrow}>→</Text>
          <Text
            style={[
              sharedStyles.newPrice,
              { color: isUp ? colors.success : colors.error },
            ]}>
            {formatCurrency(mover.newPrice)}
          </Text>
        </View>
      </View>
    </View>
  );
}

// --- Home Dashboard ---

type RestickerItem = {
  card: InventoryCard;
  targetSticker: number;
};

function normalizeCurrencyInput(text: string): string {
  return text
    .replace(/[^0-9.]/g, '')
    .replace(/(\..*?)\./g, '$1');
}

function SyncBadge({
  isSyncing,
  pendingSyncCount,
}: {
  isSyncing: boolean;
  pendingSyncCount: number;
}) {
  const hasPending = pendingSyncCount > 0;
  const isActive = isSyncing || hasPending;
  const badgeColor = isActive ? colors.warning : colors.success;
  const badgeBg = isActive
    ? 'rgba(245, 158, 11, 0.12)'
    : 'rgba(34, 197, 94, 0.12)';

  let label: string;
  if (isSyncing) {
    label = 'Syncing...';
  } else if (hasPending) {
    label = `${pendingSyncCount} pending`;
  } else {
    label = 'Synced';
  }

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: badgeBg,
          borderColor: badgeColor,
        },
      ]}>
      <View style={[styles.badgeDot, { backgroundColor: badgeColor }]} />
      <Text style={[styles.badgeText, { color: badgeColor }]}>{label}</Text>
    </View>
  );
}

function QuickQuote() {
  const getCashOffer = useVendorStore((state) => state.getCashOffer);
  const getStickerPrice = useVendorStore((state) => state.getStickerPrice);
  const tiers = useVendorStore((state) => state.tiers);
  const stickerRules = useVendorStore((state) => state.stickerRules);
  const [rawValue, setRawValue] = useState('');

  const { buyOffer, targetSticker } = useMemo(() => {
    const marketPrice = Number.parseFloat(rawValue);
    const isValid = !Number.isNaN(marketPrice) && marketPrice > 0;
    return {
      buyOffer: isValid ? getCashOffer(marketPrice) : null,
      targetSticker: isValid ? getStickerPrice(marketPrice) : null,
    };
  }, [rawValue, tiers, stickerRules, getCashOffer, getStickerPrice]);

  const profit =
    buyOffer != null && targetSticker != null
      ? (targetSticker ?? 0) - (buyOffer ?? 0)
      : null;
  const profitColor =
    profit != null && profit >= 0 ? colors.success : colors.error;

  const handleClear = () => setRawValue('');

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Quick Quote</Text>
      <View style={styles.quoteOutputs}>
        <View style={styles.quoteInputBox}>
          <Text style={styles.quoteOutputLabel} numberOfLines={1}>
            Raw ($)
          </Text>
          <View style={styles.quoteInputRow}>
            <TextInput
              style={styles.quoteInput}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.textMuted}
              value={rawValue}
              onChangeText={(text) =>
                setRawValue(normalizeCurrencyInput(text))
              }
              returnKeyType="done"
              autoCorrect={false}
            />
            {rawValue.length > 0 && (
              <TouchableOpacity
                style={styles.clearButton}
                activeOpacity={0.7}
                onPress={handleClear}>
                <Ionicons
                  name="close-circle"
                  size={14}
                  color={colors.textMuted}
                />
              </TouchableOpacity>
            )}
          </View>
        </View>

        <View style={styles.quoteOutputBox}>
          <Text style={styles.quoteOutputLabel} numberOfLines={1}>
            Buy Offer
          </Text>
          <View style={styles.quoteOutputValueTrack}>
            <Text
              style={[styles.quoteOutputValue, { color: colors.success }]}
              numberOfLines={1}
              adjustsFontSizeToFit>
              {buyOffer != null ? formatCurrency(buyOffer) : '—'}
            </Text>
          </View>
        </View>

        <View style={styles.quoteOutputBox}>
          <Text style={styles.quoteOutputLabel} numberOfLines={1}>
            Profit
          </Text>
          <View style={styles.quoteOutputValueTrack}>
            <Text
              style={[
                styles.quoteOutputValue,
                { color: profit != null ? profitColor : colors.text },
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit>
              {profit != null ? formatCurrency(profit) : '—'}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

type LiveHorizon = 'day' | 'week' | 'month';

const HORIZON_OPTIONS: { key: LiveHorizon; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

function parseSaleDate(dateString: string): Date {
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return new Date();
  return d;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, days: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + days);
  return result;
}

function formatShortDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

type LivePage = {
  label: string;
  start: Date;
  end: Date;
  revenue: number;
  cost: number;
  profit: number;
};

function buildLivePages(
  horizon: LiveHorizon,
  now: Date,
  sales: CompletedSale[]
): LivePage[] {
  const today = startOfDay(now);
  if (horizon === 'day') {
    return Array.from({ length: 30 }, (_, n) => {
      const start = addDays(today, -n);
      const end = addDays(start, 1);
      const filtered = sales.filter((s) => {
        const d = parseSaleDate(s.dateSold);
        return d.getTime() >= start.getTime() && d.getTime() < end.getTime();
      });
      const revenue = filtered.reduce((sum, s) => sum + s.soldPrice, 0);
      const cost = filtered.reduce((sum, s) => sum + s.acquiredCost, 0);
      return {
        label: n === 0 ? 'Today' : formatShortDate(start),
        start,
        end,
        revenue,
        cost,
        profit: revenue - cost,
      };
    });
  }

  const windowDays = horizon === 'week' ? 7 : 30;
  const count = 12;
  return Array.from({ length: count }, (_, n) => {
    const end = addDays(today, -n * windowDays + 1);
    const start = addDays(end, -windowDays);
    const filtered = sales.filter((s) => {
      const d = parseSaleDate(s.dateSold);
      return d.getTime() >= start.getTime() && d.getTime() < end.getTime();
    });
    const revenue = filtered.reduce((sum, s) => sum + s.soldPrice, 0);
    const cost = filtered.reduce((sum, s) => sum + s.acquiredCost, 0);
    const label = `${formatShortDate(start)}-${formatShortDate(
      addDays(end, -1)
    )}`;
    return {
      label,
      start,
      end,
      revenue,
      cost,
      profit: revenue - cost,
    };
  });
}

function LiveSessionAnalytics() {
  const completedSales = useInventoryStore((state) => state.completedSales);
  const { width: windowWidth } = useWindowDimensions();
  const pageWidth = windowWidth - 56;

  const [liveHorizon, setLiveHorizon] = useState<LiveHorizon>('day');
  const [liveIndex, setLiveIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const pages = useMemo(
    () => buildLivePages(liveHorizon, new Date(), completedSales),
    [liveHorizon, completedSales]
  );

  const activePage = pages[liveIndex];

  const handleHorizonChange = useCallback((h: LiveHorizon) => {
    setLiveHorizon(h);
    setLiveIndex(0);
    scrollRef.current?.scrollTo({ x: 0, animated: true });
  }, []);

  const handleScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = event.nativeEvent.contentOffset.x;
      const index = Math.round(x / pageWidth);
      setLiveIndex(Math.max(0, Math.min(pages.length - 1, index)));
    },
    [pageWidth, pages.length]
  );

  return (
    <View style={styles.card}>
      <View style={styles.liveHeader}>
        <View>
          <Text style={styles.sectionTitle}>Live Session</Text>
          <Text style={styles.liveSubtitle}>
            {activePage?.label ?? ''}
          </Text>
        </View>
        <View style={styles.livePills}>
          {HORIZON_OPTIONS.map((opt) => {
            const active = liveHorizon === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[
                  styles.livePill,
                  active && styles.livePillActive,
                ]}
                activeOpacity={0.7}
                onPress={() => handleHorizonChange(opt.key)}>
                <Text
                  style={[
                    styles.livePillText,
                    active && styles.livePillTextActive,
                  ]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScrollEnd}
        snapToInterval={pageWidth}
        decelerationRate="fast"
        snapToAlignment="start"
        style={[styles.liveScrollView, { width: pageWidth }]}
        contentContainerStyle={{ width: pages.length * pageWidth }}>
        {pages.map((page, i) => {
          const profitColor =
            page.profit >= 0 ? colors.success : colors.error;
          return (
            <View
              key={`${liveHorizon}-${i}`}
              style={[styles.livePage, { width: pageWidth }]}>
              <View style={styles.analyticsGrid}>
                <View style={styles.analyticsCell}>
                  <Text style={styles.analyticsValue}>
                    {formatCurrency(page.revenue)}
                  </Text>
                  <Text style={styles.analyticsLabel}>Gross Revenue</Text>
                </View>

                <View style={styles.analyticsCell}>
                  <Text style={styles.analyticsValue}>
                    {formatCurrency(page.cost)}
                  </Text>
                  <Text style={styles.analyticsLabel}>Total Cost</Text>
                </View>

                <View style={styles.analyticsCell}>
                  <Text
                    style={[
                      styles.analyticsValue,
                      { color: profitColor },
                    ]}>
                    {formatCurrency(page.profit)}
                  </Text>
                  <Text style={styles.analyticsLabel}>Net Profit</Text>
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.dotRow}>
        {(() => {
          const maxDots = 3;
          const count = Math.min(pages.length, maxDots);
          let start = 0;
          if (pages.length > maxDots) {
            if (liveIndex >= pages.length - 1) {
              start = pages.length - maxDots;
            } else if (liveIndex > 0) {
              start = liveIndex - 1;
            }
          }
          return Array.from({ length: count }).map((_, i) => {
            const pageIndex = start + i;
            const active = pageIndex === liveIndex;
            const isFaded =
              !active &&
              ((i === 0 && start > 0) ||
                (i === count - 1 && pageIndex < pages.length - 1));
            return (
              <View
                key={`dot-${liveHorizon}-${pageIndex}`}
                style={[
                  styles.dot,
                  active && styles.dotActive,
                  isFaded && styles.dotMore,
                ]}
              />
            );
          });
        })()}
      </View>
    </View>
  );
}

const RestickerRow = memo(function RestickerRow({
  item,
  onUpdate,
}: {
  item: RestickerItem;
  onUpdate: (item: RestickerItem) => Promise<void>;
}) {
  const [updating, setUpdating] = useRecyclingState(false, [item.card.id]);

  const handlePress = async () => {
    if (updating) return;
    setUpdating(true);
    try {
      await onUpdate(item);
    } finally {
      setUpdating(false);
    }
  };

  const meta = [item.card.number, item.card.set]
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .join(' · ');

  return (
    <View style={styles.radarRow}>
      <View style={styles.radarInfo}>
        <Text style={styles.radarName} numberOfLines={1}>
          {item.card.name}
        </Text>
        {meta.length > 0 && <Text style={styles.radarMeta}>{meta}</Text>}
        <View style={styles.radarPrices}>
          <Text style={styles.radarCurrent}>
            {formatCurrency(item.card.stickerPrice)}
          </Text>
          <Text style={styles.radarArrow}>→</Text>
          <Text style={styles.radarTarget}>
            {formatCurrency(item.targetSticker)}
          </Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.radarButton, updating && styles.radarButtonDisabled]}
        activeOpacity={updating ? 1 : 0.7}
        onPress={handlePress}
        disabled={updating}>
        <Text
          style={[
            styles.radarButtonText,
            updating && styles.radarButtonTextDisabled,
          ]}>
          {updating ? '...' : 'Update Sticker'}
        </Text>
      </TouchableOpacity>
    </View>
  );
});

function RestickerRadar() {
  const inventory = useInventoryStore((state) => state.inventory);
  const getStickerPrice = useVendorStore((state) => state.getStickerPrice);
  const stickerRules = useVendorStore((state) => state.stickerRules);
  const updateInventoryCard = useInventoryStore(
    (state) => state.updateInventoryCard
  );

  const radarData = useMemo<RestickerItem[]>(() => {
    const flagged: RestickerItem[] = [];
    for (const card of inventory) {
      const target = getStickerPrice(card.liveMarket);
      if (card.stickerPrice.toFixed(2) !== target.toFixed(2)) {
        flagged.push({ card, targetSticker: target });
      }
    }
    return flagged;
  }, [inventory, stickerRules, getStickerPrice]);

  const handleUpdate = useCallback(
    async (item: RestickerItem) => {
      await updateInventoryCard({
        id: item.card.id,
        stickerPrice: item.targetSticker,
      });
    },
    [updateInventoryCard]
  );

  const renderItem = useCallback(
    ({ item }: { item: RestickerItem }) => (
      <RestickerRow item={item} onUpdate={handleUpdate} />
    ),
    [handleUpdate]
  );

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Resticker Radar</Text>
      <View style={styles.radarListContainer}>
        <FlashList<RestickerItem>
          data={radarData}
          renderItem={renderItem}
          keyExtractor={(item) => item.card.id}
          nestedScrollEnabled
          ListEmptyComponent={
            <View style={styles.radarEmpty}>
              <Ionicons
                name="checkmark-circle"
                size={40}
                color={colors.success}
              />
              <Text style={styles.radarEmptyText}>
                All inventory is priced accurately.
              </Text>
            </View>
          }
          contentContainerStyle={styles.radarContent}
          style={styles.radarList}
        />
      </View>
    </View>
  );
}

function CatalogTimestamp() {
  const catalogLastUpdated = useProgressStore(
    (state) => state.catalogLastUpdated
  );

  const label = useMemo(() => {
    if (catalogLastUpdated == null) {
      return 'Prices: Unknown';
    }

    const date = new Date(catalogLastUpdated);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const time = date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });

    return isToday ? `Prices: Today, ${time}` : `Prices: ${time}`;
  }, [catalogLastUpdated]);

  return <Text style={styles.timestampText}>{label}</Text>;
}

export function HomeScreen() {
  const pendingSyncCount = useInventoryStore((state) => state.pendingSyncCount);
  const isSyncing = useInventoryStore((state) => state.isSyncing);

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Dashboard</Text>
            <Text style={styles.subtitle}>Live session & quick quotes</Text>
          </View>
          <View style={styles.statusBlock}>
            <SyncBadge
              isSyncing={isSyncing}
              pendingSyncCount={pendingSyncCount}
            />
            <CatalogTimestamp />
          </View>
        </View>

        <QuickQuote />
        <LiveSessionAnalytics />
        <RestickerRadar />
      </ScrollView>
    </View>
  );
}

const sharedStyles = StyleSheet.create({
  moverCard: {
    width: 140,
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    marginRight: 10,
  },
  moverImage: {
    height: 80,
    backgroundColor: colors.surfaceLight,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  moverImageFill: {
    width: '100%',
    height: '100%',
    marginBottom: 8,
  },
  moverImageText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  moverName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 1,
  },
  moverNumber: {
    color: colors.textMuted,
    fontSize: 10,
    marginBottom: 6,
  },
  moverPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 6,
  },
  moverPill: {
    backgroundColor: colors.surfaceLight,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 2,
    paddingHorizontal: 6,
    marginRight: 4,
    marginBottom: 3,
  },
  moverPillText: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '500',
  },
  shiftRow: {
    marginTop: 'auto',
  },
  shiftLabel: {
    color: colors.textMuted,
    fontSize: 9,
    marginBottom: 1,
  },
  shiftPrices: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  oldPrice: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  shiftArrow: {
    color: colors.textMuted,
    fontSize: 12,
    marginHorizontal: 3,
  },
  newPrice: {
    fontSize: 13,
    fontWeight: 'bold',
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  statusBlock: {
    alignItems: 'flex-end',
  },
  timestampText: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 4,
    textAlign: 'right',
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: 'bold',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  badgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    marginBottom: 12,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  quoteInput: {
    width: '100%',
    height: 34,
    color: colors.text,
    fontSize: 18,
    fontWeight: 'bold',
    paddingVertical: 0,
    paddingHorizontal: 18,
    textAlign: 'center',
  },
  clearButton: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  quoteOutputs: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
  },
  quoteInputBox: {
    flex: 1,
    width: 0,
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quoteInputRow: {
    width: '100%',
    height: 34,
    position: 'relative',
  },
  quoteOutputBox: {
    flex: 1,
    width: 0,
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quoteOutputLabel: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: 4,
  },
  quoteOutputValueTrack: {
    width: '100%',
    height: 34,
    justifyContent: 'center',
    alignItems: 'stretch',
  },
  quoteOutputValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: 'bold',
    width: '100%',
    textAlign: 'center',
  },
  analyticsGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  analyticsCell: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    alignItems: 'center',
  },
  analyticsValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  analyticsLabel: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
  },
  radarListContainer: {
    height: 180,
  },
  radarList: {
    flex: 1,
  },
  radarContent: {
    paddingVertical: 2,
  },
  radarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 8,
    marginBottom: 6,
  },
  radarInfo: {
    flex: 1,
    paddingRight: 8,
  },
  radarName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  radarMeta: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
    marginBottom: 4,
  },
  radarPrices: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  radarCurrent: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '500',
  },
  radarArrow: {
    color: colors.textMuted,
    fontSize: 13,
    marginHorizontal: 6,
  },
  radarTarget: {
    color: colors.success,
    fontSize: 13,
    fontWeight: 'bold',
  },
  radarButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  radarButtonDisabled: {
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
  },
  radarButtonText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  radarButtonTextDisabled: {
    color: colors.textMuted,
  },
  radarEmpty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  radarEmptyText: {
    color: colors.success,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 12,
    textAlign: 'center',
  },
  liveHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  liveSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  livePills: {
    flexDirection: 'row',
    backgroundColor: colors.background,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 2,
  },
  livePill: {
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  livePillActive: {
    backgroundColor: colors.primary,
  },
  livePillText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  livePillTextActive: {
    color: colors.text,
  },
  liveScrollView: {
    height: 110,
  },
  livePage: {
    height: 110,
    justifyContent: 'center',
  },
  dotRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  dotActive: {
    backgroundColor: colors.primary,
  },
  dotMore: {
    opacity: 0.35,
  },
});
