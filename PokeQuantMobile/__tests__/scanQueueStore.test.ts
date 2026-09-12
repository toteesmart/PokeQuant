import { useScanQueueStore } from '../src/scanner/store/scanQueueStore';
import { createScannedCard } from '../src/scanner/types/scan';
import type { ScanCatalogCard } from '../src/scanner/types/catalog';

const catalogCard = (overrides: Partial<ScanCatalogCard> = {}): ScanCatalogCard => ({
  productId: 1,
  name: 'Pikachu - 025/165',
  number: '025/165',
  set: 'SV151',
  rarity: 'Illustration Rare',
  imageUrl: 'https://example.com/p.png',
  variants: [{ subType: 'Normal', marketPrice: 10, date: '2026-01-01' }],
  ...overrides,
});

beforeEach(() => {
  useScanQueueStore.setState({ items: [] });
});

test('add/remove/clear manage queue items', () => {
  const card = createScannedCard(catalogCard());
  useScanQueueStore.getState().add(card);
  expect(useScanQueueStore.getState().items).toHaveLength(1);
  useScanQueueStore.getState().remove(card.id);
  expect(useScanQueueStore.getState().items).toHaveLength(0);
  useScanQueueStore.getState().add(card);
  useScanQueueStore.getState().clear();
  expect(useScanQueueStore.getState().items).toHaveLength(0);
});

test('updateCondition reprices with vendor modifiers', () => {
  const card = createScannedCard(catalogCard());
  useScanQueueStore.getState().add(card);
  // vendorStore CONDITION_MODIFIERS: lp = 0.85
  useScanQueueStore.getState().updateCondition(card.id, 'LP');
  const updated = useScanQueueStore.getState().items[0];
  expect(updated.condition).toBe('LP');
  expect(updated.marketPrice).toBe(8.5);
  expect(updated.totalPrice).toBe(8.5);
});

test('updateQuantity floors at 1 and retotals', () => {
  const card = createScannedCard(catalogCard());
  useScanQueueStore.getState().add(card);
  useScanQueueStore.getState().updateQuantity(card.id, 3);
  let updated = useScanQueueStore.getState().items[0];
  expect(updated.quantity).toBe(3);
  expect(updated.totalPrice).toBe(30);
  useScanQueueStore.getState().updateQuantity(card.id, 0);
  updated = useScanQueueStore.getState().items[0];
  expect(updated.quantity).toBe(1);
  expect(updated.totalPrice).toBe(10);
});

test('replaceCard swaps the matched card and keeps condition/quantity', () => {
  const card = createScannedCard(catalogCard());
  useScanQueueStore.getState().add(card);
  useScanQueueStore.getState().updateCondition(card.id, 'MP');
  useScanQueueStore.getState().updateQuantity(card.id, 2);
  const replacement = catalogCard({
    productId: 2,
    name: 'Pikachu (Pattern) - 025/165',
    variants: [{ subType: 'Normal', marketPrice: 20, date: '2026-01-01' }],
  });
  useScanQueueStore.getState().replaceCard(card.id, replacement);
  const updated = useScanQueueStore.getState().items[0];
  expect(updated.productId).toBe(2);
  expect(updated.condition).toBe('MP');
  // mp modifier = 0.65 -> 20 * 0.65 * 2 = 26
  expect(updated.marketPrice).toBe(13);
  expect(updated.totalPrice).toBe(26);
});

test('totalCount/totalPrice aggregate the queue', () => {
  useScanQueueStore.getState().add(createScannedCard(catalogCard()));
  useScanQueueStore
    .getState()
    .add(createScannedCard(catalogCard({ productId: 9 }), 'NM', 2));
  expect(useScanQueueStore.getState().totalCount()).toBe(3);
  expect(useScanQueueStore.getState().totalPrice()).toBe(30);
});
