"""Compose signals + event context into a sell/hold stance.

Bands are deliberately simple heuristics — this is a context engine, not a
forecaster. Constants at top are the tunable knobs.
"""

# --- tunable bands ---
STALE_DAYS = 60            # no price change this long -> flag stale
THIN_EVENTS = 30           # fewer change-events than this -> insufficient
THIN_COVERAGE = 0.30       # or events on <30% of span days
Z_HIGH = 1.5               # ~93rd pctile of a normal window
Z_LOW = -1.0               # ~16th pctile
PCT_HIGH = 95              # 1y percentile — fat tails: pctile catches what z misses
PCT_LOW = 10
FALLING_7D = -10.0         # 7d return below this in a low z regime = knife
DEPRESSED_7D = 10.0        # |ret_7d| below this in a low z regime = stable dip
POST_RELEASE_WEEKS = 3     # younger than this = hype-decay regime
SET_LAG_PCT = -10.0        # excess return below this = underperforming set

STANCES = (
    'elevated', 'elevated_rising', 'depressed', 'falling',
    'neutral', 'insufficient_data',
)


def evaluate(z, pctile, mom, vol, liq, beta, set_ctx, nearby_events, grid_meta=None):
    """All inputs may contain Nones — degrade, never raise.

    grid_meta: {n_events, coverage, ...} from signals.daily_grid — thin-data
    detection keys on the sparse event reality, not the filled grid size.

    Returns {stance, reasons, warnings, notes}.
    """
    warnings, reasons, notes = [], [], []

    # --- warnings & notes that apply regardless of stance ---
    if liq.get('days_since_change') is not None and liq['days_since_change'] > STALE_DAYS:
        warnings.append(
            f"STALE_PRICE: no market-price update in {liq['days_since_change']}d — "
            'verify the quote before trusting any signal'
        )
    if set_ctx.get('weeks_since_release') is not None and \
            set_ctx['weeks_since_release'] < POST_RELEASE_WEEKS:
        warnings.append(
            f"POST_RELEASE: set is {set_ctx['weeks_since_release']:.1f}w old — "
            'hype-decay regime, signals discounted'
        )
    for ev in nearby_events:
        notes.append(f"event {ev['date']}: {ev['label']}")
    if beta.get('excess_return') is not None and beta['excess_return'] < SET_LAG_PCT:
        notes.append(
            f"underperforming its set by {beta['excess_return']:.1f}% "
            f"over {beta['days']}d (set median {beta['set_median']:+.1f}%)"
        )
    if vol.get('regime') == 'high':
        notes.append('elevated volatility — treat percentile bands as soft')

    # --- thin-data guard overrides everything ---
    gm = grid_meta or {}
    n_events = gm.get('n_events') or 0
    cov = gm.get('coverage') or 0.0
    if n_events < THIN_EVENTS or cov < THIN_COVERAGE:
        return {
            'stance': 'insufficient_data',
            'reasons': [
                f'thin history ({n_events} price changes, {cov:.0%} coverage) — '
                'report stats, but no reliable stance'
            ],
            'warnings': warnings,
            'notes': notes,
        }

    zz = z.get('z')
    r7 = mom.get('ret_7d')
    if zz is None:
        return {
            'stance': 'insufficient_data',
            'reasons': ['window too short for z-score'],
            'warnings': warnings,
            'notes': notes,
        }

    pct = pctile.get('pctile')
    pct_s = f"{pct:.0f}%" if pct is not None else 'n/a'
    r7_s = f"{r7:+.1f}%" if r7 is not None else 'n/a'
    extreme = zz >= Z_HIGH or (pct is not None and pct >= PCT_HIGH)
    cheap = zz <= Z_LOW or (pct is not None and pct <= PCT_LOW)

    if extreme:
        if r7 is not None and r7 > 0:
            stance = 'elevated_rising'
            reasons.append(
                f"z={zz:+.2f} (pctile {pct_s}) and still climbing ({r7_s} 7d) — "
                "strong, but don't wait for the top"
            )
        else:
            stance = 'elevated'
            reasons.append(
                f"z={zz:+.2f} (pctile {pct_s}) with flat/cooling momentum "
                f"({r7_s} 7d) — reasonable exit zone"
            )
    elif cheap:
        if r7 is not None and r7 < FALLING_7D:
            stance = 'falling'
            reasons.append(
                f"z={zz:+.2f} and still falling hard ({r7_s} 7d) — "
                'knife territory, wait for stabilization'
            )
        else:
            stance = 'depressed'
            reasons.append(
                f"z={zz:+.2f} (pctile {pct_s}) and no longer bleeding "
                f"({r7_s} 7d) — historically cheap, holding beats selling"
            )
    else:
        stance = 'neutral'
        reasons.append(
            f"z={zz:+.2f} mid-range (pctile {pct_s}) — "
            'no strong signal; sell if you want the liquidity'
        )

    return {'stance': stance, 'reasons': reasons,
            'warnings': warnings, 'notes': notes}
