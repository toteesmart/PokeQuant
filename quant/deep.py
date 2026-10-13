"""Deep engine — the heavy per-card + cross-card stats the app can't
afford to compute at scale.

    py -m quant.deep --per-card      daily:  card_deep (shelves, bounce
                                           memory, cycles, archetypes,
                                           set percentile, self-analogs,
                                           pv agreement)
    py -m quant.deep --pattern       weekly: pattern_stats (cross-card
                                           outcome base rates) +
                                           market_stats (breadth)

The swing/floor logic is a straight port of the app's seriesSignals.ts
(same 8% reversal threshold, same despike rule, same shelf semantics)
so a stamped stat agrees with the deep read the sheet computes live.

card_deep columns the app consumes:
    shelf_price / shelf_tests  — the defended level under price + holds
    bounce_pct_med / bounce_days_med — what prior shelf touches ran to
    cycle_days / cycle_amp     — the card's rhythm
    target_price               — nearest defended resistance above
    archetype                  — compounder|boom_bust|one_spike|
                                 flatline|bleeder|young|neutral
    set_pctile_30d             — momentum vs set peers (n>=15)
    analog_n / analog_bounce_n — "last N times here, bounced M"
    pv_flag / source_agreement — second-source trust (null when absent)
    computed_at                — staleness guard (>14d = treat as absent)
"""
import argparse
import bisect
import math
import sqlite3
import statistics
from datetime import date, timedelta

from . import store

REVERSAL_PCT = 0.08
FLOOR_TOUCH = 0.08          # trough within this of the shelf = a test
AT_SHELF = 1.12             # last price within 12% above shelf
DEFENDED_RALLY = 1.15       # ≥15% rally after a trough = defended
SET_PEER_MIN = 15
PATTERN_WINDOW_DAYS = 550   # rolling ~18mo for outcome studies
FWD_EVAL_DAYS = 60          # outcome measured 60d forward
MIN_PATTERN_N = 20          # don't ship base rates on tiny samples


def _d(iso: str) -> date:
    return date.fromisoformat(iso)


def days_between(a: str, b: str) -> int:
    return (_d(b) - _d(a)).days


def despike(points):
    """Port of seriesSignals.despike — a one-point wick >60% past both
    neighbors that reverts next tick is a data error, not a move."""
    if len(points) < 3:
        return list(points)
    out = []
    for i, p in enumerate(points):
        if i == 0 or i == len(points) - 1:
            out.append(p)
            continue
        prev, nxt = points[i - 1][1], points[i + 1][1]
        v = p[1]
        if prev <= 0 or nxt <= 0 or v <= 0:
            out.append(p)
            continue
        if not (v > prev * 1.6 and v > nxt * 1.6) and not (v < prev * 0.4 and v < nxt * 0.4):
            out.append(p)
    return out


def swings(points):
    """Port of seriesSignals.swings — [(kind, price, date)] zigzag at
    an 8% reversal threshold."""
    out = []
    if len(points) < 3:
        return out
    direction = 0  # 1 = rising leg, -1 = falling leg
    extreme = points[0]
    for p in points[1:]:
        change = p[1] / extreme[1] - 1 if extreme[1] > 0 else 0
        if direction != -1 and change <= -REVERSAL_PCT and extreme[1] > 0:
            if direction == 1 or not out:
                out.append(('peak', extreme[1], extreme[0]))
            direction = -1
            extreme = p
        elif direction != 1 and change >= REVERSAL_PCT:
            if direction == -1 or not out:
                out.append(('trough', extreme[1], extreme[0]))
            direction = 1
            extreme = p
        elif (direction == 1 and p[1] > extreme[1]) or \
             (direction == -1 and p[1] < extreme[1]) or direction == 0:
            extreme = p
    return out


def nearest_shelf(troughs, last_price):
    """Nearest swing trough at-or-below last price (2% tolerance)."""
    best = None
    for t in troughs:
        if t[1] <= last_price * 1.02 and (best is None or t[1] > best[1]):
            best = t
    return best


