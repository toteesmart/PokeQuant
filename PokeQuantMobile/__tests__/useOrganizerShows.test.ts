import { act } from 'react';
import { mkReg, mkVendorShow } from './helpers/builders';
import { flushAsync, renderHook } from './helpers/renderHook';
import { useOrganizerShows } from '../src/hooks/useOrganizerShows';
import {
  getShowRegistrations,
  getVendorShows,
} from '../src/services/showVendorService';

// Seam map: getVendorShows/getShowRegistrations are the worker calls —
// jest.fns. The mount load is deferred one tick by the hook (setTimeout 0),
// so flushAsync() drains it.

jest.mock('../src/services/showVendorService', () => ({
  getVendorShows: jest.fn(),
  getShowRegistrations: jest.fn(),
}));

const mockGetShows = jest.mocked(getVendorShows);
const mockGetRegs = jest.mocked(getShowRegistrations);

const SHOW = mkVendorShow({ my_status: 'owner' });

beforeEach(() => {
  jest.clearAllMocks();
  mockGetShows.mockResolvedValue([]);
  mockGetRegs.mockResolvedValue([]);
});

test('mount loads shows once and keeps only owned rows', async () => {
  mockGetShows.mockResolvedValue([
    mkVendorShow({ id: 'own', my_status: 'owner' }),
    mkVendorShow({ id: 'sell', my_status: 'approved' }),
    mkVendorShow({ id: 'wait', my_status: 'pending' }),
    mkVendorShow({ id: 'deny', my_status: 'rejected' }),
  ]);
  const { result } = renderHook(() => useOrganizerShows());

  // The deferred load hasn't resolved yet.
  expect(result.current.loading).toBe(true);

  await flushAsync();
  expect(mockGetShows).toHaveBeenCalledTimes(1);
  expect(result.current.shows.map((s) => s.id)).toEqual(['own']);
  expect(result.current.loading).toBe(false);
  expect(result.current.error).toBeNull();
});

test('a loadShows failure lands in error and clears loading', async () => {
  mockGetShows.mockRejectedValue('Request quota hit');
  const { result } = renderHook(() => useOrganizerShows());
  await flushAsync();

  expect(result.current.error).toBe('Request quota hit');
  expect(result.current.shows).toEqual([]);
  expect(result.current.loading).toBe(false);
});

test('a loadShows re-run clears a prior error', async () => {
  mockGetShows.mockRejectedValueOnce('boom');
  const { result } = renderHook(() => useOrganizerShows());
  await flushAsync();
  expect(result.current.error).toBe('boom');

  mockGetShows.mockResolvedValue([SHOW]);
  await act(async () => {
    await result.current.loadShows();
  });
  expect(result.current.error).toBeNull();
  expect(result.current.shows).toEqual([SHOW]);
});

test('openDetail selects the show and pulls its registrations', async () => {
  const regs = [mkReg({ vendorId: 'v-1' }), mkReg({ vendorId: 'manual:x' })];
  mockGetRegs.mockResolvedValue(regs);
  const { result } = renderHook(() => useOrganizerShows());
  await flushAsync();

  act(() => result.current.openDetail(mkVendorShow({ id: 'show-9' })));
  expect(result.current.selected?.id).toBe('show-9');
  await flushAsync();

  expect(mockGetRegs).toHaveBeenCalledWith('show-9');
  expect(result.current.registrations).toEqual(regs);
});

test('refreshSelected reloads regs only while a show is selected', async () => {
  const { result } = renderHook(() => useOrganizerShows());
  await flushAsync();

  act(() => result.current.refreshSelected());
  expect(mockGetRegs).not.toHaveBeenCalled();

  act(() => result.current.openDetail(SHOW));
  await flushAsync();
  mockGetRegs.mockClear();

  act(() => result.current.refreshSelected());
  await flushAsync();
  expect(mockGetRegs).toHaveBeenCalledWith('show-1');
});

test('a loadRegs failure reports the error without touching the selection', async () => {
  mockGetRegs.mockRejectedValue('Request quota hit');
  const { result } = renderHook(() => useOrganizerShows());
  await flushAsync();

  act(() => result.current.openDetail(SHOW));
  await flushAsync();

  expect(result.current.selected).toBe(SHOW);
  expect(result.current.error).toBe('Request quota hit');
  expect(result.current.registrations).toEqual([]);
});
