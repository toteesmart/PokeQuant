"""PV <-> tcgcsv join + source-agreement scoring.

Two independent feeds joined for weight — never merged into one
series. tcgcsv stays canonical; PV earns a prefix (history before our
first date) only when the pair provably tracks the same card. The
audit showed ~22% of PV entries priced >2x off our level — those are
the wrong-printing misses (JP/alt/graded counted as English), and
they get quarantined here, not blended.

Per (product_id, sub_type):
    level_ratio    median(pv_price / our_price) on shared dates
    corr           Pearson on matched daily returns (shape agreement)
    agreement      0..1 blend of level+shape, None when unprovable
    pv_flag        ok | level_mismatch | shape_divergent | thin_overlap |
                   no_our_series | thin_pv

Tables:
    pv_agreement — one row per joined (product_id, sub_type)
    pv_prefix    — PV rows BEFORE our first tcgcsv date, only where the
                   pair passes: the honest history extension. deep.py
                   reads this; the canonical tables never see it.
"""
import argparse
import sqlite3
import statistics
import time

from .pv_ingest import VARIANT_MAP, now_iso
from . import store

SCHEMA = """
CREATE TABLE IF NOT EXISTS pv_agreement (
    product_id  INTEGER NOT NULL,
    sub_type    TEXT NOT NULL,
    pv_variant  TEXT NOT NULL,
    level_ratio REAL,
    overlap_days INTEGER,
    corr        REAL,
    agreement   REAL,
    pv_flag     TEXT NOT NULL,
    computed_at TEXT NOT NULL,
    PRIMARY KEY (product_id, sub_type)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS pv_prefix (
    product_id  INTEGER NOT NULL,
    sub_type    TEXT NOT NULL,
    date        TEXT NOT NULL,
    price       REAL NOT NULL,
    PRIMARY KEY (product_id, sub_type, date)
) WITHOUT ROWID;
"""

# Agreement gates — level within ~1/1.4 (±40% median) and the curves
# moving together. Deliberately looser than the raw 15% audit band:
# eBay-level pricing runs noisier than tcgcsv mid, so agreement asks
# "same card?" not "same price?".
LEVEL_MIN, LEVEL_MAX = 0.55, 1.8
CORR_MIN = 0.45
OVERLAP_MIN = 45          # shared days before the score means anything
AGREEMENT_PASS = 0.60     # blend threshold for earning the prefix


def pearson(xs, ys):
    n = len(xs)
    if n < 8:
        return None
    mx, my = statistics.fmean(xs), statistics.fmean(ys)
    cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    vx = sum((x - mx) ** 2 for x in xs)
    vy = sum((y - my) ** 2 for y in ys)
    if vx <= 0 or vy <= 0:
        return None
    return cov / (vx * vy) ** 0.5


def matched_returns(ours: dict, pv: dict):
    """Daily returns on dates BOTH series price — shape agreement."""
    dates = sorted(set(ours) & set(pv))
    rx, ry = [], []
    for i in range(1, len(dates)):
        p0, p1 = ours[dates[i - 1]], ours[dates[i]]
        q0, q1 = pv[dates[i - 1]], pv[dates[i]]
        if p0 > 0 and q0 > 0:
            rx.append(p1 / p0 - 1)
            ry.append(q1 / q0 - 1)
    return rx, ry, len(dates)


def score_pair(ours: dict, pv: dict):
    """(level_ratio, overlap_days, corr, agreement, flag)"""
    shared = sorted(set(ours) & set(pv))
    overlap = len(shared)
    if overlap < OVERLAP_MIN:
        return None, overlap, None, None, 'thin_overlap'
    ratios = [pv[d] / ours[d] for d in shared if ours[d] > 0 and pv[d] > 0]
    if len(ratios) < OVERLAP_MIN:
        return None, overlap, None, None, 'thin_overlap'
    level = statistics.median(ratios)
    rx, ry, _ = matched_returns(ours, pv)
    corr = pearson(rx, ry)

    if level < LEVEL_MIN or level > LEVEL_MAX:
        flag = 'level_mismatch'
    elif corr is not None and corr < CORR_MIN:
        flag = 'shape_divergent'
    else:
        flag = 'ok'

    # Blend: level closeness on a log scale (1.0 = identical median),
    # shape as the return correlation (None corr → neutral 0.5).
    level_score = max(0.0, 1.0 - abs(__import__('math').log(level)) / __import__('math').log(1.8))
    shape_score = (corr + 1) / 2 if corr is not None else 0.5
    agreement = round(0.55 * level_score + 0.45 * shape_score, 3)
    return level, overlap, corr, agreement, flag


def run(con, master, verbose=True):
    con.executescript(SCHEMA)
    ts = now_iso()

    # PV side: variant -> our sub_type, only where a map exists.
    pv_variants = {
        (r['product_id'], r['pv_variant'])
        for r in con.execute('SELECT DISTINCT product_id, pv_variant FROM pv_series')
    }
    stats = {'ok': 0, 'level_mismatch': 0, 'shape_divergent': 0,
             'thin_overlap': 0, 'no_our_series': 0, 'thin_pv': 0, 'prefix': 0}

    n_done = 0
    with con:
        con.execute('DELETE FROM pv_prefix')
    for pid, pv_variant in sorted(pv_variants):
        sub = VARIANT_MAP.get(pv_variant)
        if not sub:
            continue
        ours = dict(
            store.get_series(master, pid, sub)
        )
        pv = {
            r['date']: r['price']
            for r in con.execute(
                'SELECT date, price FROM pv_series WHERE product_id=? AND pv_variant=?',
                (pid, pv_variant),
            )
        }
        if len(pv) < OVERLAP_MIN:
            flag = 'thin_pv'
            level = overlap = corr = agreement = None
            overlap = 0
        elif not ours:
            flag = 'no_our_series'
            level = corr = agreement = None
            overlap = 0
        else:
            level, overlap, corr, agreement, flag = score_pair(ours, pv)

        stats[flag] = stats.get(flag, 0) + 1
        with con:
            con.execute(
                'INSERT OR REPLACE INTO pv_agreement VALUES (?,?,?,?,?,?,?,?,?)',
                (pid, sub, pv_variant, level, overlap, corr, agreement, flag, ts),
            )
            if flag == 'ok' and agreement >= AGREEMENT_PASS and ours:
                our_first = min(ours)
                for d, p in pv.items():
                    if d < our_first:
                        con.execute(
                            'INSERT OR REPLACE INTO pv_prefix VALUES (?,?,?,?)',
                            (pid, sub, d, p),
                        )
                        stats['prefix'] += 1
        n_done += 1
        if verbose and n_done % 2000 == 0:
            print(f'  joined {n_done}/{len(pv_variants)}')

    with con:
        con.execute(
            'INSERT OR REPLACE INTO pv_meta (key, value) VALUES (?,?)',
            ('join_computed_at', ts),
        )
    if verbose:
        print('pv_join:', stats)
    return stats


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--db', help='research db path')
    ap.add_argument('--master', help='canonical tcgcsv db path (default: --db)')
    args = ap.parse_args()

    db_path = args.db or store.default_db_path()
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    master = store.open_master(args.master or db_path)
    run(con, master)


if __name__ == '__main__':
    main()
