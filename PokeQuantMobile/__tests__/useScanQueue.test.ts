import { act } from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';
import { mkSignal } from './helpers/builders';
import { flushAsync, renderHook } from './helpers/renderHook';
import { useScanQueue } from '../src/scanner/hooks/useScanQueue';
import { useScanQueueStore } from '../src/scanner/store/scanQueueStore';
import {
  useInventoryStore,
  type InventoryInput,
} from '../src/store/inventoryStore';
import { createScannedCard, type ScannedCard } from '../src/scanner/types/scan';
import type { ScanCatalogCard } from '../src/scanner/types/catalog';
import type { CatalogMatch } from '../src/scanner/services/catalog/catalogMatcher';
import {
  hydrateVariantPrices,
  loadScannerCatalog,
  matchForCardRef,
} from '../src/scanner/services/catalog/ScannerCatalogProvider';
import { findVariantOptions } from '../src/scanner/services/catalog/catalogMatcher';
import {
  getCardSignals,
  getLatestSubTypePricesForProducts,
  openCatalogDatabase,
} from '../src/db/catalogDb';

// The hook's async boundaries are the scanner catalog provider, the
// variant matcher, and the catalog DB — all mocked. The queue store and
// the pricing utils stay real so the tests exercise the same offer math
// and store mutations the screen relies on.

jest.mock('../src/scanner/services/catalog/ScannerCatalogProvider', () => ({
  loadScannerCatalog: jest.fn(),
  hydrateVariantPrices: jest.fn(),
  matchForCardRef: jest.fn(),
}));

jest.mock('../src/scanner/services/catalog/catalogMatcher', () => {
  const actual = jest.requireActual<
    typeof import('../src/scanner/services/catalog/catalogMatcher')
  >('../src/scanner/services/catalog/catalogMatcher');
  return { ...actual, findVariantOptions: jest.fn() };
});

jest.mock('../src/db/catalogDb', () => ({
  openCatalogDatabase: jest.fn(),
  getLatestSubTypePricesForProducts: jest.fn(),
  getCardSignals: jest.fn(),
}));

const mockLoadScannerCatalog = jest.mocked(loadScannerCatalog);
const mockHydrateVariantPrices = jest.mocked(hydrateVariantPrices);
const mockMatchForCardRef = jest.mocked(matchForCardRef);
const mockFindVariantOptions = jest.mocked(findVariantOptions);
const mockOpenCatalogDatabase = jest.mocked(openCatalogDatabase);
const mockGetLatestSubTypePrices = jest.mocked(
  getLatestSubTypePricesForProducts
);
const mockGetCardSignals = jest.mocked(getCardSignals);

const mockAddScannedCards = jest.fn(async (_cards: InventoryInput[]) => {});

const catalogCard = (
  over: Partial<ScanCatalogCard> = {}
): ScanCatalogCard => ({
  productId: 1,
  name: 'Pikachu - 025/165',
  number: '025/165',
  set: 'SV151',
  rarity: 'Illustration Rare',
  imageUrl: 'https://example.com/p.png',
  variants: [{ subType: 'Normal', marketPrice: 10, date: '2026-01-01' }],
  ...over,
});

const queueItem = (over: Partial<ScanCatalogCard> = {}): ScannedCard =>
  createScannedCard(catalogCard(over));

