"""Stamp card_signals + price_series into a target catalog DB.

    py -m quant.ship --db mobile_catalog.db [--from research.db]

--from DB must contain signals_snapshot (run `py -m quant.snapshot` first)
and price_history for series packing. The shipped tables are read
optionally by the app — old catalogs simply lack them.

    card_signals(product_id, sub_type, price, price_date, stance, action,
        confidence, pctile_1y, ret_7d, ret_30d, ret_90d, cagr, trend,
        drawdown, days_since_change, n_events, vol_regime, excess_30d,
        fwd_30d_lo, fwd_30d_hi, reason, computed_at)

    price_series(product_id, sub_type, series, computed_at)
        series = JSON [[yyyymmdd, price], ...] — event-dense <=120d,
        last-event-per-week older. Int dates keep the payload ~40% smaller.
"""
import argparse
import json
import math
import os
import sqlite3
import sys
from datetime import timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from quant import signals, store  # noqa: E402

DENSE_DAYS = 120
MIN_SERIES_EVENTS = 2

SIGNAL_SQL = '''CREATE TABLE card_signals (
    product_id INTEGER, sub_type TEXT, price REAL, price_date TEXT,
    stance TEXT, action TEXT, confidence TEXT,
    pctile_1y REAL, ret_7d REAL, ret_30d REAL, ret_90d REAL,
    cagr REAL, trend TEXT, drawdown REAL,
    days_since_change INTEGER, n_events INTEGER, vol_regime TEXT,
    excess_30d REAL, fwd_30d_lo REAL, fwd_30d_hi REAL,
    reason TEXT, computed_at TEXT,
    PRIMARY KEY (product_id, sub_type))'''


def fwd_band(price, ret_30d, cagr, daily_sigma):
    """Indicative 30d range — drift damped 50%, ±1 stdev band. Not a forecast."""
    if not price or price <= 0:
        return None, None
    if ret_30d is not None:
        drift_d = ret_30d / 30.0 / 100.0
    elif cagr is not None:
        drift_d = cagr / 365.0 / 100.0
    else:
        drift_d = 0.0
    drift_d *= 0.5
    sig30 = (daily_sigma or 0.0) * math.sqrt(30)
    mu = math.log(price) + drift_d * 30
    return round(math.exp(mu - sig30), 2), round(math.exp(mu + sig30), 2)


def synth_reason(r):
    """One-line customer-facing reason synthesized from the signal stats."""
    stance, action, trend = r['stance'], r['action'], r['trend']
    r30, cagr, pct, dd = (r['ret_30d'], r['cagr'],
                          r['pctile_1y'], r['drawdown'])
    if stance == 'falling':
        return (f"down {abs(r30):.0f}% in 30d and still falling"
                if r30 is not None else 'actively falling')
    if stance == 'depressed' and trend == 'appreciating':
        if dd is not None and cagr is not None:
            return (f"dipped {abs(dd):.0f}% off highs but up "
                    f"{cagr:+.0f}%/yr long-term")
        return 'historically cheap inside an uptrend'
    if stance == 'depressed':
        return 'below its usual range, flat trend — wait or lowball'
    if stance == 'elevated_rising':
        return f"at {pct:.0f}% of 1y range and still climbing — hot but near highs" \
            if pct is not None else 'near highs and still climbing'
    if stance == 'elevated':
        return f"at {pct:.0f}% of 1y range — near highs" \
            if pct is not None else 'near highs'
    if trend == 'appreciating':
        return f"steady climber, {cagr:+.0f}%/yr" if cagr is not None \
            else 'steady climber'
    if trend == 'depreciating':
        return f"long-term decliner, {cagr:+.0f}%/yr" if cagr is not None \
            else 'long-term decliner'
    if stance == 'insufficient_data':
        return 'thin price history — low confidence'
    return 'no strong signal — mid-range'


def pack_series(events, dense_days=DENSE_DAYS):
    """[[yyyymmdd, price],...] — every event within `dense_days` of the
    last, last-event-per-ISO-week for anything older."""
    if len(events) < MIN_SERIES_EVENTS:
        return None
    last = signals._d(events[-1][0])
    cutoff = (last - timedelta(days=dense_days)).isoformat()
    out, cur_week = [], None
    for d, p in events:
        pt = [int(d.replace('-', '')), round(p, 4)]
        if d >= cutoff:
            out.append(pt)
            continue
        wk = signals._d(d).isocalendar()[:2]
        if wk == cur_week:
            out[-1] = pt
        else:
            out.append(pt)
            cur_week = wk
    return out


def stamp(target_db: str, source_db: str = None, vacuum: bool = True):
    src_path = source_db or store.default_db_path(None)
    src = store.open_master(src_path)
    if not store.has_table(src, 'signals_snapshot'):
        sys.exit('signals_snapshot missing in source — '
                 'run `py -m quant.snapshot` first')
    snap_rows = [dict(r) for r in src.execute('SELECT * FROM signals_snapshot')]

    wcon = sqlite3.connect(target_db)
    wcon.execute('DROP TABLE IF EXISTS card_signals')
    wcon.execute(SIGNAL_SQL)
    n_sig = 0
    for r in snap_rows:
        lo, hi = fwd_band(r['price'], r['ret_30d'], r['cagr'],
                          r['daily_sigma'])
        wcon.execute(
            f'INSERT INTO card_signals VALUES ({",".join("?" * 22)})',
            (r['product_id'], r['sub_type'], r['price'], r['price_date'],
             r['stance'], r['action'], r['confidence'], r['pctile_1y'],
             r['ret_7d'], r['ret_30d'], r['ret_90d'], r['cagr'], r['trend'],
             r['drawdown'], r['days_since_change'], r['n_events'],
             r['vol_regime'], r['excess_30d'], lo, hi, synth_reason(r),
             r.get('computed_at')))
        n_sig += 1

    wcon.execute('DROP TABLE IF EXISTS price_series')
    wcon.execute('''CREATE TABLE price_series (
        product_id INTEGER, sub_type TEXT, series TEXT, computed_at TEXT,
        PRIMARY KEY (product_id, sub_type))''')
    n_ser, buf, cur = 0, [], None
    stream = src.execute(
        'SELECT product_id, sub_type, date, market_price FROM price_history '
        'WHERE market_price > 0 ORDER BY product_id, sub_type, date')

    def flush():
        nonlocal n_ser
        if not buf:
            return
        packed = pack_series(buf)
        if packed:
            wcon.execute(
                'INSERT INTO price_series VALUES (?,?,?,date("now"))',
                (cur[0], cur[1], json.dumps(packed, separators=(',', ':'))))
            n_ser += 1

    for pid, sub, d, p in stream:
        if (pid, sub) != cur:
            flush()
            cur, buf = (pid, sub), []
        buf.append((d, p))
    flush()
    wcon.commit()
    src.close()
    if vacuum:
        wcon.execute('VACUUM')
    wcon.close()
    print(f'card_signals: {n_sig} rows | price_series: {n_ser} rows '
          f'-> {target_db}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', required=True, help='target catalog DB to stamp')
    ap.add_argument('--src', '--from', dest='source',
                    help='research DB w/ signals_snapshot (default: research.db)')
    ap.add_argument('--no-vacuum', action='store_true')
    args = ap.parse_args()
    stamp(args.db, args.source, vacuum=not args.no_vacuum)


if __name__ == '__main__':
    main()
