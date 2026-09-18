"""Rewrite the R2 image packs with uncompressed (stored) entries.

JPEGs are already compressed, so deflate saves ~1% while forcing a full CPU
inflate pass during mobile extraction. Stored entries make react-native-
zip-archive extraction a pure file copy (~2-3x faster) at ~the same size.

Downloads the current zip from the public R2 host, streams every entry
through a stored rewrite, and re-uploads via the S3 API (boto3 auto-
multiparts — both packs exceed wrangler's 300 MiB `r2 object put` cap).

Run in CI (secrets provided) or locally with the R2 env vars set:

    py rezip_image_packs.py                      # both packs
    py rezip_image_packs.py catalog_images.zip   # one pack
"""

import os
import sys
import time
import zipfile
from pathlib import Path

import requests

R2_PUBLIC_BASE = "https://pub-81d2f5a4ba9a4821bc03f0c3375f9536.r2.dev"
R2_BUCKET = "pokequant-db"
PACKS = ["catalog_images.zip", "catalog_images_jp.zip"]


def download(key: str, dest: Path) -> None:
    url = f"{R2_PUBLIC_BASE}/{key}"
    print(f"Downloading {url} ...")
    t0 = time.time()
    with requests.get(url, stream=True, timeout=60) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(chunk_size=8 * 1024 * 1024):
                f.write(chunk)
    print(f"  {dest.stat().st_size / 1e9:.2f} GB in {time.time() - t0:.0f}s")


def restore(src: Path, dest: Path) -> None:
    """Copy every entry into a ZIP_STORED archive, preserving entry names."""
    zin = zipfile.ZipFile(src)
    infos = zin.infolist()
    print(f"  {len(infos)} entries")
    t0 = time.time()
    with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as zout:
        for i, info in enumerate(infos):
            data = zin.read(info.filename)
            # Recreate ZipInfo to preserve name/date; force stored method.
            zi = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            zi.compress_type = zipfile.ZIP_STORED
            zi.external_attr = info.external_attr
            zout.writestr(zi, data)
            if i % 5000 == 0:
                print(f"  {i}/{len(infos)} ({time.time() - t0:.0f}s)", flush=True)
    print(f"  stored zip: {dest.stat().st_size / 1e9:.2f} GB")


def upload(key: str, path: Path) -> None:
    import boto3
    from botocore.config import Config

    account_id = os.environ["R2_ACCOUNT_ID"]
    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )
    bucket = os.getenv("R2_BUCKET_NAME", R2_BUCKET)
    print(f"  uploading -> {bucket}/{key}")
    t0 = time.time()
    s3.upload_file(str(path), bucket, key)
    print(f"  uploaded in {time.time() - t0:.0f}s")


def main() -> None:
    keys = sys.argv[1:] or PACKS
    work = Path("rezip_work")
    work.mkdir(exist_ok=True)
    for key in keys:
        name = Path(key).name
        src = work / f"{name}.orig.zip"
        dest = work / name
        download(key, src)
        restore(src, dest)
        upload(key, dest)
        src.unlink(missing_ok=True)
        dest.unlink(missing_ok=True)
    print("Done.")


if __name__ == "__main__":
    main()
