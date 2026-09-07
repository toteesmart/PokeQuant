import { scoreCatalogMatch, type MatchableRow } from '../src/utils/scoreCatalogMatch';
import type { CatalogCard } from '../src/db/catalogDb';

function makeCard(overrides: Partial<CatalogCard> = {}): CatalogCard {
  return {
    id: '1-normal',
    name: 'Pikachu',
    number: '25',
    set: 'Base Set',
    rarity: 'Common',
    productType: 'Normal',
    liveMarket: 10,
    velocity1d: 0,
    velocity3d: 0,
    velocity7d: 0,
    velocity30d: 0,
    range90dHigh: 10,
    range90dLow: 10,
    productId: 1,
    imageUrl: '',
    variants: [],
    ...overrides,
  };
}

function makeRow(overrides: Partial<MatchableRow> = {}): MatchableRow {
  return {
    id: 'row-1',
    name: 'Pikachu',
    set: 'Base Set',
    number: '25',
    variant: 'Normal',
    ...overrides,
  };
}

describe('scoreCatalogMatch', () => {
  it('returns -1 when the row has no name', () => {
    const row = makeRow({ name: '' });
    const card = makeCard();
    expect(scoreCatalogMatch(row, card)).toBe(-1);
  });

  it('gives a high score to an exact name match', () => {
    const row = makeRow();
    const card = makeCard();
    expect(scoreCatalogMatch(row, card)).toBeGreaterThanOrEqual(100);
  });

  it('boosts the score when set and number also match', () => {
    const row = makeRow({ set: 'Base Set', number: '25' });
    const exact = makeCard({ set: 'Base Set', number: '25' });
    const wrong = makeCard({ set: 'Jungle', number: '32' });
    expect(scoreCatalogMatch(row, exact)).toBeGreaterThan(
      scoreCatalogMatch(row, wrong)
    );
  });

  it('prefers a card whose name contains the full query', () => {
    const row = makeRow({ name: 'Pikachu' });
    const exact = makeCard({ name: 'Pikachu' });
    const partial = makeCard({ name: 'Pikachu V' });
    expect(scoreCatalogMatch(row, exact)).toBeGreaterThan(
      scoreCatalogMatch(row, partial)
    );
  });
});
