#!/usr/bin/env python3
"""Build a catalog embedding sidecar for CardCacheScanner.

This script uses the same MobileCLIP-S2 TFLite model and art-crop preprocessing
that the app uses, so the sidecar vectors are directly comparable to on-device
query embeddings.

Output files are written to `assets/catalog_embeddings/`:
  - catalog_embeddings.json   # easy-to-import JSON for dev testing
  - embeddings.bin            # raw float32 vectors for production
  - manifest.json             # productId -> byte offset map

Usage:
  py tools/build_embeddings.py

By default it builds for `assets/test_catalog.json`.
"""

import hashlib
import json
import os
import struct
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image
from PIL.Image import Resampling
from PIL import ImageOps
from ai_edge_litert.interpreter import Interpreter

SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_DIR = SCRIPT_DIR.parent
MODEL_PATH = PROJECT_DIR / 'assets' / 'models' / 'mobileclip_s2_image_fp16.tflite'
CATALOG_PATH = PROJECT_DIR / 'assets' / 'test_catalog.json'
OUTPUT_DIR = PROJECT_DIR / 'assets' / 'catalog_embeddings'
IMAGE_CACHE_DIR = SCRIPT_DIR / '.image_cache'

INPUT_SIZE = 224
OUTPUT_DIM = 512
ART_CROP_TOP = 0.08
ART_CROP_BOTTOM = 0.55


def load_catalog(path: Path) -> list[dict[str, Any]]:
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def image_cache_path(url: str) -> Path:
    h = hashlib.sha256(url.encode()).hexdigest()[:16]
    return IMAGE_CACHE_DIR / f'{h}.jpg'


def download_image(url: str, out: Path) -> None:
    import requests
    out.parent.mkdir(parents=True, exist_ok=True)
    r = requests.get(url, stream=True, timeout=120)
    r.raise_for_status()
    with open(out, 'wb') as f:
        for chunk in r.iter_content(chunk_size=8192):
            f.write(chunk)


def ensure_image(card: dict[str, Any]) -> Path:
    url = card['imageUrl']
    cache = image_cache_path(url)
    if cache.exists():
        return cache
    print(f"Downloading {card['productId']} {card['name']} ...")
    download_image(url, cache)
    return cache


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


def load_model() -> Interpreter:
    interp = Interpreter(model_path=str(MODEL_PATH))
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


def build_sidecar(catalog: list[dict[str, Any]], interp: Interpreter) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    vectors: list[tuple[int, np.ndarray]] = []
    json_embeddings: list[dict[str, Any]] = []

    for card in catalog:
        try:
            img_path = ensure_image(card)
            vec = embed_image(interp, img_path)
            product_id = card['productId']
            vectors.append((product_id, vec))
            json_embeddings.append({
                'productId': product_id,
                'vector': vec.tolist(),
            })
            print(f"  embedded {product_id} {card['name']}")
        except Exception as e:
            print(f"  FAILED {card['productId']} {card['name']}: {e}")

    # JSON dev/test sidecar
    catalog_embeddings_json = {
        'dimension': OUTPUT_DIM,
        'count': len(vectors),
        'embeddings': json_embeddings,
    }
    with open(OUTPUT_DIR / 'catalog_embeddings.json', 'w', encoding='utf-8') as f:
        json.dump(catalog_embeddings_json, f, separators=(',', ':'))

    # Binary production sidecar
    manifest: dict[str, Any] = {
        'dimension': OUTPUT_DIM,
        'floatBytes': 4,
        'count': len(vectors),
    }
    product_ids: list[int] = []
    offsets: list[int] = []

    with open(OUTPUT_DIR / 'embeddings.bin', 'wb') as f:
        for product_id, vec in vectors:
            offset = f.tell()
            product_ids.append(product_id)
            offsets.append(offset)
            f.write(vec.tobytes())

    manifest['productIds'] = product_ids
    manifest['offsets'] = offsets
    with open(OUTPUT_DIR / 'manifest.json', 'w', encoding='utf-8') as f:
        json.dump(manifest, f, separators=(',', ':'))

    print(f"\nWrote {len(vectors)} embeddings to {OUTPUT_DIR}")
    print(f"  catalog_embeddings.json  (dev/test)")
    print(f"  embeddings.bin + manifest.json  (production)")


def main() -> None:
    print(f"Model: {MODEL_PATH}")
    print(f"Catalog: {CATALOG_PATH}")
    catalog = load_catalog(CATALOG_PATH)
    interp = load_model()
    build_sidecar(catalog, interp)


if __name__ == '__main__':
    main()
