import type { SQLiteDatabase } from 'expo-sqlite';
import { mkDeep, mkSignal } from './helpers/builders';
import { flushAsync, renderHook } from './helpers/renderHook';
import { useDealAnalysis } from '../src/scanner/hooks/useDealAnalysis';
import {
  getCardDeep,
  getPatternStats,
  getPriceSeries,
  openCatalogDatabase,
  type CardSignal,
  type PricePoint,
} from '../src/db/catalogDb';
import { cutoffIso } from '../src/utils/format';

// catalogDb is partially mocked at the four seams the hook's load pass hits.
// The deal engine itself (classifyDeal / buildSeriesFeatures / buildFacets /
// deepComputedDaysAgo / cutoffIso) stays real — the suite pins how the hook
// composes them: the 15-point feature gate, window collapse, the staleness
// guard, and the delta label fallbacks.
jest.mock('../src/db/catalogDb', () => {
  const actual = jest.requireActual<typeof import('../src/db/catalogDb')>(
    '../src/db/catalogDb'
  );
  return {
    ...actual,
    openCatalogDatabase: jest.fn(),
    getPriceSeries: jest.fn(),
    getCardDeep: jest.fn(),
    getPatternStats: jest.fn(),
  };
});

const mockOpen = jest.mocked(openCatalogDatabase);
const mockSeries = jest.mocked(getPriceSeries);
const mockDeep = jest.mocked(getCardDeep);
const mockPatterns = jest.mocked(getPatternStats);

const catalogDbHandle = {} as SQLiteDatabase;

const isoDaysAgo = (n: number) =>
  new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

/** `days`-long daily ramp ending today — smooth enough that despike keeps
 *  every point, so length/span assertions stay exact. */
const rampSeries = (days: number, start = 10, step = 0.1): PricePoint[] =>
  Array.from({ length: days + 1 }, (_, i) => ({
    date: isoDaysAgo(days - i),
    marketPrice: start + i * step,
  }));

type Props = {
  productId: number;
  finish: string;
  signal: CardSignal | undefined;
  window: string;
};

const renderAnalysis = (props: Partial<Props> = {}) =>
  renderHook(
    (p: Props) => useDealAnalysis(p.productId, p.finish, p.signal, p.window),
    {
      productId: 42,
      finish: 'Normal',
      signal: undefined,
      window: 'MAX',
      ...props,
    }
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockOpen.mockResolvedValue(catalogDbHandle);
  mockSeries.mockResolvedValue([]);
  mockDeep.mockResolvedValue(null);
  mockPatterns.mockResolvedValue({});
});

test('loads series, deep row, and pattern stats for the product+finish', async () => {
  const deep = mkDeep({ productId: 42, computedAt: isoDaysAgo(2) });
  const patterns = {
    floor_bounce: {
      pattern: 'floor_bounce',
      windowDays: 30,
      nCases: 120,
      holdRate: 0.4,
      bounceMedPct: 18,
      bounceMedDays: 6,
      computedAt: isoDaysAgo(1),
    },
  };
  mockSeries.mockResolvedValue(rampSeries(99));
  mockDeep.mockResolvedValue(deep);
  mockPatterns.mockResolvedValue(patterns);

  const { result } = renderAnalysis();
  // Pre-resolve: nothing loaded yet — the sheet shows the scalar fallback.
  expect(result.current.series).toBeNull();
  expect(result.current.shown).toEqual([]);
  await flushAsync();

  expect(mockSeries).toHaveBeenCalledWith(catalogDbHandle, 42, 'Normal');
  expect(mockDeep).toHaveBeenCalledWith(catalogDbHandle, 42, 'Normal');
  expect(mockPatterns).toHaveBeenCalledWith(catalogDbHandle);
  expect(result.current.series).toHaveLength(100);
  expect(result.current.deep).toBe(deep);
  expect(result.current.patterns).toBe(patterns);
});

