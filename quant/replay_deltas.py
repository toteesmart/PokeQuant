"""Replay dated R2 delta JSONs into a local DB to gap-fill missed days.

    py -m quant.replay_deltas --db pokemon_tcg.db [--days 30]
    py -m quant.replay_deltas --db x.db --dir ./deltas   # offline path

The daily pipeline archives each run's {product_id, sub_type, market_price,
date} rows under deltas/YYYY-MM-DD.json — replaying them rebuilds any day
the master missed. INSERT OR IGNORE makes re-runs idempotent.
"""
import argparse
import glob
import json
import os
import re
import sqlite3
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from quant import store  # noqa: E402

DATED_RE = re.compile(r'(\d{4}-\d{2}-\d{2})\.json$')
CARD_COLS = ('product_id', 'card_name', 'card_number', 'set_name', 'rarity')


def apply_delta(con, payload, has_rarity):
    """INSERT OR IGNORE a delta file's rows. Returns (price_rows, card_rows)."""
    n_p = n_c = 0
    for r in payload.get('price_updates', []):
        n_p += con.execute(
            'INSERT OR IGNORE INTO price_history '
            '(product_id, sub_type, date, market_price) VALUES (?,?,?,?)',
            (r['product_id'], r['sub_type'], r['date'], r['market_price'])
        ).rowcount
    cols = CARD_COLS if has_rarity else CARD_COLS[:4]
    for c in payload.get('new_cards', []):
        n_c += con.execute(
            f'INSERT OR IGNORE INTO cards ({",".join(cols)}) '
            f'VALUES ({",".join("?" for _ in cols)})',
            tuple(c.get(k) for k in cols)).rowcount
    return n_p, n_c


def delta_date(path_or_key):
    m = DATED_RE.search(path_or_key)
    return m.group(1) if m else None


def r2_delta_keys(days):
    """List dated deltas/ keys on R2 within `days`. Needs R2_* env creds."""
    import boto3
    from botocore.config import Config
    s3 = boto3.client(
        's3',
        endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
        config=Config(signature_version='s3v4'), region_name='auto')
    bucket = os.environ.get('R2_BUCKET_NAME', 'pokequant-db')
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    keys = []
    for page in s3.get_paginator('list_objects_v2').paginate(
            Bucket=bucket, Prefix='deltas/'):
        for obj in page.get('Contents', []):
            d = delta_date(obj['Key'])
            if d and d >= cutoff:
                keys.append((d, obj['Key']))
    return sorted(keys), s3, bucket


def replay(db_path, days=30, local_dir=None):
    con = sqlite3.connect(db_path)
    has_rarity = 'rarity' in {
        r[1] for r in con.execute('PRAGMA table_info(cards)')}
    total_p = total_c = 0

    if local_dir:
        files = []
        cutoff = (date.today() - timedelta(days=days)).isoformat()
        for f in glob.glob(os.path.join(local_dir, '*.json')):
            d = delta_date(os.path.basename(f))
            if d and d >= cutoff:
                files.append((d, f))
        for d, path in sorted(files):
            n_p, n_c = apply_delta(con, json.load(open(path)), has_rarity)
            total_p, total_c = total_p + n_p, total_c + n_c
            print(f'{d}: +{n_p} prices, +{n_c} cards')
    else:
        keys, s3, bucket = r2_delta_keys(days)
        if not keys:
            print('no dated deltas found in window — '
                  'archive starts with the next pipeline run')
            return
        import tempfile
        for d, key in keys:
            with tempfile.NamedTemporaryFile(
                    suffix='.json', delete=False) as tmp:
                s3.download_fileobj(bucket, key, tmp)
                tmp_path = tmp.name
            n_p, n_c = apply_delta(
                con, json.load(open(tmp_path)), has_rarity)
            os.remove(tmp_path)
            total_p, total_c = total_p + n_p, total_c + n_c
            print(f'{d}: +{n_p} prices, +{n_c} cards')

    con.commit()
    con.close()
    print(f'total: +{total_p} price rows, +{total_c} cards -> {db_path}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', required=True)
    ap.add_argument('--days', type=int, default=30,
                    help='only replay deltas dated within N days')
    ap.add_argument('--dir', help='local folder of delta JSONs (no R2)')
    args = ap.parse_args()
    if not args.dir and not all(os.environ.get(k) for k in
                                ('R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID',
                                 'R2_SECRET_ACCESS_KEY')):
        sys.exit('R2 creds not in env — pass --dir for a local replay')
    replay(args.db, days=args.days, local_dir=args.dir)


if __name__ == '__main__':
    main()
