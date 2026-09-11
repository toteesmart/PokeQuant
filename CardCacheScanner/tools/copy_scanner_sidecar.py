#!/usr/bin/env python3
"""Copy the canonical production embedding sidecar into CardCacheScanner assets.

The canonical sidecar is built by `tools/build_embeddings.py` and written to
`PokeQuantMobile/assets/catalog_embeddings/`. This script stages the binary
sidecar (`embeddings.bin` + `manifest.json`) so the scanner can bundle it as a
Metro asset without committing the 64 MB binary into git.

Usage:
    py tools/copy_scanner_sidecar.py
"""

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1].parents[0]
SOURCE = ROOT / 'PokeQuantMobile' / 'assets' / 'catalog_embeddings'
DEST = ROOT / 'CardCacheScanner' / 'assets' / 'catalog_embeddings'

FILES = ['embeddings.bin', 'manifest.json']


def main() -> None:
    DEST.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        src = SOURCE / name
        dst = DEST / name
        if not src.exists():
            raise FileNotFoundError(f'Source sidecar file missing: {src}')
        if dst.exists():
            src_stat = src.stat()
            dst_stat = dst.stat()
            if src_stat.st_size == dst_stat.st_size and src_stat.st_mtime <= dst_stat.st_mtime:
                print(f'Up to date: {dst}')
                continue
        print(f'Copying {src} -> {dst}')
        shutil.copy2(src, dst)


if __name__ == '__main__':
    main()
