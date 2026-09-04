import { memo, useCallback, useMemo, useState } from 'react';
import { useRecyclingState } from '@shopify/flash-list';
import { FlashList } from '@shopify/flash-list';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import { useVendorStore } from '../store/vendorStore';
import { useProgressStore } from '../store/progressStore';
import {
  useInventoryStore,
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
  return (
    <View style={sharedStyles.moverCard}>
      <View style={sharedStyles.moverImage}>
        <Text style={sharedStyles.moverImageText}>IMG</Text>
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

  const handleClear = () => setRawValue('');

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Quick Quote</Text>
      <Text style={styles.inputLabel}>Raw Market Value ($)</Text>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.quoteInput}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor={colors.textMuted}
          value={rawValue}
          onChangeText={(text) => setRawValue(normalizeCurrencyInput(text))}
          returnKeyType="done"
          autoCorrect={false}
        />
        {rawValue.length > 0 && (
          <TouchableOpacity
            style={styles.clearButton}
            activeOpacity={0.7}
            onPress={handleClear}>
            <Ionicons name="close-circle" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.quoteOutputs}>
        <View style={styles.quoteOutputBox}>
          <Text style={styles.quoteOutputLabel}>Buy Offer</Text>
          <Text style={[styles.quoteOutputValue, { color: colors.success }]}>
            {buyOffer != null ? formatCurrency(buyOffer) : '—'}
          </Text>
        </View>
        <View style={styles.quoteOutputBox}>
          <Text style={styles.quoteOutputLabel}>Target Sticker</Text>
          <Text style={styles.quoteOutputValue}>
            {targetSticker != null ? formatCurrency(targetSticker) : '—'}
          </Text>
        </View>
      </View>
    </View>
  );
}

function LiveSessionAnalytics() {
  const completedSales = useInventoryStore((state) => state.completedSales);

  const { grossRevenue, totalCost, netProfit } = useMemo(() => {
    const gross = completedSales.reduce((sum, s) => sum + s.soldPrice, 0);
    const cost = completedSales.reduce((sum, s) => sum + s.acquiredCost, 0);
    return { grossRevenue: gross, totalCost: cost, netProfit: gross - cost };
  }, [completedSales]);

  const profitColor = netProfit >= 0 ? colors.success : colors.error;

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Live Session</Text>
      <View style={styles.analyticsGrid}>
        <View style={styles.analyticsCell}>
          <Text style={styles.analyticsValue}>
            {formatCurrency(grossRevenue)}
          </Text>
          <Text style={styles.analyticsLabel}>Gross Revenue</Text>
        </View>

        <View style={styles.analyticsCell}>
          <Text style={styles.analyticsValue}>
            {formatCurrency(totalCost)}
          </Text>
          <Text style={styles.analyticsLabel}>Total Cost</Text>
        </View>

        <View style={styles.analyticsCell}>
          <Text style={[styles.analyticsValue, { color: profitColor }]}>
            {formatCurrency(netProfit)}
          </Text>
          <Text style={styles.analyticsLabel}>Net Profit</Text>
        </View>
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
            <Text style={styles.title}>PokeQuant</Text>
            <Text style={styles.subtitle}>Vendor Dashboard</Text>
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
    paddingBottom: 24,
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
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  inputLabel: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 8,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  quoteInput: {
    flex: 1,
    color: colors.text,
    fontSize: 28,
    fontWeight: 'bold',
    paddingVertical: 16,
  },
  clearButton: {
    padding: 4,
    marginLeft: 4,
  },
  quoteOutputs: {
    flexDirection: 'row',
    gap: 12,
  },
  quoteOutputBox: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    alignItems: 'center',
  },
  quoteOutputLabel: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 6,
  },
  quoteOutputValue: {
    color: colors.text,
    fontSize: 22,
    fontWeight: 'bold',
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
    height: 300,
  },
  radarList: {
    flex: 1,
  },
  radarContent: {
    paddingVertical: 4,
  },
  radarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 8,
  },
  radarInfo: {
    flex: 1,
    paddingRight: 12,
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
    marginBottom: 6,
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
    paddingVertical: 8,
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
});
