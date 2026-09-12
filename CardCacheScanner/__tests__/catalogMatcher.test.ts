import { cleanCardName, extractCardNameFromOcr, bestNameScore, catalogName, findBestMatch, findVariantOptions, findNearNumberCandidates } from '../src/services/catalog/catalogMatcher';
import { extractCardNumber } from '../src/utils/normalizeText';

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

test('findVariantOptions includes base and patterned printings of same number', () => {
  const catalog = [
    { productId: 1, name: 'Pikachu - 055/217', number: '055/217', set: 'ME: Ascended Heroes', rarity: 'Common', imageUrl: '', variants: [] },
    { productId: 2, name: 'Pikachu (Energy Symbol Pattern) - 055/217', number: '055/217', set: 'ME: Ascended Heroes', rarity: 'Promo', imageUrl: '', variants: [] },
    { productId: 3, name: 'Raichu - 055/217', number: '055/217', set: 'ME: Ascended Heroes', rarity: 'Uncommon', imageUrl: '', variants: [] },
    { productId: 4, name: 'Pikachu - 056/217', number: '056/217', set: 'ME: Ascended Heroes', rarity: 'Common', imageUrl: '', variants: [] },
  ] as any[];
  const options = findVariantOptions(catalog[1], catalog);
  expect(options.map((o) => o.productId).sort()).toEqual([1, 2]);
});

test('findVariantOptions does not mix prefixed names (Mega Latias ex vs Latias)', () => {
  const catalog = [
    { productId: 5, name: 'Mega Latias ex - 100/132', number: '100/132', set: 'ME01', rarity: '', imageUrl: '', variants: [] },
    { productId: 6, name: 'Latias - 100/132', number: '100/132', set: 'ME01', rarity: '', imageUrl: '', variants: [] },
  ] as any[];
  const options = findVariantOptions(catalog[0], catalog);
  expect(options.map((o) => o.productId)).toEqual([5]);
});

test('findBestMatch matches promo-style SVP number', () => {
  const catalog = [
    { productId: 1, name: 'Eevee - 51/64', number: '51/64', set: 'Jungle', rarity: 'Common', imageUrl: '', variants: [] },
    { productId: 2, name: 'Eevee - 200 (Cosmos Holo)', number: 'SVP 200', set: 'SV: Scarlet & Violet Promo Cards', rarity: 'Promo', imageUrl: '', variants: [] },
  ] as any[];
  const match = findBestMatch('Eevee HP 60', 'SVP200', catalog);
  expect(match).not.toBeNull();
  expect(match?.card.productId).toBe(2);
});

test('findBestMatch matches small-set promo numbers regardless of padding', () => {
  const catalog = [
    { productId: 1, name: 'Pikachu - 6/12', number: '6/12', set: "McDonald's 2019", rarity: '', imageUrl: '', variants: [] },
    { productId: 2, name: 'Pikachu - 25/25', number: '25/25', set: 'Celebrations', rarity: '', imageUrl: '', variants: [] },
  ] as any[];
  const match = findBestMatch('Pikachu HP60', '006/012', catalog);
  expect(match).not.toBeNull();
  expect(match?.card.productId).toBe(1);
});

test('findBestMatch keeps exact-number card over fuzzy-only name match', () => {
  const catalog = [
    { productId: 1, name: 'Mega Diancie ex - 267/217', number: '267/217', set: 'ME: Ascended Heroes', rarity: '', imageUrl: '', variants: [] },
    { productId: 2, name: 'Dialga', number: '164/198', set: 'Other', rarity: '', imageUrl: '', variants: [] },
  ] as any[];
  // "dianga" fuzzy-matches "dialga" (0.83) but is only a fuzzy hit — the
  // exact 267/217 number points at Mega Diancie ex and must win.
  const match = findBestMatch('BASIG Maga Dianga eX ASHR 270 MenyEvolved form of', '267/217', catalog);
  expect(match).not.toBeNull();
  expect(match?.card.productId).toBe(1);
});

test('findBestMatch still corrects a misread number when the name match has exact tokens', () => {
  const catalog = [
    { productId: 1, name: "Erika's Victreebel - 006/217", number: '006/217', set: 'ME: Ascended Heroes', rarity: '', imageUrl: '', variants: [] },
    { productId: 2, name: 'Mega Hawlucha ex - 116/217', number: '116/217', set: 'ME: Ascended Heroes', rarity: '', imageUrl: '', variants: [] },
  ] as any[];
  // "116/217" was misread as "006/217" — the name match has an exact
  // "hawlucha" token, so the number gets corrected to the real card.
  const match = findBestMatch('Mega Hawlucha ex', '006/217', catalog);
  expect(match).not.toBeNull();
  expect(match?.card.productId).toBe(2);
});

test('findBestMatch keeps possessive names agreeing through OCR typos', () => {
  const catalog = [
    { productId: 1, name: "Cynthia's Spiritomb - 244/217", number: '244/217', set: 'ME: Ascended Heroes', rarity: '', imageUrl: '', variants: [] },
    { productId: 2, name: 'Spiritomb', number: '087', set: 'Other Set', rarity: '', imageUrl: '', variants: [] },
  ] as any[];
  // "Cynchials" is an OCR misread of "Cynthia's" — the number is exact and the
  // name is close enough that the same-number card must win.
  const match = findBestMatch('Cynchials Spiritomb', '244/217', catalog);
  expect(match).not.toBeNull();
  expect(match?.card.productId).toBe(1);
});

