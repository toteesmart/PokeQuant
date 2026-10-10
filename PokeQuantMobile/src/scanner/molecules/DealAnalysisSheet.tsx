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
import { catalogName, type CatalogMatch } from '../services/catalog/catalogMatcher';
import type { CardSignal } from '../../db/catalogDb';
import { classifyDeal, offerBand, ownerNote } from '../services/deal/dealClassify';
import { useVendorStore } from '../../store/vendorStore';
import { actionStyle, derivedAction, VerdictChip } from '../atoms/VerdictChip';
import { ExplainChip, Tip } from '../atoms/ExplainChip';
import {
  explainAction,
  explainClass,
  explainConfidence,
  explainRisk,
  explainStance,
} from '../services/deal/dealExplain';
import { TimeframeChips, TIMEFRAMES } from '../atoms/TimeframeChips';
import { PriceChart } from './PriceChart';

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

/** Deterministic per-set badge color — same set always gets the same hue. */
function setTone(set?: string): { fg: string; bg: string } {
  let h = 0;
  const s = set ?? '?';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return {
    fg: `hsl(${hue}, 72%, 62%)`,
    bg: `hsla(${hue}, 72%, 62%, 0.14)`,
  };
}

function stanceTint(stance?: string | null): string {
  if (stance === 'falling') return colors.velocityNegative;
  if (stance === 'depressed') return colors.warning;
  if (stance === 'elevated' || stance === 'elevated_rising')
    return colors.velocityPositive;
  return colors.textMuted;
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
  const tone = setTone(match.card.set);
  // The stamped reason restates what the deal read already computes —
  // keep it only for low-data cards where it carries the "why" detail.
  const dealCls = classifyDeal(signal).cls;
  // Chip renders the engine action; the stance word is a second axis —
  // hide it when it literally duplicates the chip label ("Neutral" twice).
  const stanceText = signal?.stance
    ? signal.stance.replace('_', ' ')
    : 'unrated';
  const stanceIsDupe =
    signal?.action != null &&
    stanceText.toLowerCase() ===
      actionStyle(derivedAction(signal)).label.toLowerCase();

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
            <View
              style={[
                styles.setBadge,
                { borderColor: tone.fg, backgroundColor: tone.bg },
              ]}
            >
              <Text
                style={[styles.setBadgeText, { color: tone.fg }]}
                numberOfLines={1}
              >
                {match.card.set}
              </Text>
            </View>
          </View>
          {imgUri ? (
            <Image
              source={{ uri: imgUri }}
              style={styles.cardThumb}
              contentFit="contain"
              cachePolicy="memory-disk"
            />
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
            {/* Every badge here is tappable — tap for a plain-language
                gloss with an example. */}
            <Tip tip={explainAction(derivedAction(signal) ?? 'UNRATED')}>
              <VerdictChip signal={signal} showConfFlag={false} />
            </Tip>
            {!stanceIsDupe ? (
              <ExplainChip
                label={stanceText}
                fg={stanceTint(signal?.stance)}
                bg={tintBg(stanceTint(signal?.stance))}
                tip={explainStance(signal?.stance)}
              />
            ) : null}
            {signal?.confidence ? (
              <ExplainChip
                label={`${signal.confidence} conf`}
                fg={confTint(signal.confidence)}
                bg={tintBg(confTint(signal.confidence))}
                tip={explainConfidence(signal.confidence)}
              />
            ) : null}
          </View>
          {signal?.reason && dealCls === 'LOW_DATA' ? (
            <Text style={styles.reason}>{signal.reason}</Text>
          ) : null}

          <DealReadSection signal={signal} ownership={ownership} />

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

/** The deal card's title row — class name + risk tag, both tappable. */
function DealHead({ read }: { read: ReturnType<typeof classifyDeal> }) {
  return (
    <View style={styles.dealHead}>
      <Tip tip={explainClass(read.cls)}>
        <Text style={[styles.dealClass, { color: read.color }]}>
          {read.label}
        </Text>
      </Tip>
      <Tip tip={explainRisk(read.risk)} align="right">
        <Text
          style={[
            styles.dealRisk,
            read.risk === 'good'
              ? styles.metricUp
              : read.risk === 'risky'
                ? styles.metricDown
                : styles.dealRiskNeutral,
          ]}
        >
          {read.risk}
        </Text>
      </Tip>
    </View>
  );
}

/** Inventory-owner version of the deal read: cost basis, days held,
 *  gain vs market, and whether the 30d drift stays above what you paid. */
function PositionSection({
  read,
  signal,
  ownership,
}: {
  read: ReturnType<typeof classifyDeal>;
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
      <DealHead read={read} />
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

/** Class + shielded offer band + customer script — the table-time read. */
function DealReadSection({
  signal,
  ownership,
}: {
  signal: CardSignal | undefined;
  ownership?: Props['ownership'];
}) {
  const read = classifyDeal(signal);
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
      <DealHead read={read} />
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
  setBadge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 4,
    maxWidth: '100%',
  },
  setBadgeText: { fontSize: 11, fontWeight: '700' },
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
  verdictRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stanceText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  confText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  reason: {
    color: colors.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 8,
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
  dealHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dealClass: { fontSize: 13, fontWeight: 'bold', letterSpacing: 0.3 },
  dealRisk: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  dealRiskNeutral: { color: colors.textMuted },
  dealHeadline: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
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
