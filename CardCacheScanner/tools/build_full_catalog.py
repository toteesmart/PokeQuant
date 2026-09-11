#!/usr/bin/env python3
"""Build a full-catalog JSON that matches the current binary sidecar.

The catalog only includes product IDs that already have embeddings in the sidecar.
"""

import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1].parents[0]
SIDEcar_DIR = ROOT / 'CardCacheScanner' / 'assets' / 'catalog_embeddings'
DB_PATH = ROOT / 'pokemon_tcg.db'
OUTPUT_PATH = ROOT / 'CardCacheScanner' / 'assets' / 'full_catalog.json'


def main() -> None:
    with open(SIDEcar_DIR / 'manifest.json', 'r', encoding='utf-8') as f:
        manifest = json.load(f)

    pids = manifest['productIds']
    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.cursor()
    placeholders = ','.join('?' * len(pids))
    cur.execute(
        f"""
        SELECT product_id, card_name, card_number, set_name, rarity
        FROM cards
        WHERE product_id IN ({placeholders})
        """,
        tuple(pids),
    )

    rows_by_pid = {row[0]: row for row in cur}
    conn.close()

    catalog = []
    for pid in pids:
        row = rows_by_pid.get(pid)
        if not row:
            continue
        _, name, number, set_name, rarity = row
        catalog.append({
            'productId': pid,
            'name': name,
            'number': number or '',
            'set': set_name,
            'rarity': rarity,
            'imageUrl': f'https://tcgplayer-cdn.tcgplayer.com/product/{pid}_400w.jpg',
            'variants': [],
        })

    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(catalog, f, separators=(',', ':'))

    print(f'Wrote {len(catalog)} cards to {OUTPUT_PATH}')


if __name__ == '__main__':
    main()
