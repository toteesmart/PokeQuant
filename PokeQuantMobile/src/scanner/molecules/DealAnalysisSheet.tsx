import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/theme';
import { getCatalogImageUri } from '../../services/CatalogImageService';
import { displayCardName, type CatalogMatch } from '../services/catalog/catalogMatcher';
import type { CardSignal } from '../../db/catalogDb';
import { DealClassBadge } from '../atoms/DealClassBadge';
import { ExplainChip, Tip } from '../atoms/ExplainChip';
import {
  archetypeLabel,
  explainArchetype,
  explainClass,
  explainConfidence,
} from '../services/deal/dealExplain';
import { useWatchlistStore } from '../../store/watchlistStore';
import { useDealAnalysis } from '../hooks/useDealAnalysis';
import { TimeframeChips } from '../atoms/TimeframeChips';
import { PriceChart } from './PriceChart';
import { SetBadge } from '../../components/SetBadge';
import { CircleButton, DeltaPill, Disclosure, GlassSheet } from '../../components/ui';
import { tintBg } from '../../utils/tint';
import { styles } from './dealSheetStyles';
import { DealEngineLines } from './DealEngineLines';
import { DealReadSection, type DealOwnership } from './DealReadSection';
import { confLabel, confTint, fmtDollars, pct, releaseLabel } from '../../utils/format';
import { dataAgeLabel } from '../services/deal/sheetReads';

type Props = {
  match: CatalogMatch;
  subType?: string;
  /** Present when the card is already in inventory — flips the deal read
   *  into position language (cost basis, days held, cushion vs cost). */
  ownership?: DealOwnership;
  onClose: () => void;
};

