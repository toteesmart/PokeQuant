// catalogSignals — the quant-engine tables (card_signals, card_deep,
// pattern_stats, scout view). Stamped nightly by the pipeline's
// quant.ship step; every reader degrades silently on older catalogs
// that lack the tables.
import type { SQLiteDatabase } from 'expo-sqlite';
import { catalogHasTable, sqliteDb, withCatalogGuard } from './catalogSession';

// --- quant engine tables (optional — absent on older catalogs) ---
// Stamped nightly by the pipeline's `quant.ship` step. Every reader here is
// guarded: a catalog without these tables must degrade silently, never
// re-download or crash.

export type CardSignal = {
  productId: number;
  subType: string;
  price: number | null;
  priceDate: string | null;
  firstDate: string | null;
  stance: string | null;
  action: string | null;
  confidence: string | null;
  pctile1y: number | null;
  ret7d: number | null;
  ret14d: number | null;
  ret30d: number | null;
  ret90d: number | null;
  ret180d: number | null;
  ret365d: number | null;
  retAll: number | null;
  cagr: number | null;
  trend: string | null;
  drawdown: number | null;
  daysSinceHigh: number | null;
  low90d: number | null;
  high90d: number | null;
  slope30d: number | null;
  ma20_60: number | null;
  z90: number | null;
  dailySigma: number | null;
  daysSinceChange: number | null;
  nEvents: number | null;
  coverage: number | null;
  spanDays: number | null;
  liqFlag: string | null;
  changesPerYear: number | null;
  pctileAll: number | null;
  volRegime: string | null;
  excess30d: number | null;
  fwd30dLo: number | null;
  fwd30dHi: number | null;
  reason: string | null;
  /** Deep-engine shelf under the current price (card_deep join) —
   *  lets the stamp-only path prove "parked on a floor" without the
   *  series. Null on catalogs that predate the deep tables. */
  shelfPrice: number | null;
  shelfTests: number | null;
  /** Deep-engine cycle stamps (card_deep join) — trough rhythm, what
   *  shelf touches bounced to, and the bounce-capped ceiling. Lets the
   *  scalar path see a range cycler without loading the series. */
  cycleDays: number | null;
  medianBouncePct: number | null;
  targetPrice: number | null;
  /** The deep engine's own "bounced K of N" numerator — of the card's
   *  sits at THIS shelf, how many produced the held-bounce outcome.
   *  The RANGE_PLAY rhythm claim's proof ledger on the scalar path
   *  (the window resolution carries the same count as floorBounces). */
  analogBounceN: number | null;
};

