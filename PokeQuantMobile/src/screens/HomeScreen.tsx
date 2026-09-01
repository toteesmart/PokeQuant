import { useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AddAssetModal } from '../components/AddAssetModal';
import { QuickCashOfferModal } from '../components/QuickCashOfferModal';
import { colors } from '../constants/colors';

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
  '1d': {
    label: '1-Day',
    change: 6.0,
    movers: [
      {
        name: 'Pikachu VMAX',
        number: '44/185',
        set: 'Vivid Voltage',
        rarity: 'Secret Rare',
        condition: 'NM',
        oldPrice: 14.0,
        newPrice: 20.0,
      },
      {
        name: 'Charizard V',
        number: '19/189',
        set: 'Darkness Ablaze',
        rarity: 'Ultra Rare',
        condition: 'LP',
        oldPrice: 8.5,
        newPrice: 12.0,
      },
      {
        name: 'Mewtwo VSTAR',
        number: '086/172',
        set: 'Brilliant Stars',
        rarity: 'Rainbow Rare',
        condition: 'NM',
        oldPrice: 22.0,
        newPrice: 18.5,
      },
    ],
  },
  '3d': {
    label: '3-Day',
    change: -3.0,
    movers: [
      {
        name: 'Mewtwo VSTAR',
        number: '086/172',
        set: 'Brilliant Stars',
        rarity: 'Rainbow Rare',
        condition: 'NM',
        oldPrice: 22.0,
        newPrice: 18.5,
      },
      {
        name: 'Raichu GX',
        number: '29/68',
        set: 'Hidden Fates',
        rarity: 'Shiny',
        condition: 'NM',
        oldPrice: 11.0,
        newPrice: 9.0,
      },
    ],
  },
  '1w': {
    label: '1-Week',
    change: -2.0,
    movers: [
      {
        name: 'Blastoise GX',
        number: '35/214',
        set: 'Unbroken Bonds',
        rarity: 'Full Art',
        condition: 'LP',
        oldPrice: 16.0,
        newPrice: 14.0,
      },
      {
        name: 'Venusaur EX',
        number: '141/146',
        set: 'XY',
        rarity: 'EX',
        condition: 'MP',
        oldPrice: 7.0,
        newPrice: 5.5,
      },
      {
        name: 'Gengar VMAX',
        number: '157/264',
        set: 'Fusion Strike',
        rarity: 'Secret Rare',
        condition: 'NM',
        oldPrice: 31.0,
        newPrice: 34.0,
      },
      {
        name: 'Rayquaza V',
        number: '110/203',
        set: 'Evolving Skies',
        rarity: 'Alt Art',
        condition: 'NM',
        oldPrice: 45.0,
        newPrice: 42.0,
      },
    ],
  },
};

export const METRICS = {
  activeAssets: 53,
  totalCostBasis: 208.69,
  projectedSticker: 365.0,
  projectedProfit: 156.31,
  profit24h: 6.0,
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
    <View style={styles.moverCard}>
      <View style={styles.moverImage}>
        <Text style={styles.moverImageText}>IMG</Text>
      </View>
      <Text style={styles.moverName} numberOfLines={2}>
        {mover.name}
      </Text>
      <Text style={styles.moverNumber}>
        {mover.number} · {mover.set}
      </Text>
      <View style={styles.moverPillRow}>
        <View style={styles.moverPill}>
          <Text style={styles.moverPillText}>{mover.rarity}</Text>
        </View>
        <View style={styles.moverPill}>
          <Text style={styles.moverPillText}>{mover.condition}</Text>
        </View>
      </View>
      <View style={styles.shiftRow}>
        <Text style={styles.shiftLabel}>Sticker</Text>
        <View style={styles.shiftPrices}>
          <Text style={styles.oldPrice}>{formatCurrency(mover.oldPrice)}</Text>
          <Text style={styles.shiftArrow}>→</Text>
          <Text
            style={[
              styles.newPrice,
              { color: isUp ? colors.success : colors.error },
            ]}>
            {formatCurrency(mover.newPrice)}
          </Text>
        </View>
      </View>
    </View>
  );
}

type WatchItem = {
  name: string;
  number: string;
  set: string;
  oldPrice: number;
  livePrice: number;
  stickerPrice: number;
};

