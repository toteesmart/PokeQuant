"""Batch inventory lookup against signals_snapshot.

    py -m quant.lookup cards.txt [--top N]

Each line: "Name|number" (number optional, '#' comments ok, '|jp' third field
filters to JP sets). Prints every candidate variant plus its snapshot signal
row so the right printing/finish can be verified — no silent auto-picks.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from quant import store  # noqa: E402

ROW_SQL = ('SELECT sub_type, price, action, stance, pctile_1y, ret_7d, '
           'ret_30d, ret_90d, cagr, trend, confidence, n_events '
           'FROM signals_snapshot WHERE product_id=? ORDER BY sub_type')


def fmt(x, pct=True, nd=0):
    if x is None:
        return 'n/a'
    return f'{x:+.{nd}f}%' if pct else f'{x:.{nd}f}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('file')
    ap.add_argument('--db')
    ap.add_argument('--top', type=int, default=5)
    args = ap.parse_args()

    con = store.open_master(store.default_db_path(args.db))
    if not store.has_table(con, 'signals_snapshot'):
        sys.exit('signals_snapshot missing — run `py -m quant.snapshot` first')

    for line in open(args.file, encoding='utf-8'):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        parts = [p.strip() for p in line.split('|')]
        name, num = parts[0], (parts[1] if len(parts) > 1 else '')
        jp = parts[2].lower() == 'jp' if len(parts) > 2 else None
        cands = store.resolve_card(con, name, num or None, jp=jp)
        print(f'\n## {line}')
        if not cands:
            print('  NO MATCH')
            continue
        for c in cands[:args.top]:
            print(f"  pid={c['product_id']} {c['card_name']} #{c['card_number']} "
                  f"[{c['set_name']}] {c.get('rarity') or ''} "
                  f"(score {c['score']:.0f})")
            for r in con.execute(ROW_SQL, (c['product_id'],)):
                (sub, price, action, stance, pct, r7, r30, r90,
                 cagr, trend, conf, ne) = r
                ps = f'${price:.2f}' if price else '$-'
                print(f'      {sub:<14} {ps:>8}  {action or "-":<14} '
                      f'{stance:<12} pct{fmt(pct):>7} 7d{fmt(r7):>8} '
                      f'30d{fmt(r30):>8} 90d{fmt(r90):>8} cagr{fmt(cagr):>9} '
                      f'{trend:<13} {conf} n={ne}')


if __name__ == '__main__':
    main()