function signalFromRow(row: Record<string, unknown>): CardSignal {
  return {
    productId: Number.parseInt(String(row.product_id), 10) || 0,
    subType: String(row.sub_type ?? ''),
    price: row.price == null ? null : Number(row.price),
    priceDate: row.price_date == null ? null : String(row.price_date),
    firstDate: row.first_date == null ? null : String(row.first_date),
    stance: row.stance == null ? null : String(row.stance),
    action: row.action == null ? null : String(row.action),
    confidence: row.confidence == null ? null : String(row.confidence),
    pctile1y: row.pctile_1y == null ? null : Number(row.pctile_1y),
    ret7d: row.ret_7d == null ? null : Number(row.ret_7d),
    ret14d: row.ret_14d == null ? null : Number(row.ret_14d),
    ret30d: row.ret_30d == null ? null : Number(row.ret_30d),
    ret90d: row.ret_90d == null ? null : Number(row.ret_90d),
    ret180d: row.ret_180d == null ? null : Number(row.ret_180d),
    ret365d: row.ret_365d == null ? null : Number(row.ret_365d),
    retAll: row.ret_all == null ? null : Number(row.ret_all),
    cagr: row.cagr == null ? null : Number(row.cagr),
    trend: row.trend == null ? null : String(row.trend),
    drawdown: row.drawdown == null ? null : Number(row.drawdown),
    daysSinceHigh: row.days_since_high == null ? null : Number(row.days_since_high),
    low90d: row.low_90d == null ? null : Number(row.low_90d),
    high90d: row.high_90d == null ? null : Number(row.high_90d),
    slope30d: row.slope_30d == null ? null : Number(row.slope_30d),
    ma20_60: row.ma20_60 == null ? null : Number(row.ma20_60),
    z90: row.z90 == null ? null : Number(row.z90),
    dailySigma: row.daily_sigma == null ? null : Number(row.daily_sigma),
    daysSinceChange: row.days_since_change == null ? null : Number(row.days_since_change),
    nEvents: row.n_events == null ? null : Number(row.n_events),
    coverage: row.coverage == null ? null : Number(row.coverage),
    spanDays: row.span_days == null ? null : Number(row.span_days),
    liqFlag: row.liq_flag == null ? null : String(row.liq_flag),
    changesPerYear: row.changes_per_year == null ? null : Number(row.changes_per_year),
    pctileAll: row.pctile_all == null ? null : Number(row.pctile_all),
    volRegime: row.vol_regime == null ? null : String(row.vol_regime),
    excess30d: row.excess_30d == null ? null : Number(row.excess_30d),
    fwd30dLo: row.fwd_30d_lo == null ? null : Number(row.fwd_30d_lo),
    fwd30dHi: row.fwd_30d_hi == null ? null : Number(row.fwd_30d_hi),
    reason: row.reason == null ? null : String(row.reason),
    shelfPrice: row.d_shelf_price == null ? null : Number(row.d_shelf_price),
    shelfTests: row.d_shelf_tests == null ? null : Number(row.d_shelf_tests),
    cycleDays: row.d_cycle_days == null ? null : Number(row.d_cycle_days),
    medianBouncePct: row.d_bounce_pct_med == null ? null : Number(row.d_bounce_pct_med),
    targetPrice: row.d_target_price == null ? null : Number(row.d_target_price),
    analogBounceN: row.d_analog_bounce_n == null ? null : Number(row.d_analog_bounce_n),
  };
}

async function _getCardSignals(
  db: SQLiteDatabase,
  productIds: number[],
): Promise<Record<number, Record<string, CardSignal>>> {
  if (productIds.length === 0 || !(await catalogHasTable('card_signals'))) {
    return {};
  }
  const placeholders = productIds.map(() => '?').join(',');
  // card_deep is optional (older catalogs lack it) — the shelf columns
  // let scalar readers prove floor proximity without loading a series.
  const hasDeep = await catalogHasTable('card_deep');
  const sql = hasDeep
    ? `SELECT cs.*, d.shelf_price AS d_shelf_price, d.shelf_tests AS d_shelf_tests,
              d.cycle_days AS d_cycle_days, d.bounce_pct_med AS d_bounce_pct_med,
              d.target_price AS d_target_price, d.analog_bounce_n AS d_analog_bounce_n
       FROM card_signals cs
       LEFT JOIN card_deep d
         ON d.product_id = cs.product_id AND d.sub_type = cs.sub_type
       WHERE cs.product_id IN (${placeholders})`
    : `SELECT * FROM card_signals WHERE product_id IN (${placeholders})`;
  const rows = await sqliteDb!.getAllAsync<Record<string, unknown>>(sql, ...productIds);
  const result: Record<number, Record<string, CardSignal>> = {};
  for (const row of rows) {
    const signal = signalFromRow(row);
    if (!result[signal.productId]) result[signal.productId] = {};
    result[signal.productId][signal.subType] = signal;
  }
  return result;
}

export const getCardSignals = withCatalogGuard(_getCardSignals, {});

/** Signals are keyed by product finish; held rows store the scanned
 *  finish in productType. Fall back through Normal to any available
 *  finish so a variant mismatch doesn't lose the read. */