const WATCH_DATA: WatchItem[] = [
  {
    name: 'Charizard ex OB 054',
    number: '054/197',
    set: 'Obsidian Flames',
    oldPrice: 18.0,
    livePrice: 25.5,
    stickerPrice: 22.0,
  },
  {
    name: 'Pikachu ex PA 094',
    number: '094/193',
    set: 'Paldea Evolved',
    oldPrice: 11.0,
    livePrice: 9.1,
    stickerPrice: 7.0,
  },
  {
    name: 'Mewtwo ex GG 082',
    number: '082/165',
    set: '151',
    oldPrice: 15.0,
    livePrice: 18.2,
    stickerPrice: 20.0,
  },
  {
    name: 'Blastoise ex CN 176',
    number: '176/197',
    set: 'Crimson Haze',
    oldPrice: 9.0,
    livePrice: 12.34,
    stickerPrice: 8.0,
  },
  {
    name: 'Gengar VMAX BD 157',
    number: '157/264',
    set: 'Fusion Strike',
    oldPrice: 38.0,
    livePrice: 34.1,
    stickerPrice: 28.0,
  },
  {
    name: 'Lugia V AA 138',
    number: '138/195',
    set: 'Silver Tempest',
    oldPrice: 50.0,
    livePrice: 55.0,
    stickerPrice: 48.0,
  },
];

const SESSION = {
  syncStatus: 'Database 100% Offline Ready',
  syncTimestamp: 'Market Prices Updated: Today 6:00 AM',
  cashOutlay: 85.0,
  grossRevenue: 142.5,
  netRealized: 57.5,
};

type ActivityItem = {
  id: string;
  text: string;
  timeAgo: string;
};

const ACTIVITY_DATA: ActivityItem[] = [
  {
    id: '1',
    text: 'Sold Blastoise ex CN 176 for $8.00',
    timeAgo: '12m ago',
  },
  {
    id: '2',
    text: 'Acquired Gengar VMAX for $35.00',
    timeAgo: '1h ago',
  },
  {
    id: '3',
    text: 'Updated Sticker Price on Pikachu ex to $15.00',
    timeAgo: '2h ago',
  },
];

function HeroDock({
  onCashOffer,
  onAddCard,
  onTradeBuilder,
}: {
  onCashOffer: () => void;
  onAddCard: () => void;
  onTradeBuilder: () => void;
}) {
  return (
    <View style={commandStyles.heroDock}>
      <TouchableOpacity
        style={[commandStyles.heroButton, commandStyles.cashOfferButton]}
        activeOpacity={0.8}
        onPress={onCashOffer}>
        <Text style={commandStyles.heroIcon}>$</Text>
        <Text style={commandStyles.heroTitle}>Quick Cash Offer</Text>
        <Text style={commandStyles.heroSub}>Instant payout calc</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[commandStyles.heroButton, commandStyles.addCardButton]}
        activeOpacity={0.8}
        onPress={onAddCard}>
        <Text style={commandStyles.heroIcon}>+</Text>
        <Text style={commandStyles.heroTitle}>Rapid Add Card</Text>
        <Text style={commandStyles.heroSub}>Manual floor entry</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[commandStyles.heroButton, commandStyles.tradeButton]}
        activeOpacity={0.8}
        onPress={onTradeBuilder}>
        <Text style={commandStyles.heroIcon}>⇄</Text>
        <Text style={commandStyles.heroTitle}>Trade Builder</Text>
        <Text style={commandStyles.heroSub}>Split calc coming soon</Text>
      </TouchableOpacity>
    </View>
  );
}

function SessionPulse() {
  return (
    <View style={commandStyles.pulseCard}>
      <View style={commandStyles.syncPill}>
        <View style={commandStyles.syncDot} />
        <View style={commandStyles.syncTextStack}>
          <Text style={commandStyles.syncText}>{SESSION.syncStatus}</Text>
          <Text style={commandStyles.syncTimestamp}>
            {SESSION.syncTimestamp}
          </Text>
        </View>
      </View>

      <View style={commandStyles.metricRow}>
        <View style={commandStyles.metricChip}>
          <Text style={commandStyles.metricValue}>
            {formatCurrency(SESSION.cashOutlay)}
          </Text>
          <Text style={commandStyles.metricLabel}>Spent Today</Text>
          <Text style={commandStyles.metricSub}>Cash outlay</Text>
        </View>

        <View style={commandStyles.metricChip}>
          <Text style={commandStyles.metricValue}>
            {formatCurrency(SESSION.grossRevenue)}
          </Text>
          <Text style={commandStyles.metricLabel}>Gross Profit</Text>
          <Text style={commandStyles.metricSub}>Cash collected</Text>
        </View>

        <View style={commandStyles.metricChip}>
          <Text
            style={[
              commandStyles.metricValue,
              { color: colors.success },
            ]}>
            {formatSignedCurrency(SESSION.netRealized)}
          </Text>
          <Text style={commandStyles.metricLabel}>Net Profit</Text>
          <Text style={commandStyles.metricSub}>Positive cashflow</Text>
        </View>
      </View>
    </View>
  );
}

