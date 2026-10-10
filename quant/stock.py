"""Cheap appreciating-stock finder — the $2-10 binder-fill shopping list.

    py -m quant.stock [--max-price 10] [--min-price 1.5]
                      [--min-cagr 30] [--min-events 30] [--limit 60] [--jp]

Liquid + appreciating cards in a price band, ranked by CAGR. These are the
cards that compound while sitting as casual-buyer impulse stock — the mini
versions of the gallery-class hold pile.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from quant import store  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--max-price', type=float, default=10.0)
    ap.add_argument('--min-price', type=float, default=1.5)
    ap.add_argument('--min-cagr', type=float, default=30.0)
    ap.add_argument('--min-events', type=int, default=30)
    ap.add_argument('--min-span', type=int, default=120,
                    help='min tracked days — kills new-release CAGR blowups')
    ap.add_argument('--max-cagr', type=float, default=500.0,
                    help='cap base-effect CAGR artifacts (pennies -> dollars)')
    ap.add_argument('--limit', type=int, default=60)
    ap.add_argument('--jp', action='store_true')
    ap.add_argument('--db')
    args = ap.parse_args()

    con = store.open_master(store.default_db_path(args.db))
    if not store.has_table(con, 'signals_snapshot'):
        sys.exit('signals_snapshot missing — run `py -m quant.snapshot` first')

    jp_clause = "AND c.set_name LIKE 'JP · %'" if args.jp \
        else "AND c.set_name NOT LIKE 'JP · %'"
    rows = con.execute(f'''
        SELECT c.card_name, c.card_number, c.set_name, c.rarity,
               s.sub_type, s.price, s.cagr, s.ret_30d, s.ret_7d,
               s.pctile_1y, s.n_events, s.action
        FROM signals_snapshot s JOIN cards c ON s.product_id = c.product_id
        WHERE s.price BETWEEN ? AND ?
          AND s.trend = 'appreciating' AND s.liq_flag = 'active'
          AND s.cagr BETWEEN ? AND ?
          AND s.n_events >= ? AND s.span_days >= ?
          {jp_clause}
        ORDER BY s.cagr DESC LIMIT ?''',
        (args.min_price, args.max_price, args.min_cagr, args.max_cagr,
         args.min_events, args.min_span, args.limit)).fetchall()

    print(f'{len(rows)} hits — appreciating + liquid '
          f'${args.min_price}-${args.max_price}')
    for r in rows:
        (name, num, set_name, rarity, sub, price, cagr, r30, r7,
         pct, ne, action) = r
        print(f"  ${price:>6.2f} {name:<32} #{num or '':<10} "
              f"{(set_name or '')[:32]:<32} {sub:<12} "
              f"cagr{cagr:+.0f}% 30d{(r30 or 0):+.0f}% "
              f"7d{(r7 or 0):+.0f}% pct{(pct or 0):.0f} n={ne} [{action}]")


if __name__ == '__main__':
    main()
