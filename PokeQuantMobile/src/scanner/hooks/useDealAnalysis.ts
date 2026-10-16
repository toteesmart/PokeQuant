// useDealAnalysis — all of DealAnalysisSheet's data plumbing in one
// hook: series/deep/pattern loading, feature building, the classified
// read, facets, and chart-window resolution. The sheet keeps only UI
// state (finish, window, details toggle) and render.
import { useEffect, useMemo, useState } from 'react';
import {
  deepComputedDaysAgo,
  DEEP_STALE_DAYS,
  getCardDeep,
  getPatternStats,
  getPriceSeries,
  openCatalogDatabase,
  type CardDeep,
  type CardSignal,
  type PatternStat,
  type PricePoint,
} from '../../db/catalogDb';
import { classifyDeal } from '../services/deal/dealClassify';
import { buildFacets } from '../services/deal/sheetReads';
import { buildSeriesFeatures } from '../services/deal/seriesSignals';
import { TIMEFRAMES, timeframeDisplay } from '../atoms/TimeframeChips';
import { cutoffIso } from '../../utils/format';

export function useDealAnalysis(
  productId: number,
  resolvedFinish: string,
  signal: CardSignal | undefined,
  window_: string,
) {
  const [series, setSeries] = useState<PricePoint[] | null>(null);
  const [deep, setDeep] = useState<CardDeep | null>(null);
  const [patterns, setPatterns] = useState<Record<string, PatternStat>>({});

  // Deep read — curve features off the shipped price_series (floor
  // tests, failed bounces, fresh slopes) refine the scalar read.
  const features = useMemo(
    () => (series && series.length >= 15 ? buildSeriesFeatures(series) : null),
    [series],
  );
  const read = useMemo(() => classifyDeal(signal, features ?? undefined), [signal, features]);
  const facets = useMemo(() => buildFacets(signal, features), [signal, features]);

  // A new card/finish resets the loaded surface — render-adjusted on the
  // load key so the effect body stays async-only.
  const loadKey = `${productId}:${resolvedFinish}`;
  const [prevLoadKey, setPrevLoadKey] = useState(loadKey);
  if (loadKey !== prevLoadKey) {
    setPrevLoadKey(loadKey);
    setSeries(null);
    setDeep(null);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = await openCatalogDatabase();
        const [pts, deepRow, patRows] = await Promise.all([
          getPriceSeries(db, productId, resolvedFinish),
          getCardDeep(db, productId, resolvedFinish),
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
  }, [productId, resolvedFinish]);

  // Engine staleness guard — past the window, deep stats stop rendering
  // as if they were current history.
  const deepStale = (deepComputedDaysAgo(deep?.computedAt ?? null) ?? 0) > DEEP_STALE_DAYS;

  // History depth drives both the "released/tracked since" label and which
  // timeframe chips are meaningful — a May-2026 promo has no 2Y view.
  const seriesSpanDays = useMemo(() => {
    if (!series || series.length < 2) return null;
    const first = new Date(`${series[0].date}T00:00:00`).getTime();
    const last = new Date(`${series[series.length - 1].date}T00:00:00`).getTime();
    return Math.max(1, Math.round((last - first) / 86400000));
  }, [series]);

  const rawDays = TIMEFRAMES.find((t) => t.label === window_)?.days ?? Number.POSITIVE_INFINITY;
  const windowDays =
    Number.isFinite(rawDays) && seriesSpanDays != null && rawDays > seriesSpanDays
      ? Number.POSITIVE_INFINITY
      : rawDays;
  const effectiveWindow = Number.isFinite(windowDays) ? window_ : 'MAX';
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

  return {
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
    winRet,
    deltaRet,
    deltaLabel,
  };
}
