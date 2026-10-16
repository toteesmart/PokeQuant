import { act } from 'react';
import { Alert, type AlertButton } from 'react-native';
import { mkReg, mkVendorShow } from './helpers/builders';
import { flushAsync, renderHook } from './helpers/renderHook';
import { useRegActions } from '../src/hooks/useRegActions';
import {
  updateShow,
  updateShowRegistration,
  type VendorShow,
} from '../src/services/showVendorService';
import { sendReminderSms } from '../src/services/organizerText';

// The hook talks to the worker through showVendorService and opens Messages
// through organizerText.sendReminderSms — both are jest.fns so nothing
// leaves the device. displayName stays real so the SMS body pins the
// manual/vendor name resolution. selected/setSelected/setError/loadShows/
// refreshSelected are injected by the screen's useOrganizerShows, so the
// tests pass jest.fns directly — no store involved.

jest.mock('../src/services/showVendorService', () => ({
  updateShow: jest.fn(),
  updateShowRegistration: jest.fn(),
}));

jest.mock('../src/services/organizerText', () => ({
  ...jest.requireActual('../src/services/organizerText'),
  sendReminderSms: jest.fn(),
}));

const mockUpdateShow = jest.mocked(updateShow);
const mockUpdateReg = jest.mocked(updateShowRegistration);
const mockSms = jest.mocked(sendReminderSms);
const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

const SHOW = mkVendorShow();

type Hook = ReturnType<typeof useRegActions>;
type Props = {
  selected: VendorShow | null;
  setSelected: jest.Mock;
  setError: jest.Mock;
  loadShows: jest.Mock;
  refreshSelected: jest.Mock;
};

const mkProps = (selected: VendorShow | null = SHOW): Props => ({
  selected,
  setSelected: jest.fn(),
  setError: jest.fn(),
  loadShows: jest.fn(async () => {}),
  refreshSelected: jest.fn(async () => {}),
});

// Mounts the hook and returns result + props. Props is a stable object so
// assertions can read the injected fns after the fact.
const setup = (selected: VendorShow | null = SHOW) => {
  const props = mkProps(selected);
  const { result } = renderHook((p: Props) => useRegActions(p), props);
  return { result, props };
};

// Grabs the buttons passed to the most recent Alert.alert and presses the
// one matching `text`, awaiting its (async) onPress inside act.
const pressAlertButton = async (text: string) => {
  const calls = alertSpy.mock.calls;
  const buttons = (calls[calls.length - 1]?.[2] ?? []) as AlertButton[];
  const button = buttons.find((b) => b.text === text);
  expect(button).toBeDefined();
  await act(async () => {
    await button!.onPress?.();
  });
};

// Opens a modal then sets draft fields, all inside act so the committed
// callbacks see the latest state.
const openApproveWith = (
  result: { current: Hook },
  reg: ReturnType<typeof mkReg>,
  drafts: { table?: string; due?: string; phone?: string } = {},
) => {
  act(() => result.current.openApprove(reg));
  act(() => {
    if (drafts.table !== undefined) result.current.setATable(drafts.table);
    if (drafts.due !== undefined) result.current.setADue(drafts.due);
    if (drafts.phone !== undefined) result.current.setAPhone(drafts.phone);
  });
};

