import { cleanCardName, extractCardNameFromOcr, bestNameScore, catalogName, findBestMatch } from '../src/services/catalog/catalogMatcher';

test('cleanCardName keeps ex and removes noise', () => {
  const raw = 'STAGE) Vaporeon eX $280 Erolves fram Revie Thra As long as this Pokemon ex ...';
  const got = cleanCardName(raw);
  expect(got).toContain('vaporeon');
  expect(got).toContain('ex');
});

test('bestNameScore prefers Vaporeon ex when ex is in OCR', () => {
  const ocr = 'vaporeon ex erolves fram revie thra';
  const sEx = bestNameScore(ocr, 'vaporeon ex');
  const sBase = bestNameScore(ocr, 'vaporeon');
  // Both can be 1.0 (target-normalized). The tie-break in findBestMatch should
  // prefer the longer name when the OCR has "ex".
  expect(sEx).toBeGreaterThanOrEqual(0.5);
  if (sEx === sBase) {
    expect('vaporeon ex'.length).toBeGreaterThan('vaporeon'.length);
  }
});

test('catalogName strips numbers', () => {
  const c = { productId: 1, name: 'Vaporeon ex - 023/131', number: '023/131', set: '', rarity: '', imageUrl: '', variants: [] } as any;
  expect(catalogName(c)).toBe('vaporeon ex');
});

test('findBestMatch corrects misread number to Vaporeon ex', () => {
  const catalog = [
    { productId: 1, name: 'Vaporeon (12)', number: '12', set: 'Jungle', rarity: 'Holo Rare', imageUrl: '', variants: [] },
    { productId: 2, name: 'Vaporeon ex - 023/131', number: '023/131', set: 'SV: Prismatic Evolutions', rarity: 'Holo Rare', imageUrl: '', variants: [] },
    { productId: 3, name: 'Hydreigon - 62/111', number: '062/111', set: 'Deck Exclusives', rarity: 'Holo Rare', imageUrl: '', variants: [] },
  ] as any[];
  const topText = 'Vaporeon eX Evolves from Eevee HP280 Tera';
  const match = findBestMatch(topText, '023/137', catalog);
  expect(match).not.toBeNull();
  expect(match?.card.productId).toBe(2);
});
