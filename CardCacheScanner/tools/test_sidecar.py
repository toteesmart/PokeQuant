#!/usr/bin/env python3
"""Sanity-test the binary sidecar by embedding a query image and scoring the catalog.

Reads `embeddings.bin` + `manifest.json` and compares an on-the-fly MobileCLIP-S2
embedding to the stored vectors.  This proves the binary sidecar is consistent
with the model and useful for visual matching.

Usage:
    py tools/test_sidecar.py --product-id 610378
    py tools/test_sidecar.py --sidecar-dir PokeQuantMobile/assets/catalog_embeddings --product-id 610378
"""

import argparse
import json
import sqlite3
from pathlib import Path

import numpy as np
from build_embeddings import embed_image, load_model

ROOT = Path(__file__).resolve().parents[1].parents[0]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Test the binary embedding sidecar.')
    parser.add_argument('--sidecar-dir', type=Path, default=ROOT / 'CardCacheScanner' / 'assets' / 'catalog_embeddings',
                        help='Directory containing embeddings.bin and manifest.json.')
    parser.add_argument('--images-dir', type=Path, default=ROOT / 'catalog_images',
                        help='Directory of catalog images named {productId}.jpg.')
    parser.add_argument('--catalog-db', type=Path, default=ROOT / 'pokemon_tcg.db',
                        help='SQLite catalog DB for product names.')
    parser.add_argument('--model', type=Path, default=ROOT / 'CardCacheScanner' / 'assets' / 'models' / 'mobileclip_s2_image_fp16.tflite',
                        help='MobileCLIP-S2 TFLite model.')
    parser.add_argument('--product-id', type=int, default=610378,
                        help='Product ID of the query image.')
    parser.add_argument('--top-k', type=int, default=5,
                        help='Number of top matches to print.')
    return parser.parse_args()


def load_names(db_path: Path) -> dict[int, str]:
    if not db_path.exists():
        return {}
    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()
    cur.execute('SELECT product_id, card_name FROM cards')
    names = {product_id: card_name for product_id, card_name in cur}
    conn.close()
    return names


def main() -> None:
    args = parse_args()
    manifest_path = args.sidecar_dir / 'manifest.json'
    bin_path = args.sidecar_dir / 'embeddings.bin'

    if not manifest_path.exists():
        raise FileNotFoundError(f'Manifest not found: {manifest_path}')
    if not bin_path.exists():
        raise FileNotFoundError(f'Binary sidecar not found: {bin_path}')

    with open(manifest_path, 'r', encoding='utf-8') as f:
        manifest = json.load(f)

    print(f'Loading sidecar: {manifest["count"]} vectors, dim={manifest["dimension"]}')
    all_vectors = np.fromfile(bin_path, dtype=np.float32)

    img_path = args.images_dir / f'{args.product_id}.jpg'
    if not img_path.exists():
        raise FileNotFoundError(f'Query image not found: {img_path}')

    print(f'Query image: {img_path}')
    interp = load_model(args.model)
    query = embed_image(interp, img_path)

    # Self-check: the stored vector for the query product should have dot ~1.0.
    product_ids = manifest['productIds']
    if args.product_id in product_ids:
        idx = product_ids.index(args.product_id)
        offset = manifest['offsets'][idx]
        self_vec = all_vectors[offset // 4 : offset // 4 + manifest['dimension']]
        self_score = float(np.dot(query, self_vec))
        print(f'Self dot for pid={args.product_id}: {self_score:.6f}')

    names = load_names(args.catalog_db)

    scores = []
    dim = manifest['dimension']
    for i, pid in enumerate(product_ids):
        offset = manifest['offsets'][i]
        vec = all_vectors[offset // 4 : offset // 4 + dim]
        score = float(np.dot(query, vec))
        scores.append((score, pid))

    scores.sort(reverse=True)

    print(f'\nTop {args.top_k} matches:')
    for score, pid in scores[:args.top_k]:
        name = names.get(pid, '?')
        print(f'  {pid} {name}: {score:.4f}')


if __name__ == '__main__':
    main()
