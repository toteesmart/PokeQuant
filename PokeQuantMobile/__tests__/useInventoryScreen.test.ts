import { act } from 'react';
import { Dimensions, type LayoutChangeEvent } from 'react-native';
import { mkInventoryCard } from './helpers/builders';
import { flushAsync, renderHook } from './helpers/renderHook';
import { useInventoryScreen } from '../src/hooks/useInventoryScreen';
import { useInventoryStore } from '../src/store/inventoryStore';
import { useProgressStore } from '../src/store/progressStore';
import { useWatchlistStore } from '../src/store/watchlistStore';
import { GRID_GAP } from '../src/components/InventoryCell';
import { layout } from '../src/constants/theme';
import { CATALOG_IMAGE_BASE } from '../src/constants/api';

// catalogDb is partially mocked: openCatalogDatabase failing fast keeps
// the hook's background deep-feature hydration from kicking off the real
// self-healing download; the hook's own catch leaves scalar reads standing.
// Everything else (pickSignalForFinish → signalForCard → buildStockHealth)
// stays real.
jest.mock('../src/db/catalogDb', () => {
  const actual = jest.requireActual<typeof import('../src/db/catalogDb')>('../src/db/catalogDb');
  return {
    ...actual,
    openCatalogDatabase: jest.fn(() => Promise.reject(new Error('no catalog in tests'))),
    getPriceSeriesBulk: jest.fn(async () => ({})),
  };
});

beforeEach(() => {
  act(() => {
    useInventoryStore.setState({
      activeInventory: [],
      isSyncing: false,
      pendingSyncCount: 0,
    });
    useProgressStore.setState({
      isCatalogReady: false,
      isExtracting: false,
    });
    useWatchlistStore.setState({ cards: {} });
  });
});

test('metrics aggregate the active inventory', async () => {
  act(() => {
    useInventoryStore.setState({
      activeInventory: [
        mkInventoryCard({ id: 'a', amountPaid: 5, stickerPrice: 10, projProfit: 5 }),
        mkInventoryCard({ id: 'b', amountPaid: 3, stickerPrice: 4, projProfit: 1 }),
      ],
    });
  });
  const { result } = renderHook(() => useInventoryScreen());
  await flushAsync();

  expect(result.current.metrics).toEqual({
    activeAssets: 2,
    totalCostBasis: 8,
    projectedSticker: 14,
    projectedProfit: 6,
  });
});

test('metrics are zeroed on an empty inventory', async () => {
  const { result } = renderHook(() => useInventoryScreen());
  await flushAsync();

  expect(result.current.metrics).toEqual({
    activeAssets: 0,
    totalCostBasis: 0,
    projectedSticker: 0,
    projectedProfit: 0,
  });
});

test('heroArtUri bleeds the top-sticker card art', async () => {
  act(() => {
    useInventoryStore.setState({
      activeInventory: [
        mkInventoryCard({ id: 'a', stickerPrice: 10, imageUrl: 'https://img.example/a.png' }),
        mkInventoryCard({ id: 'b', stickerPrice: 40, imageUrl: 'https://img.example/b.png' }),
      ],
    });
  });
  const { result } = renderHook(() => useInventoryScreen());
  await flushAsync();

  expect(result.current.heroArtUri).toBe('https://img.example/b.png');
});

test('heroArtUri re-derives a reproducible imageUrl from productId', async () => {
  act(() => {
    useInventoryStore.setState({
      activeInventory: [
        // file:// paths are device-local — the hero must rebuild from the
        // catalog CDN like the row itself does.
        mkInventoryCard({
          id: 'a',
          stickerPrice: 10,
          imageUrl: 'file:///old-install/cache/1.jpg',
          productId: 55,
        }),
      ],
    });
  });
  const { result } = renderHook(() => useInventoryScreen());
  await flushAsync();

  expect(result.current.heroArtUri).toBe(`${CATALOG_IMAGE_BASE}/55_400w.jpg`);
});

