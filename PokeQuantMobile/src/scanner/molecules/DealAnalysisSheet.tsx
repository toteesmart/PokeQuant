import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { colors } from '../../constants/colors';
import {
  CARD_ASPECT_RATIO,
  layout,
  radius,
  spacing,
  type_,
  weight,
} from '../../constants/theme';
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
  displayCardName,
  type CatalogMatch,
} from '../services/catalog/catalogMatcher';
import type { CardSignal } from '../../db/catalogDb';
import {
  classifyDeal,
  dealAction,
  offerBand,
  ownerNote,
  positionAction,
  type DealRead,
} from '../services/deal/dealClassify';
import { useVendorStore } from '../../store/vendorStore';
import { DealClassBadge } from '../atoms/DealClassBadge';
import { ExplainChip, Tip } from '../atoms/ExplainChip';
import {
  explainClass,
  explainConfidence,
} from '../services/deal/dealExplain';
import {
  buildFacets,
  engineLines,
  positionTriggers,
} from '../services/deal/sheetReads';
import {
  buildSeriesFeatures,
  type SeriesFeatures,
} from '../services/deal/seriesSignals';
import { useWatchlistStore } from '../../store/watchlistStore';
import {
  TimeframeChips,
  TIMEFRAMES,
  timeframeDisplay,
} from '../atoms/TimeframeChips';
import { PriceChart } from './PriceChart';
import { SetBadge } from '../../components/SetBadge';
import {
  CircleButton,
  DeltaPill,
  Disclosure,
  GlassSheet,
} from '../../components/ui';
import { tintBg } from '../../utils/tint';

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

function confLabel(confidence?: string | null): string {
  const c = (confidence ?? '').toLowerCase();
  return c === 'high'
    ? 'solid data'
    : c === 'medium'
      ? 'decent data'
      : 'thin data';
}

function confTint(confidence?: string | null): string {
  const c = (confidence ?? '').toLowerCase();
  if (c === 'high') return colors.velocityPositive;
  if (c === 'medium') return colors.warning;
  return colors.textMuted;
}

