import { act } from 'react';
import { mkVendorShow } from './helpers/builders';
import { renderHook } from './helpers/renderHook';
import { useShowForm } from '../src/hooks/useShowForm';
import { createShow, updateShow, type VendorShow } from '../src/services/showVendorService';

// The form's only outside seam is the worker write (createShow/updateShow) —
// both jest.fns. selected/setError/loadShows/loadRegs are injected by the
// screen's useOrganizerShows, so the tests pass jest.fns directly.

jest.mock('../src/services/showVendorService', () => ({
  createShow: jest.fn(),
  updateShow: jest.fn(),
}));

const mockCreate = jest.mocked(createShow);
const mockUpdate = jest.mocked(updateShow);

const SHOW = mkVendorShow({
  name: 'Spring Show',
  start_date: '2026-11-01',
  location: 'Hall A',
  table_count: 12,
  pay_instructions: 'Zelle @vendor',
});

type Hook = ReturnType<typeof useShowForm>;
type Props = Parameters<typeof useShowForm>[0];

const mkProps = (selected: VendorShow | null = null): Props => ({
  selected,
  setSelected: jest.fn(),
  setError: jest.fn(),
  loadShows: jest.fn(async () => {}),
  loadRegs: jest.fn(async () => {}),
});

const setup = (selected: VendorShow | null = null) => {
  const props = mkProps(selected);
  const { result } = renderHook((p: Props) => useShowForm(p), props);
  return { result, props };
};

const fill = (
  result: { current: Hook },
  fields: {
    name?: string;
    date?: string;
    location?: string;
    tables?: string;
    pay?: string;
  },
) => {
  act(() => {
    if (fields.name !== undefined) result.current.setFName(fields.name);
    if (fields.date !== undefined) result.current.setFDate(fields.date);
    if (fields.location !== undefined) result.current.setFLocation(fields.location);
    if (fields.tables !== undefined) result.current.setFTables(fields.tables);
    if (fields.pay !== undefined) result.current.setFPay(fields.pay);
  });
};

const save = (result: { current: Hook }) =>
  act(async () => {
    await result.current.saveShow();
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockResolvedValue(SHOW);
  mockUpdate.mockResolvedValue(undefined);
});

test('openNewShow opens a blank create form, wiping any edit drafts', () => {
  const { result } = setup(SHOW);
  act(() => result.current.openEditShow(SHOW));
  act(() => result.current.openNewShow());

  expect(result.current.showFormOpen).toBe(true);
  expect(result.current.editingShow).toBe(false);
  expect(result.current.fName).toBe('');
  expect(result.current.fDate).toBe('');
  expect(result.current.fLocation).toBe('');
  expect(result.current.fTables).toBe('');
  expect(result.current.fPay).toBe('');
});

test('openEditShow seeds the drafts from the show', () => {
  const { result } = setup(SHOW);
  act(() => result.current.openEditShow(SHOW));

  expect(result.current.showFormOpen).toBe(true);
  expect(result.current.editingShow).toBe(true);
  expect(result.current.fName).toBe('Spring Show');
  expect(result.current.fDate).toBe('2026-11-01');
  expect(result.current.fLocation).toBe('Hall A');
  expect(result.current.fTables).toBe('12');
  expect(result.current.fPay).toBe('Zelle @vendor');
});

test('openEditShow blanks the optional fields the show lacks', () => {
  const bare = mkVendorShow({ name: 'Bare', start_date: '', location: '' });
  const { result } = setup(bare);
  act(() => result.current.openEditShow(bare));

  expect(result.current.fTables).toBe('');
  expect(result.current.fPay).toBe('');
});

test('saveShow is a no-op until the name is non-blank', async () => {
  const { result } = setup();
  act(() => result.current.openNewShow());
  await save(result);
  expect(mockCreate).not.toHaveBeenCalled();

  fill(result, { name: '   ' });
  await save(result);
  expect(mockCreate).not.toHaveBeenCalled();
  expect(result.current.showFormOpen).toBe(true);
});