export function pickSignalForFinish(
  signalMap: Record<number, Record<string, CardSignal>>,
  card: { productId?: number | null; productType?: string },
): CardSignal | undefined {
  if (card.productId == null) return undefined;
  const byFinish = signalMap[card.productId];
  if (!byFinish) return undefined;
  const finish = card.productType;
  return (finish ? byFinish[finish] : undefined) ?? byFinish.Normal ?? Object.values(byFinish)[0];
}

export type ScoutRow = {
  signal: CardSignal;
  name: string;
  number: string | null;
  set: string | null;
  rarity: string | null;
};

/** Coarse SQL funnel for the buy scout — pulls only rows that could
 *  plausibly classify as a buy class, joined to card identity. The
 *  honest filter is classifyDeal() on the survivors; this just keeps
 *  the pass bounded (one indexed scan, ~800 rows max). */
async function _getScoutRows(db: SQLiteDatabase): Promise<ScoutRow[]> {
  if (!(await catalogHasTable('card_signals'))) return [];
  const hasDeep = await catalogHasTable('card_deep');
  // Cycler arm — a card parked at its floor often fails every leg-based
  // arm (mid-range pctile, red week) precisely because it's AT the buy
  // end. The stamped cycle stats fetch it by position instead.
  const rows = await sqliteDb!.getAllAsync<Record<string, unknown>>(
    hasDeep
      ? `SELECT cs.*, c.card_name AS scout_name, c.card_number AS scout_number,
                c.set_name AS scout_set, c.rarity AS scout_rarity,
                d.shelf_price AS d_shelf_price, d.shelf_tests AS d_shelf_tests,
                d.cycle_days AS d_cycle_days, d.bounce_pct_med AS d_bounce_pct_med,
                d.target_price AS d_target_price, d.analog_bounce_n AS d_analog_bounce_n
         FROM card_signals cs
         JOIN cards c ON c.product_id = cs.product_id
         LEFT JOIN card_deep d
           ON d.product_id = cs.product_id AND d.sub_type = cs.sub_type
         WHERE cs.liq_flag = 'active'
           AND cs.action IS NOT NULL AND cs.action != 'UNRATED'
           AND cs.price >= 2
           AND (
             (cs.trend = 'appreciating' AND cs.cagr > 10)
             OR (cs.ret_30d > 4 AND (cs.drawdown < -10 OR cs.pctile_1y < 55))
             OR (cs.pctile_1y <= 30 AND cs.ret_30d > -10)
             OR (d.shelf_tests >= 3 AND d.cycle_days BETWEEN 21 AND 180
                 AND d.bounce_pct_med >= 15
                 AND (d.analog_bounce_n >= 1 OR cs.trend IS NOT 'depreciating')
                 AND cs.price >= d.shelf_price * 0.97
                 AND cs.price <= COALESCE(d.target_price, d.shelf_price * (1 + d.bounce_pct_med / 100)) * 1.15)
           )
         ORDER BY COALESCE(cs.n_events, 0) DESC
         LIMIT 800`
      : `SELECT cs.*, c.card_name AS scout_name, c.card_number AS scout_number,
                c.set_name AS scout_set, c.rarity AS scout_rarity
         FROM card_signals cs
         JOIN cards c ON c.product_id = cs.product_id
         WHERE cs.liq_flag = 'active'
           AND cs.action IS NOT NULL AND cs.action != 'UNRATED'
           AND cs.price >= 2
           AND (
             (cs.trend = 'appreciating' AND cs.cagr > 10)
             OR (cs.ret_30d > 4 AND (cs.drawdown < -10 OR cs.pctile_1y < 55))
             OR (cs.pctile_1y <= 30 AND cs.ret_30d > -10)
           )
         ORDER BY COALESCE(cs.n_events, 0) DESC
         LIMIT 800`,
  );
  return rows.map((row) => ({
    signal: signalFromRow(row),
    name: String(row.scout_name ?? ''),
    number: row.scout_number == null ? null : String(row.scout_number),
    set: row.scout_set == null ? null : String(row.scout_set),
    rarity: row.scout_rarity == null ? null : String(row.scout_rarity),
  }));
}

