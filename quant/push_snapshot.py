"""Upload a research DB snapshot to R2 (seed once, or manual refresh).

    set R2_ACCOUNT_ID=... & set R2_ACCESS_KEY_ID=... & set R2_SECRET_ACCESS_KEY=...
    py -m quant.push_snapshot --db pokemon_tcg.db
    py -m quant.push_snapshot --db quant\data\research.db --raw   # skip 7z

Artifact contract: research/research_catalog.7z on bucket pokequant-db
(public base below). Compressed with `7z a` — same tool the scraper needs.
"""
import argparse
import os
import subprocess
import sys

R2_PUBLIC_BASE = 'https://pub-81d2f5a4ba9a4821bc03f0c3375f9536.r2.dev'
R2_BUCKET = 'pokequant-db'
R2_KEY = 'research/research_catalog.7z'


def _s3():
    import boto3
    from botocore.config import Config
    account_id = os.environ['R2_ACCOUNT_ID']
    return boto3.client(
        's3',
        endpoint_url=f'https://{account_id}.r2.cloudflarestorage.com',
        aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
        config=Config(signature_version='s3v4'),
        region_name='auto',
    )


def compress(db_path: str, out_7z: str) -> str:
    subprocess.run(['7z', 'a', out_7z, db_path, '-y'],
                   check=True, stdout=subprocess.DEVNULL)
    return out_7z


def push(archive_path: str, key: str = R2_KEY):
    s3 = _s3()
    bucket = os.getenv('R2_BUCKET_NAME', R2_BUCKET)
    size = os.path.getsize(archive_path)
    print(f'Uploading {archive_path} ({size/1e6:.0f} MB) -> {bucket}/{key}')
    s3.upload_file(archive_path, bucket, key)
    print('Done.')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', required=True, help='DB file to snapshot')
    ap.add_argument('--raw', action='store_true',
                    help='--db is already the archive (skip 7z)')
    ap.add_argument('--key', default=R2_KEY)
    args = ap.parse_args()

    archive = args.db if args.raw else compress(
        args.db, os.path.splitext(args.db)[0] + '.7z')
    push(archive, args.key)


if __name__ == '__main__':
    main()
