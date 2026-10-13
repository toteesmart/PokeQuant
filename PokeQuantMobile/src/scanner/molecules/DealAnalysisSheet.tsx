import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../constants/colors';
import {
  deepComputedDaysAgo,
  DEEP_STALE_DAYS,
  getCardDeep,
  getPatternStats,
  getPriceSeries,
  openCatalogDatabase,
  type CardDeep,
  type PatternStat,
  type PricePoint,
} from '../../db/catalogDb';
import { getCatalogImageUri } from '../../services/CatalogImageService';
import {
  catalogName,
  displayCardName,
  type CatalogMatch,
} from '../services/catalog/catalogMatcher';
import type { CardSignal } from '../../db/catalogDb';
import {
  classifyDeal,
  offerBand,
  ownerNote,
  type DealRead,
} from '../services/deal/dealClassify';
import { useVendorStore } from '../../store/vendorStore';
import { DealClassBadge } from '../atoms/DealClassBadge';
import { ExplainChip, Tip } from '../atoms/ExplainChip';
import {
  explainClass,
  explainConfidence,
  stanceLabel,
} from '../services/deal/dealExplain';
import {
  buildSeriesFeatures,
  type SeriesFeatures,
} from '../services/deal/seriesSignals';
import { useWatchlistStore } from '../../store/watchlistStore';
import { TimeframeChips, TIMEFRAMES } from '../atoms/TimeframeChips';
import { PriceChart } from './PriceChart';
import { SetBadge } from '../../components/SetBadge';

type Props = {
  match: CatalogMatch;
  subType?: string;
  /** Present when the card is already in inventory — flips the deal read
   *  into position language (cost basis, days held, cushion vs cost). */
  ownership?: {
    paid: number;
    since?: string;
    sticker?: number;
  };
  onClose: () => void;
};

