import { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  useNavigation,
  type NavigationProp,
  type ParamListBase,
} from '@react-navigation/native';
import { colors } from '../constants/colors';

type Period = '1d' | '3d' | '1w';

type Mover = {
  name: string;
  number: string;
  set: string;
  rarity: string;
  condition: string;
  oldPrice: number;
  newPrice: number;
};

type VelocityWindow = {
  label: string;
  change: number;
  movers: Mover[];
};

const VELOCITY_DATA: Record<Period, VelocityWindow> = {
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

const METRICS = {
  activeAssets: 53,
  totalCostBasis: 208.69,
  projectedSticker: 365.0,
  projectedProfit: 156.31,
  profit24h: 6.0,
};

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatSignedCurrency(value: number): string {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function MiniMoverCard({ mover }: { mover: Mover }) {
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

export function HomeScreen() {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const [velocityExpanded, setVelocityExpanded] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState<Period>('1d');

  const current = VELOCITY_DATA[selectedPeriod];

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>PokeQuant</Text>
          <Text style={styles.subtitle}>Trading terminal ready.</Text>
        </View>

        <TouchableOpacity
          style={styles.quickView}
          activeOpacity={0.8}
          onPress={() => navigation.navigate('Inventory')}>
          <View style={styles.quickViewHeader}>
            <Text style={styles.quickViewTitle}>Quick View: Active Inventory</Text>
            <Text style={styles.quickViewArrow}>→</Text>
          </View>
          <View style={styles.quickViewStats}>
            <View style={styles.quickViewStat}>
              <Text style={styles.quickViewValue}>{METRICS.activeAssets}</Text>
              <Text style={styles.quickViewLabel}>Active</Text>
            </View>
            <View style={styles.quickViewStat}>
              <Text style={styles.quickViewValue}>
                {formatCurrency(METRICS.totalCostBasis)}
              </Text>
              <Text style={styles.quickViewLabel}>Cost Basis</Text>
            </View>
            <View style={styles.quickViewStat}>
              <Text style={styles.quickViewValue}>
                {formatCurrency(METRICS.projectedProfit)}
              </Text>
              <Text style={styles.quickViewLabel}>Profit</Text>
            </View>
          </View>
        </TouchableOpacity>

        <View style={styles.metricsContainer}>
          <Text style={styles.sectionTitle}>Condensed Metrics</Text>
          <View style={styles.metricsGrid}>
            <View style={styles.metricTile}>
              <Text style={styles.metricLabel}>Active Assets</Text>
              <Text style={styles.metricValue}>{METRICS.activeAssets}</Text>
            </View>
            <View style={styles.metricTile}>
              <Text style={styles.metricLabel}>Total Cost Basis</Text>
              <Text style={styles.metricValue}>
                {formatCurrency(METRICS.totalCostBasis)}
              </Text>
            </View>
            <View style={styles.metricTile}>
              <Text style={styles.metricLabel}>Proj. Sticker Price</Text>
              <Text style={styles.metricValue}>
                {formatCurrency(METRICS.projectedSticker)}
              </Text>
            </View>
            <View style={styles.metricTile}>
              <View style={styles.metricLabelRow}>
                <Text style={styles.metricLabel}>Live Proj. Profit</Text>
                <View
                  style={[
                    styles.profitPill,
                    {
                      backgroundColor: 'rgba(34, 197, 94, 0.15)',
                      borderColor: colors.success,
                    },
                  ]}>
                  <Text
                    style={[styles.profitPillText, { color: colors.success }]}>
                    ↑ {formatSignedCurrency(METRICS.profit24h)} (24h)
                  </Text>
                </View>
              </View>
              <Text style={styles.metricValue}>
                {formatCurrency(METRICS.projectedProfit)}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.accordionContainer}>
          <TouchableOpacity
            style={styles.accordionHeader}
            onPress={() => setVelocityExpanded((v) => !v)}>
            <Text style={styles.accordionTitle}>
              Velocity Breakdown (Live Market Shifts)
            </Text>
            <View style={styles.summaryPills}>
              {(Object.keys(VELOCITY_DATA) as Period[]).map((p) => {
                const data = VELOCITY_DATA[p];
                const isPositive = data.change >= 0;
                return (
                  <View
                    key={p}
                    style={[
                      styles.summaryPill,
                      {
                        backgroundColor: isPositive
                          ? 'rgba(34, 197, 94, 0.12)'
                          : 'rgba(239, 68, 68, 0.12)',
                        borderColor: isPositive ? colors.success : colors.error,
                      },
                    ]}>
                    <Text
                      style={[
                        styles.summaryPillText,
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
            <View style={styles.accordionBody}>
              <View style={styles.tabRow}>
                {(Object.keys(VELOCITY_DATA) as Period[]).map((p) => {
                  const isActive = p === selectedPeriod;
                  return (
                    <TouchableOpacity
                      key={p}
                      style={[styles.tab, isActive && styles.tabActive]}
                      onPress={() => setSelectedPeriod(p)}>
                      <Text
                        style={[
                          styles.tabText,
                          isActive && styles.tabTextActive,
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
                contentContainerStyle={styles.moverScroll}>
                {current.movers.map((mover, index) => (
                  <MiniMoverCard key={index} mover={mover} />
                ))}
              </ScrollView>
            </View>
          )}
        </View>

        <View style={styles.navContainer}>
          <Text style={styles.sectionTitle}>Modules</Text>
          {[
            {
              route: 'SearchBuy',
              title: 'Search & Buy',
              subtitle: 'Find cards and run cash offers',
            },
            {
              route: 'Inventory',
              title: 'Inventory',
              subtitle: 'Manage active inventory',
            },
            {
              route: 'Settings',
              title: 'Settings',
              subtitle: 'Vendor settings and buy tiers',
            },
          ].map((module) => (
            <TouchableOpacity
              key={module.route}
              style={styles.navCard}
              activeOpacity={0.8}
              onPress={() => navigation.navigate(module.route)}>
              <View style={styles.navCardHeader}>
                <Text style={styles.navCardTitle}>{module.title}</Text>
                <Text style={styles.navCardArrow}>→</Text>
              </View>
              <Text style={styles.navCardSubtitle}>{module.subtitle}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
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
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  header: {
    paddingTop: 60,
    paddingBottom: 12,
  },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: 'bold',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 16,
    marginTop: 4,
  },
  quickView: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginTop: 8,
    marginBottom: 20,
  },
  quickViewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  quickViewTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  quickViewArrow: {
    color: colors.primary,
    fontSize: 18,
    fontWeight: 'bold',
  },
  quickViewStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  quickViewStat: {
    flex: 1,
    alignItems: 'center',
  },
  quickViewValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: 'bold',
  },
  quickViewLabel: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  metricsContainer: {
    marginBottom: 20,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  metricTile: {
    width: '48%',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 12,
    justifyContent: 'space-between',
    minHeight: 100,
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  metricLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    marginBottom: 6,
  },
  metricValue: {
    color: colors.text,
    fontSize: 22,
    fontWeight: 'bold',
  },
  profitPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 2,
    paddingHorizontal: 6,
    marginLeft: 4,
  },
  profitPillText: {
    fontSize: 10,
    fontWeight: '600',
  },
  accordionContainer: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 20,
    overflow: 'hidden',
  },
  accordionHeader: {
    padding: 16,
  },
  accordionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 10,
  },
  summaryPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  summaryPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginRight: 8,
    marginBottom: 4,
  },
  summaryPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  accordionBody: {
    padding: 16,
    paddingTop: 0,
  },
  tabRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
  },
  tabActive: {
    borderBottomColor: colors.primary,
  },
  tabText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '500',
  },
  tabTextActive: {
    color: colors.text,
    fontWeight: 'bold',
  },
  moverScroll: {
    paddingVertical: 4,
  },
  moverCard: {
    width: 160,
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginRight: 12,
  },
  moverImage: {
    height: 100,
    backgroundColor: colors.surfaceLight,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  moverImageText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  moverName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  moverNumber: {
    color: colors.textMuted,
    fontSize: 11,
    marginBottom: 8,
  },
  moverPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  moverPill: {
    backgroundColor: colors.surfaceLight,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 3,
    paddingHorizontal: 8,
    marginRight: 6,
    marginBottom: 4,
  },
  moverPillText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '500',
  },
  shiftRow: {
    marginTop: 'auto',
  },
  shiftLabel: {
    color: colors.textMuted,
    fontSize: 10,
    marginBottom: 2,
  },
  shiftPrices: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  oldPrice: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '500',
  },
  shiftArrow: {
    color: colors.textMuted,
    fontSize: 13,
    marginHorizontal: 4,
  },
  newPrice: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  navContainer: {
    marginBottom: 16,
  },
  navCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 12,
  },
  navCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  navCardTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  navCardArrow: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: 'bold',
  },
  navCardSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
  },
});