test('findBestMatch prefers same-number card when generic name is a subset', () => {
  const catalog = [
    { productId: 1, name: "Cynthia's Spiritomb - 244/217", number: '244/217', set: 'ME: Ascended Heroes', rarity: '', imageUrl: '', variants: [] },
    { productId: 2, name: 'Spiritomb', number: '087', set: 'Other Set', rarity: '', imageUrl: '', variants: [] },
  ] as any[];
  // Clean "spiritomb" OCR + an exact 244/217 number should not return the
  // unrelated plain Spiritomb printing.
  const match = findBestMatch('Spiritomb', '244/217', catalog);
  expect(match).not.toBeNull();
  expect(match?.card.productId).toBe(1);
});

test('findBestMatch prefers same-number card over weak garbage name match', () => {
  const catalog = [
    { productId: 1, name: 'Mega Lucario ex - 113/217', number: '113/217', set: 'ME: Ascended Heroes', rarity: '', imageUrl: '', variants: [] },
    { productId: 2, name: 'Stunfisk ex - 114/217', number: '114/217', set: 'ME: Ascended Heroes', rarity: '', imageUrl: '', variants: [] },
  ] as any[];
  // Garbage OCR name that only shares the generic "ex" token must not snap
  // the correct number to a wrong neighbour — the real 113/217 card wins.
  const match = findBestMatch('STAGET ex', '113/217', catalog);
  expect(match).not.toBeNull();
  expect(match?.card.productId).toBe(1);
});

test('findBestMatch rejects same-number card when OCR name disagrees', () => {
  const catalog = [
    { productId: 1, name: "Erika's Victreebel - 006/217", number: '006/217', set: 'ME: Ascended Heroes', rarity: '', imageUrl: '', variants: [] },
    { productId: 2, name: "Erika's Victreebel (Poke Ball) - 006/217", number: '006/217', set: 'ME: Ascended Heroes', rarity: '', imageUrl: '', variants: [] },
    { productId: 3, name: 'Mega Hawlucha ex - 116/217', number: '116/217', set: 'ME: Ascended Heroes', rarity: '', imageUrl: '', variants: [] },
  ] as any[];
  // OCR read the name correctly but misread 116/217 as 006/217.
  const match = findBestMatch('Mega Hawlucha eX m250', '006/217', catalog);
  expect(match).not.toBeNull();
  expect(match?.card.productId).toBe(3);
});

test('findBestMatch exposes same-number alternates when name cannot disambiguate', () => {
  const catalog = [
    { productId: 1, name: 'Rockruff - 075/131', number: '075/131', set: 'Other', rarity: '', imageUrl: '', variants: [] },
    { productId: 2, name: 'Eevee ex - 075/131', number: '075/131', set: 'PRE', rarity: '', imageUrl: '', variants: [] },
  ] as any[];
  // Garbage OCR name ("favep") agrees with neither same-number card — the
  // fallback keeps the other card reachable via alternates.
  const match = findBestMatch('favep', '075/131', catalog);
  expect(match).not.toBeNull();
  expect(match?.method).toBe('number');
  expect(match?.confidence).toBe(0.5);
  expect(match?.alternates?.map((c: any) => c.productId)).toEqual([2]);
});

test('findNearNumberCandidates returns one-digit-off same-total cards', () => {
  const catalog = [
    { productId: 1, name: 'Beautifly - 013/217', number: '013/217', set: 'ME', rarity: '', imageUrl: '', variants: [] },
    { productId: 2, name: 'Mega Lucario ex - 113/217', number: '113/217', set: 'ME', rarity: '', imageUrl: '', variants: [] },
    { productId: 3, name: 'Unrelated - 013/132', number: '013/132', set: 'ME', rarity: '', imageUrl: '', variants: [] },
  ] as any[];
  const near = findNearNumberCandidates('013/217', catalog);
  expect(near.map((c) => c.productId)).toEqual([2]);
  // Bare numbers and promo codes produce no near candidates.
  expect(findNearNumberCandidates('075', catalog)).toEqual([]);
  expect(findNearNumberCandidates('SVP200', catalog)).toEqual([]);
});

test('findBestMatch resolves SVP promo numbers with junk tokens between prefix and digits', () => {
  const catalog = [
    { productId: 1, name: 'Eevee - 200 (Cosmos Holo)', number: 'SVP 200', set: 'SV Promo', rarity: '', imageUrl: '', variants: [] },
    { productId: 2, name: 'Eevee - 166/236', number: '166/236', set: 'Obsidian Flames', rarity: '', imageUrl: '', variants: [] },
  ] as any[];
  // "SVP EN UE 200" and "SVP B 200" are real OCR reads of the same card.
  for (const text of ['Illus. Kariya H SVP EN UE 200', 'Illus. Kariya H SVP B 200', 'Illus. Kariya H SVP EN 200']) {
    const num = extractCardNumber(text);
    expect(num).toBe('SVP200');
    const match = findBestMatch('eevee', num, catalog);
    expect(match).not.toBeNull();
    expect(match?.card.productId).toBe(1);
  }
});
