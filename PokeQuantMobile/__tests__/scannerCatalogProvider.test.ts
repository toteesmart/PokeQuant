import { mapRowsToCards } from '../src/scanner/services/catalog/ScannerCatalogProvider';

const cardRow = (overrides: Partial<Parameters<typeof mapRowsToCards>[0][number]> = {}) => ({
  product_id: 123,
  card_name: 'Pikachu - 025/165',
  card_number: '025/165',
  set_name: 'SV: Scarlet & Violet 151',
  rarity: 'Illustration Rare',
  ...overrides,
});

const priceRow = (
  productId: number,
  subType: string,
  marketPrice: number,
  date = '2026-01-01'
) => ({ product_id: productId, sub_type: subType, market_price: marketPrice, date });

test('mapRowsToCards maps card fields and falls back on nulls', () => {
  const [card] = mapRowsToCards(
    [cardRow({ card_number: null, set_name: null })],
    []
  );
  expect(card.productId).toBe(123);
  expect(card.name).toBe('Pikachu - 025/165');
  expect(card.number).toBe('');
  expect(card.set).toBe('');
  expect(card.rarity).toBe('Illustration Rare');
  expect(card.imageUrl).toBe('https://tcgplayer-cdn.tcgplayer.com/product/123_400w.jpg');
});

test('mapRowsToCards prefers the Normal subtype price', () => {
  const [card] = mapRowsToCards(
    [cardRow()],
    [
      priceRow(123, 'Reverse Holofoil', 9.99),
      priceRow(123, 'Normal', 4.5),
    ]
  );
  expect(card.variants[0].subType).toBe('Normal');
  expect(card.variants[0].marketPrice).toBe(4.5);
});

test('mapRowsToCards falls back to holofoil, then lowest positive', () => {
  const [holo] = mapRowsToCards(
    [cardRow()],
    [priceRow(123, 'Holofoil', 7.0), priceRow(123, 'Reverse Holofoil', 3.0)]
  );
  expect(holo.variants[0].marketPrice).toBe(7.0);

  const [lowest] = mapRowsToCards(
    [cardRow()],
    [priceRow(123, 'Reverse Holofoil', 3.0), priceRow(123, '1st Edition', 12.0)]
  );
  expect(lowest.variants[0].marketPrice).toBe(3.0);
});

test('mapRowsToCards leaves empty price list at zero', () => {
  const [card] = mapRowsToCards([cardRow()], []);
  expect(card.variants[0].marketPrice).toBe(0);
});
