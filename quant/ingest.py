"""Build quant/data/research.db = master catalog + quant meta tables.

Usage:
    py -m quant.ingest                       # copy ../pokemon_tcg.db -> data/research.db, add meta
    py -m quant.ingest --db path.db --in-place   # add meta tables to an existing DB (CI)
    py -m quant.ingest --skip-rarity         # skip the slow per-group rarity backfill

Meta tables added:
    set_events(category, group_id, set_code, set_name, published_on)
    events(date, scope, ref, label)
    research_meta(key, value)

Rarity: cards.rarity is a post-hoc column added by patch_rarities_api.py. On
first ingest it is created and backfilled from tcgcsv extendedData (slow —
one request per set group); later runs only top up sets missing values.
"""
import argparse
import os
import shutil
import sqlite3
import sys
import time
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import tcg_scraper  # noqa: E402 — reuses its curl_cffi session (plain ssl fails on this box)

from quant.events_seed import EVENTS  # noqa: E402
from quant.store import JP_SET_PREFIX, has_table  # noqa: E402

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
DEFAULT_OUT = os.path.join(DATA_DIR, 'research.db')
CATEGORIES = (3, 85)


def ensure_meta_schema(con: sqlite3.Connection):
    con.executescript('''
        CREATE TABLE IF NOT EXISTS set_events (
            category INTEGER,
            group_id INTEGER,
            set_code TEXT,
            set_name TEXT,
            published_on TEXT,
            PRIMARY KEY (category, group_id)
        );
        CREATE TABLE IF NOT EXISTS events (
            date TEXT,
            scope TEXT,
            ref TEXT,
            label TEXT,
            PRIMARY KEY (date, ref)
        );
        CREATE TABLE IF NOT EXISTS research_meta (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    ''')
    con.commit()


def load_set_events(con: sqlite3.Connection) -> int:
    """Populate set_events from the same tcgcsv /groups endpoint the scraper uses."""
    session = tcg_scraper._get_session()
    inserted = 0
    for category in CATEGORIES:
        res = session.get(f'https://tcgcsv.com/tcgplayer/{category}/groups')
        if res.status_code != 200:
            print(f'  set_events: category {category} groups -> HTTP {res.status_code}')
            continue
        groups = res.json().get('results', [])
        rows = []
        for g in groups:
            set_name = g['name']
            if category == 85:
                set_name = JP_SET_PREFIX + set_name
            published = (g.get('publishedOn') or '')[:10] or None
            rows.append((
                category,
                g['groupId'],
                g.get('abbreviation'),
                set_name,
                published,
            ))
        con.executemany(
            'INSERT OR REPLACE INTO set_events '
            '(category, group_id, set_code, set_name, published_on) '
            'VALUES (?,?,?,?,?)',
            rows,
        )
        inserted += len(rows)
        print(f'  set_events: category {category} -> {len(rows)} sets')
    con.commit()
    return inserted


def seed_events(con: sqlite3.Connection) -> int:
    con.executemany(
        'INSERT OR REPLACE INTO events (date, scope, ref, label) VALUES (?,?,?,?)',
        EVENTS,
    )
    con.commit()
    return len(EVENTS)


def ensure_rarity(con: sqlite3.Connection, skip: bool) -> int:
    cols = {r[1] for r in con.execute('PRAGMA table_info(cards)')}
    if 'rarity' not in cols:
        con.execute('ALTER TABLE cards ADD COLUMN rarity TEXT')
        con.commit()
    missing = con.execute(
        'SELECT COUNT(*) FROM cards WHERE rarity IS NULL'
    ).fetchone()[0]
    if skip:
        print(f'  rarity: skipped ({missing} cards unset)')
        return 0
    if missing == 0:
        print('  rarity: already populated')
        return 0

    session = tcg_scraper._get_session()
    updated = 0
    for category in CATEGORIES:
        res = session.get(f'https://tcgcsv.com/tcgplayer/{category}/groups')
        if res.status_code != 200:
            continue
        for group in res.json().get('results', []):
            p_res = session.get(
                f"https://tcgcsv.com/tcgplayer/{category}/{group['groupId']}/products"
            )
            if p_res.status_code != 200:
                continue
            updates = []
            for p in p_res.json().get('results', []):
                rarity = next(
                    (i.get('value') for i in p.get('extendedData', [])
                     if i.get('name') == 'Rarity'),
                    None,
                )
                if rarity:
                    updates.append((rarity, p['productId']))
            if updates:
                con.executemany(
                    'UPDATE cards SET rarity=? WHERE product_id=? AND rarity IS NULL',
                    updates,
                )
                con.commit()
                updated += len(updates)
            time.sleep(0.2)
    print(f'  rarity: backfilled {updated} cards')
    return updated


def stamp_meta(con: sqlite3.Connection, source: str):
    max_date = con.execute('SELECT MAX(date) FROM price_history').fetchone()[0]
    rows = [
        ('ingested_at', datetime.now(timezone.utc).isoformat(timespec='seconds')),
        ('master_max_date', max_date or ''),
        ('source', source),
    ]
    con.executemany(
        'INSERT OR REPLACE INTO research_meta (key, value) VALUES (?,?)', rows
    )
    con.commit()


def ingest(master_path: str, out_path: str = DEFAULT_OUT, in_place: bool = False,
           skip_rarity: bool = False):
    if in_place:
        target = master_path
    else:
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        print(f'Copying {master_path} -> {out_path}')
        shutil.copy(master_path, out_path)
        target = out_path

    con = sqlite3.connect(target)
    try:
        ensure_meta_schema(con)
        load_set_events(con)
        seed_events(con)
        ensure_rarity(con, skip_rarity)
        stamp_meta(con, source=master_path)
    finally:
        con.close()
    print(f'Ingest complete -> {target}')
    return target


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', default=os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'pokemon_tcg.db'))
    ap.add_argument('--out', default=DEFAULT_OUT)
    ap.add_argument('--in-place', action='store_true',
                    help='add meta tables directly to --db (CI snapshot path)')
    ap.add_argument('--skip-rarity', action='store_true')
    args = ap.parse_args()
    ingest(args.db, args.out, args.in_place, args.skip_rarity)


if __name__ == '__main__':
    main()
