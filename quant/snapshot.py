"""Full-catalog signal snapshot — runs the analysis engine over every
(product_id, sub_type) series in the research DB.

    py -m quant.snapshot [--db PATH] [--out CSV]

Streams price_history once (sorted), computes per-series stats on a bounded
400d dense window (z90, pctile-1y, vol) plus sparse-event stats for the full
span (returns via binary search, ATH, CAGR, liquidity). Classifies each row
into an action: SELL_STRENGTH / SELL_NOW / BUY_HOLD / BUY_FLIP / HOLD /
NEUTRAL / UNRATED. Writes a `signals_snapshot` table into the research DB
(the future card_signals ship shape) and a CSV report.
"""
import argparse
import bisect
import csv
import os
import sqlite3
from datetime import date, timedelta

from quant import signals, store, verdict

TAIL_DAYS = 400          # dense window covering z90 + pctile-1y + vol
FLIP_MIN_PRICE = 2.0     # below this, flip margins aren't worth table slots
MIN_BUY_PRICE = 1.0      # BUY lists ignore sub-$1 bulk


def event_meta(events):
    """n_events / span / coverage / max_gap without building a dense grid."""
    if not events:
        return {'n_events': 0, 'span_days': 0, 'coverage': 0.0,
                'max_gap_days': 0, 'last_event_date': None}
    span = (signals._d(events[-1][0]) - signals._d(events[0][0])).days + 1
    max_gap = max(
        ((signals._d(events[i][0]) - signals._d(events[i - 1][0])).days
         for i in range(1, len(events))),
        default=0,
    )
    return {'n_events': len(events), 'span_days': span,
            'coverage': len(events) / span, 'max_gap_days': max_gap,
            'last_event_date': events[-1][0]}


def tail_series(events, days=TAIL_DAYS):
    """Last `days` of an event series with the carried-forward price first."""
    if not events:
        return []
    start = (signals._d(events[-1][0]) - timedelta(days=days)).isoformat()
    dates = [d for d, _ in events]
    i = bisect.bisect_right(dates, start)
    if i == 0:
        return list(events)
    return events[i - 1:]


def price_at(dates, events, iso):
    """Price in force on `iso` — last event at or before it."""
    i = bisect.bisect_right(dates, iso) - 1
    return events[i][1] if i >= 0 else None


def ret_days(dates, events, days):
    """% return over the trailing `days` via carried price."""
    prev = price_at(dates, events,
                    (signals._d(events[-1][0]) - timedelta(days=days)).isoformat())
    cur = events[-1][1]
    if prev is None or prev <= 0:
        return None
    return (cur / prev - 1.0) * 100.0


def appr_from_events(events, dates):
    """Appreciation stats straight off the sparse events (no dense grid)."""
    out = {'ret_180d': None, 'ret_365d': None, 'ret_all': None,
           'cagr': None, 'trend': 'insufficient', 'span_days': 0}
    if len(events) < 2:
        return out
    first_p, last_p = events[0][1], events[-1][1]
    span = (signals._d(events[-1][0]) - signals._d(events[0][0])).days + 1
    out['span_days'] = span
    if first_p > 0:
        out['ret_all'] = (last_p / first_p - 1.0) * 100.0
    if span >= 60 and first_p > 0 and last_p > 0:
        out['cagr'] = ((last_p / first_p) ** (365.0 / span) - 1.0) * 100.0
    out['ret_180d'] = ret_days(dates, events, 180)
    out['ret_365d'] = ret_days(dates, events, 365)
    basis = out['ret_365d'] if out['ret_365d'] is not None else out['cagr']
    if basis is None:
        out['trend'] = 'insufficient'
    elif basis >= 30.0:
        out['trend'] = 'appreciating'
    elif basis <= -30.0:
        out['trend'] = 'depreciating'
    else:
        out['trend'] = 'flat'
    return out


