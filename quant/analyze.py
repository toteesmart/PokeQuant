"""Card sell/hold analyzer — CLI entrypoint.

    py analyze_card.py "Togedemaru" 090/080 --jp
    py analyze_card.py "Charizard" --set ME02 --subtype "Reverse Holofoil"
    py analyze_card.py --product-id 655869
    py analyze_card.py --file cards.txt --json     # lines: "Name|number"

All math lives in quant/signals.py + quant/verdict.py; this file resolves the
card, gathers context (set events, curated events, set peers), and prints.
"""
import argparse
import json
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from quant import signals, store, verdict  # noqa: E402

STALE_MASTER_DAYS = 10
EVENT_LOOKBACK_DAYS = 90
EVENT_LOOKAHEAD_DAYS = 45


def set_context(set_events, set_name, today: date):
    ev = set_events.get(set_name)
    if not ev or not ev.get('published_on'):
        return {'set_code': ev['set_code'] if ev else None,
                'published_on': None, 'weeks_since_release': None, 'phase': 'unknown'}
    pub = date.fromisoformat(ev['published_on'])
    weeks = (today - pub).days / 7.0
    phase = 'release-hype' if weeks < 3 else 'decay' if weeks < 12 else 'stable'
    return {'set_code': ev['set_code'], 'published_on': ev['published_on'],
            'weeks_since_release': weeks, 'phase': phase}


def nearby_events(con, card_name, set_name, today):
    rows = store.get_events(
        con,
        after=(today - timedelta(days=EVENT_LOOKBACK_DAYS)).isoformat(),
        before=(today + timedelta(days=EVENT_LOOKAHEAD_DAYS)).isoformat(),
    )
    out = []
    for ev in rows:
        if ev['scope'] == 'global':
            out.append(ev)
        elif ev['scope'] == 'set' and ev['ref'].lower() in (set_name or '').lower():
            out.append(ev)
        elif ev['scope'] == 'card' and ev['ref'].lower() in (card_name or '').lower():
            out.append(ev)
    return out


def analyze_subtype(con, card, sub_type, set_events, peers_cache, today):
    series = store.get_series(con, card['product_id'], sub_type)
    grid, gmeta = signals.daily_grid(series)
    cur_price = series[-1][1] if series else None
    z = signals.zscore(series, window_days=90)
    pct = signals.percentile_rank(series, window_days=365)
    mom = signals.momentum(series)
    vol = signals.realized_vol(series, window_days=60)
    liq = signals.liquidity(series, as_of=today)
    sctx = set_context(set_events, card['set_name'], today)
    evs = nearby_events(con, card['card_name'], card['set_name'], today)

    beta30 = {'excess_return': None, 'set_median': None, 'n_peers': 0, 'days': 30}
    beta90 = None
    if card['set_name'] not in peers_cache:
        peers = store.get_set_peers(con, card['set_name'], card['product_id'])
        peers_cache[card['set_name']] = peers
    peers = peers_cache[card['set_name']]
    if peers:
        peer_series = store.get_peer_series(con, peers, sub_type)
        beta30 = signals.set_beta(series, peer_series, days=30)
        beta90 = signals.set_beta(series, peer_series, days=90)

    conf = signals.confidence(gmeta['n_events'], gmeta['coverage'], vol['regime'])
    v = verdict.evaluate(z, pct, mom, vol, liq, beta30, sctx, evs, gmeta)

    return {
        'sub_type': sub_type,
        'price': cur_price,
        'price_date': series[-1][0] if series else None,
        'n_events': gmeta['n_events'],
        'coverage': gmeta['coverage'],
        'z90': z['z'], 'pctile_1y': pct['pctile'],
        'momentum': mom, 'vol': vol, 'liquidity': liq,
        'set_context': sctx, 'beta_30d': beta30, 'beta_90d': beta90,
        'events': evs, 'confidence': conf,
        'stance': v['stance'], 'reasons': v['reasons'],
        'warnings': v['warnings'], 'notes': v['notes'],
    }


def analyze_card(con, card, subtypes, set_events, today):
    subs = store.get_subtypes(con, card['product_id'])
    names = [s[0] for s in subs]
    if subtypes:
        names = [s for s in names if s.lower() in {x.lower() for x in subtypes}]
    peers_cache = {}
    analyses = [analyze_subtype(con, card, s, set_events, peers_cache, today)
                for s in names]
    return {'card': card, 'subtypes': analyses}


def fmt_pct(x):
    return f'{x:+.1f}%' if x is not None else '  n/a'