function pct(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function cutoffIso(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

function confTint(confidence?: string | null): string {
  const c = (confidence ?? '').toLowerCase();
  if (c === 'high') return colors.velocityPositive;
  if (c === 'medium') return colors.warning;
  return colors.textMuted;
}

/** Translucent badge background derived from a hex tint. */
function tintBg(fg: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(fg) ? `${fg}26` : 'rgba(255,255,255,0.08)';
}

export function DealAnalysisSheet({ match, subType, ownership, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const variants = match.card.variants;
  const [finish, setFinish] = useState(
    subType ?? variants[0]?.subType ?? ''
  );
  // The requested finish may not exist (e.g. an inventory card whose
  // productType is a rarity, not a print finish) — resolve to a real one.
  const resolvedFinish = variants.some((v) => v.subType === finish)
    ? finish
    : (variants[0]?.subType ?? finish);
  const [window_, setWindow] = useState('3M');
  const [series, setSeries] = useState<PricePoint[] | null>(null);
  const [deep, setDeep] = useState<CardDeep | null>(null);
  const [patterns, setPatterns] = useState<Record<string, PatternStat>>({});
  const [showDetails, setShowDetails] = useState(false);

  const signal: CardSignal | undefined =
    variants.find((v) => v.subType === resolvedFinish)?.signal ??
    variants[0]?.signal;

  const imgUri =
    match.card.imageUrl || getCatalogImageUri(match.card.productId);
  // One badge = the lifecycle class, colored by its read. Confidence
  // stays its own axis — "how much data backs this", not "what to do".
  // Deep read — curve features off the shipped price_series (floor
  // tests, failed bounces, fresh slopes) refine the scalar read.
  const features = useMemo(
    () =>
      series && series.length >= 15 ? buildSeriesFeatures(series) : null,
    [series]
  );
  const read = useMemo(
    () => classifyDeal(signal, features ?? undefined),
    [signal, features]
  );
  const facets = useMemo(
    () => buildFacets(signal, features),
    [signal, features]
  );

  // Watch toggle — only for cards the user doesn't own; owned cards
  // already get movement shifts off the inventory diff.
  const watched = useWatchlistStore((s) =>
    s.isWatched(match.card.productId, resolvedFinish)
  );
  const toggleWatch = useWatchlistStore((s) => s.toggle);

  useEffect(() => {
    let cancelled = false;
    setSeries(null);
    setDeep(null);
    (async () => {
      try {
        const db = await openCatalogDatabase();
        const [pts, deepRow, patRows] = await Promise.all([
          getPriceSeries(db, match.card.productId, resolvedFinish),
          getCardDeep(db, match.card.productId, resolvedFinish),
          getPatternStats(db),
        ]);
        if (cancelled) return;
        setSeries(pts);
        setDeep(deepRow);
        setPatterns(patRows);
      } catch {
        if (!cancelled) setSeries([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [match.card.productId, resolvedFinish]);

  // Engine staleness guard — past the window, deep stats stop rendering
  // as if they were current history.
  const deepStale =
    (deepComputedDaysAgo(deep?.computedAt ?? null) ?? 0) >
    DEEP_STALE_DAYS;

  // History depth drives both the "released/tracked since" label and which
  // timeframe chips are meaningful — a May-2026 promo has no 2Y view.
  const seriesSpanDays = useMemo(() => {
    if (!series || series.length < 2) return null;
    const first = new Date(`${series[0].date}T00:00:00`).getTime();
    const last = new Date(
      `${series[series.length - 1].date}T00:00:00`
    ).getTime();
    return Math.max(1, Math.round((last - first) / 86400000));
  }, [series]);

  const rawDays =
    TIMEFRAMES.find((t) => t.label === window_)?.days ??
    Number.POSITIVE_INFINITY;
  const windowDays =
    Number.isFinite(rawDays) &&
    seriesSpanDays != null &&
    rawDays > seriesSpanDays
      ? Number.POSITIVE_INFINITY
      : rawDays;
  const effectiveWindow =
    Number.isFinite(windowDays) ? window_ : 'MAX';
  const shown = useMemo(() => {
    if (!series) return [];
    if (!Number.isFinite(windowDays)) return series;
    const cut = cutoffIso(windowDays);
    const sliced = series.filter((p) => p.date >= cut);
    // Keep at least the two nearest points so short-history cards still draw.
    return sliced.length >= 2 ? sliced : series.slice(-2);
  }, [series, windowDays]);

  const winRet = useMemo(() => {
    if (shown.length < 2) return null;
    const first = shown[0].marketPrice;
    const last = shown[shown.length - 1].marketPrice;
    return first > 0 ? ((last - first) / first) * 100 : null;
  }, [shown]);

  return (
    <View style={[styles.overlay, { paddingTop: insets.top + 24 }]}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <View style={styles.headerInfo}>
            <Text style={styles.name} numberOfLines={1}>
              {catalogName(match.card)} · {match.card.number}
            </Text>
            <SetBadge set={match.card.set} style={styles.setBadge} />
          </View>
          {imgUri ? (
            <Image
              source={{ uri: imgUri }}
              style={styles.cardThumb}
              contentFit="contain"
              cachePolicy="memory-disk"
            />
          ) : null}
          {!ownership ? (
            <Tip
              tip={
                'Watch — get a movement alert when this card\'s story ' +
                'changes (wakes up, breaks its floor), same as owned stock.'
              }
              align="right"
            >
              <Pressable
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
                hitSlop={10}
                style={styles.closeBtn}
              >
                <Ionicons
                  name={watched ? 'bookmark' : 'bookmark-outline'}
                  size={18}
                  color={watched ? colors.primary : colors.text}
                />
              </Pressable>
            </Tip>
          ) : null}
          <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
            <Ionicons name="close" size={20} color={colors.text} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Finish switcher — each print finish has its own signal/series. */}
          {variants.length > 1 ? (
            <View style={styles.finishRow}>
              {variants.map((v) => (
                <Pressable
                  key={v.subType}
                  onPress={() => setFinish(v.subType)}
                  style={[
                    styles.finishChip,
                    v.subType === resolvedFinish && styles.finishChipActive,
                  ]}
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

          <View style={styles.verdictRow}>
            {/* The class badge IS the verdict — tap for its gloss. */}
            <Tip tip={explainClass(read.cls)}>
              <DealClassBadge read={read} />
            </Tip>
            {deep && !deepStale && deep.archetype &&
            deep.archetype !== 'neutral' ? (
              <ExplainChip
                label={ARCHETYPE_LABELS[deep.archetype] ?? deep.archetype}
                fg={colors.textMuted}
                bg={tintBg(colors.textMuted)}
                tip={ARCHETYPE_GLOSS[deep.archetype] ??
                  'How this card has historically behaved.'}
                align="right"
              />
            ) : null}
            {signal?.confidence ? (
              <ExplainChip
                label={`${signal.confidence} conf`}
                fg={confTint(signal.confidence)}
                bg={tintBg(confTint(signal.confidence))}
                tip={explainConfidence(signal.confidence)}
                align="right"
              />
            ) : null}
          </View>

          <DealReadSection
            read={read}
            signal={signal}
            ownership={ownership}
            features={features}
          />

          <EngineLines
            read={read}
            deep={deep}
            deepStale={deepStale}
            patterns={patterns}
          />

          <View style={styles.metricRow}>
            {(
              [
                ['7d', signal?.ret7d],
                ['30d', signal?.ret30d],
                ['90d', signal?.ret90d],
              ] as const
            ).map(([label, v]) => (
              <View key={label} style={styles.metric}>
                <Text
                  style={[
                    styles.metricValue,
                    v != null &&
                      (v >= 0
                        ? styles.metricUp
                        : styles.metricDown),
                  ]}
                >
                  {pct(v)}
                </Text>
                <Text style={styles.metricLabel}>{label}</Text>
              </View>
            ))}
            <View style={styles.metric}>
              <Text style={styles.metricValue}>
                {signal?.pctile1y != null
                  ? `${Math.round(signal.pctile1y)}th`
                  : '—'}
              </Text>
              <Text style={styles.metricLabel}>1y pctile</Text>
            </View>
          </View>

          {series && series.length >= 2 ? (
            <Text style={styles.trackedSince}>
              {releaseLabel(series[0].date, seriesSpanDays)}
            </Text>
          ) : null}
          <Text style={styles.sectionLabel}>Price history</Text>
          <TimeframeChips
            selected={effectiveWindow}
            onSelect={setWindow}
            maxDays={seriesSpanDays}
          />
          <View style={styles.chartWrap}>
            {series === null ? (
              <View style={styles.chartLoading}>
                <ActivityIndicator color={colors.primary} size="small" />
              </View>
            ) : (
              <>
                <PriceChart points={shown} />
                {winRet != null && shown.length >= 2 ? (
                  <Text style={styles.windowRet}>
                    {window_ === 'MAX' ? 'All-time' : window_}{' '}
                    <Text
                      style={
                        winRet >= 0 ? styles.metricUp : styles.metricDown
                      }
                    >
                      {pct(winRet)}
                    </Text>{' '}
                    ({fmtShort(shown[0].date)} →{' '}
                    {fmtShort(shown[shown.length - 1].date)})
                  </Text>
                ) : null}
              </>
            )}
          </View>

          {/* Details — the supporting reads, collapsed so the chart is
              the first thing you see. */}
          {facets.length > 0 ? (
            <>
              <Pressable
                style={styles.detailsToggle}
                onPress={() => setShowDetails((v) => !v)}
                hitSlop={6}
              >
                <Text style={styles.detailsToggleText}>
                  {showDetails ? 'Hide details' : 'Details'}
                </Text>
                <Ionicons
                  name={showDetails ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  color={colors.textMuted}
                />
              </Pressable>
              {showDetails ? (
                <View style={styles.facetCard}>
                  {facets.map((f) => (
                    <View key={f.label} style={styles.facetRow}>
                      <Text style={styles.facetLabel}>{f.label}</Text>
                      <Text style={styles.facetText}>{f.text}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          ) : null}

        </ScrollView>
      </View>
    </View>
  );
}

function fmtShort(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

/** tcgcsv price capture began ~Feb 2024. A first observed price before the
 *  collection floor means the card predates the dataset — say "tracked
 *  since", not "released". */
const COLLECTION_FLOOR = '2024-04-01';

function releaseLabel(firstDate: string, spanDays: number | null): string {
  const span = spanDays != null ? ` · ${spanDays}d tracked` : '';
  if (firstDate > COLLECTION_FLOOR) {
    return `Released ~${fmtShort(firstDate)}${span}`;
  }
  return `Tracked since ${fmtShort(firstDate)}${span}`;
}

function heldDays(since?: string): number | null {
  if (!since) return null;
  const t = new Date(since).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 86400000));
}

function heldLabel(days: number): string {
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

/** Inventory-owner version of the deal read: cost basis, days held,
 *  gain vs market, and whether the 30d drift stays above what you paid. */
function PositionSection({
  read,
  signal,
  ownership,
  features,
}: {
  read: DealRead;
  signal: CardSignal | undefined;
  ownership: NonNullable<Props['ownership']>;
  features?: SeriesFeatures | null;
}) {
  const days = heldDays(ownership.since);
  const mkt = signal?.price ?? 0;
  const vsCost = mkt > 0 ? mkt - ownership.paid : null;
  const vsCostPct =
    vsCost != null && ownership.paid > 0
      ? (vsCost / ownership.paid) * 100
      : null;
  const cushion =
    signal?.fwd30dLo != null ? signal.fwd30dLo - ownership.paid : null;
  // The floor is the decision for every fall-at-support class — give
  // it a dollar figure so "if it cracks" means something concrete.
  const floorPrice =
    features?.floorPrice ?? signal?.shelfPrice ?? signal?.low90d ?? null;
  const FLOOR_CLASSES = new Set([
    'BASE_FORMING',
    'POST_SPIKE_BLEED',
    'FREE_FALL',
    'DIP_BUY',
    'DECLINER',
    'RANGE_PLAY',
  ]);
  const showFloor =
    floorPrice != null && floorPrice > 0 && FLOOR_CLASSES.has(read.cls);
  // A shelf is a zone, not a line — "thesis dead" is ~3% through the
  // anchor ($8.15 shelf → ~$7.91 break). Same threshold as the
  // at-floor band, so a card ON its shelf isn't flagged as through
  // it. The 90d-low fallback is already the low itself — under it
  // is broken by definition.
  const crackPrice =
    floorPrice != null && features?.floorPrice != null
      ? floorPrice * 0.97
      : floorPrice;
  const floorCracked =
    crackPrice != null && mkt > 0 && mkt < crackPrice;
  // Rounded-dollar reality: a bounce back worth under ~$3 isn't an
  // exit event, it's the same money — just sell it.
  const bounceCheap =
    floorCracked && floorPrice != null && floorPrice - mkt < 3;
  // The upside half of the plan — the resistance a bounce runs into
  // first. Only worth printing where "hold for the bounce" is the
  // read and the target clears enough room to matter.
  // The eject line — structural resistance capped by bounce memory, so
  // it reads as a realistic window, not a far-off peak.
  const targetPrice =
    features?.sellIntoPrice ?? signal?.targetPrice ?? signal?.high90d ?? null;
  const TARGET_CLASSES = new Set([
    'BASE_FORMING',
    'POST_SPIKE_BLEED',
    'DIP_BUY',
    'DECLINER',
    'AT_PEAK',
    'RANGE_PLAY',
  ]);
  const showTarget =
    targetPrice != null &&
    mkt > 0 &&
    targetPrice >= mkt * 1.08 &&
    // An eject measured in cents isn't a target — vendors deal in
    // rounded dollars, so the window needs real money behind it.
    targetPrice - mkt >= 3 &&
    TARGET_CLASSES.has(read.cls);

  return (
    <View style={[styles.dealCard, { borderLeftColor: read.color }]}>
      <Text style={styles.dealHeadline}>{read.headline}</Text>
      <Text style={styles.dealOffer}>
        Paid ${Math.round(ownership.paid)}
        {days != null ? ` · held ${heldLabel(days)}` : ''}
        {mkt > 0 ? ` · now $${Math.round(mkt)}` : ''}
      </Text>
      {vsCost != null ? (
        <Text
          style={[
            styles.positionLine,
            vsCost >= 0 ? styles.metricUp : styles.metricDown,
          ]}
        >
          {vsCost >= 0 ? 'Up ' : 'Down '}
          {// Cents don't materialize on low-value cards — a +59% read
          // on a $1.27 card is 47¢ that stickers at the same $1. Show
          // the real dollars; percents stay for positions where the
          // swing is actual money.
          Math.abs(vsCost) < 3 || mkt < 10
            ? `$${
                Math.abs(vsCost) < 10
                  ? Math.abs(vsCost).toFixed(2)
                  : Math.round(Math.abs(vsCost))
              }`
            : vsCostPct != null
              ? `${Math.abs(vsCostPct).toFixed(0)}%`
              : `$${Math.round(Math.abs(vsCost))}`}{' '}
          vs your cost
        </Text>
      ) : null}
      {// Downside under cost only matters when it's real money — 13¢
      // under cost on a $1.27 fodder card isn't a threat, it's the
      // same $1 sticker either way. The drag problem (it sits in
      // inventory forever) is what the owner note carries.
      cushion != null && cushion < -3 ? (
        <Text style={[styles.positionLine, styles.metricDown]}>
          A bad month could take it ~$
          {Math.abs(cushion) < 10
            ? Math.abs(cushion).toFixed(2)
            : Math.round(Math.abs(cushion))}{' '}
          under your cost
        </Text>
      ) : null}
      <Text style={styles.dealScript}>
        {`“${ownerNote(read, features ?? undefined, { price: mkt > 0 ? mkt : null, floor: floorPrice, vsCost, daysHeld: days, cracked: floorCracked, ceiling: targetPrice })}”`}
      </Text>
      {showFloor && floorPrice != null && crackPrice != null ? (
        <View style={styles.triggerRow}>
          <Text style={[styles.triggerTag, { color: read.color }]}>
            {floorCracked ? 'CRACKED' : 'SELL UNDER'}
          </Text>
          <Text style={styles.triggerPrice}>
            ${(floorCracked ? floorPrice : crackPrice).toFixed(2)}
          </Text>
          <Text style={styles.triggerTail}>
            {floorCracked
              ? bounceCheap
                ? 'floor gave way → just sell it'
                : 'floor gave way — a bounce back to it is the exit'
              : 'floor cracks → new lows'}
          </Text>
        </View>
      ) : null}
      {showTarget && targetPrice != null ? (
        <View style={styles.triggerRow}>
          <Text
            style={[
              styles.triggerTag,
              { color: colors.velocityPositive },
            ]}
          >
            SELL INTO
          </Text>
          <Text style={styles.triggerPrice}>
            ~${targetPrice.toFixed(2)}
          </Text>
          <Text style={styles.triggerTail}>bounce target → bank it</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Archetype chip vocabulary — deterministic lifecycle labels stamped
 *  pipeline-side. 'neutral' is the default and gets no chip. */
const ARCHETYPE_LABELS: Record<string, string> = {
  compounder: 'Compounder',
  boom_bust: 'Boom-bust',
  one_spike: 'One-spike',
  flatline: 'Flatline',
  bleeder: 'Bleeder',
  young: 'Young card',
};
const ARCHETYPE_GLOSS: Record<string, string> = {
  compounder:
    'Long-term steady climber — dips have historically been buyable.',
  boom_bust:
    'Spike-and-cool-off cycles — where it sits in the cycle matters more than the trend.',
  one_spike:
    'Had one big run and never repeated it — treat rallies as exits, not momentum.',
  flatline:
    'Price has been pinned in a tight range — stable but dead money.',
  bleeder:
    'Long-term decline — floors have kept failing on this card.',
  young: 'Short price history — pattern reads are thin by nature.',
};

/** Classes where "does the floor hold" is the live question — these get
 *  the floor-hold base rate. Revival gets its own prior. */
const FLOOR_ODDS_CLASSES = new Set([
  'BASE_FORMING',
  'POST_SPIKE_BLEED',
  'FREE_FALL',
  'DIP_BUY',
  'DECLINER',
  'RANGE_PLAY',
]);

/** Engine context lines — self-history analogs + cross-card base rates,
 *  each line carrying its evidence (n, window) or not rendering. Deep
 *  stats past the staleness window are dropped, not shown as current. */
function EngineLines({
  read,
  deep,
  deepStale,
  patterns,
}: {
  read: DealRead;
  deep: CardDeep | null;
  deepStale: boolean;
  patterns: Record<string, PatternStat>;
}) {
  const lines: { text: string; warn?: boolean }[] = [];

  // The card's own track record at this exact shelf — strongest prior.
  if (
    !deepStale &&
    deep?.analogN != null &&
    deep.analogN >= 3 &&
    deep.analogBounceN != null
  ) {
    lines.push({
      text:
        `Sat at this floor ${deep.analogN}× before — ` +
        `bounced ${deep.analogBounceN} of them`,
    });
  }

  // Cross-card base rate — floors like this, or turns like this.
  const floorRate = patterns.floor_hold;
  const floorStale =
    (deepComputedDaysAgo(floorRate?.computedAt ?? null) ?? 0) >
    DEEP_STALE_DAYS;
  if (
    FLOOR_ODDS_CLASSES.has(read.cls) &&
    floorRate &&
    !floorStale &&
    floorRate.holdRate != null &&
    (floorRate.nCases ?? 0) >= 20
  ) {
    const winMo = Math.round((floorRate.windowDays ?? 0) / 30);
    lines.push({
      text:
        `Floors like this held ~${Math.round(floorRate.holdRate)}% ` +
        `of the time (${fmtCases(floorRate.nCases)} cases, ` +
        `${winMo}mo window)`,
    });
  }
  const revRate = patterns.revival_follow;
  const revStale =
    (deepComputedDaysAgo(revRate?.computedAt ?? null) ?? 0) >
    DEEP_STALE_DAYS;
  if (
    read.cls === 'REVIVAL' &&
    revRate &&
    !revStale &&
    revRate.holdRate != null &&
    (revRate.nCases ?? 0) >= 20
  ) {
    const winMo = Math.round((revRate.windowDays ?? 0) / 30);
    lines.push({
      text:
        `Turns like this followed through ~` +
        `${Math.round(revRate.holdRate)}% (${fmtCases(revRate.nCases)} ` +
        `cases, ${winMo}mo)`,
    });
  }

  // Second-source disagreement — the JP/EN misattribution guard. Reads
  // still show, but with the caveat that history may not be this card.
  if (
    !deepStale &&
    (deep?.pvFlag === 'level_mismatch' ||
      deep?.pvFlag === 'shape_divergent')
  ) {
    lines.push({
      text:
        'A second price source disagrees with this card’s history — ' +
        'it may be a different printing. Treat reads with care.',
      warn: true,
    });
  }

  if (lines.length === 0) return null;
  return (
    <View style={styles.engineBlock}>
      {lines.map((l) => (
        <Text
          key={l.text}
          style={[styles.engineLine, l.warn && styles.engineWarn]}
        >
          {l.text}
        </Text>
      ))}
    </View>
  );
}

function fmtCases(n: number | null): string {
  if (n == null) return '?';
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

/** Class headline + shielded offer band + customer script — the
 *  table-time read. The class badge sits in the verdict row above. */
function DealReadSection({
  read,
  signal,
  ownership,
  features,
}: {
  read: DealRead;
  signal: CardSignal | undefined;
  ownership?: Props['ownership'];
  features?: SeriesFeatures | null;
}) {
  const getCashOffer = useVendorStore((s) => s.getCashOffer);
  const mkt = signal?.price ?? 0;
  const base = mkt > 0 ? getCashOffer(mkt) : 0;
  const band = base > 0 ? offerBand(read, base) : null;

  if (ownership) {
    return (
      <PositionSection
        read={read}
        signal={signal}
        ownership={ownership}
        features={features}
      />
    );
  }

  return (
    <View style={[styles.dealCard, { borderLeftColor: read.color }]}>
      <Text style={styles.dealHeadline}>{read.headline}</Text>
      {band ? (
        <Text style={styles.dealOffer}>
          Offer ${Math.round(band.open)} · don't pass $
          {Math.round(band.max)}
        </Text>
      ) : null}
      <Text style={styles.dealScript}>“{read.script}”</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* "Where it is" — the facets under the verdict. Each row is one      */
/* plain-language read of a dimension the class alone can't carry.    */
/* ------------------------------------------------------------------ */

type Facet = { label: string; text: string };

function fmtDaysAgo(days: number): string {
  if (days < 45) return `${Math.round(days)}d`;
  if (days < 365) return `~${Math.round(days / 30)}mo`;
  return `~${(days / 365).toFixed(1)}y`;
}

function buildFacets(
  signal: CardSignal | undefined,
  features?: SeriesFeatures | null
): Facet[] {
  if (!signal) return [];
  const out: Facet[] = [];
  const { pctile1y, drawdown, daysSinceHigh, low90d, high90d } = signal;
  const r7 = signal.ret7d;
  const r30 = signal.ret30d;
  const price = signal.price;

  // 1) Price level — where the price sits inside its own 1y band.
  if (pctile1y != null) {
    const p = Math.round(pctile1y);
    const band =
      p <= 15
        ? 'Bottom of its 1-year range'
        : p <= 40
          ? 'Low end of its 1-year range'
          : p <= 60
            ? 'Middle of its 1-year range'
            : p <= 85
              ? 'High end of its 1-year range'
              : 'Near its 1-year high';
    out.push({ label: 'Price level', text: band });
  } else if (signal.stance && signal.stance !== 'insufficient_data') {
    const s = stanceLabel(signal.stance);
    out.push({
      label: 'Price level',
      text: s.charAt(0).toUpperCase() + s.slice(1),
    });
  }

  // 2) From its peak — how far off the high, and how long ago it peaked.
  if (drawdown != null && drawdown <= -3) {
    let t = `Down ${Math.abs(drawdown).toFixed(0)}% from its high`;
    if (daysSinceHigh != null && daysSinceHigh > 14) {
      t += ` — peaked ${fmtDaysAgo(daysSinceHigh)} ago`;
    }
    out.push({ label: 'From its peak', text: t });
  } else if (drawdown != null) {
    out.push({ label: 'From its peak', text: 'Basically at its high' });
  }

  // 3) Recent range — the last-90d floor and ceiling.
  if (low90d != null && high90d != null && price != null && low90d > 0) {
    const above = ((price - low90d) / low90d) * 100;
    const spot =
      above <= 15
        ? 'near the bottom'
        : above >= 80 && high90d > low90d
          ? 'near the top'
          : 'in the middle';
    out.push({
      label: 'Recent range',
      text: `$${low90d.toFixed(2)} – $${high90d.toFixed(2)} lately — ${spot}`,
    });
  }

  // 4) Right now — which direction it's pushing this week vs the month.
  if (signal.ma20_60 != null) {
    const m = signal.ma20_60;
    const slope = signal.slope30d;
    let t =
      m > 0.5 ? 'Trending up' : m < -0.5 ? 'Trending down' : 'Trend flat';
    if (slope != null && Math.abs(slope) >= 1) {
      t += slope > 0 ? ' — picking up speed' : ' — slowing down';
    }
    out.push({ label: 'Right now', text: t });
  } else if (r7 != null && r30 != null) {
    let t: string;
    if (r7 >= 5 && r30 >= 5) t = 'Rising — up this week and this month';
    else if (r7 <= -5 && r30 <= -5)
      t = 'Still falling — down this week and this month';
    else if (r30 <= -5 && r7 > 0)
      t = 'Easing — down on the month, up this week';
    else if (r30 >= 5 && r7 < 0)
      t = 'Cooling — up on the month, down this week';
    else t = 'Flat — not much moving';
    out.push({ label: 'Right now', text: t });
  }

  // 5) Pattern — what the chart's shape itself says.
  if (features) {
    const bits: string[] = [];
    if (features.failedBounce) {
      bits.push('Bounced once, then fell back');
    }
    if (features.floorTests >= 2) {
      bits.push(`Hit its floor ${features.floorTests}× and held`);
    }
    if (features.medianBouncePct != null) {
      bits.push(
        `Prior floor tests ran ~+${features.medianBouncePct.toFixed(0)}%`
      );
    }
    if (features.cycleDays != null && features.cycleDays >= 45) {
      bits.push(
        `Cycles roughly every ~${Math.round(features.cycleDays / 30)}mo`
      );
    }
    if (features.higherLows) bits.push('Each dip bottoms higher');
    if (bits.length) out.push({ label: 'Pattern', text: bits.join(' · ') });
  }

  // 6) Data — how much history backs any of this.
  const bits: string[] = [];
  if (signal.nEvents != null) {
    bits.push(
      signal.nEvents < 30
        ? `only ${signal.nEvents} sales on record`
        : `${signal.nEvents} sales tracked`
    );
  }
  if (signal.liqFlag === 'thin' || signal.liqFlag === 'no_data')
    bits.push('barely trades');
  else if (signal.liqFlag === 'stale') bits.push('price may be stale');
  if (signal.daysSinceChange != null && signal.daysSinceChange > 30) {
    bits.push(`no price change in ${signal.daysSinceChange} days`);
  }
  if (bits.length) {
    out.push({
      label: 'Data',
      text: bits.join(' · ').replace(/^./, (c) => c.toUpperCase()),
    });
  }

  // 7) Vs its set — moving with or against the cards around it.
  if (signal.excess30d != null) {
    const e = signal.excess30d;
    out.push({
      label: 'Vs its set',
      text:
        Math.abs(e) < 3
          ? 'Moving with the rest of its set'
          : e > 0
            ? `Doing better than its set this month (+${e.toFixed(0)}%)`
            : `Doing worse than its set this month (${e.toFixed(0)}%)`,
    });
  }

  return out;
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    flex: 1,
    backgroundColor: '#10151c',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  headerInfo: { flex: 1 },
  name: { color: colors.text, fontSize: 16, fontWeight: 'bold' },
  setBadge: { marginTop: 4 },
  cardThumb: {
    width: 44,
    height: 62,
    borderRadius: 6,
    marginLeft: 10,
  },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  content: { padding: 16, paddingTop: 8, paddingBottom: 24 },
  finishRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  finishChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  finishChipActive: { borderColor: colors.primary },
  finishText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  finishTextActive: { color: colors.primary },
  // zIndex lifts the whole row above the deal card so tip bubbles
  // dropping from its badges draw on top instead of behind it.
  verdictRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    zIndex: 30,
  },

  metricRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  metric: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
    paddingVertical: 8,
  },
  metricValue: { color: colors.text, fontSize: 13, fontWeight: 'bold' },
  metricUp: { color: colors.velocityPositive },
  metricDown: { color: colors.velocityNegative },
  metricLabel: { color: colors.textMuted, fontSize: 10, marginTop: 2 },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 16,
    marginBottom: 8,
  },
  trackedSince: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 12,
  },
  chartWrap: { marginTop: 10 },
  chartLoading: {
    height: 150,
    alignItems: 'center',
    justifyContent: 'center',
  },
  windowRet: { color: colors.textMuted, fontSize: 11, marginTop: 8 },
  detailsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
    paddingVertical: 8,
  },
  detailsToggleText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  dealCard: {
    marginTop: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 10,
    borderLeftWidth: 3,
    padding: 12,
  },
  dealHeadline: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  facetCard: {
    marginTop: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  facetRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 5,
    gap: 10,
  },
  facetLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    width: 76,
    marginTop: 1,
  },
  facetText: {
    color: colors.text,
    fontSize: 11,
    flex: 1,
    lineHeight: 15,
  },
  dealOffer: {
    color: colors.text,
    fontSize: 13,
    fontWeight: 'bold',
    marginTop: 8,
  },
  positionLine: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 6,
  },
  dealScript: {
    color: colors.textMuted,
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 8,
    lineHeight: 16,
  },
  triggerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 7,
    marginTop: 8,
  },
  triggerTag: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  triggerPrice: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  triggerTail: {
    color: colors.textMuted,
    fontSize: 10.5,
    flex: 1,
    flexShrink: 1,
  },
  engineBlock: {
    marginTop: 8,
    gap: 4,
  },
  engineLine: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
  },
  engineWarn: {
    color: colors.velocityNegative,
  },
});