test('create posts trimmed fields, closes the form, and reloads shows only', async () => {
  const { result, props } = setup();
  act(() => result.current.openNewShow());
  fill(result, {
    name: '  New Show  ',
    date: ' 2026-12-01 ',
    location: ' Hall B ',
    tables: '20',
    pay: ' Cash only ',
  });
  await save(result);

  expect(mockCreate).toHaveBeenCalledWith({
    name: 'New Show',
    start_date: '2026-12-01',
    location: 'Hall B',
    table_count: 20,
    pay_instructions: 'Cash only',
  });
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(result.current.showFormOpen).toBe(false);
  expect(props.loadShows).toHaveBeenCalledTimes(1);
  // Regs reload is edit-only — a new show has no roster yet.
  expect(props.loadRegs).not.toHaveBeenCalled();
  expect(props.setSelected).not.toHaveBeenCalled();
  expect(result.current.saving).toBe(false);
});

test('table_count coercion: blank → null, non-numeric → 0, decimals floor', async () => {
  const { result } = setup();
  act(() => result.current.openNewShow());

  fill(result, { name: 'S', tables: '' });
  await save(result);
  expect(mockCreate).toHaveBeenLastCalledWith(expect.objectContaining({ table_count: null }));

  fill(result, { tables: 'abc' });
  await save(result);
  expect(mockCreate).toHaveBeenLastCalledWith(expect.objectContaining({ table_count: 0 }));

  fill(result, { tables: '12.9' });
  await save(result);
  expect(mockCreate).toHaveBeenLastCalledWith(expect.objectContaining({ table_count: 12 }));
});

test('editing patches the show, merges it into selected, and reloads regs', async () => {
  const { result, props } = setup(SHOW);
  act(() => result.current.openEditShow(SHOW));
  fill(result, { name: 'Spring Show v2', tables: '30' });
  await save(result);

  expect(mockUpdate).toHaveBeenCalledWith('show-1', {
    name: 'Spring Show v2',
    start_date: '2026-11-01',
    location: 'Hall A',
    table_count: 30,
    pay_instructions: 'Zelle @vendor',
  });
  expect(mockCreate).not.toHaveBeenCalled();
  expect(props.setSelected).toHaveBeenCalledWith({
    ...SHOW,
    name: 'Spring Show v2',
    start_date: '2026-11-01',
    location: 'Hall A',
    table_count: 30,
    pay_instructions: 'Zelle @vendor',
  });
  expect(props.loadShows).toHaveBeenCalledTimes(1);
  expect(props.loadRegs).toHaveBeenCalledWith('show-1');
});

test('the editing flag without a selected show falls back to create', async () => {
  const { result, props } = setup(null);
  act(() => result.current.openEditShow(SHOW));
  await save(result);

  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(props.setSelected).not.toHaveBeenCalled();
  expect(props.loadRegs).not.toHaveBeenCalled();
});

test('a save failure reports the error and keeps the form open', async () => {
  mockCreate.mockRejectedValueOnce('Request quota hit');
  const { result, props } = setup();
  act(() => result.current.openNewShow());
  fill(result, { name: 'X' });
  await save(result);

  expect(props.setError).toHaveBeenCalledWith('Request quota hit');
  expect(result.current.showFormOpen).toBe(true);
  expect(result.current.saving).toBe(false);
  expect(props.loadShows).not.toHaveBeenCalled();
});

test('saving is true only while the write is in flight', async () => {
  let resolveSave!: () => void;
  mockCreate.mockReturnValueOnce(new Promise<VendorShow>((r) => (resolveSave = () => r(SHOW))));
  const { result } = setup();
  act(() => result.current.openNewShow());
  fill(result, { name: 'X' });

  act(() => {
    void result.current.saveShow();
  });
  expect(result.current.saving).toBe(true);

  await act(async () => resolveSave());
  expect(result.current.saving).toBe(false);
});
