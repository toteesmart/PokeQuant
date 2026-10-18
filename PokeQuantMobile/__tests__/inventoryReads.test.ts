import { signalForCard, featuresForCard } from '../src/services/inventoryReads';
import { mkSignal, mkFeatures, mkInventoryCard } from './helpers/builders';
import type { CardSignal } from '../src/db/catalogDb';
import type { SeriesFeatures } from '../src/scanner/services/deal/seriesSignals';
import type { InventoryCard } from '../src/store/inventoryStore';

// signalForCard and featuresForCard share the same finish-fallback contract
// (held finish → Normal → first loaded finish) via pickSignalForFinish — pin
// the matrix once against both readers.
const cases: {
  name: string;
  read: (map: Record<number, Record<string, unknown>>, card: InventoryCard) => unknown;
  mkValue: (over?: object) => unknown;
}[] = [
  {
    name: 'signalForCard',
    read: (map, card) => signalForCard(map as Record<number, Record<string, CardSignal>>, card),
    mkValue: (over) => mkSignal(over),
  },
  {
    name: 'featuresForCard',
    read: (map, card) =>
      featuresForCard(map as Record<number, Record<string, SeriesFeatures>>, card),
    mkValue: (over) => mkFeatures(over),
  },
];

describe.each(cases)('$name', ({ read, mkValue }) => {
  test('null or missing productId → undefined', () => {
    const map = { 1: { Normal: mkValue() } };
    expect(read(map, mkInventoryCard({ productId: null }))).toBeUndefined();
    expect(read(map, mkInventoryCard({ productId: undefined }))).toBeUndefined();
  });

  test('an unknown productId → undefined', () => {
    const map = { 1: { Normal: mkValue() } };
    expect(read(map, mkInventoryCard({ productId: 999 }))).toBeUndefined();
  });

  test('the held finish wins', () => {
    const holo = mkValue();
    const map = { 1: { Normal: mkValue(), Holofoil: holo } };
    expect(read(map, mkInventoryCard({ productId: 1, productType: 'Holofoil' }))).toBe(holo);
  });

  test('a missing held finish falls back to Normal', () => {
    const normal = mkValue();
    const map = { 1: { Normal: normal } };
    expect(read(map, mkInventoryCard({ productId: 1, productType: 'Reverse Holofoil' }))).toBe(
      normal,
    );
  });

  test('when neither finish is loaded it takes the first available value', () => {
    const first = mkValue();
    const map = { 1: { Holofoil: first, 'Reverse Holofoil': mkValue() } };
    expect(read(map, mkInventoryCard({ productId: 1, productType: 'Normal' }))).toBe(first);
  });

  test('an undefined productType resolves the Normal finish', () => {
    const normal = mkValue();
    const map = { 1: { Normal: normal, Holofoil: mkValue() } };
    expect(read(map, mkInventoryCard({ productId: 1, productType: undefined }))).toBe(normal);
  });
});
