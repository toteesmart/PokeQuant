import type {
  CardDeep,
  CardSignal,
  PatternStat,
  PricePoint,
} from '../../src/db/catalogDb';

// Fixture hydration — replicates catalogDb's row→model mapping for
// the raw exported rows in realCards.json. Kept deliberately close to
// signalFromRow/deepFromRow (src/db/catalogDb.ts): if a column is
// added pipeline-side, this is the one place the fixture mapping
// must learn about it.

type Raw = Record<string, unknown>;

export type FixtureVariant = {
  subType: string;
  signal: Raw;
  deep: Raw | null;
  series: [number, number][];
};

export type FixtureCard = {
  productId: number;
  name: string;
  setName: string;
  number: string;
  rarity: string;
  variants: FixtureVariant[];
};

export type Fixture = {
  exportedFrom: string;
  catalogTables: string[];
  cards: Record<string, FixtureCard>;
  patterns?: Record<string, Raw>;
};

const num = (v: unknown): number | null => (v == null ? null : Number(v));
const str = (v: unknown): string | null => (v == null ? null : String(v));

/** Mirrors signalFromRow — the raw cs.* + d_* row → CardSignal. */
export function hydrateSignal(row: Raw): CardSignal {
  return {
    productId: Number.parseInt(String(row.product_id), 10) || 0,
    subType: String(row.sub_type ?? ''),
    price: num(row.price),
    priceDate: str(row.price_date),
    firstDate: str(row.first_date),
    stance: str(row.stance),
    action: str(row.action),
    confidence: str(row.confidence),
    pctile1y: num(row.pctile_1y),
    ret7d: num(row.ret_7d),
    ret14d: num(row.ret_14d),
    ret30d: num(row.ret_30d),
    ret90d: num(row.ret_90d),
    ret180d: num(row.ret_180d),
    ret365d: num(row.ret_365d),
    retAll: num(row.ret_all),
    cagr: num(row.cagr),
    trend: str(row.trend),
    drawdown: num(row.drawdown),
    daysSinceHigh: num(row.days_since_high),
    low90d: num(row.low_90d),
    high90d: num(row.high_90d),
    slope30d: num(row.slope_30d),
    ma20_60: num(row.ma20_60),
    z90: num(row.z90),
    dailySigma: num(row.daily_sigma),
    daysSinceChange: num(row.days_since_change),
    nEvents: num(row.n_events),
    coverage: num(row.coverage),
    spanDays: num(row.span_days),
    liqFlag: str(row.liq_flag),
    changesPerYear: num(row.changes_per_year),
    pctileAll: num(row.pctile_all),
    volRegime: str(row.vol_regime),
    excess30d: num(row.excess_30d),
    fwd30dLo: num(row.fwd_30d_lo),
    fwd30dHi: num(row.fwd_30d_hi),
    reason: str(row.reason),
    shelfPrice: num(row.d_shelf_price),
    shelfTests: num(row.d_shelf_tests),
    cycleDays: num(row.d_cycle_days),
    medianBouncePct: num(row.d_bounce_pct_med),
    targetPrice: num(row.d_target_price),
  };
}

/** Mirrors deepFromRow — the raw card_deep row → CardDeep. */
export function hydrateDeep(row: Raw | null): CardDeep | null {
  if (row == null) return null;
  return {
    productId: Number.parseInt(String(row.product_id), 10) || 0,
    subType: String(row.sub_type ?? ''),
    shelfPrice: num(row.shelf_price),
    shelfTests: num(row.shelf_tests),
    bouncePctMed: num(row.bounce_pct_med),
    bounceDaysMed: num(row.bounce_days_med),
    cycleDays: num(row.cycle_days),
    cycleAmp: num(row.cycle_amp),
    targetPrice: num(row.target_price),
    archetype: str(row.archetype),
    setPctile: num(row.set_pctile),
    analogN: num(row.analog_n),
    analogBounceN: num(row.analog_bounce_n),
    pvFlag: str(row.pv_flag),
    pvAgreement: num(row.pv_agreement),
    computedAt: str(row.computed_at),
  };
}

/** Mirrors _getPriceSeries — packed [[yyyymmdd, price]] → PricePoint. */
export function hydrateSeries(packed: [number, number][]): PricePoint[] {
  return packed.map(([d, p]) => ({
    date:
      `${String(d).slice(0, 4)}-${String(d).slice(4, 6)}-` +
      `${String(d).slice(6, 8)}`,
    marketPrice: p,
  }));
}

/** Mirrors the pattern_stats row → PatternStat. */
export function hydratePatterns(
  raw: Record<string, Raw> | undefined
): Record<string, PatternStat> {
  const out: Record<string, PatternStat> = {};
  for (const [k, row] of Object.entries(raw ?? {})) {
    out[k] = {
      pattern: str(row.pattern) ?? k,
      windowDays: num(row.window_days),
      nCases: num(row.n_cases),
      holdRate: num(row.hold_rate),
      bounceMedPct: num(row.bounce_med_pct),
      bounceMedDays: num(row.bounce_med_days),
      computedAt: str(row.computed_at),
    };
  }
  return out;
}
