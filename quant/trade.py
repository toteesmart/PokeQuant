"""Two-sided trade fairness against signals_snapshot.

    py -m quant.trade --give give.txt --get get.txt

Same file format as quant.lot. Compares face value AND 30d trajectory
(market x (1+ret_30d)) per side — a trade can look fair today while handing
you a declining pile for a compounding one. Flags:
  - incoming cards at pctile>=90 (they're selling the top) or SELL_NOW
  - your outgoing BUY_HOLD compounders (you'd gift the recovery)
  - >=4 copies of one card on a side (concentration = slow to move)
"""
import argparse
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from quant import store  # noqa: E402
from quant.lot import valuate  # noqa: E402

FAV_WIN, FAV_LOSE = 1.10, 0.90
DUP_LIMIT = 4


def side_value(con, snaps, path):
    items, total, traj = [], 0.0, 0.0
    for name, num, jp, qty, raw in store.parse_card_file(path):
        it = valuate(con, snaps, name, num, jp, qty)
        items.append(it)
        if it['card'] and it['pick']:
            price = it['pick']['price'] or 0.0
            r30 = it['pick']['ret_30d']
            total += price * qty
            traj += price * qty * (1 + (r30 or 0) / 100.0)
    return items, total, traj


def print_side(label, items, total, traj):
    print(f'\n=== {label}: ${total:,.2f} market '
          f'(30d trajectory ${traj:,.2f}) ===')
    dupes = Counter(it['card']['product_id']
                    for it in items if it['card'])
    for it in items:
        if not it['card']:
            print(f"  ?? {it['name']} — NO MATCH")
            continue
        c, p, q = it['card'], it['pick'], it['qty']
        price = (p or {}).get('price') or 0.0
        notes = []
        if p:
            if (p['pctile_1y'] or 0) >= 90:
                notes.append('at 1y highs')
            if p['action'] == 'SELL_NOW':
                notes.append('FALLING')
            if p['action'] == 'BUY_HOLD':
                notes.append('compounder')
            if p['trend'] == 'appreciating' and \
                    (p['ret_30d'] or 0) < -8 \
                    and p['action'] != 'SELL_NOW':
                notes.append('dip buy')
        if it['ambiguous']:
            notes.append(f"ambiguous — maybe {it['runner']['set_name']}")
        if dupes[c['product_id']] >= DUP_LIMIT:
            notes.append(f"x{dupes[c['product_id']]} dupes — slow mover")
        note_s = f"  <<{'; '.join(notes)}>>" if notes else ''
        print(f"  ${price:>7.2f} x{q} {c['card_name']} "
              f"#{c['card_number']} [{c['set_name']}]{note_s}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--give', required=True, help='cards you hand over')
    ap.add_argument('--get', required=True, help='cards you receive')
    ap.add_argument('--db')
    args = ap.parse_args()

    con = store.open_master(store.default_db_path(args.db))
    if not store.has_table(con, 'signals_snapshot'):
        sys.exit('signals_snapshot missing — run `py -m quant.snapshot` first')
    snaps = store.load_snapshot_map(con)

    g_items, g_total, g_traj = side_value(con, snaps, args.give)
    t_items, t_total, t_traj = side_value(con, snaps, args.get)
    print_side('YOU GIVE', g_items, g_total, g_traj)
    print_side('YOU GET', t_items, t_total, t_traj)

    if g_total <= 0:
        sys.exit('give side has no value — check matches')
    ratio = t_total / g_total
    diff = t_total - g_total
    traj_ratio = t_traj / g_traj if g_traj else 1.0
    print(f'\n--- VERDICT ---')
    print(f'face value:  ${t_total:,.2f} vs ${g_total:,.2f} '
          f'({ratio:.0%} — {"+" if diff >= 0 else ""}{diff:,.2f})')
    print(f'trajectory:  ${t_traj:,.2f} vs ${g_traj:,.2f} ({traj_ratio:.0%})')
    if ratio >= FAV_WIN:
        print('FACE VALUE: favorable for you')
    elif ratio >= FAV_LOSE:
        print('FACE VALUE: fair')
    else:
        print(f'FACE VALUE: you are ${abs(diff):,.2f} UNDERWATER')
    if traj_ratio >= 1.10 and ratio < 1.0:
        print("but trajectory favors you — they're handing you the "
              'appreciating side')
    elif traj_ratio <= 0.90 and ratio >= 1.0:
        print("but trajectory favors them — you'd be trading "
              "compounders for decay")


if __name__ == '__main__':
    main()