def print_report(result):
    c = result['card']
    print(f"\n=== {c['card_name']}  #{c['card_number']}  [{c['set_name']}]"
          f"  {c.get('rarity') or ''}  pid={c['product_id']} ===")
    for a in result['subtypes']:
        m, v, l = a['momentum'], a['vol'], a['liquidity']
        print(f"  [{a['sub_type']}] ${a['price']:.2f} "
              f"(as of {a['price_date']}, {a['n_events']} events)")
        zs = f"{a['z90']:+.2f}" if a['z90'] is not None else 'n/a'
        ps = f"{a['pctile_1y']:.0f}%" if a['pctile_1y'] is not None else 'n/a'
        hi = f"{m['days_since_high']}d" if m['days_since_high'] is not None else 'n/a'
        print(f"    z90 {zs} | pctile-1y {ps} | "
          f"7d {fmt_pct(m['ret_7d'])} | 30d {fmt_pct(m['ret_30d'])} | "
          f"90d {fmt_pct(m['ret_90d'])} | dd {fmt_pct(m['drawdown_from_high'])} | "
          f"high {hi} ago")
        sig = f"{v['daily_sigma']*100:.1f}%/d" if v['daily_sigma'] is not None else 'n/a'
        print(f"    vol {sig} ({v['regime']}) | "
          f"liquidity {l['flag']} ({l['days_since_change']}d since change, "
          f"{l['changes_per_year']:.0f}/yr, {a['coverage']:.0%} coverage)")
        sc = a['set_context']
        if sc['weeks_since_release'] is not None:
            print(f"    set: {sc['set_code']} released {sc['published_on']} "
              f"({sc['weeks_since_release']:.0f}w, {sc['phase']})")
        b = a['beta_30d']
        if b.get('excess_return') is not None:
            print(f"    set-beta 30d: card {fmt_pct(b['card_ret'])} vs median "
              f"{fmt_pct(b['set_median'])} -> excess {fmt_pct(b['excess_return'])} "
              f"(n={b['n_peers']} peers)")
        for ev in a['events']:
            print(f"    event {ev['date']}: {ev['label']}")
        print(f"    VERDICT [{a['confidence']} conf]: {a['stance'].upper()}")
        for r in a['reasons']:
            print(f"      - {r}")
        for w in a['warnings']:
            print(f"      ! {w}")
        for n in a['notes']:
            print(f"      · {n}")


def pick_card(candidates, pick=None):
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]
    if pick is not None:
        return candidates[pick - 1] if 1 <= pick <= len(candidates) else None
    print('\nAmbiguous — rerun with --pick N:')
    for i, c in enumerate(candidates[:15], 1):
        print(f"  {i:2d}. {c['card_name']} #{c['card_number']} "
              f"[{c['set_name']}] {c.get('rarity') or ''} "
              f"(score {c['score']:.0f}, pid {c['product_id']})")
    return None


def card_by_id(con, pid):
    has_rarity = 'rarity' in {r[1] for r in con.execute('PRAGMA table_info(cards)')}
    cols = 'product_id, card_name, card_number, set_name' + (', rarity' if has_rarity else '')
    row = con.execute(f'SELECT {cols} FROM cards WHERE product_id=?', (pid,)).fetchone()
    if not row:
        return None
    d = dict(row)
    d.setdefault('rarity', None)
    d['score'] = 100.0
    return d


def staleness_banner(con):
    mx = store.db_max_date(con)
    meta = store.research_meta(con)
    if mx:
        age = (date.today() - date.fromisoformat(mx)).days
        flag = '  <-- STALE, run fetch_db.py' if age > STALE_MASTER_DAYS else ''
        print(f'[db] prices through {mx} ({age}d old){flag}'
              + (f" | ingested {meta.get('ingested_at', '?')}" if meta else ''))


def main():
    ap = argparse.ArgumentParser(description='Card sell/hold analyzer')
    ap.add_argument('name', nargs='?', help='card name (fuzzy)')
    ap.add_argument('number', nargs='?', help='collector number e.g. 090/080')
    ap.add_argument('--set', dest='set_hint', help='set name filter')
    ap.add_argument('--jp', action='store_true', help='Japanese printings only')
    ap.add_argument('--en', action='store_true', help='English printings only')
    ap.add_argument('--subtype', action='append', help='finish e.g. Normal, Holofoil')
    ap.add_argument('--product-id', type=int, help='direct product id')
    ap.add_argument('--pick', type=int, help='choose from candidate list')
    ap.add_argument('--file', help='batch file: "Name|number" per line')
    ap.add_argument('--json', action='store_true', help='machine-readable output')
    ap.add_argument('--db', help='database path override')
    args = ap.parse_args()

    con = store.open_master(store.default_db_path(args.db))
    today = date.today()
    set_events = store.get_set_events(con)

    if not args.json:
        staleness_banner(con)

    jp_flag = True if args.jp else (False if args.en else None)

    if args.file:
        results = []
        with open(args.file, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                name, _, num = line.partition('|')
                cands = store.resolve_card(con, name.strip(),
                                           num.strip() or None, args.set_hint, jp_flag)
                card = cands[0] if cands else None
                if not card:
                    results.append({'query': line, 'error': 'no match'})
                    continue
                res = analyze_card(con, card, args.subtype, set_events, today)
                results.append(res)
        if args.json:
            print(json.dumps(results, indent=1, default=str))
        else:
            for res in results:
                if 'error' in res:
                    print(f"\n  {res['query']}: NO MATCH")
                    continue
                print_report(res)
        return

    if args.product_id:
        card = card_by_id(con, args.product_id)
    else:
        if not args.name:
            ap.error('name or --product-id or --file required')
        card = pick_card(store.resolve_card(
            con, args.name, args.number, args.set_hint, jp_flag), args.pick)

    if not card:
        print('No card resolved.')
        sys.exit(1)

    result = analyze_card(con, card, args.subtype, set_events, today)
    if args.json:
        print(json.dumps(result, indent=1, default=str))
    else:
        print_report(result)


if __name__ == '__main__':
    main()
