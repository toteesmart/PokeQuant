"""Evaluate a TCGplayer export.csv lot against engine signals.

py eval_lot.py --csv C:/Users/Drawi/Downloads/export.csv --offer 220
"""
import argparse
import csv
import re
import sqlite3

DB = 'quant/data/research.db'


def norm(s):
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()


def match_card(con, name, number, jp):
    """Find product_id candidates by number + name."""
    base = norm(name).replace(' jp', '').strip()
    rows = con.execute(
        'SELECT product_id, card_name, set_name, rarity FROM cards '
        'WHERE card_number = ?', (number,)).fetchall()
    if not rows:
        rows = con.execute(
            'SELECT product_id, card_name, set_name, rarity FROM cards '
            'WHERE card_name LIKE ?', (f'%{name.split("(")[0].strip()}%',)
        ).fetchall()[:8]
    if not rows:
        return None, None, None
    scored = []
    for pid, cn, sn, rar in rows:
        ncn = norm(cn)
        score = 0
        if base and base in ncn:
            score += 3
        elif ncn in base:
            score += 2
        is_jp_row = 'JP' in (sn or '')
        if is_jp_row == jp:
            score += 1
        scored.append((score, pid, cn, sn, rar))
    scored.sort(key=lambda x: -x[0])
    if scored and scored[0][0] > 0:
        return scored[0][1], scored[0][2], scored[0][3]
    return None, None, None


def best_signal(con, pid, market):
    rows = con.execute(
        'SELECT * FROM signals_snapshot WHERE product_id = ?', (pid,)
    ).fetchall()
    if not rows:
        return None
    cols = [d[1] for d in con.execute('PRAGMA table_info(signals_snapshot)')]
    sigs = [dict(zip(cols, r)) for r in rows]
    # prefer Holofoil (export variance), else closest price to market
    def key(s):
        pref = 0 if s['sub_type'] == 'Holofoil' else 1
        dist = abs((s['price'] or 0) - market) if market else 0
        return (pref, dist)
    sigs.sort(key=key)
    return sigs[0]


def bucket(sig):
    """Simplified rotation read from signal stats."""
    if sig is None:
        return 'unknown', '?'
    r30, r90 = sig['ret_30d'], sig['ret_90d']
    cagr, dd, pct = sig['cagr'], sig['drawdown'], sig['pctile_1y']
    if r30 is not None and r30 <= -12:
        return 'rotate', 'FREE_FALL'
    if cagr is not None and cagr <= -15:
        return 'rotate', 'DECLINER'
    if (r90 is not None and r90 <= -15) and (cagr is None or cagr < 10):
        return 'rotate', 'BLEED'
    if dd is not None and dd <= -45 and (sig['days_since_high'] or 0) > 300 \
            and (r90 is None or r90 < 10):
        return 'dead', 'ONE_SPIKE'
    if cagr is not None and abs(cagr) < 8 and (pct is None or 20 < pct < 80):
        return 'dead', 'FLAT'
    if (r30 is not None and r30 > 5) or (cagr is not None and cagr >= 20):
        return 'grow', 'GROW'
    return 'keep', 'STABLE'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--csv', required=True)
    ap.add_argument('--offer', type=float, required=True)
    args = ap.parse_args()

    con = sqlite3.connect(DB)
    total = 0.0
    matched = 0
    rows_out = []
    with open(args.csv, newline='', encoding='utf-8-sig') as f:
        for r in csv.DictReader(f):
            name = r['Product Name'].strip()
            number = r['Card Number'].strip()
            jp = '(jp)' in name.lower() or '(JP)' in r['Set']
            qty = int(float(r['Quantity'] or 1))
            market = float(r['Market Price (As of 2026-10-12)'] or 0)
            pid, cn, sn = match_card(con, name, number, jp)
            sig = best_signal(con, pid, market) if pid else None
            b, cls = bucket(sig)
            rows_out.append({
                'name': name, 'set': r['Set'], 'num': number, 'qty': qty,
                'market': market, 'pid': pid, 'cn': cn, 'sn': sn,
                'bucket': b, 'cls': cls,
                'r30': sig['ret_30d'] if sig else None,
                'r90': sig['ret_90d'] if sig else None,
                'cagr': sig['cagr'] if sig else None,
                'dd': sig['drawdown'] if sig else None,
                'pct': sig['pctile_1y'] if sig else None,
            })
            total += market * qty
            matched += 1 if pid else 0

    print(f'\n=== LOT EVAL vs ${args.offer:.0f} offer ===')
    print(f'rows {len(rows_out)} | matched {matched} | '
          f'market ${total:.2f} | offer = {args.offer / total * 100:.0f}% '
          f'of market\n')

    by_bucket = {}
    for o in rows_out:
        by_bucket.setdefault(o['bucket'], []).append(o)
    order = ['grow', 'keep', 'dead', 'rotate', 'unknown']
    for b in order:
        lst = by_bucket.get(b, [])
        if not lst:
            continue
        val = sum(o['market'] * o['qty'] for o in lst)
        print(f'--- {b.upper()} ({len(lst)} rows, ${val:.2f}) ---')
        for o in sorted(lst, key=lambda x: -x['market']):
            stat = ''
            if o['r30'] is not None:
                stat += f" r30 {o['r30']:+.0f}%"
            if o['cagr'] is not None:
                stat += f" cagr {o['cagr']:+.0f}%/y"
            if o['dd'] is not None:
                stat += f" dd {o['dd']:.0f}%"
            tag = '' if o['pid'] else '  [UNMATCHED]'
            print(f"  ${o['market']:>7.2f} x{o['qty']} {o['name'][:38]:<38} "
                  f"{o['cls']:<9}{stat}{tag}")
        print()


if __name__ == '__main__':
    main()