def was_defended(trough, peaks):
    return any(p[2] > trough[2] and p[1] >= trough[1] * DEFENDED_RALLY
               for p in peaks)


def price_at(dates, events, iso):
    i = bisect.bisect_right(dates, iso) - 1
    return events[i][1] if 0 <= i < len(events) else None


def ret_n(dates, events, days):
    prev = price_at(dates, events,
                    (_d(events[-1][0]) - timedelta(days=days)).isoformat())
    cur = events[-1][1]
    if prev is None or prev <= 0:
        return None
    return (cur / prev - 1.0) * 100.0


def archetype(cagr, drawdown, days_since_high, ret90, span, n_events,
              floor_tests, cycle_days, cycle_amp, daily_sigma):
    """Deterministic lifecycle shape — readable rules, not ML. Order
    matters: the first matching story wins."""
    if span < 120 or n_events < 15:
        return 'young'
    if cagr is not None and cagr >= 25 and (drawdown is None or drawdown > -40):
        return 'compounder'
    if cycle_days and cycle_amp and cycle_amp >= 40 and floor_tests >= 2:
        return 'boom_bust'
    if (drawdown is not None and drawdown <= -60
            and days_since_high is not None and days_since_high > 300
            and (ret90 is None or ret90 < 15)):
        return 'one_spike'
    if (cagr is not None and cagr <= -25) or (ret90 is not None and ret90 <= -20):
        return 'bleeder'
    if (cagr is not None and abs(cagr) < 10
            and (daily_sigma is None or daily_sigma < 0.02)):
        return 'flatline'
    return 'neutral'


def deep_features(events):
    """Full per-card deep pass over a sparse event series. events =
    [(iso_date, price)] asc. Returns the card_deep row dict + the swing
    structure the pattern study reuses."""
    pts = despike(events)
    clean_dates = [d for d, _ in pts]
    last_price = pts[-1][1] if pts else None
    sw = swings(pts)
    troughs = [s for s in sw if s[0] == 'trough']
    peaks = [s for s in sw if s[0] == 'peak']

    shelf = nearest_shelf(troughs, last_price) if last_price else None
    shelf_price = shelf[1] if shelf else None
    shelf_tests = (
        sum(1 for t in troughs if abs(t[1] - shelf_price) <= shelf_price * FLOOR_TOUCH)
        if shelf_price else 0
    )

    # Bounce memory — what prior touches of THIS shelf ran to.
    bounce_pcts, bounce_days = [], []
    if shelf_price:
        for t in troughs:
            if abs(t[1] - shelf_price) > shelf_price * FLOOR_TOUCH:
                continue
            nxt = next((p for p in peaks if p[2] > t[2]), None)
            if nxt and nxt[1] > t[1]:
                bounce_pcts.append((nxt[1] / t[1] - 1) * 100)
                bounce_days.append(days_between(t[2], nxt[2]))
    bounce_pct_med = statistics.median(bounce_pcts) if bounce_pcts else None
    bounce_days_med = statistics.median(bounce_days) if bounce_days else None

    # Cycle rhythm — median trough spacing + amplitude.
    gaps = [days_between(troughs[i - 1][2], troughs[i][2])
            for i in range(1, len(troughs))]
    cycle_days = statistics.median(gaps) if len(gaps) >= 2 else None
    amps = []
    for t in troughs:
        nxt = next((p for p in peaks if p[2] > t[2]), None)
        if nxt:
            amps.append((nxt[1] / t[1] - 1) * 100)
    cycle_amp = statistics.median(amps) if amps else None

    # Upside target — nearest defended resistance above, capped by what
    # the card's own bounces ran to off its shelf. Parity with the app's
    # sellIntoPrice: a +25%-bounce floor doesn't get a +70% exit line.
    above = [p[1] for p in peaks if last_price and p[1] > last_price * 1.05
             and was_defended_peak(p, troughs)]
    target_price = min(above) if above else None
    if shelf_price and bounce_pct_med is not None:
        realistic_top = shelf_price * (1 + bounce_pct_med / 100)
        target_price = (min(target_price, realistic_top)
                        if target_price else realistic_top)

    # Self-analog — "times at this shelf → bounced ≥10% in 60d".
    analog_n = 0
    analog_bounce = 0
    if shelf_price:
        for t in troughs:
            if abs(t[1] - shelf_price) > shelf_price * FLOOR_TOUCH:
                continue
            analog_n += 1
            fwd_iso = (_d(t[2]) + timedelta(days=FWD_EVAL_DAYS)).isoformat()
            fwd = price_at(clean_dates, pts, fwd_iso)
            if fwd and fwd >= t[1] * 1.10:
                analog_bounce += 1

    return {
        'shelf_price': shelf_price,
        'shelf_tests': shelf_tests,
        'shelf_defended': bool(shelf and was_defended(shelf, peaks)),
        'bounce_pct_med': bounce_pct_med,
        'bounce_days_med': bounce_days_med,
        'cycle_days': cycle_days,
        'cycle_amp': cycle_amp,
        'target_price': target_price,
        'analog_n': analog_n,
        'analog_bounce_n': analog_bounce,
    }, sw