test('heroArtUri re-derives a CDN-base imageUrl from productId', async () => {
  act(() => {
    useInventoryStore.setState({
      activeInventory: [
        // A stale catalog-CDN URL (wrong product in the filename) is
        // reproducible — the hero rebuilds it from productId, not passthrough.
        mkInventoryCard({
          id: 'a',
          stickerPrice: 10,
          imageUrl: `${CATALOG_IMAGE_BASE}/999_400w.jpg`,
          productId: 55,
        }),
      ],
    });
  });
  const { result } = renderHook(() => useInventoryScreen());
  await flushAsync();

  expect(result.current.heroArtUri).toBe(`${CATALOG_IMAGE_BASE}/55_400w.jpg`);
});

test('heroArtUri is undefined with no inventory', async () => {
  const { result } = renderHook(() => useInventoryScreen());
  await flushAsync();
  expect(result.current.heroArtUri).toBeUndefined();
});

test('filteredInventory searches the normalized haystack', async () => {
  const pika = mkInventoryCard({ id: 'a', name: 'Pikachu', number: '025' });
  const farfetch = mkInventoryCard({
    id: 'b',
    name: "Farfetch'd",
    number: '083',
    set: 'Base Set',
  });
  act(() => {
    useInventoryStore.setState({ activeInventory: [pika, farfetch] });
  });
  const { result } = renderHook(() => useInventoryScreen());
  await flushAsync();

  expect(result.current.filteredInventory).toEqual([pika, farfetch]);

  act(() => result.current.setSearchQuery('pika'));
  expect(result.current.filteredInventory).toEqual([pika]);

  act(() => result.current.setSearchQuery('farfetchd'));
  expect(result.current.filteredInventory).toEqual([farfetch]);

  act(() => result.current.setSearchQuery('  '));
  expect(result.current.filteredInventory).toEqual([pika, farfetch]);
});

test('cellWidth splits the window into two columns minus gaps', async () => {
  const { result } = renderHook(() => useInventoryScreen());
  await flushAsync();

  const width = Dimensions.get('window').width;
  expect(result.current.cellWidth).toBe(
    Math.max(0, Math.floor((width - layout.screenPadding * 2 - GRID_GAP) / 2)),
  );
});

test('handleEdit opens the edit sheet on a card', async () => {
  const card = mkInventoryCard({ id: 'a' });
  act(() => {
    useInventoryStore.setState({ activeInventory: [card] });
  });
  const { result } = renderHook(() => useInventoryScreen());
  await flushAsync();

  expect(result.current.editingCard).toBeNull();
  act(() => result.current.handleEdit(card));
  expect(result.current.editingCard).toBe(card);
  act(() => result.current.setEditingCard(null));
  expect(result.current.editingCard).toBeNull();
});

test('no signals yet → buckets empty but totals still counted', async () => {
  act(() => {
    useInventoryStore.setState({
      activeInventory: [
        mkInventoryCard({ id: 'a', liveMarket: 10, amountPaid: 5 }),
        mkInventoryCard({ id: 'b', liveMarket: 20, amountPaid: 8 }),
      ],
    });
  });
  const { result } = renderHook(() => useInventoryScreen());
  await flushAsync();

  // Catalog gate is closed (isCatalogReady false) — signal reads stay
  // empty, so nothing classifies, but the portfolio totals still sum.
  expect(result.current.health.totalValue).toBe(30);
  expect(result.current.health.totalCost).toBe(13);
  expect(result.current.health.items).toEqual([]);
  expect(result.current.watchItems).toEqual([]);
  expect(result.current.signals.signalMap).toEqual({});
});

test('handleScrollLayout stores the viewport', async () => {
  const { result } = renderHook(() => useInventoryScreen());
  await flushAsync();

  act(() => {
    result.current.handleScrollLayout({
      nativeEvent: { layout: { width: 400, height: 800 } },
    } as LayoutChangeEvent);
  });
  expect(result.current.viewport).toEqual({ width: 400, height: 800 });
});
