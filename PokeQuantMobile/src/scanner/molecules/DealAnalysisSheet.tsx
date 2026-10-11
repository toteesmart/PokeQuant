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
  getPriceSeries,
  openCatalogDatabase,
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

  // Watch toggle — only for cards the user doesn't own; owned cards
  // already get movement shifts off the inventory diff.
  const watched = useWatchlistStore((s) =>
    s.isWatched(match.card.productId, resolvedFinish)
  );
  const toggleWatch = useWatchlistStore((s) => s.toggle);

  useEffect(() => {
    let cancelled = false;
    setSeries(null);
    (async () => {
      try {
        const db = await openCatalogDatabase();
        const pts = await getPriceSeries(
          db,
          match.card.productId,
          resolvedFinish
        );
        if (!cancelled) setSeries(pts);
      } catch {
        if (!cancelled) setSeries([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [match.card.productId, resolvedFinish]);

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

          <DealReadSection read={read} signal={signal} ownership={ownership} />
          <WhereItIs signal={signal} features={features} />

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
}: {
  read: DealRead;
  signal: CardSignal | undefined;
  ownership: NonNullable<Props['ownership']>;
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

  return (
    <View style={[styles.dealCard, { borderLeftColor: read.color }]}>
      <Text style={styles.dealHeadline}>{read.headline}</Text>
      <Text style={styles.dealOffer}>
        In at ${Math.round(ownership.paid)}
        {days != null ? ` · held ${heldLabel(days)}` : ''}
        {mkt > 0 ? ` · mkt $${Math.round(mkt)}` : ''}
        {ownership.sticker != null && ownership.sticker > 0
          ? ` · sticker $${Math.round(ownership.sticker)}`
          : ''}
      </Text>
      {vsCost != null ? (
        <Text
          style={[
            styles.positionLine,
            vsCost >= 0 ? styles.metricUp : styles.metricDown,
          ]}
        >
          {vsCost >= 0 ? '+' : '−'}${Math.abs(Math.round(vsCost))}
          {vsCostPct != null
            ? ` (${vsCostPct >= 0 ? '+' : ''}${vsCostPct.toFixed(0)}%)`
            : ''}{' '}
          over your cost
        </Text>
      ) : null}
      {cushion != null ? (
        <Text
          style={[
            styles.positionLine,
            cushion >= 0 ? styles.metricUp : styles.metricDown,
          ]}
        >
          {cushion >= 0
            ? `Even the 30d low stays ~$${Math.round(cushion)} above your cost`
            : `The 30d low could dip ~$${Math.round(Math.abs(cushion))} under your cost`}
        </Text>
      ) : null}
      <Text style={styles.dealScript}>“{ownerNote(read)}”</Text>
    </View>
  );
}

/** Class headline + shielded offer band + customer script — the
 *  table-time read. The class badge sits in the verdict row above. */
function DealReadSection({
  read,
  signal,
  ownership,
}: {
  read: DealRead;
  signal: CardSignal | undefined;
  ownership?: Props['ownership'];
}) {
  const getCashOffer = useVendorStore((s) => s.getCashOffer);
  const getTierFor = useVendorStore((s) => s.getTierFor);
  const mkt = signal?.price ?? 0;
  const base = mkt > 0 ? getCashOffer(mkt) : 0;
  const tier = mkt > 0 ? getTierFor(mkt) : null;
  const band = base > 0 ? offerBand(read, base) : null;

  if (ownership) {
    return (
      <PositionSection read={read} signal={signal} ownership={ownership} />
    );
  }

  return (
    <View style={[styles.dealCard, { borderLeftColor: read.color }]}>
      <Text style={styles.dealHeadline}>{read.headline}</Text>
      {band ? (
        <Text style={styles.dealOffer}>
          Offer open ${Math.round(band.open)} · walk-away $
          {Math.round(band.max)}
          {tier ? (
            <Text style={styles.dealOfferSub}>
              {'  '}(base ${Math.round(base)} · $
              {tier.minDollar}–{tier.maxDollar} tier @{' '}
              {tier.marginPercent}%)
            </Text>
          ) : null}
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

  // 1) Range position — where the price sits inside its own 1y band.
  if (pctile1y != null) {
    const p = Math.round(pctile1y);
    const band =
      p <= 15
        ? 'bottom of its range'
        : p <= 40
          ? 'below mid-range'
          : p <= 60
            ? 'mid-range'
            : p <= 85
              ? 'upper range'
              : 'near the top';
    out.push({
      label: 'Where it sits',
      text: `${p}${ordinal(p)} pctile of its 1y range — ${band}`,
    });
  } else if (signal.stance && signal.stance !== 'insufficient_data') {
    out.push({ label: 'Where it sits', text: stanceLabel(signal.stance) });
  }

  // 2) Peak context — how far off the high, and how long ago it peaked.
  if (drawdown != null && drawdown <= -3) {
    let t = `${Math.abs(drawdown).toFixed(0)}% below its high`;
    if (daysSinceHigh != null && daysSinceHigh > 14) {
      t += ` — peaked ${fmtDaysAgo(daysSinceHigh)} ago`;
    }
    out.push({ label: 'Off the top', text: t });
  } else if (drawdown != null) {
    out.push({ label: 'Off the top', text: 'At or near its 1y high' });
  }

  // 3) Floor context — distance above the 90d low, or the window itself.
  if (low90d != null && high90d != null && price != null && low90d > 0) {
    const above = ((price - low90d) / low90d) * 100;
    const spot =
      above <= 15
        ? 'holding just above the floor'
        : above >= 80 && high90d > low90d
          ? 'pressing the top of the window'
          : 'mid-window';
    out.push({
      label: '90d window',
      text:
        `$${low90d.toFixed(2)} – $${high90d.toFixed(2)} — ` +
        `${above.toFixed(0)}% off the floor, ${spot}`,
    });
  }

  // 4) Momentum shape — MA crossover when shipped; week-vs-month on
  //    older catalogs.
  if (signal.ma20_60 != null) {
    const m = signal.ma20_60;
    const slope = signal.slope30d;
    let t =
      m > 0.5
        ? 'Short average above the long one — building'
        : m < -0.5
          ? 'Short average under the long one — fading'
          : 'Averages have converged — no push either way';
    if (slope != null && Math.abs(slope) >= 1) {
      t += slope > 0 ? '; 30d slope rising' : '; 30d slope falling';
    }
    out.push({ label: 'Momentum', text: t });
  } else if (r7 != null && r30 != null) {
    let t: string;
    if (r7 >= 5 && r30 >= 5) t = 'Climbing — the week is as strong as the month';
    else if (r7 <= -5 && r30 <= -5) t = 'Still falling — the week is as bad as the month';
    else if (r30 <= -5 && r7 > 0) t = 'Easing — the month was red but this week ticked up';
    else if (r30 >= 5 && r7 < 0) t = 'Cooling — the month was green but this week dipped';
    else t = 'Flat — no real push either way';
    out.push({ label: 'Momentum', text: t });
  }

  // 5) Curve shape — what the series itself says the structure is.
  if (features) {
    const bits: string[] = [];
    if (features.failedBounce) {
      bits.push('bounced once — ran, came back to the floor');
    }
    if (features.floorTests >= 2) {
      bits.push(`floor tested ${features.floorTests}× and holding`);
    }
    if (features.higherLows) bits.push('higher lows — floor stepping up');
    if (bits.length) out.push({ label: 'Shape', text: bits.join(' · ') });
  }

  // 6) Data honesty — how much history backs any of this.
  const bits: string[] = [];
  if (signal.nEvents != null) {
    bits.push(
      signal.nEvents < 30
        ? `thin — ${signal.nEvents} prints`
        : `${signal.nEvents} prints`
    );
  }
  if (signal.liqFlag === 'thin' || signal.liqFlag === 'no_data')
    bits.push('thinly traded');
  else if (signal.liqFlag === 'stale') bits.push('price may be stale');
  if (signal.daysSinceChange != null && signal.daysSinceChange > 30) {
    bits.push(`last move ${signal.daysSinceChange}d ago`);
  }
  if (bits.length) out.push({ label: 'History', text: bits.join(' · ') });

  // 7) Set-relative — is the card moving with or against its set.
  if (signal.excess30d != null) {
    const e = signal.excess30d;
    out.push({
      label: 'vs its set',
      text:
        Math.abs(e) < 3
          ? 'tracking its set (30d)'
          : `${e >= 0 ? '+' : ''}${e.toFixed(1)}% vs the set over 30d — ` +
            (e > 0 ? 'outrunning it' : 'lagging it'),
    });
  }

  return out;
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][Math.min(v % 10, 4)] ?? 'th';
}

/** Facet rows — muted label left, plain-language read right. */
function WhereItIs({
  signal,
  features,
}: {
  signal: CardSignal | undefined;
  features?: SeriesFeatures | null;
}) {
  const facets = useMemo(() => buildFacets(signal, features), [signal, features]);
  if (!facets.length) return null;
  return (
    <View style={styles.facetCard}>
      {facets.map((f) => (
        <View key={f.label} style={styles.facetRow}>
          <Text style={styles.facetLabel}>{f.label}</Text>
          <Text style={styles.facetText}>{f.text}</Text>
        </View>
      ))}
    </View>
  );
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
  dealOfferSub: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '400',
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
});