def was_defended_peak(peak, troughs):
    """A peak that gave back ≥15% after — real resistance, not a step."""
    return any(t[2] > peak[2] and t[1] <= peak[1] / DEFENDED_RALLY
               for t in troughs)


SCHEMA = """
CREATE TABLE IF NOT EXISTS card_deep (
    product_id INTEGER NOT NULL,
    sub_type   TEXT NOT NULL,
    shelf_price REAL, shelf_tests INTEGER,
    bounce_pct_med REAL, bounce_days_med REAL,
    cycle_days REAL, cycle_amp REAL,
    target_price REAL,
    archetype TEXT,
    set_pctile_30d REAL,
    analog_n INTEGER, analog_bounce_n INTEGER,
    pv_flag TEXT, source_agreement REAL,
    computed_at TEXT NOT NULL,
    PRIMARY KEY (product_id, sub_type)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS pattern_stats (
    pattern TEXT NOT NULL,
    window_days INTEGER NOT NULL,
    n_cases INTEGER, hold_rate REAL,
    bounce_med_pct REAL, bounce_med_days REAL,
    computed_at TEXT NOT NULL,
    PRIMARY KEY (pattern, window_days)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS market_stats (
    key TEXT PRIMARY KEY,
    value REAL,
    computed_at TEXT NOT NULL
);
"""


def iter_series(con):
    """Yield (pid, sub, events) streaming the sorted price_history."""
    cur, buf = None, []
    for pid, sub, d, p in con.execute(
        'SELECT product_id, sub_type, date, market_price FROM price_history '
        'WHERE market_price > 0 ORDER BY product_id, sub_type, date'
    ):
        if (pid, sub) != cur:
            if cur is not None and buf:
                yield cur[0], cur[1], buf
            cur, buf = (pid, sub), []
        buf.append((d, p))
    if cur is not None and buf:
        yield cur[0], cur[1], buf


