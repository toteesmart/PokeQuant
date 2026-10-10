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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../constants/colors';
import {
  getPriceSeries,
  openCatalogDatabase,
  type PricePoint,
} from '../../db/catalogDb';
import { catalogName, type CatalogMatch } from '../services/catalog/catalogMatcher';
import type { CardSignal } from '../../db/catalogDb';
import { classifyDeal, offerBand } from '../services/deal/dealClassify';
import { useVendorStore } from '../../store/vendorStore';
import { VerdictChip } from '../atoms/VerdictChip';
import { TimeframeChips, TIMEFRAMES } from '../atoms/TimeframeChips';
import { PriceChart } from './PriceChart';

type Props = {
  match: CatalogMatch;
  subType?: string;
  onClose: () => void;
};

function pct(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function cutoffIso(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

export function DealAnalysisSheet({ match, subType, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const variants = match.card.variants;
  const [finish, setFinish] = useState(
    subType ?? variants[0]?.subType ?? ''
  );
  const [window_, setWindow] = useState('3M');
  const [series, setSeries] = useState<PricePoint[] | null>(null);

  const signal: CardSignal | undefined =
    variants.find((v) => v.subType === finish)?.signal ??
    variants[0]?.signal;

  useEffect(() => {
    let cancelled = false;
    setSeries(null);
    (async () => {
      try {
        const db = await openCatalogDatabase();
        const pts = await getPriceSeries(db, match.card.productId, finish);
        if (!cancelled) setSeries(pts);
      } catch {
        if (!cancelled) setSeries([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [match.card.productId, finish]);

  const windowDays =
    TIMEFRAMES.find((t) => t.label === window_)?.days ??
    Number.POSITIVE_INFINITY;
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
            <Text style={styles.meta} numberOfLines={1}>
              {match.card.set}
            </Text>
          </View>
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
                    v.subType === finish && styles.finishChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.finishText,
                      v.subType === finish && styles.finishTextActive,
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
            <VerdictChip signal={signal} />
            <Text style={styles.stanceText}>
              {signal?.stance
                ? `${signal.stance.replace('_', ' ')}`
                : 'unrated'}
              {signal?.confidence ? ` · ${signal.confidence} conf` : ''}
            </Text>
          </View>
          {signal?.reason ? (
            <Text style={styles.reason}>{signal.reason}</Text>
          ) : null}

          <DealReadSection signal={signal} />

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

          <Text style={styles.sectionLabel}>Price history</Text>
          <TimeframeChips selected={window_} onSelect={setWindow} />
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

          {signal?.fwd30dLo != null && signal?.fwd30dHi != null ? (
            <Text style={styles.fwdBand}>
              30d drift band ≈ ${signal.fwd30dLo.toFixed(2)} – $
              {signal.fwd30dHi.toFixed(2)} (indicative, not a forecast)
            </Text>
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

/** Class + shielded offer band + customer script — the table-time read. */
function DealReadSection({ signal }: { signal: CardSignal | undefined }) {
  const read = classifyDeal(signal);
  const getCashOffer = useVendorStore((s) => s.getCashOffer);
  const mkt = signal?.price ?? 0;
  const base = mkt > 0 ? getCashOffer(mkt) : 0;
  const band = base > 0 ? offerBand(read, base) : null;

  return (
    <View style={[styles.dealCard, { borderLeftColor: read.color }]}>
      <View style={styles.dealHead}>
        <Text style={[styles.dealClass, { color: read.color }]}>
          {read.label}
        </Text>
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
      </View>
      <Text style={styles.dealHeadline}>{read.headline}</Text>
      {band ? (
        <Text style={styles.dealOffer}>
          Offer open ${band.open.toFixed(2)} · walk-away $
          {band.max.toFixed(2)}
          <Text style={styles.dealOfferSub}>
            {'  '}(base ${base.toFixed(2)} @ your tier)
          </Text>
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
  chartWrap: { marginTop: 10 },
  chartLoading: {
    height: 150,
    alignItems: 'center',
    justifyContent: 'center',
  },
  windowRet: { color: colors.textMuted, fontSize: 11, marginTop: 8 },
  fwdBand: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 14,
    lineHeight: 16,
  },
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
  dealScript: {
    color: colors.textMuted,
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 8,
    lineHeight: 16,
  },
});