test('features stay null under 15 points, then resolve on a real series', async () => {
  mockSeries.mockResolvedValue(rampSeries(9)); // 10 points
  const short = renderAnalysis();
  await flushAsync();
  expect(short.result.current.series).toHaveLength(10);
  expect(short.result.current.features).toBeNull();

  mockSeries.mockResolvedValue(rampSeries(99)); // 100 points
  const long = renderAnalysis({ productId: 43 });
  await flushAsync();
  const features = long.result.current.features;
  expect(features).not.toBeNull();
  expect(features!.lastPrice).toBeCloseTo(10 + 99 * 0.1);
  expect(features!.daysCovered).toBe(99);
});

test('the read classifies on the stamped signal alone', async () => {
  const { result } = renderAnalysis();
  await flushAsync();
  // No signal → the engine's catch-all for thin data.
  expect(result.current.read.cls).toBe('LOW_DATA');
  expect(result.current.facets).toEqual([]);
});

test('series-fresh flat legs can outvote a stale stamped bleed', async () => {
  // The stamp says the card is bleeding out of a months-old peak…
  const staleBleed = mkSignal({
    ret7d: -10,
    ret30d: -15,
    ret90d: -20,
    drawdown: -30,
    daysSinceHigh: 60,
    pctile1y: 20,
  });
  // …but the shipped series has been flat at the floor the whole
  // window — fresh r7/r30 ≈ 0 override the stamped -15 month, so
  // stillBleeding clears and the parked floor reads as a base.
  mockSeries.mockResolvedValue(rampSeries(99, 10, 0));
  const { result } = renderAnalysis({ signal: staleBleed });
  await flushAsync();

  expect(result.current.features).not.toBeNull();
  expect(result.current.read.cls).toBe('BASE_FORMING');
});

test('series-fresh climb over a stale stamp reads as revival', async () => {
  const staleBleed = mkSignal({
    ret7d: -10,
    ret30d: -15,
    ret90d: -20,
    drawdown: -30,
    daysSinceHigh: 60,
    pctile1y: 20,
    cagr: -20,
  });
  // Same stale stamp, but the series has been climbing for the whole
  // window — a sustained rise off a quiet base is waking up, not basing.
  mockSeries.mockResolvedValue(rampSeries(99));
  const { result } = renderAnalysis({ signal: staleBleed });
  await flushAsync();

  expect(result.current.read.cls).toBe('REVIVAL');
});

test('facets build off the signal', async () => {
  const { result } = renderAnalysis({ signal: mkSignal() });
  await flushAsync();

  const byLabel = Object.fromEntries(
    result.current.facets.map((f) => [f.label, f.text])
  );
  expect(byLabel['Price level']).toBe('Middle of its 1-year range');
  expect(byLabel['From its peak']).toBe('Basically at its high');
});

test('deepStale is the 14-day engine guard on computedAt', async () => {
  mockDeep.mockResolvedValue(mkDeep({ computedAt: '2020-01-01' }));
  const stale = renderAnalysis();
  await flushAsync();
  expect(stale.result.current.deepStale).toBe(true);

  mockDeep.mockResolvedValue(mkDeep({ computedAt: isoDaysAgo(1) }));
  const fresh = renderAnalysis({ productId: 43 });
  await flushAsync();
  expect(fresh.result.current.deepStale).toBe(false);
});

test('a window wider than the card history collapses to MAX', async () => {
  mockSeries.mockResolvedValue(rampSeries(99)); // ~3 months of history
  const { result } = renderAnalysis({ window: '2Y' });
  await flushAsync();

  expect(result.current.seriesSpanDays).toBe(99);
  expect(result.current.effectiveWindow).toBe('MAX');
  expect(result.current.shown).toEqual(result.current.series);
});

test('a fitting window slices the series at the cutoff', async () => {
  mockSeries.mockResolvedValue(rampSeries(99));
  const { result } = renderAnalysis({ window: '1M' });
  await flushAsync();

  expect(result.current.effectiveWindow).toBe('1M');
  // 31-day window → points at day-31 … today inclusive.
  expect(result.current.shown).toHaveLength(32);
  expect(result.current.shown[0].date).toBe(cutoffIso(31));
  expect(result.current.deltaLabel).toBe('1 mo');
});

