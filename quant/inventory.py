"""Grade an exported inventory CSV against signals_snapshot.

    py -m quant.inventory export.csv

Auto-detects format: a `product_id` column (CardCache export) matches
directly; otherwise name+number columns resolve fuzzily (Collectr export).
BOM-tolerant. Buckets every row:

  DEAD     falling/SELL_NOW          -> dump at 75-80% before it decays more
  RISER    climbing now              -> keep at full sticker
  KEEPER   appreciating compounder   -> hold
  STALE    no price update in 60d+   -> verify the quote manually
  NEUTRAL  everything else

Then prints fresh-vs-listed totals so stale app prices surface.
"""
import argparse
import csv
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from quant import store  # noqa: E402

STALE_DAYS = 60
NAME_COLS = ('card_name', 'card', 'name', 'product name', 'product_name')
NUM_COLS = ('card_number', 'number', 'num', '#', 'card number', 'no.')
SET_COLS = ('set_name', 'set', 'set name', 'edition', 'series')
QTY_COLS = ('quantity', 'qty', 'count', 'amount')
PRICE_COLS = ('market_price', 'market price', 'price', 'value',
              'current price', 'market')


def find_col(headers, candidates):
    low = {h.strip().lower(): h for h in headers}
    for c in candidates:
        if c in low:
            return low[c]
    return None


def to_f(x):
    try:
        return float(str(x).replace('$', '').replace(',', '').strip())
    except (TypeError, ValueError):
        return None


def to_i(x):
    try:
        return int(float(str(x).strip()))
    except (TypeError, ValueError):
        return 1


def bucket(sig):
    if not sig:
        return 'NEUTRAL'
    if sig['action'] == 'SELL_NOW' or sig['stance'] == 'falling':
        return 'DEAD'
    if (sig['days_since_change'] or 0) > STALE_DAYS:
        return 'STALE'
    if sig['action'] == 'BUY_FLIP' or sig['stance'] == 'elevated_rising' \
            or (sig['ret_30d'] or 0) >= 8:
        return 'RISER'
    if sig['action'] == 'BUY_HOLD' or sig['trend'] == 'appreciating':
        return 'KEEPER'
    return 'NEUTRAL'


SUGGEST = {
    'DEAD': 'dump at 75-80% — still decaying',
    'RISER': 'full sticker — moving up',
    'KEEPER': 'hold — compounding',
    'STALE': 'verify price manually — feed is stale',
    'NEUTRAL': 'sticker at market',
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('csv_file')
    ap.add_argument('--db')
    args = ap.parse_args()

    con = store.open_master(store.default_db_path(args.db))
    if not store.has_table(con, 'signals_snapshot'):
        sys.exit('signals_snapshot missing — run `py -m quant.snapshot` first')
    snaps = store.load_snapshot_map(con)

    with open(args.csv_file, encoding='utf-8-sig', newline='') as f:
        rows = list(csv.DictReader(f))
    if not rows:
        sys.exit('empty or unreadable CSV')
    headers = list(rows[0].keys())
    pid_col = find_col(headers, ('product_id', 'product id', 'productid'))
    name_col = find_col(headers, NAME_COLS)
    num_col = find_col(headers, NUM_COLS)
    qty_col = find_col(headers, QTY_COLS)
    price_col = find_col(headers, PRICE_COLS)

    buckets = {b: [] for b in ('DEAD', 'RISER', 'KEEPER', 'STALE', 'NEUTRAL')}
    total_fresh = total_listed = 0.0
    unmatched = 0
    for row in rows:
        qty = to_i(row.get(qty_col)) if qty_col else 1
        listed = to_f(row.get(price_col)) if price_col else None
        if pid_col:
            pid = to_i(row.get(pid_col))
            cands = snaps.get(pid, [])
            card_name = row.get(name_col) or f'pid {pid}'
        else:
            card_name = row.get(name_col, '')
            num = row.get(num_col, '') if num_col else ''
            cands_raw = store.resolve_card(con, card_name, num or None)
            pid = cands_raw[0]['product_id'] if cands_raw else None
            cands = snaps.get(pid, []) if pid else []
        sig = store.pick_signal_row(cands)
        if not cands:
            unmatched += 1
        b = bucket(sig)
        fresh = (sig or {}).get('price')
        total_fresh += (fresh or 0) * qty
        total_listed += (listed or fresh or 0) * qty
        buckets[b].append({
            'name': card_name, 'qty': qty, 'fresh': fresh,
            'listed': listed, 'sig': sig,
            'delta': (fresh - listed) if fresh and listed else None,
        })

    print(f'\n{len(rows)} rows | {unmatched} unmatched | '
          f'fresh total ${total_fresh:,.2f} vs listed ${total_listed:,.2f}')
    for b in ('DEAD', 'RISER', 'KEEPER', 'STALE', 'NEUTRAL'):
        items = buckets[b]
        if not items:
            continue
        sub = sum((i['fresh'] or 0) * i['qty'] for i in items)
        print(f'\n== {b} — {len(items)} cards, ${sub:,.2f} ==  '
              f'{SUGGEST[b]}')
        for i in sorted(items, key=lambda x: -(x['fresh'] or 0))[:25]:
            fresh_s = f"${i['fresh']:.2f}" if i['fresh'] else '  $-'
            d = i['delta']
            d_s = f" ({d:+.2f} vs listed)" if d and abs(d) >= 1 else ''
            sig = i['sig'] or {}
            print(f"  {fresh_s:>8} x{i['qty']:<2} {i['name']}{d_s}  "
                  f"[{sig.get('action', '?')}]")


if __name__ == '__main__':
    main()