export function DealAnalysisSheet({ match, subType, ownership, onClose }: Props) {
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

  // Delta under the price hero — windowed when the series has loaded,
  // otherwise the catalog's 30d scalar while the chart warms up.
  const deltaRet = winRet ?? signal?.ret30d ?? null;
  const deltaLabel =
    winRet != null
      ? effectiveWindow === 'MAX'
        ? 'All-time'
        : timeframeDisplay(effectiveWindow)
      : '30 days';
  const deltaColor =
    (deltaRet ?? 0) >= 0 ? colors.velocityPositive : colors.velocityNegative;

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
              'Watch — get a movement alert when this card\'s story ' +
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
              accessibilityLabel={
                watched ? 'Remove from watchlist' : 'Add to watchlist'
              }
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
              <Text style={styles.heroNumber}>
                #{match.card.number}
              </Text>
            </View>
            {/* Finish switcher — each print finish has its own signal/series. */}
            {variants.length > 1 ? (
              <View style={styles.finishRow}>
                {variants.map((v) => (
                  <Pressable
                    key={v.subType}
                    onPress={() => setFinish(v.subType)}
                    style={[
                      styles.finishChip,
                      v.subType === resolvedFinish &&
                        styles.finishChipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.finishText,
                        v.subType === resolvedFinish &&
                          styles.finishTextActive,
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
              {signal?.price != null
                ? `$${signal.price.toFixed(2)}`
                : '—'}
            </Text>
            {deltaRet != null ? (
              <DeltaPill
                text={`${pct(deltaRet)} · ${deltaLabel}`}
                color={deltaColor}
                icon={deltaRet >= 0 ? 'caret-up' : 'caret-down'}
              />
            ) : null}
          </View>

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
            <Text style={styles.trackedSince}>
              {releaseLabel(series[0].date, seriesSpanDays)}
            </Text>
          ) : null}
          <TimeframeChips
            selected={effectiveWindow}
            onSelect={setWindow}
            maxDays={seriesSpanDays}
          />

          <DealReadSection
            read={read}
            signal={signal}
            ownership={ownership}
            features={features}
          />

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
                        (signal.ret30d ?? 0) >= 0
                          ? colors.velocityPositive
                          : colors.velocityNegative,
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
                        v != null &&
                          (v >= 0
                            ? styles.metricUp
                            : styles.metricDown),
                      ]}
                    >
                      {pct(v)}
                    </Text>
                  </View>
                ))}
              </View>
              <View style={styles.moduleCard}>
                <Text style={styles.moduleTitle}>Where it sits</Text>
                <View
                  style={[
                    styles.moduleAccent,
                    { backgroundColor: colors.primary },
                  ]}
                />
                <View style={styles.moduleStatRow}>
                  <Text style={styles.moduleStatLabel}>Market</Text>
                  <Text style={styles.moduleStatValue}>
                    {signal.price != null
                      ? `$${signal.price.toFixed(2)}`
                      : '—'}
                  </Text>
                </View>
                <View style={styles.moduleStatRow}>
                  <Text style={styles.moduleStatLabel}>30-day range</Text>
                  <Text style={styles.moduleStatValue}>
                    {signal.fwd30dLo != null && signal.fwd30dHi != null
                      ? `$${fmtDollars(signal.fwd30dLo)}–$${fmtDollars(
                          signal.fwd30dHi
                        )}`
                      : '—'}
                  </Text>
                </View>
                <View style={styles.moduleStatRow}>
                  <Text style={styles.moduleStatLabel}>1-yr range</Text>
                  <Text style={styles.moduleStatValue}>
                    {signal.pctile1y != null
                      ? `${Math.round(signal.pctile1y)}th percentile`
                      : '—'}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          <EngineLines
            read={read}
            deep={deep}
            deepStale={deepStale}
            patterns={patterns}
          />

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

/** Money the way a vendor reads it — cents under $10, whole dollars
 *  above. +$0.40 on a $6 card isn't green, it's the same sticker. */
function fmtDollars(v: number): string {
  return Math.abs(v) < 10 ? Math.abs(v).toFixed(2) : String(Math.round(Math.abs(v)));
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
  const span = spanDays != null ? ` · tracked ${spanDays} days` : '';
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
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'}`;
  if (days < 365) return `${Math.round(days / 30)} months`;
  return `${(days / 365).toFixed(1)} yrs`;
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
  const cushion =
    signal?.fwd30dLo != null ? signal.fwd30dLo - ownership.paid : null;
  // The floor/target decision — same pure read the coherence harness
  // renders, so the trigger rows and the tested strings can't drift.
  const {
    floorPrice,
    crackPrice,
    floorCracked,
    bounceCheap,
    showFloor,
    targetPrice,
    showTarget,
  } = positionTriggers(read, signal, features);

  return (
    <View
      style={[
        styles.dealCard,
        {
          borderLeftColor: read.color,
          backgroundColor: tintBg(read.color),
        },
      ]}
    >
      {/* Action first — what to do with this card today. */}
      <Text style={[styles.dealAction, { color: read.color }]}>
        {positionAction(read, {
          cracked: floorCracked,
          bounceCheap,
          ceiling: showTarget ? targetPrice : null,
          // A real-dollar win only — +$0.40 on a $6 card isn't green,
          // it's the same sticker price.
          green: vsCost != null && vsCost >= 1,
          price: mkt,
        })}
      </Text>
      {vsCost != null ? (
        <Text
          style={[
            styles.positionHero,
            vsCost >= 0 ? styles.metricUp : styles.metricDown,
          ]}
        >
          {vsCost >= 0 ? 'Up ' : 'Down '}
          {`$${fmtDollars(vsCost)}`}{' '}
          vs your cost
        </Text>
      ) : null}
      <Text style={styles.positionMeta}>
        You paid ${Math.round(ownership.paid)}
        {days != null ? ` · held ${heldLabel(days)}` : ''}
        {mkt > 0 ? ` · worth $${Math.round(mkt)} now` : ''}
      </Text>
      <Text style={styles.dealHeadline}>{read.headline}</Text>
      {// Downside under cost only matters when it's real money — 13¢
      // under cost on a $1.27 fodder card isn't a threat, it's the
      // same $1 sticker either way. The drag problem (it sits in
      // inventory forever) is what the owner note carries.
      cushion != null && cushion < -3 ? (
        <Text style={[styles.positionLine, styles.metricDown]}>
          A bad month could take it ~${fmtDollars(cushion)} under your cost
        </Text>
      ) : null}
      <Text style={styles.dealScript}>
        {`“${ownerNote(read, features ?? undefined, { price: mkt > 0 ? mkt : null, floor: floorPrice, vsCost, daysHeld: days, cracked: floorCracked, ceiling: targetPrice, signal })}”`}
      </Text>
      {showFloor && floorPrice != null && crackPrice != null ? (
        <View style={styles.triggerRow}>
          <Text style={[styles.triggerTag, { color: read.color }]}>
            {floorCracked ? 'FLOOR BROKE' : 'SELL IF BELOW'}
          </Text>
          <Text style={styles.triggerPrice}>
            ${(floorCracked ? floorPrice : crackPrice).toFixed(2)}
          </Text>
          <Text style={styles.triggerTail}>
            {floorCracked
              ? bounceCheap
                ? 'its floor broke — sell it'
                : 'floor broke — sell when it bounces back'
              : 'if it drops below, expect new lows'}
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
            SELL AT
          </Text>
          <Text style={styles.triggerPrice}>
            ~${targetPrice.toFixed(2)}
          </Text>
          <Text style={styles.triggerTail}>bounce target — take the money</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Archetype chip vocabulary — deterministic lifecycle labels stamped
 *  pipeline-side. 'neutral' is the default and gets no chip. */
const ARCHETYPE_LABELS: Record<string, string> = {
  compounder: 'Steady riser',
  boom_bust: 'Boom-bust',
  one_spike: 'One-spike',
  flatline: 'Flat',
  bleeder: 'Slow bleeder',
  young: 'Young card',
};
const ARCHETYPE_GLOSS: Record<string, string> = {
  compounder:
    'Long-term steady climber — dips have historically been buyable.',
  boom_bust:
    'Spike-and-cool-off cycles — where it sits in the cycle matters more than the trend.',
  one_spike:
    'Had one big run and never repeated it — treat rallies as exits, not a comeback.',
  flatline:
    'Price has been pinned in a tight range — stable but dead money.',
  bleeder:
    'Slow long-term slide — floors have kept failing on this card.',
  young: 'Short price history — pattern reads are thin by nature.',
};

/** Engine context lines — the pure strings live in sheetReads so the
 *  coherence harness renders the same wording the user sees. */
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
  const lines = engineLines(
    read,
    deep,
    deepStale,
    patterns,
    (p) =>
      (deepComputedDaysAgo(p?.computedAt ?? null) ?? 0) > DEEP_STALE_DAYS
  );
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
    <View
      style={[
        styles.dealCard,
        {
          borderLeftColor: read.color,
          backgroundColor: tintBg(read.color),
        },
      ]}
    >
      {/* Action first — the two-second read. Numbers, then the story. */}
      <Text style={[styles.dealAction, { color: read.color }]}>
        {dealAction(read)}
      </Text>
      {band ? (
        <Text style={styles.dealOffer}>
          Offer ${Math.round(band.open)} · don't pass $
          {Math.round(band.max)}
        </Text>
      ) : null}
      <Text style={styles.dealHeadline}>{read.headline}</Text>
      <Text style={styles.dealScript}>“{read.script}”</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Chrome (Modal, bleed backdrop, header, scroll container) now comes
  // from ui/GlassSheet — these styles are page content only.
  hero: { alignItems: 'center', marginTop: spacing.lg },
  heroImage: {
    width: 140,
    height: 140 / CARD_ASPECT_RATIO,
    borderRadius: radius.card,
  },
  heroName: {
    color: colors.text,
    fontSize: type_.title,
    fontWeight: weight.bold,
    textAlign: 'center',
    marginTop: spacing['2xl'],
  },
  heroMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  heroNumber: { color: colors.textMuted, fontSize: type_.label },
  priceHero: {
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing['4xl'],
  },
  priceValue: {
    color: colors.text,
    fontSize: type_.display,
    fontWeight: weight.heavy,
  },
  finishRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: spacing['2xl'],
  },
  finishChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: colors.overlay3,
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
    justifyContent: 'center',
    gap: 10,
    zIndex: 30,
    marginTop: spacing['2xl'],
  },
  moduleRow: {
    flexDirection: 'row',
    gap: layout.gridGap,
    marginTop: spacing['4xl'],
  },
  moduleCard: {
    flex: 1,
    backgroundColor: colors.overlay2,
    borderRadius: radius.card,
    padding: layout.cardPadding,
  },
  moduleTitle: {
    color: colors.textMuted,
    fontSize: type_.label,
    fontWeight: weight.semibold,
  },
  moduleAccent: {
    width: 24,
    height: 3,
    borderRadius: radius.pill,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  moduleStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  moduleStatLabel: { color: colors.textMuted, fontSize: type_.meta },
  moduleStatValue: {
    color: colors.text,
    fontSize: type_.body,
    fontWeight: weight.semibold,
  },
  metricUp: { color: colors.velocityPositive },
  metricDown: { color: colors.velocityNegative },
  trackedSince: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  chartWrap: { marginTop: spacing['4xl'] },
  chartLoading: {
    height: 150,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dealCard: {
    marginTop: 12,
    backgroundColor: colors.overlay2,
    borderRadius: 10,
    borderLeftWidth: 3,
    padding: 12,
  },
  dealHeadline: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 7,
  },
  dealAction: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  positionHero: {
    fontSize: 16,
    fontWeight: '800',
    marginTop: 5,
  },
  positionMeta: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  facetCard: {
    marginTop: 8,
    backgroundColor: colors.overlay1,
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
    fontSize: 16,
    fontWeight: '800',
    marginTop: 5,
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
    fontSize: 15,
    fontWeight: '800',
  },
  triggerTail: {
    color: colors.textMuted,
    fontSize: 10,
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
