import { act } from 'react';
import { mkCustomerInfo, mkVendorProfile } from './helpers/builders';
import { renderHook } from './helpers/renderHook';
import { useScanMeter } from '../src/hooks/useScanMeter';
import {
  FREE_DAILY_SCAN_LIMIT,
  SCAN_TRIAL_DAYS,
  todayKey,
  useScanMeterStore,
} from '../src/scanner/store/scanMeterStore';
import { useShowVendorStore } from '../src/store/showVendorStore';
import { useSubscriptionStore } from '../src/store/subscriptionStore';

// Store math (trial window, daily counter, recordScan) is pinned in
// scanMeterStore.test.ts — this suite pins the hook layer on top: the
// unlimited truth table (entitlement kinds × vendor/team flags), reactive
// re-reads so a purchase clears the gate mid-session, the mount-time
// ensureInstalledAt stamp, and that the hook's unlimited flag is what
// reaches canScanToday.

const DAY_MS = 86_400_000;

beforeEach(() => {
  jest.clearAllMocks();
  useScanMeterStore.setState({ installedAt: null, dayKey: null, count: 0 });
  useShowVendorStore.setState({ profile: null });
  useSubscriptionStore.setState({ customerInfo: null });
});

test('first Scan-tab visit stamps installedAt and starts a fresh meter', () => {
  const { result } = renderHook(() => useScanMeter());

  expect(useScanMeterStore.getState().installedAt).not.toBeNull();
  expect(result.current.unlimited).toBe(false);
  // installedAt is stamped with the same frozen nowMs the hook computes
  // against, so a fresh install reads exactly SCAN_TRIAL_DAYS.
  expect(result.current.trialDaysLeft).toBe(SCAN_TRIAL_DAYS);
  expect(result.current.scansLeft).toBe(FREE_DAILY_SCAN_LIMIT);
  expect(result.current.limitSheetOpen).toBe(false);

  act(() => result.current.setLimitSheetOpen(true));
  expect(result.current.limitSheetOpen).toBe(true);
});

test('Cardcache_pro unlocks unlimited scans', () => {
  act(() => {
    useSubscriptionStore.setState({
      customerInfo: mkCustomerInfo(['Cardcache_pro']),
    });
  });
  const { result } = renderHook(() => useScanMeter());
  expect(result.current.unlimited).toBe(true);
});

test('Cardcache_scan unlocks scans even though it never unlocks vendor features', () => {
  act(() => {
    useSubscriptionStore.setState({
      customerInfo: mkCustomerInfo(['Cardcache_scan']),
    });
  });
  const { result } = renderHook(() => useScanMeter());
  expect(result.current.unlimited).toBe(true);
});

test('vendor and team profile flags each unlock unlimited scans', () => {
  act(() => {
    useShowVendorStore.setState({
      profile: mkVendorProfile({ isVendor: true }),
    });
  });
  const { result } = renderHook(() => useScanMeter());
  expect(result.current.unlimited).toBe(true);

  // Same mounted hook, flag swapped — the read is reactive.
  act(() => {
    useShowVendorStore.setState({
      profile: mkVendorProfile({ isVendor: false, isTeamMember: true }),
    });
  });
  expect(result.current.unlimited).toBe(true);

  act(() => {
    useShowVendorStore.setState({ profile: mkVendorProfile() });
  });
  expect(result.current.unlimited).toBe(false);
});

test('a purchase mid-session flips unlimited without a remount', () => {
  const { result } = renderHook(() => useScanMeter());
  expect(result.current.unlimited).toBe(false);

  act(() => {
    useSubscriptionStore.setState({
      customerInfo: mkCustomerInfo(['Cardcache_scan']),
    });
  });
  expect(result.current.unlimited).toBe(true);
});

test('trialDaysLeft counts down from the stamped install and clamps at zero', () => {
  act(() => {
    useScanMeterStore.setState({ installedAt: Date.now() - 2 * DAY_MS });
  });
  const { result } = renderHook(() => useScanMeter());
  expect(result.current.trialDaysLeft).toBe(SCAN_TRIAL_DAYS - 2);

  act(() => {
    useScanMeterStore.setState({ installedAt: Date.now() - 30 * DAY_MS });
  });
  expect(result.current.trialDaysLeft).toBe(0);
});

test('scansLeft reads the meter for the mount-frozen day', () => {
  act(() => {
    useScanMeterStore.setState({
      installedAt: Date.now() - 30 * DAY_MS,
      dayKey: todayKey(),
      count: 3,
    });
  });
  const { result } = renderHook(() => useScanMeter());
  expect(result.current.scansLeft).toBe(FREE_DAILY_SCAN_LIMIT - 3);

  // A stale dayKey means the day rolled over — full limit again.
  act(() => {
    useScanMeterStore.setState({ dayKey: '2000-01-01', count: 99 });
  });
  expect(result.current.scansLeft).toBe(FREE_DAILY_SCAN_LIMIT);
});

test("canScanToday consults the real meter with the hook's unlimited flag", () => {
  act(() => {
    useScanMeterStore.setState({
      installedAt: Date.now() - 30 * DAY_MS,
      dayKey: todayKey(),
      count: FREE_DAILY_SCAN_LIMIT,
    });
  });
  const { result } = renderHook(() => useScanMeter());
  expect(result.current.canScanToday()).toBe(false);

  // Only the hook's unlimited flag changes — the meter stays exhausted.
  act(() => {
    useSubscriptionStore.setState({
      customerInfo: mkCustomerInfo(['Cardcache_pro']),
    });
  });
  expect(result.current.canScanToday()).toBe(true);
});

test('recordScan counts against today and drains scansLeft reactively', () => {
  act(() => {
    useScanMeterStore.setState({
      installedAt: Date.now() - 30 * DAY_MS,
      dayKey: todayKey(),
      count: 0,
    });
  });
  const { result } = renderHook(() => useScanMeter());
  expect(result.current.scansLeft).toBe(FREE_DAILY_SCAN_LIMIT);

  act(() => result.current.recordScan());
  expect(useScanMeterStore.getState().count).toBe(1);
  expect(result.current.scansLeft).toBe(FREE_DAILY_SCAN_LIMIT - 1);
});
