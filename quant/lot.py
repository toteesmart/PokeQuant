"""Evaluate a purchase lot against signals_snapshot.

    py -m quant.lot cards.txt --price 750 [--split 2]

One card per line: `Name|number` (number optional; `|jp` JP-only; `|N` qty).
Picks the top-scoring candidate per line but flags ambiguous matches —
verify the physical printing before paying. Prints totals, % of market,
appreciating share, the flip pile (at 1y highs), and a suggested split.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from quant import store  # noqa: E402

AMBIGUITY_GAP = 15.0      # runner-up score within this of the top -> flag


def valuate(con, snaps, name, num, jp, qty):
    """Returns dict: card row, chosen signal row, qty, alt signal rows, flags."""
    cands = store.resolve_card(con, name, num or None, jp=jp)
    if not cands:
        return {'name': name, 'num': num, 'qty': qty, 'card': None}
    top, runner = cands[0], cands[1] if len(cands) > 1 else None
    rows = snaps.get(top['product_id'], [])
    pick = store.pick_signal_row(rows)
    alts = [r for r in rows if pick is None or r['sub_type'] != pick['sub_type']]
    return {
        'name': name, 'num': num, 'qty': qty, 'card': top, 'pick': pick,
        'alts': alts,
        'ambiguous': runner is not None and
                     top['score'] - runner['score'] < AMBIGUITY_GAP,
        'runner': runner,
    }


def fmt_pct(x):
    return f'{x:+.0f}%' if x is not None else '  n/a'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('file')
    ap.add_argument('--price', type=float, default=0.0, help='asking price')
    ap.add_argument('--split', type=int, default=0, help='ways to split')
    ap.add_argument('--db')
    args = ap.parse_args()

    con = store.open_master(store.default_db_path(args.db))
    if not store.has_table(con, 'signals_snapshot'):
        sys.exit('signals_snapshot missing — run `py -m quant.snapshot` first')
    snaps = store.load_snapshot_map(con)

    items = []
    for name, num, jp, qty, raw in store.parse_card_file(args.file):
        items.append(valuate(con, snaps, name, num, jp, qty))

    total = 0.0
    missing, ambiguous, flips, dead = [], [], [], []
    appr_val = depr_val = 0.0
    print(f'\n=== {len(items)} line-items ===')
    for it in items:
        if not it['card']:
            missing.append(it)
            print(f"  ?? {it['name']} {it['num']} — NO MATCH")
            continue
        c, p, q = it['card'], it['pick'], it['qty']
        price = (p or {}).get('price') or 0.0
        total += price * q
        flag = ' <<AMBIGUOUS' if it['ambiguous'] else ''
        print(f"  ${price:>7.2f} x{q} {c['card_name']} #{c['card_number']} "
              f"[{c['set_name']}]{flag}")
        if it['ambiguous']:
            ambiguous.append(it)
        if p:
            if p['trend'] == 'appreciating':
                appr_val += price * q
            elif p['trend'] == 'depreciating':
                depr_val += price * q
            if (p['pctile_1y'] or 0) >= 90 or p['action'] in (
                    'SELL_STRENGTH', 'SELL_NOW'):
                flips.append((it, price))
            if p['action'] == 'SELL_NOW':
                dead.append((it, price))
        print(f"      {p['action'] if p else 'UNPRICED':<14} "
              f"{p['stance'] if p else '':<16} "
              f"30d{fmt_pct(p['ret_30d'] if p else None):>7} "
              f"cagr{fmt_pct(p['cagr'] if p else None):>7}")

    appr_pct = appr_val / total * 100 if total else 0
    print(f'\n--- TOTAL: ${total:,.2f} market ---')
    if args.price:
        pct = args.price / total * 100 if total else 0
        per = args.price / (args.split or 1)
        print(f'asking ${args.price:,.0f} = {pct:.0f}% of market'
              + (f' | ${per:,.0f}/way for ~${total/(args.split or 1):,.0f}'
                 if args.split else ''))
    print(f'appreciating share: {appr_pct:.0f}% of value '
          f'(${appr_val:,.0f} appr / ${depr_val:,.0f} depr)')

    if flips:
        print(f'\nFLIP pile ({len(flips)} items at/near 1y highs):')
        for it, pr in sorted(flips, key=lambda t: -t[1]):
            print(f"  ${pr:>7.2f} {it['card']['card_name']} "
                  f"#{it['card']['card_number']}")
    if dead:
        print(f'\nActively falling (move fast or price low):')
        for it, pr in sorted(dead, key=lambda t: -t[1]):
            print(f"  ${pr:>7.2f} {it['card']['card_name']} "
                  f"#{it['card']['card_number']}")
    if ambiguous:
        print(f'\nVERIFY physical printings (ambiguous matches):')
        for it in ambiguous:
            r = it['runner']
            print(f"  {it['name']}: took {it['card']['set_name']} "
                  f"(score {it['card']['score']:.0f}) vs "
                  f"{r['card_name']} [{r['set_name']}] ({r['score']:.0f})")
    if missing:
        print(f'\nUNRESOLVED — check spelling/number:')
        for it in missing:
            print(f"  {it['name']} {it['num']}")


if __name__ == '__main__':
    main()
