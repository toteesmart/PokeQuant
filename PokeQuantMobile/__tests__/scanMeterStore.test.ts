import {
  FREE_DAILY_SCAN_LIMIT,
  SCAN_TRIAL_DAYS,
  useScanMeterStore,
} from '../src/scanner/store/scanMeterStore';

const DAY_MS = 86_400_000;

function todayKey(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function setMeter(overrides: {
  installedAt?: number | null;
  dayKey?: string | null;
  count?: number;
}) {
  useScanMeterStore.setState({
    installedAt: overrides.installedAt ?? null,
    dayKey: overrides.dayKey ?? null,
    count: overrides.count ?? 0,
  });
}

beforeEach(() => {
  setMeter({});
});

test('first use stamps installedAt and starts the trial', () => {
  const installedAt = useScanMeterStore.getState().ensureInstalledAt();
  expect(useScanMeterStore.getState().installedAt).toBe(installedAt);
  expect(useScanMeterStore.getState().trialActive()).toBe(true);
});

test('trial active: unlimited scans regardless of count', () => {
  setMeter({
    installedAt: Date.now(),
    dayKey: todayKey(),
    count: FREE_DAILY_SCAN_LIMIT + 50,
  });
  expect(useScanMeterStore.getState().canScanToday(false)).toBe(true);
});

test('trial expired: meter enforced at the daily limit', () => {
  const expired = Date.now() - (SCAN_TRIAL_DAYS + 1) * DAY_MS;
  setMeter({ installedAt: expired, dayKey: todayKey(), count: FREE_DAILY_SCAN_LIMIT - 1 });
  expect(useScanMeterStore.getState().canScanToday(false)).toBe(true);
  expect(useScanMeterStore.getState().scansRemaining()).toBe(1);

  setMeter({ installedAt: expired, dayKey: todayKey(), count: FREE_DAILY_SCAN_LIMIT });
  expect(useScanMeterStore.getState().canScanToday(false)).toBe(false);
  expect(useScanMeterStore.getState().scansRemaining()).toBe(0);
});

test('entitled users bypass trial and meter entirely', () => {
  const expired = Date.now() - 30 * DAY_MS;
  setMeter({ installedAt: expired, dayKey: todayKey(), count: 999 });
  expect(useScanMeterStore.getState().canScanToday(true)).toBe(true);
});

test('stale dayKey rolls the count over at local midnight', () => {
  const expired = Date.now() - (SCAN_TRIAL_DAYS + 1) * DAY_MS;
  setMeter({ installedAt: expired, dayKey: '2000-01-01', count: 99 });
  expect(useScanMeterStore.getState().scansRemaining()).toBe(FREE_DAILY_SCAN_LIMIT);
  expect(useScanMeterStore.getState().canScanToday(false)).toBe(true);
});

test('recordScan stamps the day and increments', () => {
  const expired = Date.now() - (SCAN_TRIAL_DAYS + 1) * DAY_MS;
  setMeter({ installedAt: expired, dayKey: '2000-01-01', count: 5 });
  useScanMeterStore.getState().recordScan();
  expect(useScanMeterStore.getState().dayKey).toBe(todayKey());
  expect(useScanMeterStore.getState().count).toBe(1);
  useScanMeterStore.getState().recordScan();
  expect(useScanMeterStore.getState().count).toBe(2);
});

test('trialDaysLeft counts down and clamps at zero', () => {
  setMeter({ installedAt: Date.now() - 2 * DAY_MS });
  expect(useScanMeterStore.getState().trialDaysLeft()).toBe(5);
  setMeter({ installedAt: Date.now() - 30 * DAY_MS });
  expect(useScanMeterStore.getState().trialDaysLeft()).toBe(0);
});
