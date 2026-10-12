"""Pokeviews/PriceCharting ingest — a SEPARATE source bucket.

PV rides its own tables and never touches the canonical tcgcsv
price_history. The value it adds: ebay-backed market prices and, for
some cards, history that predates our first scrape. The risk it adds:
entries occasionally priced on the wrong printing (JP/alt/graded level
counted as the English variant) — ~22% of rows sat >2x off our level
in the join audit. pv_join.py quarantines those before anything reads
the bucket.

Tables (all in the research DB):
    pv_catalog   — latest card_catalog.json row per unique_product_id
    pv_series    — per-card daily price rows, append-only
    pv_missing   — unique_product_ids whose per-card file 404'd
    pv_meta      — sync state (catalog timestamp, backfill cursor)

Modes:
    py -m quant.pv_ingest --audit        join-key / depth / freshness report
    py -m quant.pv_ingest --catalog      daily: fetch catalog, stamp prices
    py -m quant.pv_ingest --backfill     resumable per-card history pull
    py -m quant.pv_ingest --backfill --limit 500   bounded batch (CI-safe)
"""
import argparse
import gzip
import json
import os
import sqlite3
import time
import urllib.request
import urllib.error

BASE = 'https://storage.googleapis.com/pokeviews-prod/card_price_chart'
CATALOG_URL = f'{BASE}/card_catalog/card_catalog.json'
CARD_URL = f'{BASE}/card_prices_{{upid}}.json'