test('a window holding under two points still keeps the last two', async () => {
  // Span is 200d so the 1M window doesn't collapse to MAX, but only the
  // freshest print lands inside the window — the chart still needs a
  // line to draw, so the two nearest points survive the slice.
  mockSeries.mockResolvedValue([
    { date: isoDaysAgo(200), marketPrice: 10 },
    { date: isoDaysAgo(60), marketPrice: 11 },
    { date: isoDaysAgo(0), marketPrice: 12 },
  ]);
  const { result } = renderAnalysis({ window: '1M' });
  await flushAsync();

  expect(result.current.effectiveWindow).toBe('1M');
  expect(result.current.shown).toHaveLength(2);
  expect(result.current.shown[0].date).toBe(isoDaysAgo(60));
});

test('winRet is the shown-window return and feeds the delta label', async () => {
  mockSeries.mockResolvedValue([
    { date: isoDaysAgo(10), marketPrice: 10 },
    { date: isoDaysAgo(5), marketPrice: 12 },
    { date: isoDaysAgo(0), marketPrice: 15 },
  ]);
  const { result } = renderAnalysis({ window: 'MAX' });
  await flushAsync();

  expect(result.current.winRet).toBeCloseTo(50);
  expect(result.current.deltaRet).toBeCloseTo(50);
  expect(result.current.deltaLabel).toBe('All-time');
});

test('before the series lands the delta falls back to the 30d stamp', async () => {
  const { result } = renderAnalysis({ signal: mkSignal({ ret30d: 7 }) });
  await flushAsync();

  // Empty series → winRet null → stamp fallback with the fixed label.
  expect(result.current.winRet).toBeNull();
  expect(result.current.deltaRet).toBe(7);
  expect(result.current.deltaLabel).toBe('30 days');
});

test('a zero open price yields no winRet (no divide-by-zero)', async () => {
  mockSeries.mockResolvedValue([
    { date: isoDaysAgo(5), marketPrice: 0 },
    { date: isoDaysAgo(0), marketPrice: 15 },
  ]);
  const { result } = renderAnalysis({ signal: mkSignal({ ret30d: 3 }) });
  await flushAsync();

  expect(result.current.winRet).toBeNull();
  expect(result.current.deltaRet).toBe(3);
});

test('a failed load leaves the surface empty but standing', async () => {
  mockSeries.mockRejectedValue(new Error('table missing'));
  const { result } = renderAnalysis({ signal: mkSignal({ ret30d: 4 }) });
  await flushAsync();

  expect(result.current.series).toEqual([]);
  expect(result.current.shown).toEqual([]);
  expect(result.current.deep).toBeNull();
  expect(result.current.deltaRet).toBe(4);
});

test('a new product resets the surface and refetches under the new key', async () => {
  mockSeries.mockResolvedValue(rampSeries(30));
  const { result, rerender } = renderAnalysis();
  await flushAsync();
  expect(result.current.series).toHaveLength(31);

  rerender({ productId: 43, finish: 'Normal', signal: undefined, window: 'MAX' });
  // The render-adjusted reset clears before the refetch lands.
  expect(result.current.series).toBeNull();
  await flushAsync();

  expect(mockSeries).toHaveBeenLastCalledWith(catalogDbHandle, 43, 'Normal');
  expect(result.current.series).toHaveLength(31);
});

test('a finish switch refetches and repins the load key', async () => {
  const { rerender } = renderAnalysis();
  await flushAsync();

  rerender({
    productId: 42,
    finish: 'Holofoil',
    signal: undefined,
    window: 'MAX',
  });
  await flushAsync();

  expect(mockSeries).toHaveBeenLastCalledWith(catalogDbHandle, 42, 'Holofoil');
  expect(mockDeep).toHaveBeenLastCalledWith(catalogDbHandle, 42, 'Holofoil');
});
