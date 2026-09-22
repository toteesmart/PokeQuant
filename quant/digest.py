"""Render a readable master-list digest from the signals_snapshot table.

    py -m quant.digest [--db PATH] [--top N]

Emits quant/data/snapshot_digest_<date>.md — grouped BUY_HOLD / BUY_FLIP /
SELL_STRENGTH / SELL_NOW / HOLD sections plus coverage stats.
"""
import argparse
import os
from collections import Counter
from datetime import date

from quant import store

PRODUCT_WORDS = ('case', 'box', 'blister', 'collection', 'tin ', 'deck ',
                 'code card', 'pack ', 'bundle', 'display', 'figure')


def is_single(name):
    n = (name or '').lower()
    return not any(w in n for w in PRODUCT_WORDS)


def row_line(r):
    name, num, setn, rarity, st, price, z, pct, r7, r30, cagr, xs, conf, dsc = r
    xs_s = f'{xs:+.0f}' if xs is not None else 'n/a'
    cagr_s = f'{cagr:+.0f}%' if cagr is not None else 'n/a'
    return (f"| {name} #{num} | {setn} | {st} | ${price:.2f} | "
            f"{pct:.0f}% | {r7:+.0f}% | {r30:+.0f}% | {cagr_s} | {xs_s} |")


def query(con, action, order, price_min, span_min, singles_only, top):
    rows = con.execute(
        'SELECT c.card_name, c.card_number, c.set_name, c.rarity, s.sub_type, '
        's.price, s.z90, s.pctile_1y, s.ret_7d, s.ret_30d, s.cagr, '
        's.excess_30d, s.confidence, s.days_since_change '
        'FROM signals_snapshot s JOIN cards c ON c.product_id=s.product_id '
        "WHERE s.action=? AND s.liq_flag='active' "
        "AND s.confidence IN ('high','medium') AND s.price>=? AND s.span_days>=? "
        f'ORDER BY {order}', (action, price_min, span_min)).fetchall()
    if singles_only:
        rows = [r for r in rows if is_single(r[0])]
    return rows[:top]


def section(title, rows):
    out = [f'\n## {title} ({len(rows)})',
           '| card | set | finish | price | 1y pct | 7d | 30d | CAGR | set-xs |',
           '|---|---|---|---|---|---|---|---|---|']
    out += [row_line(r) for r in rows]
    return '\n'.join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db')
    ap.add_argument('--top', type=int, default=40)
    ap.add_argument('--out')
    args = ap.parse_args()

    db_path = store.default_db_path(args.db)
    con = store.open_master(db_path)
    max_date = con.execute('SELECT MAX(price_date) FROM signals_snapshot').fetchone()[0]
    counts = Counter(r[0] for r in con.execute(
        'SELECT action FROM signals_snapshot'))
    total = sum(counts.values())

    T = args.top
    parts = [
        f'# Market snapshot digest — {date.today().isoformat()} '
        f'(prices through {max_date})',
        f'\n{total} price series scored. Actions: '
        + ', '.join(f'{k} {v}' for k, v in counts.most_common()),
        '\nBuy-side assumes a 70-80% of market offer. '
        'BUY_HOLD = appreciating dip (hold thesis). '
        'BUY_FLIP = liquid + rising now (resell at market quickly). '
        'set-xs = 30d return minus set median (idiosyncratic strength).',
        section('BUY_HOLD — appreciating assets in dips (top by CAGR, ≥1y history)',
                query(con, 'BUY_HOLD', 's.cagr DESC', 3.0, 365, True, T)),
        section('BUY_FLIP — liquid and rising (top by 30d return)',
                query(con, 'BUY_FLIP', 's.ret_30d DESC', 2.0, 180, True, T)),
        section('SELL_STRENGTH — at/near highs, highest dollar first',
                query(con, 'SELL_STRENGTH', 's.price DESC', 10.0, 180, True, T)),
        section('SELL_NOW — actively falling, sell before more decay',
                query(con, 'SELL_NOW', 's.ret_30d ASC', 2.0, 120, True, T)),
        section('HOLD — historically cheap, no uptrend yet',
                query(con, 'HOLD', 's.price DESC', 3.0, 180, True, T)),
    ]
    text = '\n'.join(parts) + '\n'
    out = args.out or os.path.join(
        os.path.dirname(db_path),
        f'snapshot_digest_{date.today().isoformat()}.md')
    with open(out, 'w', encoding='utf-8') as f:
        f.write(text)
    print('wrote', out)


if __name__ == '__main__':
    main()
