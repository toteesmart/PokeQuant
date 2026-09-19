"""Fetch the R2 research snapshot into quant/data/research.db.

    py -m quant.fetch_db            # download + extract research_catalog.7z
    py -m quant.fetch_db --local    # skip download, ingest from ../pokemon_tcg.db

Falls back to plain pokemon_tcg.db analysis if the artifact is missing —
analyze.py already resolves default paths, this just keeps data fresh.
"""
import argparse
import os
import subprocess
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

R2_PUBLIC_BASE = 'https://pub-81d2f5a4ba9a4821bc03f0c3375f9536.r2.dev'
R2_KEY = 'research/research_catalog.7z'
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
ARCHIVE = os.path.join(DATA_DIR, 'research_catalog.7z')
OUT_DB = os.path.join(DATA_DIR, 'research.db')


def _download(url: str, dest: str):
    """curl, not urllib — this box's Python SSL chain is broken."""
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    subprocess.run(
        ['curl', '-fL', '-o', dest, url],
        check=True,
    )


def fetch():
    url = f'{R2_PUBLIC_BASE}/{R2_KEY}'
    print(f'Downloading {url}')
    _download(url, ARCHIVE)
    # 7z extracts pokemon_tcg.db (the archived member name) — rename to research.db
    member = os.path.join(DATA_DIR, 'pokemon_tcg.db')
    subprocess.run(['7z', 'x', ARCHIVE, f'-o{DATA_DIR}', '-y'],
                   check=True, stdout=subprocess.DEVNULL)
    if os.path.exists(member) and member != OUT_DB:
        os.replace(member, OUT_DB)
    print(f'Extracted -> {OUT_DB}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--local', action='store_true',
                    help='ingest from ../pokemon_tcg.db instead of downloading')
    ap.add_argument('--skip-rarity', action='store_true')
    args = ap.parse_args()

    if args.local:
        from quant import ingest
        master = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            'pokemon_tcg.db')
        ingest.ingest(master, OUT_DB, in_place=False,
                      skip_rarity=args.skip_rarity)
    else:
        fetch()

    # Report freshness
    import sqlite3
    from quant import store
    con = store.open_master(OUT_DB)
    meta = store.research_meta(con)
    print('research_meta:', meta)
    con.close()


if __name__ == '__main__':
    main()
