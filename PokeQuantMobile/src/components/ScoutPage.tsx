// ScoutPage — the full-page buy scout modal: two lanes (turns/growers
// vs floor buys) of engine-flagged candidates. Rendered by
// SearchBuyScreen inside a Modal.
import { memo, useMemo, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';
import {
  GlassBackButton,
  SegmentedPills,
} from './ui';
import { getCatalogImageUri } from '../services/CatalogImageService';
import type { ScoutCandidate } from '../scanner/services/deal/buyScout';

const ScoutRow = memo(function ScoutRow({
  c,
  onSelect,
}: {
  c: ScoutCandidate;
  onSelect: (c: ScoutCandidate) => void;
}) {
  return (
    <TouchableOpacity style={scoutStyles.row} onPress={() => onSelect(c)}>
      <Image
        source={{ uri: getCatalogImageUri(c.productId) }}
        style={scoutStyles.thumb}
        contentFit="contain"
        cachePolicy="memory-disk"
      />
      <View style={scoutStyles.main}>
        <Text style={scoutStyles.name} numberOfLines={1}>
          {c.name}
          {c.owned ? (
            <Text style={scoutStyles.ownedTag}> · you own this</Text>
          ) : null}
        </Text>
        <Text style={scoutStyles.set} numberOfLines={1}>
          {c.set ?? '—'}
        </Text>
        {c.stat ? (
          <Text
            style={[scoutStyles.stat, { color: c.read.color }]}
            numberOfLines={1}>
            {c.stat}
          </Text>
        ) : null}
        <Text style={scoutStyles.why} numberOfLines={1}>
          {c.why}
        </Text>
      </View>
      <View style={scoutStyles.numbers}>
        <Text style={scoutStyles.price}>${c.price.toFixed(2)}</Text>
        <Text style={[scoutStyles.chip, { color: c.read.color }]}>
          {c.read.label}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

/** Full-page scout — card images + verdict chips for every candidate
 *  the engine flags as a buy. */
export function ScoutPage({
  candidates,
  floorBuys,
  redeployValue,
  onSelect,
  onClose,
}: {
  candidates: ScoutCandidate[];
  floorBuys: ScoutCandidate[];
  redeployValue: number;
  onSelect: (c: ScoutCandidate) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  // Two lanes, two questions: turns/growers = "what's going up",
  // floor = "what do I buy at the floor today". Cyclers only live in
  // the floor lane — they lost the score fight in the mixed list.
  const mains = useMemo(
    () => candidates.filter((c) => c.read.cls !== 'RANGE_PLAY'),
    [candidates]
  );
  const [tab, setTab] = useState<'turns' | 'floor'>('turns');
  const shown = tab === 'floor' ? floorBuys : mains;
  const SCOUT_TABS: { key: 'turns' | 'floor'; label: string }[] = [
    { key: 'turns', label: `Going up (${mains.length})` },
    { key: 'floor', label: `At a low price (${floorBuys.length})` },
  ];
  return (
    <View style={scoutStyles.page}>
      <View style={[scoutStyles.pageHeader, { paddingTop: insets.top + 8 }]}>
        <GlassBackButton onPress={onClose} label="Close buy scout" />
        <View style={{ flex: 1 }}>
          <Text style={scoutStyles.pageTitle}>Buy scout</Text>
          {redeployValue >= 25 ? (
            <View style={scoutStyles.redeploy}>
              <Text style={scoutStyles.redeployAmount}>
                ~${Math.round(redeployValue)}
              </Text>
              <Text style={scoutStyles.redeployText}>
                {' '}
                of your stock could move into better cards
              </Text>
            </View>
          ) : (
            <Text style={scoutStyles.sub}>
              Cards worth buying right now.
            </Text>
          )}
        </View>
      </View>
      <SegmentedPills tabs={SCOUT_TABS} activeTab={tab} onChange={setTab} />
      <FlashList
        data={shown}
        keyExtractor={(c) => `${c.productId}-${c.subType}`}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item: c }) => (
          <ScoutRow c={c} onSelect={onSelect} />
        )}
        ListEmptyComponent={
          <Text style={scoutStyles.empty}>
            {tab === 'floor'
              ? 'No cards at their low price right now — check after the next price update.'
              : 'No deals right now — check after the next price update.'}
          </Text>
        }
      />
    </View>
  );
}

const scoutStyles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.background,
  },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pageTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  thumb: {
    width: 44,
    height: 62,
    borderRadius: 6,
    backgroundColor: colors.surfaceLight,
  },
  set: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 1,
  },
  sub: {
    color: colors.textMuted,
    fontSize: 11,
    marginBottom: 8,
    lineHeight: 15,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
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
  ownedTag: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
  },
  stat: {
    fontSize: 11,
    fontWeight: '800',
    marginTop: 2,
  },
  why: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 1,
  },
  numbers: {
    alignItems: 'flex-end',
  },
  price: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  chip: {
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginTop: 1,
  },
  empty: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 20,
  },
  redeploy: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    alignSelf: 'flex-start',
    backgroundColor: colors.warningTint,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 2,
  },
  redeployAmount: {
    color: colors.warning,
    fontSize: 14,
    fontWeight: '800',
  },
  redeployText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
  },
});
