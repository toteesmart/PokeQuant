import { act } from 'react';
import { mkVendorShow } from './helpers/builders';
import { renderHook } from './helpers/renderHook';
import { useVendorAdd } from '../src/hooks/useVendorAdd';
import {
  addShowRegistration,
  listVendors,
  type VendorShow,
} from '../src/services/showVendorService';

// Seam map: listVendors/addShowRegistration are the worker calls — jest.fns.
// selected/setError/refreshSelected are injected by the screen's
// useOrganizerShows, so the tests drive jest.fns directly.

jest.mock('../src/services/showVendorService', () => ({
  addShowRegistration: jest.fn(),
  listVendors: jest.fn(),
}));

const mockList = jest.mocked(listVendors);
const mockAdd = jest.mocked(addShowRegistration);

const SHOW = mkVendorShow();

type Props = Parameters<typeof useVendorAdd>[0];

const mkProps = (selected: VendorShow | null = SHOW): Props => ({
  selected,
  setError: jest.fn(),
  refreshSelected: jest.fn(async () => {}),
});

const setup = (selected: VendorShow | null = SHOW) => {
  const props = mkProps(selected);
  const { result } = renderHook((p: Props) => useVendorAdd(p), props);
  return { result, props };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockResolvedValue([]);
  mockAdd.mockResolvedValue(undefined);
});

test('openAddVendor opens the sheet fresh and loads the app-vendor list', async () => {
  mockList.mockResolvedValue([
    { id: 'v-1', name: 'Vendor One' },
    { id: 'v-2', name: 'Vendor Two' },
  ]);
  const { result } = setup();

  // Dirty every field first to prove the reset.
  act(() => {
    result.current.setManualMode(true);
    result.current.setPickedVendor({ id: 'v-9', name: 'Stale' });
    result.current.setMName('Bob');
    result.current.setMPhone('1');
    result.current.setMTable('2');
    result.current.setMDue('3');
  });
  await act(async () => {
    await result.current.openAddVendor();
  });

  expect(result.current.addOpen).toBe(true);
  expect(result.current.manualMode).toBe(false);
  expect(result.current.pickedVendor).toBeNull();
  expect(result.current.mName).toBe('');
  expect(result.current.mPhone).toBe('');
  expect(result.current.mTable).toBe('');
  expect(result.current.mDue).toBe('');
  expect(result.current.appVendors).toEqual([
    { id: 'v-1', name: 'Vendor One' },
    { id: 'v-2', name: 'Vendor Two' },
  ]);
});

test('a listVendors failure reports the error but still opens the sheet', async () => {
  mockList.mockRejectedValueOnce('offline');
  const { result, props } = setup();

  await act(async () => {
    await result.current.openAddVendor();
  });

  expect(props.setError).toHaveBeenCalledWith('offline');
  expect(result.current.addOpen).toBe(true);
  expect(result.current.appVendors).toEqual([]);
});

test('attachVendor is a no-op without a picked vendor or a selected show', async () => {
  const { result } = setup();
  await act(async () => {
    await result.current.attachVendor();
  });
  expect(mockAdd).not.toHaveBeenCalled();

  const noShow = setup(null);
  act(() => noShow.result.current.setPickedVendor({ id: 'v-1', name: 'V' }));
  await act(async () => {
    await noShow.result.current.attachVendor();
  });
  expect(mockAdd).not.toHaveBeenCalled();
});

test('attachVendor posts the picked id plus the shared manual fields', async () => {
  const { result, props } = setup();
  await act(async () => {
    await result.current.openAddVendor();
  });
  act(() => {
    result.current.setPickedVendor({ id: 'v-7', name: 'Vendor Seven' });
    result.current.setMPhone(' 555-0100 ');
    result.current.setMTable(' 12 ');
    result.current.setMDue(' 45 ');
  });
  await act(async () => {
    await result.current.attachVendor();
  });

  // The phone field feeds manual_phone even on the app-vendor path.
  expect(mockAdd).toHaveBeenCalledWith('show-1', {
    vendor_id: 'v-7',
    manual_phone: '555-0100',
    table_number: '12',
    total_due: 45,
  });
  expect(result.current.addOpen).toBe(false);
  expect(props.refreshSelected).toHaveBeenCalledTimes(1);
  expect(props.setError).not.toHaveBeenCalled();
});

test('attachManual posts manual_name with no vendor_id', async () => {
  const { result, props } = setup();
  act(() => result.current.setManualMode(true));
  act(() => {
    result.current.setMName(' Walk-in Bob ');
    result.current.setMPhone('555-0199');
    result.current.setMTable('3');
    result.current.setMDue('60');
  });
  await act(async () => {
    await result.current.attachManual();
  });

  expect(mockAdd).toHaveBeenCalledWith('show-1', {
    manual_name: 'Walk-in Bob',
    manual_phone: '555-0199',
    table_number: '3',
    total_due: 60,
  });
  expect(result.current.addOpen).toBe(false);
  expect(props.refreshSelected).toHaveBeenCalledTimes(1);
});

test('attachManual is a no-op on a blank name or missing show', async () => {
  const { result } = setup();
  await act(async () => {
    await result.current.attachManual();
  });

  act(() => result.current.setMName('   '));
  await act(async () => {
    await result.current.attachManual();
  });
  expect(mockAdd).not.toHaveBeenCalled();

  const noShow = setup(null);
  act(() => noShow.result.current.setMName('Bob'));
  await act(async () => {
    await noShow.result.current.attachManual();
  });
  expect(mockAdd).not.toHaveBeenCalled();
});

test('total_due coercion: blank and non-numeric collapse to 0', async () => {
  const { result } = setup();

  act(() => result.current.setMName('Bob'));
  await act(async () => {
    await result.current.attachManual();
  });
  expect(mockAdd).toHaveBeenLastCalledWith(
    'show-1',
    expect.objectContaining({ total_due: 0 })
  );

  act(() => result.current.setMDue('abc'));
  await act(async () => {
    await result.current.attachManual();
  });
  expect(mockAdd).toHaveBeenLastCalledWith(
    'show-1',
    expect.objectContaining({ total_due: 0 })
  );
});

test('an attach failure keeps the sheet open and reports the error', async () => {
  mockAdd.mockRejectedValueOnce('Request quota hit');
  const { result, props } = setup();
  await act(async () => {
    await result.current.openAddVendor();
  });
  act(() => result.current.setMName('Bob'));

  await act(async () => {
    await result.current.attachManual();
  });

  expect(props.setError).toHaveBeenCalledWith('Request quota hit');
  expect(result.current.addOpen).toBe(true);
  expect(props.refreshSelected).not.toHaveBeenCalled();
});