def per_card(con, master, today: date, verbose=True):
    con.executescript(SCHEMA)
    ts = today.isoformat()

    # set_name -> [ret_30d] needs signals_snapshot + cards (both master-side).
    ret30 = {}
    if store.has_table(master, 'signals_snapshot'):
        for r in master.execute(
            'SELECT product_id, sub_type, ret_30d FROM signals_snapshot'
        ):
            ret30[(r['product_id'], r['sub_type'])] = r['ret_30d']
    set_of = {}
    set_rets = {}
    for r in master.execute('SELECT product_id, set_name FROM cards'):
        set_of[r['product_id']] = r['set_name']
    for (pid, sub), r30 in ret30.items():
        s = set_of.get(pid)
        if s and r30 is not None:
            set_rets.setdefault(s, []).append(r30)
    set_sorted = {s: sorted(rs) for s, rs in set_rets.items()
                  if len(rs) >= SET_PEER_MIN}

    pv_rows = {}
    if store.has_table(master, 'pv_agreement'):
        for r in master.execute(
            'SELECT product_id, sub_type, pv_flag, agreement FROM pv_agreement'
        ):
            pv_rows[(r['product_id'], r['sub_type'])] = (r['pv_flag'], r['agreement'])

    # snapshot stats for archetype inputs
    snap = {}
    if store.has_table(master, 'signals_snapshot'):
        for r in master.execute('SELECT * FROM signals_snapshot'):
            snap[(r['product_id'], r['sub_type'])] = dict(r)

    # Read pass first — holding a write transaction open while streaming
    # 4M rows off a second connection self-locks on rollback journals.
    # Compute everything into a buffer, then one write txn at the end.
    rows = []
    n = 0
    for pid, sub, events in iter_series(master):
        if len(events) < 4:
            continue
        feats, _ = deep_features(events)
        s = snap.get((pid, sub), {})
        span = days_between(events[0][0], events[-1][0]) + 1
        n_events = len(events)
        # set momentum percentile — where this card's r30 sits in
        # its set's distribution.
        peers = set_sorted.get(set_of.get(pid))
        pctile = None
        r30 = ret30.get((pid, sub))
        if peers and r30 is not None:
            pctile = round(
                bisect.bisect_left(peers, r30) / len(peers) * 100, 1
            )
        arch = archetype(
            s.get('cagr'), s.get('drawdown'), s.get('days_since_high'),
            s.get('ret_90d'), span, n_events,
            feats['shelf_tests'], feats['cycle_days'],
            feats['cycle_amp'], s.get('daily_sigma'),
        )
        pv_flag, pv_agr = pv_rows.get((pid, sub), (None, None))
        rows.append(
            (pid, sub, feats['shelf_price'], feats['shelf_tests'],
             feats['bounce_pct_med'], feats['bounce_days_med'],
             feats['cycle_days'], feats['cycle_amp'],
             feats['target_price'], arch, pctile,
             feats['analog_n'], feats['analog_bounce_n'],
             pv_flag, pv_agr, ts)
        )
        n += 1
        if verbose and n % 10000 == 0:
            print(f'  computed {n}', flush=True)

    with con:
        con.execute('DELETE FROM card_deep')
        con.executemany(
            'INSERT OR REPLACE INTO card_deep VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            rows,
        )
    if verbose:
        print(f'card_deep: {n} rows')
    return n


