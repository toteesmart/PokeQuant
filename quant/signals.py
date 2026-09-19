"""Signal functions over sparse price_history series.

Series format everywhere: [(iso_date_str, price)] ascending, prices > 0.
price_history rows exist only on change, so series are event-sparse —
daily_grid() forward-fills to a dense calendar before statistics run.
All functions degrade to None/'insufficient' on thin data rather than raising.
"""
import math
import statistics
from datetime import date


def _d(iso: str) -> date:
    return date.fromisoformat(iso[:10])


def daily_grid(series):
    """Forward-fill a sparse event series onto consecutive days.

    Returns (grid, meta) where grid = [(date_str, price)] covering
    [first_date, last_date] and meta = {n_events, span_days, max_gap_days,
    coverage, last_event_date}.
    """
    if not series:
        return [], {'n_events': 0, 'span_days': 0, 'max_gap_days': 0,
                    'coverage': 0.0, 'last_event_date': None}
    events = sorted(series)
    first, last = _d(events[0][0]), _d(events[-1][0])
    span = (last - first).days + 1
    idx = 0
    cur_price = events[0][1]
    grid = []
    max_gap = 0
    prev_event_day = None
    for offset in range(span):
        day = first.fromordinal(first.toordinal() + offset)
        ds = day.isoformat()
        while idx < len(events) and _d(events[idx][0]) <= day:
            if prev_event_day is not None:
                max_gap = max(max_gap, (_d(events[idx][0]) - prev_event_day).days)
            prev_event_day = _d(events[idx][0])
            cur_price = events[idx][1]
            idx += 1
        grid.append((ds, cur_price))
    meta = {
        'n_events': len(events),
        'span_days': span,
        'max_gap_days': max_gap,
        'coverage': len(events) / span if span else 0.0,
        'last_event_date': events[-1][0],
    }
    return grid, meta


def window(grid, days: int):
    return grid[-days:] if len(grid) > days else list(grid)


def log_returns(grid):
    out = []
    for i in range(1, len(grid)):
        prev, cur = grid[i - 1][1], grid[i][1]
        if prev > 0 and cur > 0:
            out.append((grid[i][0], math.log(cur / prev)))
    return out


def zscore(series, window_days: int = 90):
    """(current - mean) / stdev over the dense window."""
    grid, _ = daily_grid(series)
    pts = [p for _, p in window(grid, window_days)]
    if len(pts) < 10:
        return {'z': None, 'mean': None, 'stdev': None, 'n': len(pts)}
    sd = statistics.stdev(pts)
    z = (pts[-1] - statistics.mean(pts)) / sd if sd > 0 else 0.0
    return {'z': z, 'mean': statistics.mean(pts), 'stdev': sd, 'n': len(pts)}


def percentile_rank(series, window_days: int = 365):
    """Share of window prices <= current price."""
    grid, _ = daily_grid(series)
    pts = [p for _, p in window(grid, window_days)]
    if len(pts) < 10:
        return {'pctile': None, 'n': len(pts)}
    cur = pts[-1]
    return {
        'pctile': sum(1 for p in pts if p <= cur) / len(pts) * 100.0,
        'n': len(pts),
    }


def _ret_n(grid, days: int):
    if len(grid) <= days:
        return None
    prev = grid[-1 - days][1]
    cur = grid[-1][1]
    return (cur / prev - 1.0) * 100.0 if prev > 0 else None


