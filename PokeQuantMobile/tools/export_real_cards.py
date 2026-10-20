"""Export real catalog rows into the Jest regression fixture.

Usage:
    py tools/export_real_cards.py                       # default paths
    py tools/export_real_cards.py --db catalog.db --out __tests__/fixtures/realCards.json

Emits the RAW rows (snake_case, exactly as the app's queries return
them) so the fixture can never drift from the shipped schema — the
test side re-hydrates through helpers/hydrate.ts mirroring
signalFromRow/deepFromRow. Every card in CARDS is a real bug or an
audited badge — the ledger grows by appending, never by churn.
"""

import argparse
import json
import os
import sqlite3

# The regression ledger — every entry is a real bug or an audited
# badge the user caught. key = fixture name, product_id = catalog row.
CARDS = [
    # Bug ledger
    ('golduck', 44437),            # "Down 35%" on +34.6% mo + badge/sheet divergence
    ('leafeon_ex', 610361),        # lifetime-ATH vs window-ATH scalar/series mismatch
    ('walking_wake_ex', 610533),   # rangeAth veto hid a real range
    ('shaymin_dr', 632985),        # same rangeAth veto
    ('lillie_determination', 654508),  # same veto on a decaying range
    ('ninetales', 42352),          # item 53: giveback at the range top reads "sitting on a low"
    ('flying_pikachu_ev', 124123), # item 53: field printing 110/108 — same tail shape (85534 is the WoTC promo)
    ('cynthias_spiritomb', 676056),# item 53: RANGE_PLAY·entry "buy end" claim on a decliner
    ('piplup', 201350),            # item 53: flat-but-fine card handed the "dead money" dump verb
    # Audited badges
    ('budew', 610359),             # off the peak — verified correct
    ('zekrom', 264205),            # compounder bleeding on a held floor
    ('nymble', 523612),            # dead / stable
    ('togedemaru', 662233),        # micro-chop floor — not a range
    # Verified sheet reads
    ('eevee_svp200', 637077),      # elevated_rising at peak
    ('vaporeon_ex', 610378),       # appreciating
    ('espeon_v', 268710),          # compounder at high
    # Journey-shape representatives (real rows matching pinned shapes)
    ('toucannon', 704851),         # young launch crash, fodder
    ('tremendous_bomb', 704870),   # crash ended on a held floor
    ('yamper', 662243),            # dead-bounce floor
    ('flying_pikachu', 85534),     # intact uptrend, soft month
    ('bellibolt', 509948),         # higher shelf vs ancient all-time low
    ('ogerpon', 550069),           # dead bounce the floor caught
    ('bubble_mew', 87413),         # +5xx% all-time compounder cooling
    ('heracross_jp', 565934),      # JP row — category-85 coverage
    ('petilil', 87990),            # old card, shelf far below
]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        '--db',
        default=os.environ.get(
            'PQ_CATALOG_DB',
            os.path.join(
                os.environ.get('LOCALAPPDATA', ''),
                'Temp', 'mobile_catalog.db',
            ),
        ),
    )
    ap.add_argument(
        '--out',
        default=os.path.join(
            os.path.dirname(__file__), '..', '__tests__', 'fixtures',
            'realCards.json',
        ),
    )
    args = ap.parse_args()

    con = sqlite3.connect(args.db)
    con.row_factory = sqlite3.Row
    tables = {
        r[0] for r in con.execute(
            "select name from sqlite_master where type='table'"
        )
    }
    has_deep = 'card_deep' in tables

    out = {
        'exportedFrom': args.db,
        'catalogTables': sorted(tables),
        'cards': {},
    }

    for key, pid in CARDS:
        card = con.execute(
            'select * from cards where product_id = ?', (pid,)
        ).fetchone()
        if card is None:
            print(f'!! {key} product_id {pid} missing from cards — skipped')
            continue
        variants = []
        sig_rows = con.execute(
            'select * from card_signals '
            'where product_id = ? order by sub_type',
            (pid,),
        ).fetchall()
        for srow in sig_rows:
            s = dict(srow)
            sub = s['sub_type']
            # The app's signal join appends d_* columns from card_deep.
            if has_deep:
                d = con.execute(
                    'select * from card_deep '
                    'where product_id = ? and sub_type = ?',
                    (pid, sub),
                ).fetchone()
                if d is not None:
                    dd = dict(d)
                    s['d_shelf_price'] = dd.get('shelf_price')
                    s['d_shelf_tests'] = dd.get('shelf_tests')
                    s['d_cycle_days'] = dd.get('cycle_days')
                    s['d_bounce_pct_med'] = dd.get('bounce_pct_med')
                    s['d_target_price'] = dd.get('target_price')
                    s['d_analog_bounce_n'] = dd.get('analog_bounce_n')
                    deep_row = dd
                else:
                    deep_row = None
            else:
                deep_row = None
            ser = con.execute(
                'select series from price_series '
                'where product_id = ? and sub_type = ?',
                (pid, sub),
            ).fetchone()
            series = json.loads(ser['series']) if ser and ser['series'] else []
            variants.append(
                {
                    'subType': sub,
                    'signal': s,
                    'deep': deep_row,
                    'series': series,
                }
            )
        out['cards'][key] = {
            'productId': pid,
            'name': card['card_name'],
            'setName': card['set_name'],
            'number': card['card_number'],
            'rarity': card['rarity'],
            'variants': variants,
        }
        print(
            f'{key}: {card["card_name"]} {card["card_number"]} '
            f'({card["set_name"]}) — {len(variants)} variant(s)'
        )

    # Global pattern stats — the pooled base rates the engine lines quote.
    if 'pattern_stats' in tables:
        out['patterns'] = {
            r['pattern']: dict(r)
            for r in con.execute('select * from pattern_stats')
        }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, separators=(',', ':'))
    size_kb = os.path.getsize(args.out) // 1024
    print(f'wrote {args.out} ({size_kb} KB)')


if __name__ == '__main__':
    main()