export const getScoutRows = withCatalogGuard(_getScoutRows, []);

/** Deep-engine row — heavy per-card stats computed pipeline-side
 *  (`quant.deep`). Optional table: older catalogs simply lack it. */
export type CardDeep = {
  productId: number;
  subType: string;
  shelfPrice: number | null;
  shelfTests: number | null;
  bouncePctMed: number | null;
  bounceDaysMed: number | null;
  cycleDays: number | null;
  cycleAmp: number | null;
  targetPrice: number | null;
  archetype: string | null;
  setPctile: number | null;
  analogN: number | null;
  analogBounceN: number | null;
  pvFlag: string | null;
  pvAgreement: number | null;
  computedAt: string | null;
};

function deepFromRow(row: Record<string, unknown>): CardDeep {
  const num = (k: string) => (row[k] == null ? null : Number(row[k]));
  const str = (k: string) => (row[k] == null ? null : String(row[k]));
  return {
    productId: Number.parseInt(String(row.product_id), 10) || 0,
    subType: String(row.sub_type ?? ''),
    shelfPrice: num('shelf_price'),
    shelfTests: num('shelf_tests'),
    bouncePctMed: num('bounce_pct_med'),
    bounceDaysMed: num('bounce_days_med'),
    cycleDays: num('cycle_days'),
    cycleAmp: num('cycle_amp'),
    targetPrice: num('target_price'),
    archetype: str('archetype'),
    setPctile: num('set_pctile'),
    analogN: num('analog_n'),
    analogBounceN: num('analog_bounce_n'),
    pvFlag: str('pv_flag'),
    pvAgreement: num('pv_agreement'),
    computedAt: str('computed_at'),
  };
}

async function _getCardDeep(
  db: SQLiteDatabase,
  productId: number,
  subType: string,
): Promise<CardDeep | null> {
  if (!(await catalogHasTable('card_deep'))) return null;
  const row = await sqliteDb!.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM card_deep WHERE product_id = ? AND sub_type = ?',
    Number.parseInt(String(productId), 10) || 0,
    subType,
  );
  return row ? deepFromRow(row) : null;
}

export const getCardDeep = withCatalogGuard(_getCardDeep, null);

/** Cross-card outcome base rates — what the odds lines quote. */
export type PatternStat = {
  pattern: string;
  windowDays: number | null;
  nCases: number | null;
  holdRate: number | null;
  bounceMedPct: number | null;
  bounceMedDays: number | null;
  computedAt: string | null;
};

async function _getPatternStats(db: SQLiteDatabase): Promise<Record<string, PatternStat>> {
  if (!(await catalogHasTable('pattern_stats'))) return {};
  const rows = await sqliteDb!.getAllAsync<Record<string, unknown>>('SELECT * FROM pattern_stats');
  const out: Record<string, PatternStat> = {};
  for (const row of rows) {
    const pattern = String(row.pattern ?? '');
    if (!pattern) continue;
    out[pattern] = {
      pattern,
      windowDays: row.window_days == null ? null : Number(row.window_days),
      nCases: row.n_cases == null ? null : Number(row.n_cases),
      holdRate: row.hold_rate == null ? null : Number(row.hold_rate),
      bounceMedPct: row.bounce_med_pct == null ? null : Number(row.bounce_med_pct),
      bounceMedDays: row.bounce_med_days == null ? null : Number(row.bounce_med_days),
      computedAt: row.computed_at == null ? null : String(row.computed_at),
    };
  }
  return out;
}

export const getPatternStats = withCatalogGuard(_getPatternStats, {});

/** Engine staleness guard — deep stats are honest history, not fresh
 *  reads; past this age the app stops quoting them as current. */
export const DEEP_STALE_DAYS = 14;

export function deepComputedDaysAgo(computedAt: string | null): number | null {
  if (!computedAt) return null;
  const t = Date.parse(`${computedAt}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}
