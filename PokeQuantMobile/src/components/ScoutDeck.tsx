import { memo, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import {
  controls,
  layout,
  radius,
  spacing,
  type_,
  weight,
} from '../constants/theme';
import { getCatalogImageUri } from '../services/CatalogImageService';
import { displayCardName } from '../scanner/services/catalog/catalogMatcher';
import { DealClassBadge } from '../scanner/atoms/DealClassBadge';
import type { ScoutCandidate } from '../scanner/services/deal/buyScout';

const TILE_WIDTH_RATIO = 0.66;
// Card art is 2.5:3.5 portrait — a 4:5 tile covers it with a slight
// side crop while keeping the tile proportion of the reference deck.
const TILE_ASPECT = 1.25;

type DeckItem = { kind: 'card'; c: ScoutCandidate } | { kind: 'seeAll' };

const SeeAllTile = memo(function SeeAllTile({
  count,
  redeployValue,
  width,
  height,
  onPress,
}: {
  count: number;
  redeployValue: number;
  width: number;
  height: number;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.tailTile, { width, height }]}
      activeOpacity={0.8}
      onPress={onPress}
      accessibilityLabel={`See all ${count} buy-scout cards`}
      accessibilityRole="button">
      <View style={styles.tailIconWrap}>
        <Ionicons
          name="layers-outline"
          size={22}
          color={colors.accentPurple}
        />
      </View>
      <Text style={styles.tailTitle}>See all {count}</Text>
      <Text style={styles.tailSub}>
        {redeployValue >= 25
          ? `~$${Math.round(redeployValue)} of your stock could move into better cards`
          : 'the full list of buy reads'}
      </Text>
      <View style={styles.tailCta}>
        <Text style={styles.tailCtaText}>Open the list</Text>
        <Ionicons
          name="chevron-forward"
          size={14}
          color={colors.accentPurple}
        />
      </View>
    </TouchableOpacity>
  );
});

const ScoutTile = memo(function ScoutTile({
  c,
  width,
  height,
  onSelect,
}: {
  c: ScoutCandidate;
  width: number;
  height: number;
  onSelect: (c: ScoutCandidate) => void;
}) {
  const uri = getCatalogImageUri(c.productId);
  return (
    <TouchableOpacity
      style={[styles.tile, { width, height }]}
      activeOpacity={0.85}
      onPress={() => onSelect(c)}
      accessibilityLabel={`${displayCardName(c.name)}, $${c.price.toFixed(
        2
      )}, ${c.read.label}`}
      accessibilityRole="button">
      <Image
        source={{ uri }}
        recyclingKey={`scout-${c.productId}`}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory-disk"
      />
      {/* Scrim band carries the text over the art. */}
      <LinearGradient
        colors={['transparent', colors.scrimOpaque]}
        locations={[0.45, 1]}
        style={styles.scrim}
        pointerEvents="none"
      />
      {c.owned ? (
        <View style={styles.ownedPill}>
          <Text style={styles.ownedText}>you own this</Text>
        </View>
      ) : null}
      <View style={styles.tileInfo}>
        <Text style={styles.tileName} numberOfLines={1}>
          {displayCardName(c.name)}
        </Text>
        <Text style={styles.tileMeta} numberOfLines={1}>
          {[c.set, c.number ? `#${c.number}` : null]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        <View style={styles.tileBottom}>
          <DealClassBadge read={c.read} />
          <View style={styles.tileNumbers}>
            <Text style={styles.tilePrice}>${c.price.toFixed(2)}</Text>
            <Text style={[styles.tileStat, { color: c.read.color }]}>
              {c.stat}
            </Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
});

/** Swipeable peek-deck of the top buy-scout reads — big art tiles one
 *  snap at a time, a "See all" tail tile opens the full list. */
export function ScoutDeck({
  candidates,
  totalCount,
  redeployValue,
  onSelect,
  onSeeAll,
}: {
  candidates: ScoutCandidate[];
  totalCount: number;
  redeployValue: number;
  onSelect: (c: ScoutCandidate) => void;
  onSeeAll: () => void;
}) {
  const { width } = useWindowDimensions();
  const tileW = Math.round(width * TILE_WIDTH_RATIO);
  const tileH = Math.round(tileW * TILE_ASPECT);
  const snap = tileW + layout.gridGap;

  const items = useMemo<DeckItem[]>(
    () => [
      ...candidates.map((c) => ({ kind: 'card' as const, c })),
      { kind: 'seeAll' },
    ],
    [candidates]
  );

  if (candidates.length === 0) return null;

  return (
    <FlashList<DeckItem>
      data={items}
      horizontal
      snapToInterval={snap}
      decelerationRate="fast"
      disableIntervalMomentum
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.deck}
      style={{ flexGrow: 0, height: tileH + spacing.md }}
      keyExtractor={(item) =>
        item.kind === 'card'
          ? `${item.c.productId}-${item.c.subType}`
          : 'see-all'
      }
      renderItem={({ item }) =>
        item.kind === 'card' ? (
          <ScoutTile
            c={item.c}
            width={tileW}
            height={tileH}
            onSelect={onSelect}
          />
        ) : (
          <SeeAllTile
            count={totalCount}
            redeployValue={redeployValue}
            width={tileW}
            height={tileH}
            onPress={onSeeAll}
          />
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  deck: {
    paddingHorizontal: layout.screenPadding,
  },
  tile: {
    borderRadius: radius.cardLg,
    overflow: 'hidden',
    marginRight: layout.gridGap,
    backgroundColor: colors.surfaceLight,
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '62%',
  },
  ownedPill: {
    position: 'absolute',
    top: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.scrimOpaque,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  ownedText: {
    color: colors.text,
    fontSize: type_.micro,
    fontWeight: weight.bold,
  },
  tileInfo: {
    position: 'absolute',
    left: spacing['2xl'],
    right: spacing['2xl'],
    bottom: spacing['2xl'],
  },
  tileName: {
    color: colors.text,
    fontSize: type_.title,
    fontWeight: weight.heavy,
  },
  tileMeta: {
    color: colors.textMuted,
    fontSize: type_.meta,
    marginTop: spacing.xs,
  },
  tileBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    gap: spacing.lg,
  },
  tileNumbers: { alignItems: 'flex-end' },
  tilePrice: {
    color: colors.text,
    fontSize: type_.title,
    fontWeight: weight.heavy,
  },
  tileStat: {
    fontSize: type_.caption,
    fontWeight: weight.bold,
    marginTop: spacing.xs,
  },
  tailTile: {
    borderRadius: radius.cardLg,
    backgroundColor: colors.overlay2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing['2xl'],
    marginRight: layout.gridGap,
  },
  tailIconWrap: {
    width: controls.minTouchTarget,
    height: controls.minTouchTarget,
    borderRadius: radius.pill,
    backgroundColor: colors.proTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tailTitle: {
    color: colors.text,
    fontSize: type_.title,
    fontWeight: weight.heavy,
    marginTop: spacing['2xl'],
  },
  tailSub: {
    color: colors.textMuted,
    fontSize: type_.meta,
    textAlign: 'center',
    marginTop: spacing.md,
    lineHeight: 15,
  },
  tailCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing['2xl'],
  },
  tailCtaText: {
    color: colors.accentPurple,
    fontSize: type_.label,
    fontWeight: weight.bold,
  },
});