def pattern(con, master, today: date, verbose=True):
    """Cross-card outcome study on a rolling window — the base rates
    the odds lines quote. Cards whose feeds die mid-test count as
    failures, or every floor looks stronger than it is."""
    con.executescript(SCHEMA)
    ts = today.isoformat()
    cutoff = (today - timedelta(days=PATTERN_WINDOW_DAYS)).isoformat()
    eval_end = (today - timedelta(days=FWD_EVAL_DAYS)).isoformat()

    floor_holds, floor_total = 0, 0
    bounce_pcts, bounce_days_all = [], []
    revival_follows, revival_total = 0, 0
    n_green, n_red, n_active = 0, 0, 0
    ret30s = []

    for pid, sub, events in iter_series(master):
        if len(events) < 10:
            continue
        dates = [d for d, _ in events]
        last_date = events[-1][0]
        n_active += 1
        r30 = ret_n(dates, events, 30)
        if r30 is not None:
            ret30s.append(r30)
            if r30 > 0:
                n_green += 1
            else:
                n_red += 1

        # Floor-hold cases: each trough inside the window that was a
        # *test of a prior shelf* — a trough near the level of an
        # earlier defended trough. Then check the next 60d.
        pts = despike(events)
        clean_dates = [d for d, _ in pts]
        sw = swings(pts)
        troughs = [s for s in sw if s[0] == 'trough']
        peaks = [s for s in sw if s[0] == 'peak']
        for i, t in enumerate(troughs):
            if t[2] < cutoff or t[2] > eval_end:
                continue
            prior = [x for x in troughs[:i]
                     if abs(x[1] - t[1]) <= t[1] * FLOOR_TOUCH]
            if not prior:
                continue  # not a re-test — no shelf to hold
            floor_total += 1
            fwd_iso = (_d(t[2]) + timedelta(days=FWD_EVAL_DAYS)).isoformat()
            fwd = price_at(dates, pts, fwd_iso)
            tail_prices = [p for d, p in pts
                           if t[2] < d <= fwd_iso]
            held = (
                fwd is not None
                and all(p >= t[1] * 0.92 for p in tail_prices)
            )
            if held:
                floor_holds += 1
            if fwd is not None and fwd > t[1]:
                bounce_pcts.append((fwd / t[1] - 1) * 100)
                bounce_days_all.append(days_between(t[2], fwd_iso))

        # Revival-follow: a +8% month off a ≥30% drawdown — was it
        # still above the turn point 60d later?
        for i, (d, p) in enumerate(pts):
            if d < cutoff or d > eval_end:
                continue
            base = price_at(clean_dates, pts,
                            (_d(d) - timedelta(days=30)).isoformat())
            peak_so_far = max(x[1] for x in pts[:i + 1]) if i else p
            if not base or base <= 0 or peak_so_far <= 0:
                continue
            r = p / base - 1
            dd = p / peak_so_far - 1
            if r >= 0.08 and dd <= -0.30:
                revival_total += 1
                fwd_iso = (_d(d) + timedelta(days=FWD_EVAL_DAYS)).isoformat()
                fwd = price_at(clean_dates, pts, fwd_iso)
                if fwd is not None and fwd >= p:
                    revival_follows += 1
                break  # one case per card keeps independence honest

    def pct(a, b):
        return round(a / b * 100, 1) if b else None

    with con:
        con.execute('DELETE FROM pattern_stats')
        con.execute('DELETE FROM market_stats')
        rows = [
            ('floor_hold', PATTERN_WINDOW_DAYS, floor_total,
             pct(floor_holds, floor_total),
             statistics.median(bounce_pcts) if bounce_pcts else None,
             None, ts),
            ('revival_follow', PATTERN_WINDOW_DAYS, revival_total,
             pct(revival_follows, revival_total), None,
             statistics.median(bounce_days_all) if bounce_days_all else None,
             ts),
        ]
        for row in rows:
            # n below the floor → write with NULL rate so the app can
            # show 'building' instead of a fake-precise number.
            if (row[2] or 0) < MIN_PATTERN_N:
                row = (row[0], row[1], row[2], None, row[4], row[5], row[6])
            con.execute(
                'INSERT INTO pattern_stats VALUES (?,?,?,?,?,?,?)', row)
        breadth = pct(n_green, n_green + n_red)
        med30 = statistics.median(ret30s) if ret30s else None
        for k, v in [
            ('n_active_series', float(n_active)),
            ('pct_green_30d', breadth if breadth is not None else 0.0),
            ('median_ret_30d', med30 if med30 is not None else 0.0),
            ('n_green_30d', float(n_green)),
            ('n_red_30d', float(n_red)),
        ]:
            con.execute(
                'INSERT INTO market_stats VALUES (?,?,?)', (k, v, ts))
    if verbose:
        print(
            f'pattern: floor_hold {floor_holds}/{floor_total} '
            f'({pct(floor_holds, floor_total)}%), '
            f'revival_follow {revival_follows}/{revival_total} '
            f'({pct(revival_follows, revival_total)}%), '
            f'breadth {breadth}% green'
        )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--db', help='research db path (deep tables written here)')
    ap.add_argument('--master', help='canonical db path (default: --db)')
    ap.add_argument('--per-card', action='store_true')
    ap.add_argument('--pattern', action='store_true')
    args = ap.parse_args()

    db_path = args.db or store.default_db_path()
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    master = store.open_master(args.master or db_path)
    today = date.today()

    if not args.per_card and not args.pattern:
        ap.error('pick --per-card and/or --pattern')
    if args.per_card:
        per_card(con, master, today)
    if args.pattern:
        pattern(con, master, today)
    con.close()


if __name__ == '__main__':
    main()