function MarketMoverCard({ item }: { item: WatchItem }) {
  const delta = item.livePrice - item.oldPrice;
  const isUp = delta >= 0;
  const resticker = item.livePrice > item.stickerPrice;

  return (
    <View style={commandStyles.watchCard}>
      <View style={commandStyles.watchImage}>
        <Text style={commandStyles.watchImageText}>IMG</Text>
      </View>
      <Text style={commandStyles.watchName} numberOfLines={2}>
        {item.name}
      </Text>
      <Text style={commandStyles.watchSet}>{item.number} · {item.set}</Text>
      <View style={commandStyles.watchPriceRow}>
        <Text style={commandStyles.watchPriceLabel}>Live</Text>
        <Text style={commandStyles.watchLivePrice}>
          {formatCurrency(item.livePrice)}
        </Text>
      </View>
      <View style={commandStyles.watchDeltaRow}>
        <Text
          style={[
            commandStyles.watchDelta,
            { color: isUp ? colors.success : colors.error },
          ]}>
          {formatSignedCurrency(delta)} (24h)
        </Text>
      </View>
      {resticker && (
        <View style={commandStyles.restickerBadge}>
          <Text style={commandStyles.restickerText}>Re-Sticker Recommended</Text>
        </View>
      )}
    </View>
  );
}

function MarketWatch({
  data,
  onAutoUpdate,
}: {
  data: WatchItem[];
  onAutoUpdate: () => void;
}) {
  const flaggedCount = data.filter(
    (item) => item.livePrice > item.stickerPrice
  ).length;

  return (
    <View style={commandStyles.sectionCard}>
      <View style={commandStyles.sectionHeader}>
        <Text style={commandStyles.sectionTitle}>
          Market Watch (24h Shifts)
        </Text>
        <TouchableOpacity
          style={[
            commandStyles.autoUpdateButton,
            flaggedCount === 0 && commandStyles.autoUpdateButtonDisabled,
          ]}
          activeOpacity={flaggedCount === 0 ? 1 : 0.7}
          onPress={onAutoUpdate}
          disabled={flaggedCount === 0}>
          <Text
            style={[
              commandStyles.autoUpdateText,
              flaggedCount === 0 && commandStyles.autoUpdateTextDisabled,
            ]}>
            Auto-Update Stickers
          </Text>
        </TouchableOpacity>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        nestedScrollEnabled
        contentContainerStyle={commandStyles.watchScroll}>
        {data.map((item, index) => (
          <MarketMoverCard key={index} item={item} />
        ))}
      </ScrollView>
    </View>
  );
}

function ActivityRow({
  item,
  onUndo,
}: {
  item: ActivityItem;
  onUndo: (id: string) => void;
}) {
  return (
    <View style={commandStyles.activityRow}>
      <View style={commandStyles.activityTextCol}>
        <Text style={commandStyles.activityText}>{item.text}</Text>
        <Text style={commandStyles.activityTime}>• {item.timeAgo}</Text>
      </View>
      <TouchableOpacity
        style={commandStyles.undoButton}
        activeOpacity={0.7}
        onPress={() => onUndo(item.id)}>
        <Text style={commandStyles.undoText}>Undo</Text>
      </TouchableOpacity>
    </View>
  );
}

function RecentActivity({
  items,
  onUndo,
}: {
  items: ActivityItem[];
  onUndo: (id: string) => void;
}) {
  return (
    <View style={commandStyles.sectionCard}>
      <Text style={commandStyles.sectionTitle}>Recent Floor Activity</Text>
      <View>
        {items.map((item) => (
          <ActivityRow key={item.id} item={item} onUndo={onUndo} />
        ))}
      </View>
    </View>
  );
}