def momentum(series):
    grid, _ = daily_grid(series)
    if len(grid) < 8:
        return {'ret_7d': None, 'ret_30d': None, 'ret_90d': None,
                'drawdown_from_high': None, 'days_since_high': None,
                'ma20_minus_ma60': None, 'slope_30d': None}
    prices = [p for _, p in grid]
    hi = max(prices)
    hi_date = grid[prices.index(hi)][0]
    last20 = prices[-20:] if len(prices) >= 20 else None
    last60 = prices[-60:] if len(prices) >= 60 else None
    ma_diff = None
    if last20 and last60 and statistics.mean(last60) > 0:
        ma_diff = (statistics.mean(last20) / statistics.mean(last60) - 1.0) * 100.0
    slope = None
    tail = grid[-30:] if len(grid) >= 30 else None
    if tail:
        ys = [math.log(p) for _, p in tail if p > 0]
        n = len(ys)
        if n >= 10:
            xbar = (n - 1) / 2.0
            ybar = statistics.mean(ys)
            denom = sum((i - xbar) ** 2 for i in range(n))
            slope = sum((i - xbar) * (y - ybar) for i, y in enumerate(ys)) / denom
    return {
        'ret_7d': _ret_n(grid, 7),
        'ret_30d': _ret_n(grid, 30),
        'ret_90d': _ret_n(grid, 90),
        'drawdown_from_high': (prices[-1] / hi - 1.0) * 100.0 if hi > 0 else None,
        'days_since_high': (_d(grid[-1][0]) - _d(hi_date)).days,
        'ma20_minus_ma60': ma_diff,
        'slope_30d': slope,
    }


def realized_vol(series, window_days: int = 60):
    """Daily/annualized stdev of log returns + regime vs own long-run vol."""
    grid, _ = daily_grid(series)
    rets = [r for _, r in log_returns(grid)]
    if len(rets) < 10:
        return {'daily_sigma': None, 'ann_sigma': None, 'regime': 'insufficient',
                'n': len(rets)}
    recent = rets[-window_days:]
    daily = statistics.stdev(recent) if len(recent) >= 10 else statistics.stdev(rets)
    long_run = statistics.stdev(rets)
    ann = daily * math.sqrt(365)
    if long_run <= 0:
        regime = 'normal'
    elif daily > 1.5 * long_run:
        regime = 'high'
    elif daily < 0.67 * long_run:
        regime = 'low'
    else:
        regime = 'normal'
    return {'daily_sigma': daily, 'ann_sigma': ann, 'regime': regime,
            'n': len(rets)}


def liquidity(series, as_of: date = None):
    """How alive the price feed is — sparse history makes this meaningful."""
    if not series:
        return {'days_since_change': None, 'changes_per_year': 0.0,
                'coverage_pct': 0.0, 'flag': 'no_data'}
    as_of = as_of or date.today()
    events = sorted(series)
    last = _d(events[-1][0])
    days_since = (as_of - last).days
    span = max(1, (last - _d(events[0][0])).days)
    per_year = len(events) / span * 365.0
    coverage = len(events) / (span + 1)
    if days_since > 60:
        flag = 'stale'
    elif per_year < 6:
        flag = 'thin'
    else:
        flag = 'active'
    return {
        'days_since_change': days_since,
        'changes_per_year': per_year,
        'coverage_pct': coverage * 100.0,
        'flag': flag,
    }


def set_beta(card_series, peers_series: dict, days: int = 30):
    """Card return minus the set's median return over the window.

    peers_series: {product_id: [(date, price)]}. Peers need >=3 events and a
    span covering at least `days` to count.
    """
    grid, _ = daily_grid(card_series)
    card_ret = _ret_n(grid, days)
    peer_rets = []
    for peer in peers_series.values():
        pgrid, _ = daily_grid(peer)
        r = _ret_n(pgrid, days)
        if r is not None:
            peer_rets.append(r)
    med = statistics.median(peer_rets) if peer_rets else None
    return {
        'card_ret': card_ret,
        'set_median': med,
        'excess_return': (card_ret - med) if card_ret is not None and med is not None else None,
        'n_peers': len(peer_rets),
        'days': days,
    }


def confidence(n_events: int, coverage: float, vol_regime: str = 'normal') -> str:
    if n_events < 10 or coverage < 0.15:
        return 'low'
    if n_events >= 120 and coverage >= 0.5 and vol_regime != 'high':
        return 'high'
    return 'medium'
