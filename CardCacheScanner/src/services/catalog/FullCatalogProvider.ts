import type { TestCatalogCard } from '../../types/catalog';
import { precomputeCatalogCache } from './catalogMatcher';

let cached: TestCatalogCard[] | null = null;
let loading: Promise<TestCatalogCard[]> | null = null;

export async function loadFullCatalog(): Promise<TestCatalogCard[]> {
  if (cached) return cached;
  if (loading) return loading;

  loading = (async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const data = require('../../../assets/full_catalog.json') as unknown as TestCatalogCard[];
    cached = Array.isArray(data) ? data : [];
    // Precompute catalog name/number caches so the first scan doesn't pay the cost.
    precomputeCatalogCache(cached);
    return cached;
  })();

  return loading;
}

export function getFullCatalog(): TestCatalogCard[] | null {
  return cached;
}