const seedQueue = (...items: ScannedCard[]) => {
  act(() => {
    useScanQueueStore.setState({ items });
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  seedQueue();
  act(() => {
    useInventoryStore.setState({
      addScannedCards: mockAddScannedCards,
    });
  });
  mockLoadScannerCatalog.mockResolvedValue([]);
  mockHydrateVariantPrices.mockResolvedValue(undefined);
  mockMatchForCardRef.mockResolvedValue({
    card: catalogCard(),
    method: 'fused',
    confidence: 1,
  });
  mockFindVariantOptions.mockReturnValue([]);
  mockOpenCatalogDatabase.mockResolvedValue(
    {} as unknown as SQLiteDatabase
  );
  mockGetLatestSubTypePrices.mockResolvedValue({});
  mockGetCardSignals.mockResolvedValue({});
  mockAddScannedCards.mockResolvedValue(undefined);
});

test('modal/draft state starts closed and empty', () => {
  const { result } = renderHook(() => useScanQueue());
  expect(result.current.switchItem).toBeNull();
  expect(result.current.switchOptions).toEqual([]);
  expect(result.current.finishOptions).toEqual([]);
  expect(result.current.switchLoading).toBe(false);
  expect(result.current.viewerFor).toBeNull();
  expect(result.current.offerItem).toBeNull();
  expect(result.current.dealOpen).toBe(false);
  expect(result.current.analysisFor).toBeNull();
  expect(result.current.isFlushing).toBe(false);
  expect(result.current.flushError).toBeNull();
});

test('exposes store totals and row mutators for the queue rows', () => {
  const item = queueItem();
  seedQueue(item);
  const { result } = renderHook(() => useScanQueue());

  // Default tiers: $10 market price lands in the 50% band.
  expect(result.current.totalCount()).toBe(1);
  expect(result.current.totalPrice()).toBe(10);
  expect(result.current.queueOfferTotal).toBe(5);

  act(() => result.current.updateQuantity(item.id, 3));
  expect(useScanQueueStore.getState().items[0].quantity).toBe(3);

  act(() => result.current.updateCondition(item.id, 'LP'));
  expect(useScanQueueStore.getState().items[0].marketPrice).toBe(8.5);

  act(() => result.current.remove(item.id));
  expect(useScanQueueStore.getState().items).toEqual([]);
});

test('openSwitcher loads variant options and sorted finish prices', async () => {
  const item = queueItem();
  seedQueue(item);
  const { result } = renderHook(() => useScanQueue());

  const variant = catalogCard({ productId: 2, set: 'Promo' });
  const holoSignal = mkSignal({ productId: 1, subType: 'Holofoil' });
  mockLoadScannerCatalog.mockResolvedValue([variant]);
  mockFindVariantOptions.mockReturnValue([variant]);
  mockGetLatestSubTypePrices.mockResolvedValue({
    [item.productId]: {
      Normal: { marketPrice: 10, date: '2026-01-01' },
      Holofoil: { marketPrice: 25, date: '2026-01-01' },
    },
  });
  mockGetCardSignals.mockResolvedValue({
    [item.productId]: { Holofoil: holoSignal },
  });

  act(() => {
    result.current.openSwitcher(item);
  });
  expect(result.current.switchItem).toBe(item);
  expect(result.current.switchLoading).toBe(true);
  expect(result.current.switchOptions).toEqual([]);
  expect(result.current.finishOptions).toEqual([]);

  await flushAsync();

  expect(result.current.switchLoading).toBe(false);
  expect(mockFindVariantOptions).toHaveBeenCalledWith(item, [variant]);
  // Prices hydrate before options land so a switched card can't carry $0.
  expect(mockHydrateVariantPrices).toHaveBeenCalledWith([variant]);
  expect(result.current.switchOptions).toEqual([variant]);
  // Desc by marketPrice; signals joined onto their own finish.
  expect(result.current.finishOptions).toEqual([
    { subType: 'Holofoil', marketPrice: 25, signal: holoSignal },
    { subType: 'Normal', marketPrice: 10, signal: undefined },
  ]);
});

test('openSwitcher still resolves variants when the finish lookup fails', async () => {
  const item = queueItem();
  seedQueue(item);
  const { result } = renderHook(() => useScanQueue());

  const variant = catalogCard({ productId: 2, set: 'Promo' });
  mockLoadScannerCatalog.mockResolvedValue([variant]);
  mockFindVariantOptions.mockReturnValue([variant]);
  mockOpenCatalogDatabase.mockRejectedValue(new Error('no catalog db'));

  act(() => {
    result.current.openSwitcher(item);
  });
  await flushAsync();

  expect(result.current.switchLoading).toBe(false);
  expect(result.current.switchOptions).toEqual([variant]);
  expect(result.current.finishOptions).toEqual([]);
});

test('openSwitcher clears the spinner when the whole lookup fails', async () => {
  const item = queueItem();
  seedQueue(item);
  const { result } = renderHook(() => useScanQueue());

  mockLoadScannerCatalog.mockRejectedValue(new Error('offline'));
  mockOpenCatalogDatabase.mockRejectedValue(new Error('no catalog db'));

  act(() => {
    result.current.openSwitcher(item);
  });
  await flushAsync();

  expect(result.current.switchLoading).toBe(false);
  expect(result.current.switchOptions).toEqual([]);
  expect(result.current.finishOptions).toEqual([]);
});

test('pickFinish reprices the queued card for the selected finish', async () => {
  const item = queueItem();
  seedQueue(item);
  const { result } = renderHook(() => useScanQueue());

  act(() => {
    result.current.openSwitcher(item);
  });
  await flushAsync();
  act(() => {
    result.current.pickFinish({ subType: 'Holofoil', marketPrice: 25 });
  });

  const updated = useScanQueueStore.getState().items[0];
  expect(updated.subType).toBe('Holofoil');
  expect(updated.baseMarketPrice).toBe(25);
  // NM modifier is 1.0 — the conditioned price equals the finish price.
  expect(updated.marketPrice).toBe(25);
  expect(updated.totalPrice).toBe(25);
});

test('pickVariant swaps the printing and drops the negotiated offer', async () => {
  const item = queueItem();
  seedQueue(item);
  const { result } = renderHook(() => useScanQueue());

  act(() => {
    result.current.openSwitcher(item);
  });
  await flushAsync();
  act(() => {
    useScanQueueStore.getState().updateOffer(item.id, 9);
  });
  const replacement = catalogCard({
    productId: 9,
    name: 'Pikachu (Promo) - 025/165',
    variants: [{ subType: 'Normal', marketPrice: 20, date: '2026-01-01' }],
  });
  act(() => {
    result.current.pickVariant(replacement);
  });

  const updated = useScanQueueStore.getState().items[0];
  expect(updated.productId).toBe(9);
  expect(updated.name).toBe('Pikachu (Promo) - 025/165');
  expect(updated.baseMarketPrice).toBe(20);
  // A negotiated offer is tied to the physical card — it can't leak
  // across onto a different printing.
  expect(updated.customOffer).toBeUndefined();
});

test('pickFinish/pickVariant are no-ops without an open switcher', () => {
  const item = queueItem();
  seedQueue(item);
  const { result } = renderHook(() => useScanQueue());

  act(() => {
    result.current.pickFinish({ subType: 'Holofoil', marketPrice: 25 });
    result.current.pickVariant(catalogCard({ productId: 9 }));
  });
  expect(useScanQueueStore.getState().items[0]).toBe(item);
});

test('closeSwitcher clears the target but keeps loaded options', async () => {
  const item = queueItem();
  seedQueue(item);
  const variant = catalogCard({ productId: 2, set: 'Promo' });
  mockLoadScannerCatalog.mockResolvedValue([variant]);
  mockFindVariantOptions.mockReturnValue([variant]);
  const { result } = renderHook(() => useScanQueue());
  act(() => {
    result.current.openSwitcher(item);
  });
  await flushAsync();
  act(() => result.current.closeSwitcher());
  expect(result.current.switchItem).toBeNull();
  // Options survive the close — reopening on another card re-fetches, but
  // the sheet doesn't blank out while it's animating away.
  expect(result.current.switchOptions).toEqual([variant]);
});

test('openOfferEdit seeds the draft from the tier auto-offer', () => {
  const item = queueItem();
  seedQueue(item);
  const { result } = renderHook(() => useScanQueue());

  act(() => result.current.openOfferEdit(item));
  expect(result.current.offerItem).toBe(item);
  // $10 market → 50% band → $5 → '5'
  expect(result.current.offerDraft).toBe('5');
});

test('openOfferEdit seeds an empty draft when the auto-offer is zero', () => {
  const item = queueItem({
    variants: [{ subType: 'Normal', marketPrice: 0, date: '2026-01-01' }],
  });
  seedQueue(item);
  const { result } = renderHook(() => useScanQueue());

  act(() => result.current.openOfferEdit(item));
  expect(result.current.offerItem).toBe(item);
  expect(result.current.offerDraft).toBe('');
});

test('commitOffer writes a parsed 2dp offer and closes the sheet', () => {
  const item = queueItem();
  seedQueue(item);
  const { result } = renderHook(() => useScanQueue());

  act(() => result.current.openOfferEdit(item));
  act(() => result.current.setOfferDraft('12.7'));
  act(() => result.current.commitOffer());

  expect(useScanQueueStore.getState().items[0].customOffer).toBe(12.7);
  expect(result.current.offerItem).toBeNull();
});

test('commitOffer clears the offer when the draft is not a number', () => {
  const item = queueItem();
  seedQueue(item);
  act(() => {
    useScanQueueStore.getState().updateOffer(item.id, 9);
  });
  const { result } = renderHook(() => useScanQueue());

  // updateOffer replaced the row — the sheet reads the store's copy.
  const updated = useScanQueueStore.getState().items[0];
  act(() => result.current.openOfferEdit(updated));
  // Seeded from the existing customOffer.
  expect(result.current.offerDraft).toBe('9');
  act(() => result.current.setOfferDraft('abc'));
  act(() => result.current.commitOffer());

  expect(
    useScanQueueStore.getState().items[0].customOffer
  ).toBeUndefined();
  expect(result.current.offerItem).toBeNull();
});

test('resetOffer clears the custom offer without touching the draft', () => {
  const item = queueItem();
  seedQueue(item);
  act(() => {
    useScanQueueStore.getState().updateOffer(item.id, 9);
  });
  const { result } = renderHook(() => useScanQueue());

  act(() => result.current.openOfferEdit(item));
  act(() => result.current.resetOffer());

  expect(
    useScanQueueStore.getState().items[0].customOffer
  ).toBeUndefined();
  expect(result.current.offerItem).toBeNull();
});

test('openDeal drafts the rounded queue offer total', () => {
  const a = queueItem({ productId: 1 });
  const b = queueItem({
    productId: 2,
    variants: [{ subType: 'Normal', marketPrice: 20, date: '2026-01-01' }],
  });
  seedQueue(a, b);
  const { result } = renderHook(() => useScanQueue());

  // autoOffer(10) = 5, autoOffer(20) = 12 → queue total $17.
  expect(result.current.queueOfferTotal).toBe(17);
  act(() => result.current.openDeal());
  expect(result.current.dealOpen).toBe(true);
  expect(result.current.dealDraft).toBe('17');
});

test('commitDeal prorates the negotiated total across the queue', () => {
  const a = queueItem({ productId: 1 });
  const b = queueItem({
    productId: 2,
    variants: [{ subType: 'Normal', marketPrice: 20, date: '2026-01-01' }],
  });
  seedQueue(a, b);
  const { result } = renderHook(() => useScanQueue());

  act(() => result.current.openDeal());
  act(() => result.current.setDealDraft('20'));
  act(() => result.current.commitDeal());

  expect(result.current.dealOpen).toBe(false);
  const offers = useScanQueueStore
    .getState()
    .items.map((i) => i.customOffer);
  // $5 and $12 shares of $20 → 5.88 + 14.12, leftover cents to the
  // largest line.
  expect(offers).toEqual([5.88, 14.12]);
  expect(
    offers.reduce((s: number, o) => s + (o ?? 0), 0)
  ).toBeCloseTo(20, 2);
});

test('commitDeal lands rounding leftovers on the largest line', () => {
  const a = queueItem({ productId: 1 });
  const b = queueItem({ productId: 2 });
  const c = queueItem({ productId: 3 });
  seedQueue(a, b, c);
  act(() => {
    useScanQueueStore.getState().updateQuantity(b.id, 3);
  });
  const { result } = renderHook(() => useScanQueue());

  act(() => result.current.openDeal());
  act(() => result.current.setDealDraft('10.01'));
  act(() => result.current.commitDeal());

  // Equal $5 unit offers, lines 5/15/5 (sum 25) → share 2.002 → 2.00 per
  // unit; total comes to 10.00 so the +0.01 leftover lands on the biggest
  // line — b's qty-3 line, not the first row.
  expect(
    useScanQueueStore.getState().items.map((i) => i.customOffer)
  ).toEqual([2, 2.01, 2]);
});

test('commitDeal ignores a non-numeric draft but still closes', () => {
  const a = queueItem({ productId: 1 });
  seedQueue(a);
  const { result } = renderHook(() => useScanQueue());

  act(() => result.current.openDeal());
  act(() => result.current.setDealDraft('abc'));
  act(() => result.current.commitDeal());

  expect(result.current.dealOpen).toBe(false);
  expect(
    useScanQueueStore.getState().items[0].customOffer
  ).toBeUndefined();
});

test('flush writes the queue to inventory, clears it, and calls onDone', async () => {
  const item = queueItem();
  seedQueue(item);
  const onDone = jest.fn();
  const { result } = renderHook(() => useScanQueue(onDone));

  await act(async () => {
    await result.current.flush();
  });

  expect(mockAddScannedCards).toHaveBeenCalledTimes(1);
  const inputs = mockAddScannedCards.mock.calls[0][0];
  expect(inputs).toHaveLength(1);
  expect(inputs[0]).toEqual(
    expect.objectContaining({
      productId: 1,
      name: 'Pikachu - 025/165',
      liveMarket: 10,
      condition: 'NM',
    })
  );
  expect(useScanQueueStore.getState().items).toEqual([]);
  expect(onDone).toHaveBeenCalledTimes(1);
  expect(result.current.isFlushing).toBe(false);
  expect(result.current.flushError).toBeNull();
});

test('flush expands quantity into per-unit inventory rows', async () => {
  const item = queueItem();
  seedQueue(item);
  act(() => {
    useScanQueueStore.getState().updateQuantity(item.id, 3);
  });
  const { result } = renderHook(() => useScanQueue());

  await act(async () => {
    await result.current.flush();
  });

  expect(mockAddScannedCards.mock.calls[0][0]).toHaveLength(3);
});

test('flush keeps the queue and reports the error when the write fails', async () => {
  const item = queueItem();
  seedQueue(item);
  mockAddScannedCards.mockRejectedValueOnce(
    new Error('disk full — could not write')
  );
  const onDone = jest.fn();
  const { result } = renderHook(() => useScanQueue(onDone));

  await act(async () => {
    await result.current.flush();
  });

  expect(result.current.flushError).toContain('disk full');
  expect(useScanQueueStore.getState().items).toHaveLength(1);
  expect(onDone).not.toHaveBeenCalled();
  expect(result.current.isFlushing).toBe(false);
});

test('a second flush while one is in flight is ignored', async () => {
  const item = queueItem();
  seedQueue(item);
  let resolveAdd!: () => void;
  mockAddScannedCards.mockImplementationOnce(
    () => new Promise<void>((r) => (resolveAdd = r))
  );
  const { result } = renderHook(() => useScanQueue());

  act(() => {
    void result.current.flush();
  });
  expect(result.current.isFlushing).toBe(true);

  await act(async () => {
    await result.current.flush();
  });
  expect(mockAddScannedCards).toHaveBeenCalledTimes(1);

  resolveAdd();
  await flushAsync();
  expect(result.current.isFlushing).toBe(false);
});

test('openViewer/closeViewer toggle the image viewer target', () => {
  const { result } = renderHook(() => useScanQueue());
  act(() => result.current.openViewer('file:///x.jpg', 'Pikachu'));
  expect(result.current.viewerFor).toEqual({
    uri: 'file:///x.jpg',
    name: 'Pikachu',
  });
  act(() => result.current.closeViewer());
  expect(result.current.viewerFor).toBeNull();
});

test('openAnalysis resolves a catalog match into the analysis sheet', async () => {
  const item = queueItem();
  seedQueue(item);
  const match: CatalogMatch = {
    card: catalogCard(),
    method: 'fused',
    confidence: 1,
  };
  mockMatchForCardRef.mockResolvedValue(match);
  const { result } = renderHook(() => useScanQueue());

  act(() => {
    result.current.openAnalysis(item);
  });
  await flushAsync();

  // The sheet gets the unconditioned base price, not the conditioned one.
  expect(mockMatchForCardRef).toHaveBeenCalledWith(
    expect.objectContaining({ productId: 1, marketPrice: 10 })
  );
  expect(result.current.analysisFor).toEqual({
    match,
    subType: 'Normal',
    ownership: undefined,
  });

  act(() => result.current.closeAnalysis());
  expect(result.current.analysisFor).toBeNull();
});
