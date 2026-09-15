"""Build the optional Japanese offline image pack (catalog_images_jp.zip).

Mirrors the English catalog_images.zip pipeline: downloads the 400w TCGplayer
CDN image for every card whose set_name carries the 'JP · ' ingest prefix into
catalog_images_jp/{product_id}.jpg, then zips and uploads to R2.

Products with imageCount: 0 on tcgcsv 404 on the CDN — those are skipped, so
the extracted directory is the source of truth for which JP ids have art.

Usage:
    py build_jp_images.py            # download + zip
    py build_jp_images.py --skip-download  # re-zip an existing dir
    py build_jp_images.py --upload   # also push the zip to R2 via wrangler
"""

import argparse
import os
import shutil
import sqlite3
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

DB_NAME = "pokemon_tcg.db"
IMAGES_DIR = Path("catalog_images_jp")
# CI runs this against the shipped catalog (LFS checkout of pokemon_tcg.db
# is unavailable), so --db can point at a downloaded mobile_catalog.db.
ZIP_NAME = "catalog_images_jp.zip"
R2_BUCKET = "pokequant-db"
R2_KEY = "catalog_images_jp.zip"
CDN_URL = "https://tcgplayer-cdn.tcgplayer.com/product/{pid}_400w.jpg"
WORKERS = 20

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "PokemonPriceTracker/1.0"})


def jp_product_ids(db_name: str = DB_NAME) -> list[int]:
    conn = sqlite3.connect(db_name)
    try:
        rows = conn.execute(
            "SELECT product_id FROM cards WHERE set_name LIKE 'JP · %'"
        ).fetchall()
        return [r[0] for r in rows]
    finally:
        conn.close()


def download_one(product_id: int) -> bool:
    dest = IMAGES_DIR / f"{product_id}.jpg"
    if dest.exists() and dest.stat().st_size > 0:
        return True
    try:
        r = SESSION.get(CDN_URL.format(pid=product_id), timeout=15)
        if r.status_code != 200:
            return False
        dest.write_bytes(r.content)
        return True
    except Exception:
        return False


def download_all(product_ids: list[int]) -> None:
    IMAGES_DIR.mkdir(exist_ok=True)
    total = len(product_ids)
    done = 0
    ok = 0
    start = time.time()
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for success in pool.map(download_one, product_ids):
            done += 1
            ok += 1 if success else 0
            if done % 500 == 0 or done == total:
                rate = done / max(time.time() - start, 0.001)
                print(
                    f"{done}/{total} images ({ok} ok) "
                    f"rate={rate:.0f}/s eta={(total - done) / max(rate, 0.001) / 60:.1f}m"
                )
    print(f"Downloaded {ok}/{total} JP images.")


def make_zip() -> None:
    out = shutil.make_archive(
        ZIP_NAME.removesuffix(".zip"), "zip", root_dir=".", base_dir=IMAGES_DIR.name
    )
    print(f"Wrote {out} ({Path(out).stat().st_size / 1e6:.0f} MB)")


def upload() -> None:
    # The zip is ~1.4 GB — over wrangler's 300 MiB `r2 object put` cap, so
    # upload through the S3-compatible API (boto3 auto-multiparts large files).
    # Credentials come from env (GitHub secrets in CI; a local .env-style
    # export for manual runs).
    import boto3
    from botocore.config import Config

    account_id = os.environ["R2_ACCOUNT_ID"]
    access_key = os.environ["R2_ACCESS_KEY_ID"]
    secret_key = os.environ["R2_SECRET_ACCESS_KEY"]
    bucket = os.getenv("R2_BUCKET_NAME", R2_BUCKET)

    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )
    s3.upload_file(
        ZIP_NAME,
        bucket,
        R2_KEY,
        ExtraArgs={
            "ContentType": "application/zip",
            "CacheControl": "max-age=0, no-cache, no-store, must-revalidate",
        },
    )
    print(f"Uploaded {ZIP_NAME} to r2://{bucket}/{R2_KEY}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-download", action="store_true")
    parser.add_argument("--upload", action="store_true")
    parser.add_argument("--db", default=DB_NAME)
    args = parser.parse_args()

    if not args.skip_download:
        ids = jp_product_ids(args.db)
        print(f"{len(ids)} JP products in catalog.")
        download_all(ids)

    make_zip()
    if args.upload:
        upload()


if __name__ == "__main__":
    sys.exit(main())