export function HomeScreen() {
  const [showCashOffer, setShowCashOffer] = useState(false);
  const [showAddCard, setShowAddCard] = useState(false);
  const [activities, setActivities] = useState<ActivityItem[]>(ACTIVITY_DATA);
  const [watchData, setWatchData] = useState<WatchItem[]>(WATCH_DATA);

  const handleUndo = (id: string) => {
    setActivities((prev) => prev.filter((a) => a.id !== id));
  };

  const handleAutoUpdateStickers = () => {
    const flagged = watchData.filter((item) => item.livePrice > item.stickerPrice);
    if (flagged.length === 0) return;

    Alert.alert(
      'Auto-Update Stickers',
      `Pushing live market prices to active inventory for ${flagged.length} card(s).`
    );

    setWatchData((prev) =>
      prev.filter((item) => item.livePrice <= item.stickerPrice)
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <View style={commandStyles.header}>
          <Text style={commandStyles.title}>PokeQuant</Text>
          <Text style={commandStyles.subtitle}>
            Live Vendor Command Center
          </Text>
        </View>

        <HeroDock
          onCashOffer={() => setShowCashOffer(true)}
          onAddCard={() => setShowAddCard(true)}
          onTradeBuilder={() =>
            Alert.alert('Trade Builder', 'Split-screen calculator coming soon.')
          }
        />

        <SessionPulse />

        <MarketWatch
          data={watchData}
          onAutoUpdate={handleAutoUpdateStickers}
        />

        <RecentActivity items={activities} onUndo={handleUndo} />
      </ScrollView>

      <QuickCashOfferModal
        visible={showCashOffer}
        onClose={() => setShowCashOffer(false)}
      />

      <AddAssetModal
        visible={showAddCard}
        onClose={() => setShowAddCard(false)}
      />
    </View>
  );
}

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
    paddingBottom: 16,
  },
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

const commandStyles = StyleSheet.create({
  header: {
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: 'bold',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 2,
  },
  heroDock: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 12,
  },
  heroButton: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 108,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cashOfferButton: {
    backgroundColor: 'rgba(59, 130, 246, 0.18)',
    borderColor: colors.primary,
  },
  addCardButton: {
    backgroundColor: 'rgba(34, 197, 94, 0.18)',
    borderColor: colors.success,
  },
  tradeButton: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderColor: '#f59e0b',
  },
  heroIcon: {
    color: colors.text,
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  heroTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  heroSub: {
    color: colors.textMuted,
    fontSize: 10,
    textAlign: 'center',
    marginTop: 2,
  },
  pulseCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 12,
  },
  syncPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.success,
    paddingVertical: 4,
    paddingHorizontal: 10,
    marginBottom: 12,
  },
  syncDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
    marginRight: 6,
  },
  syncText: {
    color: colors.success,
    fontSize: 12,
    fontWeight: '600',
  },
  syncTextStack: {
    justifyContent: 'center',
  },
  syncTimestamp: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 1,
  },
  metricRow: {
    flexDirection: 'row',
    gap: 8,
  },
  metricChip: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  metricValue: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 4,
  },
  metricSub: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 1,
  },
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 12,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  autoUpdateButton: {
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  autoUpdateButtonDisabled: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
  },
  autoUpdateText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '600',
  },
  autoUpdateTextDisabled: {
    color: colors.textMuted,
  },
  watchScroll: {
    paddingVertical: 2,
  },
  watchCard: {
    width: 150,
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    marginRight: 10,
  },
  watchImage: {
    height: 80,
    backgroundColor: colors.surfaceLight,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  watchImageText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  watchName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 1,
  },
  watchSet: {
    color: colors.textMuted,
    fontSize: 10,
    marginBottom: 8,
  },
  watchPriceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  watchPriceLabel: {
    color: colors.textMuted,
    fontSize: 10,
  },
  watchLivePrice: {
    color: colors.text,
    fontSize: 12,
    fontWeight: 'bold',
  },
  watchDeltaRow: {
    marginBottom: 6,
  },
  watchDelta: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  restickerBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.error,
    paddingHorizontal: 6,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  restickerText: {
    color: colors.error,
    fontSize: 9,
    fontWeight: '600',
  },
  activityRow: {
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
  activityTextCol: {
    flex: 1,
    paddingRight: 8,
  },
  activityText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '500',
  },
  activityTime: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  undoButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  undoText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '600',
  },
});
