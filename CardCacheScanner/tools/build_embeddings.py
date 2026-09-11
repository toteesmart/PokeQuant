#!/usr/bin/env python3
"""Build a catalog embedding sidecar for CardCacheScanner / PokeQuantMobile.

Uses the same MobileCLIP-S2 TFLite model and art-crop preprocessing that the
app uses, so the sidecar vectors are directly comparable to on-device query
embeddings.

Output files are written to `--output-dir`:
  - embeddings.bin            # raw float32 vectors for production
  - manifest.json             # productId -> byte offset map + metadata
  - catalog_embeddings.json   # only when --json is passed (dev/test)
  - progress.json             # resume state

Usage:
  # Test catalog
  py tools/build_embeddings.py

  # Real production catalog
  py tools/build_embeddings.py \
      --images-dir ../../catalog_images \
      --catalog-db ../../pokemon_tcg.db \
      --output-dir ../../PokeQuantMobile/assets/catalog_embeddings \
      --model ../assets/models/mobileclip_s2_image_fp16.tflite
"""

import argparse
import json
import os
import sqlite3
import struct
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image
from PIL.Image import Resampling
from PIL import ImageOps
from ai_edge_litert.interpreter import Interpreter

SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_DIR = SCRIPT_DIR.parent

DEFAULT_MODEL_PATH = PROJECT_DIR / 'assets' / 'models' / 'mobileclip_s2_image_fp16.tflite'
DEFAULT_TEST_CATALOG = PROJECT_DIR / 'assets' / 'test_catalog.json'
DEFAULT_OUTPUT_DIR = PROJECT_DIR / 'assets' / 'catalog_embeddings'

INPUT_SIZE = 224
OUTPUT_DIM = 512
ART_CROP_TOP = 0.08
ART_CROP_BOTTOM = 0.55
PROGRESS_SAVE_INTERVAL = 100


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Build a catalog embedding sidecar.')
    parser.add_argument('--images-dir', type=Path, default=None,
                        help='Directory of catalog images named {productId}.jpg.')
    parser.add_argument('--catalog-db', type=Path, default=None,
                        help='SQLite catalog DB (e.g. pokemon_tcg.db).')
    parser.add_argument('--catalog-json', type=Path, default=DEFAULT_TEST_CATALOG,
                        help='JSON test catalog (used if --catalog-db is not provided).')
    parser.add_argument('--output-dir', type=Path, default=DEFAULT_OUTPUT_DIR,
                        help='Where to write embeddings.bin and manifest.json.')
    parser.add_argument('--model', type=Path, default=DEFAULT_MODEL_PATH,
                        help='Path to the MobileCLIP-S2 TFLite model.')
    parser.add_argument('--json', action='store_true',
                        help='Also write a catalog_embeddings.json dev/test file.')
    parser.add_argument('--resume', action='store_true', default=True,
                        help='Resume from an existing progress.json (default True).')
    parser.add_argument('--limit', type=int, default=None,
                        help='Process only the first N cards for a quick test.')
    return parser.parse_args()


def load_test_catalog(path: Path) -> list[dict[str, Any]]:
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def load_db_catalog(db_path: Path, image_dir: Path | None) -> list[dict[str, Any]]:
    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()

    # Get the set of available local product IDs once, fast.
    available_pids: set[int] | None = None
    if image_dir is not None and image_dir.exists():
        available_pids = {int(p.stem) for p in image_dir.iterdir() if p.suffix.lower() == '.jpg'}

    # Get each card. Price is not needed here; the manifest only needs productId.
    cur.execute("""
        SELECT
            product_id,
            card_name,
            card_number,
            set_name,
            rarity
        FROM cards
        ORDER BY product_id
    """)

    rows = []
    for product_id, name, number, set_name, rarity in cur:
        row: dict[str, Any] = {
            'productId': product_id,
            'name': name,
            'number': number,
            'set': set_name,
            'rarity': rarity,
            'imageUrl': f'https://tcgplayer-cdn.tcgplayer.com/product/{product_id}_400w.jpg',
            'variants': [],
        }

        # If a local image dir is given, only include cards that have an image.
        if available_pids is not None and product_id not in available_pids:
            continue

        rows.append(row)

    conn.close()
    return rows


def preprocess_image(path: Path) -> np.ndarray:
    """Crop card art region, resize short edge to 224, center-crop to 224x224."""
    img = Image.open(path)
    img = ImageOps.exif_transpose(img)
    img = img.convert('RGB')

    w, h = img.size
    crop_top = int(ART_CROP_TOP * h)
    crop_bottom = int(ART_CROP_BOTTOM * h)
    art = img.crop((0, crop_top, w, crop_bottom))

    aw, ah = art.size
    if aw < ah:
        new_w = INPUT_SIZE
        new_h = int(round(ah * INPUT_SIZE / aw))
    else:
        new_h = INPUT_SIZE
        new_w = int(round(aw * INPUT_SIZE / ah))

    resized = art.resize((new_w, new_h), Resampling.BILINEAR)

    left = (new_w - INPUT_SIZE) // 2
    top = (new_h - INPUT_SIZE) // 2
    square = resized.crop((left, top, left + INPUT_SIZE, top + INPUT_SIZE))

    arr = np.array(square, dtype=np.float32) / 255.0
    return np.expand_dims(arr, axis=0)  # NHWC