def classify(stance, trend, ret_30d, liq_flag, price):
    """Action label for the snapshot — buy-side assumes a 70-80% offer."""
    if stance == 'insufficient_data':
        return 'UNRATED'
    if stance == 'falling':
        return 'SELL_NOW'
    if stance in ('elevated', 'elevated_rising'):
        return 'SELL_STRENGTH'
    if trend == 'appreciating' and liq_flag == 'active' \
            and price is not None and price >= MIN_BUY_PRICE:
        return 'BUY_HOLD'                       # dip/mid-range inside uptrend
    if liq_flag == 'active' and ret_30d is not None and ret_30d >= 8.0 \
            and price is not None and price >= FLIP_MIN_PRICE:
        return 'BUY_FLIP'                       # liquid + moving now
    if stance == 'depressed':
        return 'HOLD'                           # cheap but no uptrend — wait
    return 'NEUTRAL'


def compute_row(pid, sub_type, events, set_ctx, today):
    dates = [d for d, _ in events]
    meta = event_meta(events)
    tail = tail_series(events)

    z = signals.zscore(tail, window_days=90)
    pct = signals.percentile_rank(tail, window_days=365)
    vol = signals.realized_vol(tail, window_days=60)
    liq = signals.liquidity(events, as_of=today)
    app = appr_from_events(events, dates)

    mom = {
        'ret_7d': ret_days(dates, events, 7),
        'ret_30d': ret_days(dates, events, 30),
        'ret_90d': ret_days(dates, events, 90),
        'ret_180d': app['ret_180d'],
        'ret_365d': app['ret_365d'],
    }
    hi = max(p for _, p in events)
    hi_date = next(d for d, p in events if p == hi)
    mom['drawdown_from_high'] = (events[-1][1] / hi - 1.0) * 100.0 if hi > 0 else None
    mom['days_since_high'] = (signals._d(events[-1][0]) - signals._d(hi_date)).days

    beta_stub = {'excess_return': None, 'set_median': None,
                 'n_peers': 0, 'days': 30}
    gmeta = {'n_events': meta['n_events'], 'coverage': meta['coverage']}
    v = verdict.evaluate(z, pct, mom, vol, liq, beta_stub, set_ctx, [],
                         gmeta, app=app)
    conf = signals.confidence(meta['n_events'], meta['coverage'],
                              vol['regime'])
    action = classify(v['stance'], app['trend'], mom['ret_30d'],
                      liq['flag'], events[-1][1])
    return {
        'product_id': pid, 'sub_type': sub_type,
        'price': events[-1][1], 'price_date': events[-1][0],
        'n_events': meta['n_events'], 'coverage': meta['coverage'],
        'span_days': meta['span_days'],
        'z90': z['z'], 'pctile_1y': pct['pctile'],
        'ret_7d': mom['ret_7d'], 'ret_30d': mom['ret_30d'],
        'ret_90d': mom['ret_90d'], 'ret_180d': app['ret_180d'],
        'ret_365d': app['ret_365d'], 'ret_all': app['ret_all'],
        'cagr': app['cagr'], 'trend': app['trend'],
        'drawdown': mom['drawdown_from_high'],
        'days_since_high': mom['days_since_high'],
        'daily_sigma': vol['daily_sigma'], 'vol_regime': vol['regime'],
        'liq_flag': liq['flag'], 'days_since_change': liq['days_since_change'],
        'stance': v['stance'], 'confidence': conf, 'action': action,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', help='research db path override')
    ap.add_argument('--out', help='csv output path')
    args = ap.parse_args()

    db_path = store.default_db_path(args.db)
    con = store.open_master(db_path)
    today = date.today()

    from quant.analyze import set_context  # reuse set phase logic
    set_events = store.get_set_events(con)

    cards = {}
    has_rarity = 'rarity' in {r[1] for r in con.execute('PRAGMA table_info(cards)')}
    q = 'SELECT product_id, card_name, card_number, set_name' + \
        (', rarity' if has_rarity else '') + ' FROM cards'
    for row in con.execute(q):
        cards[row[0]] = dict(row)

    rows = []
    set_rets = {}   # set_name -> [ret_30d] for excess pass
    cur_pid = cur_sub = None
    buf = []

    def flush():
        if cur_pid is None or not buf:
            return
        card = cards.get(cur_pid, {})
        sctx = set_context(set_events, card.get('set_name'), today)
        r = compute_row(cur_pid, cur_sub, buf, sctx, today)
        r.update({
            'card_name': card.get('card_name'),
            'card_number': card.get('card_number'),
            'set_name': card.get('set_name'),
            'rarity': card.get('rarity'),
        })
        rows.append(r)
        if r['ret_30d'] is not None and card.get('set_name'):
            set_rets.setdefault(card['set_name'], []).append(r['ret_30d'])

    stream = con.execute(
        'SELECT product_id, sub_type, date, market_price FROM price_history '
        'ORDER BY product_id, sub_type, date')
    n_read = 0
    for pid, sub, d, p in stream:
        n_read += 1
        if pid != cur_pid or sub != cur_sub:
            flush()
            cur_pid, cur_sub, buf = pid, sub, []
        buf.append((d, p))
    flush()
    print(f'scanned {n_read} price rows -> {len(rows)} series')

    # pass 2: set-relative excess on 30d
    import statistics
    medians = {s: statistics.median(rs) for s, rs in set_rets.items()
               if len(rs) >= 10}
    for r in rows:
        med = medians.get(r['set_name'])
        r['excess_30d'] = (r['ret_30d'] - med) \
            if r['ret_30d'] is not None and med is not None else None

    # persist + export — open_master is read-only; snapshot writes need rw
    wcon = sqlite3.connect(db_path)
    wcon.execute('DROP TABLE IF EXISTS signals_snapshot')
    wcon.execute('''CREATE TABLE signals_snapshot (
        product_id INTEGER, sub_type TEXT, price REAL, price_date TEXT,
        n_events INTEGER, coverage REAL, span_days INTEGER,
        z90 REAL, pctile_1y REAL,
        ret_7d REAL, ret_30d REAL, ret_90d REAL, ret_180d REAL,
        ret_365d REAL, ret_all REAL, cagr REAL, trend TEXT,
        drawdown REAL, days_since_high INTEGER,
        daily_sigma REAL, vol_regime TEXT,
        liq_flag TEXT, days_since_change INTEGER,
        stance TEXT, confidence TEXT, action TEXT, excess_30d REAL,
        computed_at TEXT)''')
    cols = ('product_id sub_type price price_date n_events coverage span_days '
            'z90 pctile_1y ret_7d ret_30d ret_90d ret_180d ret_365d ret_all '
            'cagr trend drawdown days_since_high daily_sigma vol_regime '
            'liq_flag days_since_change stance confidence action excess_30d '
            'computed_at').split()
    now = today.isoformat()
    wcon.executemany(
        f'INSERT INTO signals_snapshot ({",".join(cols)}) '
        f'VALUES ({",".join("?" for _ in cols)})',
        [[r.get(c) if c != 'computed_at' else now for c in cols]
         for r in rows])
    wcon.execute('CREATE INDEX IF NOT EXISTS idx_snapshot_pid '
                 'ON signals_snapshot(product_id)')
    wcon.commit()

    out = args.out or os.path.join(
        os.path.dirname(db_path), f'snapshot_{now}.csv')
    fieldnames = ['card_name', 'card_number', 'set_name', 'rarity'] + cols
    with open(out, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k) for k in fieldnames})

    from collections import Counter
    print('actions:', dict(Counter(r['action'] for r in rows)))
    print('stances:', dict(Counter(r['stance'] for r in rows)))
    print('wrote', out)


if __name__ == '__main__':
    main()
