import { act } from 'react';
import { mkInventoryCard } from './helpers/builders';
import { renderHook } from './helpers/renderHook';
import { useBulkSelection } from '../src/hooks/useBulkSelection';
import { useInventoryStore } from '../src/store/inventoryStore';

// Bulk sell/delete fan out through the store's getState() actions — swapped
// for jest.fns so the pin is the per-id fan-out, not the store internals
// (covered by their own suites). The hook never subscribes, so seeding the
// store needs no act().

const realSell = useInventoryStore.getState().sellInventoryCard;
const realRemove = useInventoryStore.getState().removeInventoryCard;
const mockSell = jest.fn(async (_id: string, _price?: number) => {});
const mockRemove = jest.fn(async (_id: string) => {});

beforeEach(() => {
  jest.clearAllMocks();
  useInventoryStore.setState({
    sellInventoryCard: mockSell,
    removeInventoryCard: mockRemove,
  });
});

afterAll(() => {
  useInventoryStore.setState({
    sellInventoryCard: realSell,
    removeInventoryCard: realRemove,
  });
});

test('long-press starts a selection that ends when the last card drops', () => {
  const { result } = renderHook(() => useBulkSelection());
  expect(result.current.selecting).toBe(false);

  const a = mkInventoryCard({ id: 'a' });
  const b = mkInventoryCard({ id: 'b' });
  act(() => result.current.handleStartSelect(a));
  expect([...result.current.selectedIds]).toEqual(['a']);
  expect(result.current.selecting).toBe(true);

  // Re-pressing an already-selected card doesn't double-add.
  act(() => result.current.handleStartSelect(a));
  expect(result.current.selectedIds.size).toBe(1);

  act(() => result.current.handleToggleSelect(b));
  expect(result.current.selectedIds.size).toBe(2);
  act(() => result.current.handleToggleSelect(b));
  act(() => result.current.handleToggleSelect(a));
  expect(result.current.selectedIds.size).toBe(0);
  expect(result.current.selecting).toBe(false);
});

test('the Select button enters a mode that survives zero selections', () => {
  const { result } = renderHook(() => useBulkSelection());
  act(() => result.current.toggleSelectionMode());
  expect(result.current.selecting).toBe(true);
  expect(result.current.selectedIds.size).toBe(0);

  // Toggle the only card back off — the mode holds because it was
  // entered via the button, not a long-press.
  const a = mkInventoryCard({ id: 'a' });
  act(() => result.current.handleToggleSelect(a));
  act(() => result.current.handleToggleSelect(a));
  expect(result.current.selecting).toBe(true);
});

test('cancelling selection mode clears picked ids and the armed delete', () => {
  const { result } = renderHook(() => useBulkSelection());
  act(() => result.current.toggleSelectionMode());
  act(() => result.current.handleToggleSelect(mkInventoryCard({ id: 'a' })));
  act(() => result.current.handleBulkDelete());
  expect(result.current.confirmBulkDelete).toBe(true);

  act(() => result.current.toggleSelectionMode());
  expect(result.current.selecting).toBe(false);
  expect(result.current.selectedIds.size).toBe(0);
  expect(result.current.confirmBulkDelete).toBe(false);
});

test('clearSelection drops ids, mode, and the armed delete', () => {
  const { result } = renderHook(() => useBulkSelection());
  act(() => result.current.toggleSelectionMode());
  act(() => result.current.handleToggleSelect(mkInventoryCard({ id: 'a' })));
  act(() => result.current.handleBulkDelete());

  act(() => result.current.clearSelection());
  expect(result.current.selecting).toBe(false);
  expect(result.current.selectedIds.size).toBe(0);
  expect(result.current.confirmBulkDelete).toBe(false);
});

test('handleBulkSell sells every selected id then clears the selection', () => {
  const { result } = renderHook(() => useBulkSelection());
  act(() => result.current.handleStartSelect(mkInventoryCard({ id: 'a' })));
  act(() => result.current.handleToggleSelect(mkInventoryCard({ id: 'b' })));

  act(() => result.current.handleBulkSell());

  expect(mockSell.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
  expect(mockRemove).not.toHaveBeenCalled();
  expect(result.current.selecting).toBe(false);
  expect(result.current.selectedIds.size).toBe(0);
});

test('handleBulkDelete is a two-tap confirm — first arms, second deletes', () => {
  const { result } = renderHook(() => useBulkSelection());
  act(() => result.current.handleStartSelect(mkInventoryCard({ id: 'a' })));
  act(() => result.current.handleToggleSelect(mkInventoryCard({ id: 'b' })));

  act(() => result.current.handleBulkDelete());
  expect(result.current.confirmBulkDelete).toBe(true);
  expect(mockRemove).not.toHaveBeenCalled();

  act(() => result.current.handleBulkDelete());
  expect(mockRemove.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
  expect(mockSell).not.toHaveBeenCalled();
  expect(result.current.confirmBulkDelete).toBe(false);
  expect(result.current.selecting).toBe(false);
});

test('the armed delete lapses after 3.5s without a second tap', () => {
  jest.useFakeTimers();
  try {
    const { result } = renderHook(() => useBulkSelection());
    act(() => result.current.handleStartSelect(mkInventoryCard({ id: 'a' })));

    act(() => result.current.handleBulkDelete());
    expect(result.current.confirmBulkDelete).toBe(true);

    act(() => {
      jest.advanceTimersByTime(3499);
    });
    expect(result.current.confirmBulkDelete).toBe(true);
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current.confirmBulkDelete).toBe(false);

    // A tap after the lapse re-arms rather than deleting.
    act(() => result.current.handleBulkDelete());
    expect(result.current.confirmBulkDelete).toBe(true);
    expect(mockRemove).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});