export function DealAnalysisSheet({ match, subType, ownership, onClose }: Props) {
  const variants = match.card.variants;
  const [finish, setFinish] = useState(subType ?? variants[0]?.subType ?? '');
  // The requested finish may not exist (e.g. an inventory card whose
  // productType is a rarity, not a print finish) — resolve to a real one.
  const resolvedFinish = variants.some((v) => v.subType === finish)
    ? finish
    : (variants[0]?.subType ?? finish);
  const [window_, setWindow] = useState('3M');
  const [showDetails, setShowDetails] = useState(false);

  const signal: CardSignal | undefined =
    variants.find((v) => v.subType === resolvedFinish)?.signal ?? variants[0]?.signal;

  const imgUri = match.card.imageUrl || getCatalogImageUri(match.card.productId);
  // One badge = the lifecycle class, colored by its read. Confidence
  // stays its own axis — "how much data backs this", not "what to do".
  const {
    series,
    deep,
    patterns,
    features,
    read,
    facets,
    deepStale,
    seriesSpanDays,
    effectiveWindow,
    shown,
    deltaRet,
    deltaLabel,
  } = useDealAnalysis(match.card.productId, resolvedFinish, signal, window_);

  const deltaColor = (deltaRet ?? 0) >= 0 ? colors.velocityPositive : colors.velocityNegative;
  // Catalog-age disclosure — the stamp's own latest-price date, always
  // on under the price it dates. The verdict reads honest only while
  // the user can see how old the data behind it is.
  const dataAge = dataAgeLabel(signal);

  // Watch toggle — only for cards the user doesn't own; owned cards
  // already get movement shifts off the inventory diff.
  const watched = useWatchlistStore((s) => s.isWatched(match.card.productId, resolvedFinish));
  const toggleWatch = useWatchlistStore((s) => s.toggle);

  return (
    <GlassSheet
      title="Price read"
      onClose={onClose}
      artUri={imgUri}
      scrollProps={{ bounces: false }}
      contentStyle={{ paddingTop: spacing.lg }}
      headerRight={
        !ownership ? (
          <Tip
            tip={
              "Watch — get a movement alert when this card's story " +
              'changes (wakes up, breaks its floor), same as owned stock.'
            }
            align="right"
          >
            <CircleButton
              icon={watched ? 'bookmark' : 'bookmark-outline'}
              color={watched ? colors.primary : colors.text}
              onPress={() =>
                toggleWatch({
                  productId: match.card.productId,
                  subType: resolvedFinish,
                  name: displayCardName(match.card.name),
                  set: match.card.set,
                  number: match.card.number,
                  imageUrl: imgUri ?? undefined,
                })
              }
              accessibilityLabel={watched ? 'Remove from watchlist' : 'Add to watchlist'}
            />
          </Tip>
        ) : undefined
      }
    >
      {/* Hero — the card is the headline; identity + finish under it. */}
      <View style={styles.hero}>
        {imgUri ? (
          <Image
            source={{ uri: imgUri }}
            style={styles.heroImage}
            contentFit="contain"
            cachePolicy="memory-disk"
          />
        ) : null}
        <Text style={styles.heroName} numberOfLines={2}>
          {displayCardName(match.card.name)}
        </Text>
        <View style={styles.heroMetaRow}>
          <SetBadge set={match.card.set} />
          <Text style={styles.heroNumber}>#{match.card.number}</Text>
        </View>
        {/* Finish switcher — each print finish has its own signal/series. */}
        {variants.length > 1 ? (
          <View style={styles.finishRow}>
            {variants.map((v) => (
              <Pressable
                key={v.subType}
                onPress={() => setFinish(v.subType)}
                style={[styles.finishChip, v.subType === resolvedFinish && styles.finishChipActive]}
              >
                <Text
                  style={[
                    styles.finishText,
                    v.subType === resolvedFinish && styles.finishTextActive,
                  ]}
                  numberOfLines={1}
                >
                  {v.subType}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      {/* Market price + window delta — the reference's hero number
              pair, adapted to a card instead of a revenue figure. */}
      <View style={styles.priceHero}>
        <Text style={styles.priceValue}>
          {signal?.price != null ? `$${signal.price.toFixed(2)}` : '—'}
        </Text>
        {deltaRet != null ? (
          <DeltaPill
            text={`${pct(deltaRet)} · ${deltaLabel}`}
            color={deltaColor}
            icon={deltaRet >= 0 ? 'caret-up' : 'caret-down'}
          />
        ) : null}
        {dataAge ? <Text style={styles.dataAge}>{dataAge}</Text> : null}
      </View>

      <View style={styles.verdictRow}>
        {/* The class badge IS the verdict — tap for its gloss. */}
        <Tip tip={explainClass(read.cls)}>
          <DealClassBadge read={read} />
        </Tip>
        {deep && !deepStale && deep.archetype && deep.archetype !== 'neutral' ? (
          <ExplainChip
            label={archetypeLabel(deep.archetype)}
            fg={colors.textMuted}
            bg={tintBg(colors.textMuted)}
            tip={explainArchetype(deep.archetype)}
            align="right"
          />
        ) : null}
        {signal?.confidence ? (
          <ExplainChip
            label={confLabel(signal.confidence)}
            fg={confTint(signal.confidence)}
            bg={tintBg(confTint(signal.confidence))}
            tip={explainConfidence(signal.confidence)}
            align="right"
          />
        ) : null}
      </View>

      <View style={styles.chartWrap}>
        {series === null ? (
          <View style={styles.chartLoading}>
            <ActivityIndicator color={colors.primary} size="small" />
          </View>
        ) : (
          <PriceChart points={shown} />
        )}
      </View>
      {series && series.length >= 2 ? (
        <Text style={styles.trackedSince}>{releaseLabel(series[0].date, seriesSpanDays)}</Text>
      ) : null}
      <TimeframeChips selected={effectiveWindow} onSelect={setWindow} maxDays={seriesSpanDays} />

      <DealReadSection read={read} signal={signal} ownership={ownership} features={features} />

      {/* Stat modules — the reference's two-column cards adapted to
              the signal fields the engine already computes. */}
      {signal ? (
        <View style={styles.moduleRow}>
          <View style={styles.moduleCard}>
            <Text style={styles.moduleTitle}>Recent moves</Text>
            <View
              style={[
                styles.moduleAccent,
                {
                  backgroundColor:
                    (signal.ret30d ?? 0) >= 0 ? colors.velocityPositive : colors.velocityNegative,
                },
              ]}
            />
            {(
              [
                ['7 days', signal.ret7d],
                ['30 days', signal.ret30d],
                ['90 days', signal.ret90d],
              ] as const
            ).map(([label, v]) => (
              <View key={label} style={styles.moduleStatRow}>
                <Text style={styles.moduleStatLabel}>{label}</Text>
                <Text
                  style={[
                    styles.moduleStatValue,
                    v != null && (v >= 0 ? styles.metricUp : styles.metricDown),
                  ]}
                >
                  {pct(v)}
                </Text>
              </View>
            ))}
          </View>
          <View style={styles.moduleCard}>
            <Text style={styles.moduleTitle}>Where it sits</Text>
            <View style={[styles.moduleAccent, { backgroundColor: colors.primary }]} />
            <View style={styles.moduleStatRow}>
              <Text style={styles.moduleStatLabel}>Market</Text>
              <Text style={styles.moduleStatValue}>
                {signal.price != null ? `$${signal.price.toFixed(2)}` : '—'}
              </Text>
            </View>
            <View style={styles.moduleStatRow}>
              <Text style={styles.moduleStatLabel}>30-day range</Text>
              <Text style={styles.moduleStatValue}>
                {signal.fwd30dLo != null && signal.fwd30dHi != null
                  ? `$${fmtDollars(signal.fwd30dLo)}–$${fmtDollars(signal.fwd30dHi)}`
                  : '—'}
              </Text>
            </View>
            <View style={styles.moduleStatRow}>
              <Text style={styles.moduleStatLabel}>1-yr range</Text>
              <Text style={styles.moduleStatValue}>
                {signal.pctile1y != null ? `${Math.round(signal.pctile1y)}th percentile` : '—'}
              </Text>
            </View>
          </View>
        </View>
      ) : null}

      <DealEngineLines read={read} deep={deep} deepStale={deepStale} patterns={patterns} />

      {/* Details — the supporting reads, collapsed so the chart is
              the first thing you see. */}
      {facets.length > 0 ? (
        <Disclosure
          label={showDetails ? 'Hide details' : 'Details'}
          expanded={showDetails}
          onToggle={() => setShowDetails((v) => !v)}
          centered
        >
          <View style={styles.facetCard}>
            {facets.map((f) => (
              <View key={f.label} style={styles.facetRow}>
                <Text style={styles.facetLabel}>{f.label}</Text>
                <Text style={styles.facetText}>{f.text}</Text>
              </View>
            ))}
          </View>
        </Disclosure>
      ) : null}
    </GlassSheet>
  );
}
