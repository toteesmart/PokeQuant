import catalogData from '../../../assets/test_catalog.json';
import type { TestCatalogCard } from '../../types/catalog';

let cached: TestCatalogCard[] | null = null;

export async function loadTestCatalog(): Promise<TestCatalogCard[]> {
  if (cached) return cached;

  const data = catalogData as unknown as TestCatalogCard[];
  cached = Array.isArray(data) ? data : [];
  return cached;
}