const openPayWith = (
  result: { current: Hook },
  reg: ReturnType<typeof mkReg>,
  drafts: { amount?: string; due?: string } = {},
) => {
  act(() => result.current.openPay(reg));
  act(() => {
    if (drafts.amount !== undefined) result.current.setPayAmount(drafts.amount);
    if (drafts.due !== undefined) result.current.setPayDue(drafts.due);
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateShow.mockResolvedValue(undefined);
  mockUpdateReg.mockResolvedValue(undefined);
});

// ---------- confirmUnpublish ----------

test('confirmUnpublish is a no-op without a selected show', async () => {
  const { result } = setup(null);
  act(() => result.current.confirmUnpublish());
  expect(alertSpy).not.toHaveBeenCalled();
});

test('confirmUnpublish asks before touching the worker; Unpublish deactivates, deselects, reloads', async () => {
  const { result, props } = setup();

  act(() => result.current.confirmUnpublish());

  expect(alertSpy).toHaveBeenCalledTimes(1);
  const [title, , buttons] = alertSpy.mock.calls[0];
  expect(title).toBe('Unpublish show?');
  expect(buttons?.[0]).toMatchObject({ text: 'Cancel', style: 'cancel' });
  expect(buttons?.[1]).toMatchObject({ text: 'Unpublish', style: 'destructive' });
  // Nothing commits until the destructive button is pressed.
  expect(mockUpdateShow).not.toHaveBeenCalled();

  await pressAlertButton('Unpublish');

  expect(mockUpdateShow).toHaveBeenCalledWith('show-1', { is_active: false });
  expect(props.setSelected).toHaveBeenCalledWith(null);
  expect(props.loadShows).toHaveBeenCalledTimes(1);
  // Order: worker write → clear selection → reload the list.
  expect(mockUpdateShow.mock.invocationCallOrder[0]).toBeLessThan(
    props.setSelected.mock.invocationCallOrder[0],
  );
  expect(props.setSelected.mock.invocationCallOrder[0]).toBeLessThan(
    props.loadShows.mock.invocationCallOrder[0],
  );
  expect(props.setError).not.toHaveBeenCalled();
});

test('an unpublish failure reports the error and leaves the selection alone', async () => {
  mockUpdateShow.mockRejectedValueOnce('Request quota hit');
  const { result, props } = setup();

  act(() => result.current.confirmUnpublish());
  await pressAlertButton('Unpublish');

  expect(props.setError).toHaveBeenCalledWith('Request quota hit');
  expect(props.setSelected).not.toHaveBeenCalled();
  expect(props.loadShows).not.toHaveBeenCalled();
});

// ---------- approve ----------

test('openApprove seeds the modal drafts from the registration', async () => {
  const { result } = setup();
  const reg = mkReg({ tableNumber: '7', totalDue: 40, manualPhone: '555-0100' });

  act(() => result.current.openApprove(reg));

  expect(result.current.approveTarget).toBe(reg);
  expect(result.current.aTable).toBe('7');
  expect(result.current.aDue).toBe('40');
  expect(result.current.aPhone).toBe('555-0100');

  // Zero due → blank field, not '0'.
  act(() => result.current.openApprove(mkReg({ totalDue: 0 })));
  expect(result.current.aDue).toBe('');
});

test('commitApprove posts trimmed fields, closes the modal, and refreshes', async () => {
  const { result, props } = setup();
  const reg = mkReg({ vendorId: 'vendor-9' });
  openApproveWith(result, reg, {
    table: ' 12 ',
    due: ' 45 ',
    phone: ' 555-0100 ',
  });

  await act(async () => {
    await result.current.commitApprove();
  });

  expect(mockUpdateReg).toHaveBeenCalledWith('show-1', 'vendor-9', {
    status: 'approved',
    table_number: '12',
    total_due: 45,
    manual_phone: '555-0100',
  });
  expect(result.current.approveTarget).toBeNull();
  expect(props.refreshSelected).toHaveBeenCalledTimes(1);
  expect(props.setError).not.toHaveBeenCalled();
});

test('commitApprove coerces blank and non-numeric dues to 0', async () => {
  const { result } = setup();

  openApproveWith(result, mkReg({ vendorId: 'v-blank' }), { due: '   ' });
  await act(async () => {
    await result.current.commitApprove();
  });
  expect(mockUpdateReg).toHaveBeenLastCalledWith(
    'show-1',
    'v-blank',
    expect.objectContaining({ total_due: 0 }),
  );

  openApproveWith(result, mkReg({ vendorId: 'v-text' }), { due: 'abc' });
  await act(async () => {
    await result.current.commitApprove();
  });
  expect(mockUpdateReg).toHaveBeenLastCalledWith(
    'show-1',
    'v-text',
    expect.objectContaining({ total_due: 0 }),
  );
});

test('commitApprove is a no-op without a target or a selected show', async () => {
  const { result } = setup();

  // No target opened.
  await act(async () => {
    await result.current.commitApprove();
  });
  expect(mockUpdateReg).not.toHaveBeenCalled();

  // Target open but show deselected.
  const noShow = setup(null);
  act(() => noShow.result.current.openApprove(mkReg()));
  await act(async () => {
    await noShow.result.current.commitApprove();
  });
  expect(mockUpdateReg).not.toHaveBeenCalled();
});

test('an approve failure keeps the modal open and reports the error', async () => {
  mockUpdateReg.mockRejectedValueOnce('Request quota hit');
  const { result, props } = setup();
  const reg = mkReg();
  act(() => result.current.openApprove(reg));

  await act(async () => {
    await result.current.commitApprove();
  });

  expect(props.setError).toHaveBeenCalledWith('Request quota hit');
  expect(result.current.approveTarget).toBe(reg);
  expect(props.refreshSelected).not.toHaveBeenCalled();
});

// ---------- reject ----------

test('commitReject posts a rejected status and refreshes', async () => {
  const { result, props } = setup();
  const reg = mkReg({ vendorId: 'vendor-7' });

  await act(async () => {
    await result.current.commitReject(reg);
  });

  expect(mockUpdateReg).toHaveBeenCalledWith('show-1', 'vendor-7', {
    status: 'rejected',
  });
  expect(props.refreshSelected).toHaveBeenCalledTimes(1);
});

test('commitReject is a no-op without a selected show; failures report the error', async () => {
  const noShow = setup(null);
  await act(async () => {
    await noShow.result.current.commitReject(mkReg());
  });
  expect(mockUpdateReg).not.toHaveBeenCalled();

  mockUpdateReg.mockRejectedValueOnce('Request quota hit');
  const { result, props } = setup();
  await act(async () => {
    await result.current.commitReject(mkReg());
  });
  expect(props.setError).toHaveBeenCalledWith('Request quota hit');
  expect(props.refreshSelected).not.toHaveBeenCalled();
});

// ---------- record payment ----------

test('openPay seeds a blank amount and the due from the registration', async () => {
  const { result } = setup();
  const reg = mkReg({ totalDue: 50 });

  act(() => result.current.openPay(reg));
  expect(result.current.payTarget).toBe(reg);
  expect(result.current.payAmount).toBe('');
  expect(result.current.payDue).toBe('50');

  act(() => result.current.openPay(mkReg({ totalDue: 0 })));
  expect(result.current.payDue).toBe('');
});

test('commitPay posts a partial payment capped at the due', async () => {
  const { result, props } = setup();
  const reg = mkReg({ vendorId: 'vendor-3', totalDue: 50, paidAmount: 20 });

  openPayWith(result, reg, { amount: '15' });
  await act(async () => {
    await result.current.commitPay();
  });

  expect(mockUpdateReg).toHaveBeenCalledWith('show-1', 'vendor-3', {
    paid_amount: 35,
    total_due: 50,
  });
  expect(result.current.payTarget).toBeNull();
  expect(props.refreshSelected).toHaveBeenCalledTimes(1);

  // Overpaying clamps paid_amount to the due.
  act(() => result.current.openPay(reg));
  act(() => result.current.setPayAmount('40'));
  await act(async () => {
    await result.current.commitPay();
  });
  expect(mockUpdateReg).toHaveBeenLastCalledWith('show-1', 'vendor-3', {
    paid_amount: 50,
    total_due: 50,
  });
});

test('commitPay uses an edited due, falling back to the registration due when blank', async () => {
  const { result } = setup();
  const reg = mkReg({ vendorId: 'vendor-4', totalDue: 50, paidAmount: 20 });

  // Organizer edits the total up → new due is honored.
  openPayWith(result, reg, { amount: '10', due: '80' });
  await act(async () => {
    await result.current.commitPay();
  });
  expect(mockUpdateReg).toHaveBeenLastCalledWith('show-1', 'vendor-4', {
    paid_amount: 30,
    total_due: 80,
  });

  // Blank due → falls back to reg.totalDue.
  openPayWith(result, reg, { amount: '10', due: '  ' });
  await act(async () => {
    await result.current.commitPay();
  });
  expect(mockUpdateReg).toHaveBeenLastCalledWith('show-1', 'vendor-4', {
    paid_amount: 30,
    total_due: 50,
  });
});

test('commitPay without an amount stays open with a notice — no worker call', async () => {
  const { result, props } = setup();
  const reg = mkReg({ totalDue: 50 });

  // Empty amount.
  act(() => result.current.openPay(reg));
  await act(async () => {
    await result.current.commitPay();
  });
  expect(props.setError).toHaveBeenCalledWith('Enter a payment amount first.');
  expect(mockUpdateReg).not.toHaveBeenCalled();
  expect(result.current.payTarget).toBe(reg);

  // Zero / negative amounts hit the same guard.
  act(() => result.current.setPayAmount('0'));
  await act(async () => {
    await result.current.commitPay();
  });
  act(() => result.current.setPayAmount('-5'));
  await act(async () => {
    await result.current.commitPay();
  });
  expect(props.setError).toHaveBeenCalledTimes(3);
  expect(mockUpdateReg).not.toHaveBeenCalled();
  expect(result.current.payTarget).toBe(reg);
});

test('commitPay(true) marks paid-in-full even with an empty amount field', async () => {
  const { result } = setup();
  const reg = mkReg({ vendorId: 'vendor-5', totalDue: 50, paidAmount: 20 });

  act(() => result.current.openPay(reg));
  await act(async () => {
    await result.current.commitPay(true);
  });
  expect(mockUpdateReg).toHaveBeenCalledWith('show-1', 'vendor-5', {
    paid_amount: 50,
    total_due: 50,
  });
  expect(result.current.payTarget).toBeNull();

  // Overpaid + "paid in full" clamps paid_amount back down to the due.
  const overpaid = mkReg({ vendorId: 'vendor-6', totalDue: 50, paidAmount: 60 });
  act(() => result.current.openPay(overpaid));
  await act(async () => {
    await result.current.commitPay(true);
  });
  expect(mockUpdateReg).toHaveBeenLastCalledWith('show-1', 'vendor-6', {
    paid_amount: 50,
    total_due: 50,
  });
});

test('commitPay is a no-op without a target; failures keep the modal open', async () => {
  const { result, props } = setup();

  await act(async () => {
    await result.current.commitPay();
  });
  expect(mockUpdateReg).not.toHaveBeenCalled();

  mockUpdateReg.mockRejectedValueOnce('Request quota hit');
  const reg = mkReg();
  openPayWith(result, reg, { amount: '10' });
  await act(async () => {
    await result.current.commitPay();
  });
  expect(props.setError).toHaveBeenCalledWith('Request quota hit');
  expect(result.current.payTarget).toBe(reg);
  expect(props.refreshSelected).not.toHaveBeenCalled();
});

// ---------- assign table ----------

test('openAssign seeds the current table; commitAssign posts it trimmed', async () => {
  const { result, props } = setup();
  const reg = mkReg({ vendorId: 'vendor-8', tableNumber: '4' });

  act(() => result.current.openAssign(reg));
  expect(result.current.assignTarget).toBe(reg);
  expect(result.current.assignTable).toBe('4');

  act(() => result.current.setAssignTable(' 9 '));
  await act(async () => {
    await result.current.commitAssign();
  });

  expect(mockUpdateReg).toHaveBeenCalledWith('show-1', 'vendor-8', {
    table_number: '9',
  });
  expect(result.current.assignTarget).toBeNull();
  expect(props.refreshSelected).toHaveBeenCalledTimes(1);
});

test('commitAssign is a no-op without a target or show; failures keep the modal open', async () => {
  const { result, props } = setup();

  await act(async () => {
    await result.current.commitAssign();
  });
  expect(mockUpdateReg).not.toHaveBeenCalled();

  const noShow = setup(null);
  act(() => noShow.result.current.openAssign(mkReg()));
  await act(async () => {
    await noShow.result.current.commitAssign();
  });
  expect(mockUpdateReg).not.toHaveBeenCalled();

  mockUpdateReg.mockRejectedValueOnce('Request quota hit');
  const reg = mkReg();
  act(() => result.current.openAssign(reg));
  await act(async () => {
    await result.current.commitAssign();
  });
  expect(props.setError).toHaveBeenCalledWith('Request quota hit');
  expect(result.current.assignTarget).toBe(reg);
});

// ---------- remind ----------

test('handleRemind texts immediately when a phone is on file', async () => {
  const { result } = setup();
  const reg = mkReg({
    vendorName: 'Vendor One',
    manualPhone: '555-0100',
    totalDue: 50,
    paidAmount: 20,
  });

  act(() => result.current.handleRemind(reg));

  expect(mockSms).toHaveBeenCalledWith(
    '555-0100',
    'Hi Vendor One, your table balance for Test Show (2026-10-24) is $30.00.',
  );
  // No modal — the phone was already known.
  expect(result.current.remindTarget).toBeNull();
});

test('handleRemind drops the date parenthetical when the show has no start_date', async () => {
  const noDate = mkVendorShow({ start_date: '' });
  const { result } = setup(noDate);
  const reg = mkReg({ manualPhone: '555-0100', totalDue: 10, paidAmount: 0 });

  act(() => result.current.handleRemind(reg));

  expect(mockSms).toHaveBeenCalledWith(
    '555-0100',
    'Hi Vendor One, your table balance for Test Show is $10.00.',
  );
});

test('handleRemind names manual vendors by manualName', async () => {
  const { result } = setup();
  const reg = mkReg({
    isManual: true,
    vendorName: '',
    manualName: 'Walk-in Bob',
    manualPhone: '555-0100',
    totalDue: 10,
    paidAmount: 0,
  });

  act(() => result.current.handleRemind(reg));

  expect(mockSms).toHaveBeenCalledWith(
    '555-0100',
    'Hi Walk-in Bob, your table balance for Test Show (2026-10-24) is $10.00.',
  );
});

test('handleRemind without a phone opens the collection modal instead', async () => {
  const { result } = setup();
  const reg = mkReg({ manualPhone: '' });

  act(() => result.current.handleRemind(reg));

  expect(mockSms).not.toHaveBeenCalled();
  expect(result.current.remindTarget).toBe(reg);
  expect(result.current.remindPhone).toBe('');
});

test('handleRemind is a no-op without a selected show', async () => {
  const { result } = setup(null);
  act(() => result.current.handleRemind(mkReg({ manualPhone: '555-0100' })));
  expect(mockSms).not.toHaveBeenCalled();
  expect(result.current.remindTarget).toBeNull();
});

test('commitRemind saves the phone, texts it, closes, and refreshes', async () => {
  const { result, props } = setup();
  const reg = mkReg({
    vendorId: 'manual:abc',
    vendorName: 'Walk-in Bob',
    isManual: true,
    manualName: 'Walk-in Bob',
    manualPhone: '',
    totalDue: 50,
    paidAmount: 20,
  });

  act(() => result.current.handleRemind(reg));
  act(() => result.current.setRemindPhone(' 555-0199 '));

  await act(async () => {
    await result.current.commitRemind();
  });

  // Phone is persisted on the registration before the SMS goes out.
  expect(mockUpdateReg).toHaveBeenCalledWith('show-1', 'manual:abc', {
    manual_phone: '555-0199',
  });
  expect(mockSms).toHaveBeenCalledWith(
    '555-0199',
    'Hi Walk-in Bob, your table balance for Test Show (2026-10-24) is $30.00.',
  );
  expect(mockUpdateReg.mock.invocationCallOrder[0]).toBeLessThan(
    mockSms.mock.invocationCallOrder[0],
  );
  expect(result.current.remindTarget).toBeNull();
  expect(props.refreshSelected).toHaveBeenCalledTimes(1);
});

test('commitRemind is a no-op on a blank phone, without a target, or without a show', async () => {
  const { result } = setup();

  // Blank phone → early return, modal stays open, nothing sent.
  const reg = mkReg({ manualPhone: '' });
  act(() => result.current.handleRemind(reg));
  act(() => result.current.setRemindPhone('   '));
  await act(async () => {
    await result.current.commitRemind();
  });
  expect(mockUpdateReg).not.toHaveBeenCalled();
  expect(mockSms).not.toHaveBeenCalled();
  expect(result.current.remindTarget).toBe(reg);

  // No target at all.
  act(() => result.current.setRemindTarget(null));
  await act(async () => {
    await result.current.commitRemind();
  });
  expect(mockUpdateReg).not.toHaveBeenCalled();

  // Show deselected.
  const noShow = setup(null);
  const noShowReg = mkReg({ manualPhone: '' });
  act(() => noShow.result.current.setRemindTarget(noShowReg));
  act(() => noShow.result.current.setRemindPhone('555-0199'));
  await act(async () => {
    await noShow.result.current.commitRemind();
  });
  expect(mockUpdateReg).not.toHaveBeenCalled();
  expect(mockSms).not.toHaveBeenCalled();
});

test('a remind failure keeps the modal open and reports the error', async () => {
  mockUpdateReg.mockRejectedValueOnce('Request quota hit');
  const { result, props } = setup();
  const reg = mkReg({ manualPhone: '' });

  act(() => result.current.handleRemind(reg));
  act(() => result.current.setRemindPhone('555-0199'));
  await act(async () => {
    await result.current.commitRemind();
  });

  expect(props.setError).toHaveBeenCalledWith('Request quota hit');
  expect(result.current.remindTarget).toBe(reg);
  // The SMS never goes out when the phone save fails.
  expect(mockSms).not.toHaveBeenCalled();
  expect(props.refreshSelected).not.toHaveBeenCalled();
});

// settle any pending act() work between suites
afterEach(async () => {
  await flushAsync();
});