# PV variant token -> tcgcsv sub_type. 'edition' is PV's vintage 1st-ed
# bucket; everything else maps one-to-one. Raw pv_variant is kept on
# every row regardless — the map is for joining, not for overwriting.
VARIANT_MAP = {
    'normal': 'Normal',
    'holofoil': 'Holofoil',
    'reverse_holofoil': 'Reverse Holofoil',
    'edition': '1st Edition',
    'unlimited': 'Unlimited',
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS pv_catalog (
    product_id      INTEGER NOT NULL,
    pv_variant      TEXT NOT NULL,
    name            TEXT,
    number          TEXT,
    set_name        TEXT,
    series_name     TEXT,
    rarity          TEXT,
    current_price   REAL,
    forward_filled  INTEGER DEFAULT 0,
    fetched_at      TEXT NOT NULL,
    PRIMARY KEY (product_id, pv_variant)
);
CREATE TABLE IF NOT EXISTS pv_series (
    product_id  INTEGER NOT NULL,
    pv_variant  TEXT NOT NULL,
    date        TEXT NOT NULL,
    price       REAL NOT NULL,
    fetched_at  TEXT NOT NULL,
    PRIMARY KEY (product_id, pv_variant, date)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS pv_missing (
    unique_product_id TEXT PRIMARY KEY,
    reason TEXT,
    fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pv_meta (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""


def now_iso() -> str:
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


def fetch_json(url: str, timeout: int = 90):
    req = urllib.request.Request(
        url, headers={'User-Agent': 'pokequant-research/1.0'}
    )
    raw = urllib.request.urlopen(req, timeout=timeout).read()
    if raw[:2] == b'\x1f\x8b':
        raw = gzip.decompress(raw)
    return json.loads(raw)


def split_upid(upid: str):
    pid, _, variant = upid.partition('_')
    return int(pid), variant


def ensure_schema(con: sqlite3.Connection) -> None:
    con.executescript(SCHEMA)
    con.commit()


def get_meta(con, key: str, default=None):
    row = con.execute('SELECT value FROM pv_meta WHERE key=?', (key,)).fetchone()
    return row[0] if row else default


def set_meta(con, key: str, value: str) -> None:
    con.execute(
        'INSERT INTO pv_meta (key, value) VALUES (?,?) '
        'ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        (key, value),
    )


def load_catalog() -> list:
    cat = fetch_json(CATALOG_URL)
    if not isinstance(cat, list):
        raise RuntimeError(f'unexpected catalog shape: {type(cat).__name__}')
    return cat


def ingest_catalog(con, catalog: list) -> int:
    """Daily path — one file, every active PV entry's current price.
    Stamps the catalog row AND merges today's price into pv_series so
    the series stays fresh even where per-card files lag."""
    ts = now_iso()
    today = ts[:10]
    n = 0
    with con:
        for row in catalog:
            upid = row.get('unique_product_id') or ''
            try:
                pid, variant = split_upid(upid)
            except (ValueError, AttributeError):
                continue
            con.execute(
                'INSERT INTO pv_catalog (product_id, pv_variant, name, number,'
                ' set_name, series_name, rarity, current_price, forward_filled,'
                ' fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?) '
                'ON CONFLICT(product_id, pv_variant) DO UPDATE SET'
                ' name=excluded.name, number=excluded.number,'
                ' set_name=excluded.set_name, series_name=excluded.series_name,'
                ' rarity=excluded.rarity, current_price=excluded.current_price,'
                ' forward_filled=excluded.forward_filled,'
                ' fetched_at=excluded.fetched_at',
                (
                    pid,
                    variant,
                    row.get('name'),
                    row.get('number'),
                    row.get('set_name'),
                    row.get('series_name'),
                    row.get('rarity'),
                    row.get('current_price'),
                    1 if row.get('is_price_forward_filled') else 0,
                    ts,
                ),
            )
            price = row.get('current_price')
            if price and price > 0:
                con.execute(
                    'INSERT OR REPLACE INTO pv_series'
                    ' (product_id, pv_variant, date, price, fetched_at)'
                    ' VALUES (?,?,?,?,?)',
                    (pid, variant, today, price, ts),
                )
            n += 1
    set_meta(con, 'catalog_fetched_at', ts)
    return n


def backfill(con, limit: int, sleep_s: float, verbose: bool = True) -> int:
    """Resumable per-card history pull. Walks pv_catalog in upid order
    past the saved cursor; each fetched file fully replaces that
    variant's series (their files are the complete history, not a
    delta). 404s land in pv_missing so they don't retry every run."""
    cursor = get_meta(con, 'backfill_cursor', '') or ''
    missing = {
        r[0] for r in con.execute('SELECT unique_product_id FROM pv_missing')
    }
    rows = [
        (f"{r['product_id']}_{r['pv_variant']}", r['product_id'], r['pv_variant'])
        for r in con.execute(
            'SELECT product_id, pv_variant FROM pv_catalog '
            'ORDER BY product_id, pv_variant'
        )
        if f"{r['product_id']}_{r['pv_variant']}" > cursor
    ]
    ts = now_iso()
    done = 0
    for upid, pid, variant in rows:
        if done >= limit:
            break
        if upid in missing:
            continue
        try:
            series = fetch_json(CARD_URL.format(upid=upid), timeout=60)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                with con:
                    con.execute(
                        'INSERT OR REPLACE INTO pv_missing VALUES (?,?,?)',
                        (upid, '404', ts),
                    )
                continue
            raise
        except Exception as e:
            # Transient — save the cursor and let the next run retry.
            if verbose:
                print(f'  {upid}: transient error {e} — stopping for resume')
            break
        if not isinstance(series, list) or not series:
            with con:
                con.execute(
                    'INSERT OR REPLACE INTO pv_missing VALUES (?,?,?)',
                    (upid, 'empty', ts),
                )
            continue
        with con:
            con.execute(
                'DELETE FROM pv_series WHERE product_id=? AND pv_variant=?',
                (pid, variant),
            )
            n_rows = 0
            for p in series:
                d = p.get('price_date')
                price = p.get('market_price')
                if not d or price is None or price <= 0:
                    continue
                con.execute(
                    'INSERT OR REPLACE INTO pv_series'
                    ' (product_id, pv_variant, date, price, fetched_at)'
                    ' VALUES (?,?,?,?,?)',
                    (pid, variant, d, price, ts),
                )
                n_rows += 1
        done += 1
        cursor = upid
        if verbose and done % 100 == 0:
            print(f'  backfill {done}: {upid} ({n_rows} rows)')
        time.sleep(sleep_s)
    set_meta(con, 'backfill_cursor', cursor)
    total = len(rows) + len(missing)
    if cursor and not [
        r for r in rows if r[0] > cursor and r[0] not in missing
    ]:
        set_meta(con, 'backfill_done', ts)
    return done


def audit(con, master_path: str) -> None:
    """Join-key / depth / freshness report — run before trusting the
    bucket, and periodically after (their schema can drift)."""
    from . import store

    catalog = load_catalog()
    print(f'pv catalog: {len(catalog)} entries')
    master = store.open_master(master_path)
    ours = {
        r[0] for r in master.execute('SELECT DISTINCT product_id FROM price_history')
    }
    pv_ids = {r['product_id'] for r in catalog}
    overlap = pv_ids & ours
    print(
        f'product_id overlap: {len(overlap)}/{len(pv_ids)} '
        f'= {len(overlap) / max(1, len(pv_ids)) * 100:.1f}%'
    )
    from collections import Counter

    variants = Counter(split_upid(r['unique_product_id'])[1] for r in catalog)
    print('pv variants:', variants.most_common())
    our_latest = {}
    for pid, sub, p in master.execute(
        'SELECT product_id, sub_type, market_price FROM price_history p '
        'WHERE date=(SELECT MAX(date) FROM price_history '
        'WHERE product_id=p.product_id AND sub_type=p.sub_type)'
    ):
        our_latest[(pid, sub.lower())] = p
    import random, statistics

    ratios = []
    for r in random.sample(catalog, min(400, len(catalog))):
        pid, variant = split_upid(r['unique_product_id'])
        sub = (VARIANT_MAP.get(variant) or variant).lower()
        ours_price = our_latest.get((pid, sub)) or our_latest.get((pid, 'normal'))
        if ours_price and ours_price > 0 and (r.get('current_price') or 0) > 0:
            ratios.append(r['current_price'] / ours_price)
    if ratios:
        ratios.sort()
        n = len(ratios)
        within = sum(1 for x in ratios if 0.85 <= x <= 1.18) / n
        bad = sum(1 for x in ratios if x < 0.5 or x > 2)
        print(
            f'level agreement (n={n}): median={statistics.median(ratios):.3f} '
            f'p90={ratios[int(n * 0.9)]:.2f} within-15%={within * 100:.0f}% '
            f'mismatch->2x-or-<0.5x={bad} ({bad / n * 100:.1f}%)'
        )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--db', help='research db path (default: store.default_db_path)')
    ap.add_argument('--master', help='master db path for --audit')
    ap.add_argument('--audit', action='store_true')
    ap.add_argument('--catalog', action='store_true')
    ap.add_argument('--backfill', action='store_true')
    ap.add_argument('--limit', type=int, default=100000)
    ap.add_argument('--sleep', type=float, default=0.12)
    args = ap.parse_args()

    from . import store

    db_path = args.db or store.default_db_path()
    if not os.path.exists(db_path):
        raise SystemExit(f'db not found: {db_path}')
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    ensure_schema(con)

    if args.audit:
        audit(con, args.master or db_path)
        return
    if args.catalog:
        cat = load_catalog()
        n = ingest_catalog(con, cat)
        print(f'pv_catalog: {n} entries upserted')
    if args.backfill:
        n = backfill(con, args.limit, args.sleep)
        cursor = get_meta(con, 'backfill_cursor')
        print(f'backfill: {n} files ingested (cursor={cursor})')


if __name__ == '__main__':
    main()
