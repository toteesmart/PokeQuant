import {
  setCodeFromSetName,
  extractSetCodesFromText,
  cardsMatchingSetCodes,
  precomputeCatalogCache,
} from '../src/scanner/services/catalog/catalogMatcher';

test('setCodeFromSetName extracts the printed set code', () => {
  expect(setCodeFromSetName('JP · M2: Inferno X')).toBe('M2');
  expect(setCodeFromSetName('JP · SV-P Promotional Cards')).toBe('SV-P');
  expect(setCodeFromSetName('JP · S8: Fusion Arts')).toBe('S8');
  expect(setCodeFromSetName('ME02: Phantasmal Flames')).toBe('ME02');
  expect(setCodeFromSetName('SV: Scarlet & Violet 151')).toBe('SV');
});

test('setCodeFromSetName rejects lead words that are not codes', () => {
  expect(setCodeFromSetName('JP · Start Deck 100 Battle Collection')).toBe('');
  expect(setCodeFromSetName('JP · Unnumbered Promotional cards')).toBe('');
  expect(setCodeFromSetName('SM - Cosmic Eclipse')).toBe('');
  expect(setCodeFromSetName('')).toBe('');
  expect(setCodeFromSetName(null)).toBe('');
  expect(setCodeFromSetName(undefined)).toBe('');
});

const KNOWN = new Set(['M2', 'SV-P', 'S8', 'ME02']);

test('extractSetCodesFromText finds codes in OCR bottom text', () => {
  expect(extractSetCodesFromText('Illus. Orca M2 090/080 AR', KNOWN)).toEqual(['M2']);
  // Cyrillic look-alike — observed "м2" in real OCR output.
  expect(extractSetCodesFromText('Illus. Orca м2 090/080 AR', KNOWN)).toEqual(['M2']);
  expect(extractSetCodesFromText('PROMO 242/SV-P ©2025', KNOWN)).toEqual(['SV-P']);
});

test('extractSetCodesFromText ignores numbers, rarities and kana', () => {
  expect(extractSetCodesFromText('Illus. X 090/080 AR RR SAR', KNOWN)).toEqual([]);
  expect(extractSetCodesFromText('メガシンカex トゲデマル', KNOWN)).toEqual([]);
  expect(extractSetCodesFromText('', KNOWN)).toEqual([]);
  expect(extractSetCodesFromText('M2', new Set())).toEqual([]);
});

const card = (productId: number, number: string, set: string) =>
  ({ productId, name: 'x', number, set, rarity: '', imageUrl: '', variants: [] } as any);

test('cardsMatchingSetCodes returns only cards from OCR-matched sets', () => {
  const catalog = [
    card(1, '090/080', 'JP · M2: Inferno X'),
    card(2, '001/080', 'JP · M2: Inferno X'),
    card(3, '090/080', 'ME02: Phantasmal Flames'),
    card(4, 'N/A', 'JP · Unnumbered Promotional cards'),
  ];
  precomputeCatalogCache(catalog);
  expect(cardsMatchingSetCodes(['M2'], catalog).map((c) => c.productId)).toEqual([1, 2]);
  expect(cardsMatchingSetCodes(['M2', 'ME02'], catalog).map((c) => c.productId)).toEqual([1, 2, 3]);
  expect(cardsMatchingSetCodes(['NOPE'], catalog)).toEqual([]);
  expect(cardsMatchingSetCodes([], catalog)).toEqual([]);
});
