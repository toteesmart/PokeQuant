import json
from pathlib import Path

root = Path(__file__).parent.parent
catalog = json.loads((root / 'assets' / 'full_catalog.json').read_text())
manifest = json.loads((root / 'assets' / 'catalog_embeddings' / 'manifest.json').read_text())

print('Vaporeon ex cards in full catalog:')
for c in catalog:
    if 'vaporeon ex' in c.get('name', '').lower():
        print(c['productId'], c['name'], c.get('set'), c.get('number'))

print('\nMissing from manifest productIds:', len(set(c['productId'] for c in catalog) - set(manifest['productIds'])))
