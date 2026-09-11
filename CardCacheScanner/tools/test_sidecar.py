#!/usr/bin/env python3
"""Quick sanity check: embed one image with TFLite and compare against sidecar."""

import json
import numpy as np
from pathlib import Path
from build_embeddings import embed_image, load_model, preprocess_image, l2_normalize

# Use Vaporeon's cached image as the query
img_path = Path(__file__).parent / '.image_cache' / 'e8f5b9b2e0b8c6d9.jpg'  # placeholder; we find it below

# Find the Vaporeon image path by scanning catalog
catalog_path = Path(__file__).parent.parent / 'assets' / 'test_catalog.json'
with open(catalog_path, 'r') as f:
    catalog = json.load(f)

vaporeon = next(c for c in catalog if c['productId'] == 610378)
import hashlib
url = vaporeon['imageUrl']
h = hashlib.sha256(url.encode()).hexdigest()[:16]
img_path = Path(__file__).parent / '.image_cache' / f'{h}.jpg'
print('query image', img_path, img_path.exists())

interp = load_model()
query = embed_image(interp, img_path)

sidecar_path = Path(__file__).parent.parent / 'assets' / 'catalog_embeddings' / 'catalog_embeddings.json'
with open(sidecar_path, 'r') as f:
    sidecar = json.load(f)

scores = []
for e in sidecar['embeddings']:
    vec = np.array(e['vector'], dtype=np.float32)
    score = float(np.dot(query, vec))
    scores.append((score, e['productId'], next(c['name'] for c in catalog if c['productId'] == e['productId'])))

scores.sort(reverse=True)
print('\nTop 5 matches:')
for s, pid, name in scores[:5]:
    print(f'  {pid} {name}: {s:.4f}')