def l2_normalize(vector: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(vector)
    if norm == 0:
        return vector
    return vector / norm


def load_model(model_path: Path) -> Interpreter:
    interp = Interpreter(model_path=str(model_path))
    interp.allocate_tensors()
    return interp


def embed_image(interp: Interpreter, path: Path) -> np.ndarray:
    tensor = preprocess_image(path)
    input_index = interp.get_input_details()[0]['index']
    output_index = interp.get_output_details()[0]['index']
    interp.set_tensor(input_index, tensor)
    interp.invoke()
    out = interp.get_tensor(output_index)[0]  # 512
    return l2_normalize(out).astype(np.float32)


def load_progress(path: Path) -> tuple[set[int], list[int]]:
    if not path.exists():
        return set(), []
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        done = set(data.get('done', []))
        order = data.get('order', [])
        # If the in-bin order was not saved, the existing embeddings.bin cannot be
        # safely resumed without a manifest mismatch. Start fresh instead.
        if not order or len(order) != len(done):
            return set(), []
        return done, order
    except Exception:
        return set(), []


def save_progress(path: Path, done: set[int], order: list[int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump({'done': sorted(done), 'order': order}, f)


def resolve_image_path(card: dict[str, Any], images_dir: Path | None) -> Path:
    if images_dir is not None:
        return images_dir / f"{card['productId']}.jpg"
    # Test catalog fallback: download to cache.
    import hashlib
    import requests
    cache_dir = Path(__file__).parent / '.image_cache'
    cache_dir.mkdir(exist_ok=True)
    url = card['imageUrl']
    h = hashlib.sha256(url.encode()).hexdigest()[:16]
    cache = cache_dir / f'{h}.jpg'
    if not cache.exists():
        r = requests.get(url, stream=True, timeout=120)
        r.raise_for_status()
        with open(cache, 'wb') as f:
            for chunk in r.iter_content(chunk_size=8192):
                f.write(chunk)
    return cache


def build_sidecar(catalog: list[dict[str, Any]], interp: Interpreter, args: argparse.Namespace) -> None:
    output_dir = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    progress_path = output_dir / 'progress.json'
    done, order = load_progress(progress_path) if args.resume else (set(), [])

    embeddings_bin_path = output_dir / 'embeddings.bin'
    manifest_path = output_dir / 'manifest.json'
    json_path = output_dir / 'catalog_embeddings.json'

    # Truncate on a fresh start; otherwise append.
    if not done and embeddings_bin_path.exists():
        embeddings_bin_path.unlink()

    product_ids: list[int] = []
    offsets: list[int] = []
    json_embeddings: list[dict[str, Any]] = []

    start_time = time.time()
    total = len(catalog)
    remaining = [c for c in catalog if c['productId'] not in done]
    if args.limit is not None:
        remaining = remaining[:args.limit]

    print(f'Already embedded: {len(done)}')
    print(f'Remaining to embed: {len(remaining)}')
    print(f'Output: {output_dir}')

    with open(embeddings_bin_path, 'ab' if done else 'wb') as bin_f:
        for idx, card in enumerate(remaining, start=1):
            pid = card['productId']
            try:
                img_path = resolve_image_path(card, args.images_dir)
                vec = embed_image(interp, img_path)
                offset = bin_f.tell()
                bin_f.write(vec.tobytes())
                bin_f.flush()

                product_ids.append(pid)
                offsets.append(offset)
                if args.json:
                    json_embeddings.append({'productId': pid, 'vector': vec.tolist()})

                done.add(pid)
                order.append(pid)

                if idx % PROGRESS_SAVE_INTERVAL == 0 or idx == len(remaining):
                    save_progress(progress_path, done, order)

                elapsed = time.time() - start_time
                rate = elapsed / idx if idx > 0 else 0
                print(f'  {idx}/{len(remaining)} pid={pid} rate={rate:.2f}s/card eta={rate*(len(remaining)-idx)/60:.1f}m {card["name"][:40]}')
            except Exception as e:
                print(f'  FAILED pid={pid} {card["name"]}: {e}')

    # Write manifest from the full in-bin order so resuming never yields a partial sidecar.
    manifest: dict[str, Any] = {
        'dimension': OUTPUT_DIM,
        'floatBytes': 4,
        'count': len(order),
        'productIds': order,
        'offsets': [i * OUTPUT_DIM * 4 for i in range(len(order))],
    }
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, separators=(',', ':'))

    if args.json:
        catalog_embeddings_json = {
            'dimension': OUTPUT_DIM,
            'count': len(product_ids),
            'embeddings': json_embeddings,
        }
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(catalog_embeddings_json, f, separators=(',', ':'))

    print(f'\nWrote {len(order)} embeddings to {output_dir}')
    print(f'  embeddings.bin  ({embeddings_bin_path.stat().st_size:,} bytes)')
    print(f'  manifest.json')
    if args.json:
        print(f'  catalog_embeddings.json')


def main() -> None:
    args = parse_args()
    print(f'Model: {args.model}')

    if args.catalog_db:
        print(f'Catalog DB: {args.catalog_db}')
        catalog = load_db_catalog(args.catalog_db, args.images_dir)
    else:
        print(f'Catalog JSON: {args.catalog_json}')
        catalog = load_test_catalog(args.catalog_json)

    print(f'Catalog size: {len(catalog)}')
    interp = load_model(args.model)
    build_sidecar(catalog, interp, args)


if __name__ == '__main__':
    main()
