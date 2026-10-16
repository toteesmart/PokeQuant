import { Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { colors } from '../../constants/colors';
import { offerBreakdown } from '../utils/pricing';
import { classifyDeal } from '../services/deal/dealClassify';
import type { ScannedCard } from '../types/scan';
import { scannerScreenStyles as styles } from './scannerScreenStyles';

/** The auto-confirm pill — tapping the last-scanned card opens its deal
 *  analysis with every finish hydrated. Border = the deal read at a
 *  glance: green good buy, yellow neutral, red risky, muted unrated. */
export function LastAddedPill({
  card,
  onPress,
}: {
  card: ScannedCard;
  onPress: (card: ScannedCard) => void;
}) {
  const econ = offerBreakdown(card.marketPrice);
  // Border = the deal read at a glance: green good buy,
  // yellow neutral, red risky — muted when unrated.
  const read = card.signal ? classifyDeal(card.signal) : null;
  const pillBorder =
    read == null || read.cls === 'LOW_DATA'
      ? colors.border
      : read.risk === 'risky'
        ? colors.velocityNegative
        : read.risk === 'good'
          ? colors.velocityPositive
          : colors.warning;
  return (
    <Pressable
      style={[styles.lastPill, { borderColor: pillBorder, borderWidth: 2 }]}
      onPress={() => onPress(card)}
    >
      {card.imageUrl ? (
        <Image
          source={{ uri: card.imageUrl }}
          style={styles.lastThumb}
          contentFit="contain"
          cachePolicy="memory-disk"
        />
      ) : null}
      <View style={styles.lastInfo}>
        <Text style={styles.lastName} numberOfLines={1}>
          {card.name}
        </Text>
        <Text style={styles.lastMeta} numberOfLines={1}>
          {card.number}
          {card.subType ? ` · ${card.subType}` : ''}
        </Text>
        <Text style={styles.lastPrice} numberOfLines={1}>
          Market ${card.marketPrice.toFixed(2)} · you pay ${Math.round(econ.offer)} ({econ.offerPct}
          % of market)
        </Text>
        <Text style={styles.lastProfit} numberOfLines={1}>
          Est. profit +${Math.round(econ.profit)}
        </Text>
      </View>
    </Pressable>
  );
}
