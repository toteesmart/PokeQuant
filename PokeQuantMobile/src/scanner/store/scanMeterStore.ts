import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Daily scan meter for the free tier. Device-local (AsyncStorage) — a
 * reinstall resets both the counter and the trial; accepted, normal for the
 * category.
 *
 * - First SCAN_TRIAL_DAYS days after install: unlimited scans for everyone
 *   (a vendor recruited at a show can scan their whole intake before the
 *   wall ever appears).
 * - After the trial: FREE_DAILY_SCAN_LIMIT successful scans per local day.
 * - Unlimited bypass comes from entitlements/profile flags — the caller
 *   passes `unlimited`; this store only owns the meter.
 */
export const FREE_DAILY_SCAN_LIMIT = 15;
export const SCAN_TRIAL_DAYS = 7;

const DAY_MS = 86_400_000;

type ScanMeterState = {
  installedAt: number | null;
  dayKey: string | null;
  count: number;
};

type ScanMeterActions = {
  /** Stamps installedAt on first call; returns it. */
  ensureInstalledAt: () => number;
  trialActive: () => boolean;
  trialDaysLeft: () => number;
  /** Scans left today; meaningless while trialActive() — pill shows trial copy. */
  scansRemaining: () => number;
  canScanToday: (unlimited: boolean) => boolean;
  recordScan: () => void;
};

function todayKey(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function effectiveCount(state: ScanMeterState): number {
  return state.dayKey === todayKey() ? state.count : 0;
}

export const useScanMeterStore = create<ScanMeterState & ScanMeterActions>()(
  persist(
    (set, get) => ({
      installedAt: null,
      dayKey: null,
      count: 0,

      ensureInstalledAt: () => {
        const existing = get().installedAt;
        if (existing != null) return existing;
        const now = Date.now();
        set({ installedAt: now });
        return now;
      },

      trialActive: () => {
        const installedAt = get().ensureInstalledAt();
        return Date.now() < installedAt + SCAN_TRIAL_DAYS * DAY_MS;
      },

      trialDaysLeft: () => {
        const installedAt = get().ensureInstalledAt();
        const left = installedAt + SCAN_TRIAL_DAYS * DAY_MS - Date.now();
        return Math.max(0, Math.ceil(left / DAY_MS));
      },

      scansRemaining: () => {
        return Math.max(0, FREE_DAILY_SCAN_LIMIT - effectiveCount(get()));
      },

      // Fail-open by contract: a meter bug must never block a scan at the
      // booth. Callers wrap nothing — errors here default to allowing.
      canScanToday: (unlimited) => {
        try {
          if (unlimited) return true;
          if (get().trialActive()) return true;
          return get().scansRemaining() > 0;
        } catch {
          return true;
        }
      },

      recordScan: () => {
        try {
          get().ensureInstalledAt();
          set({ dayKey: todayKey(), count: effectiveCount(get()) + 1 });
        } catch {
          // Meter bookkeeping failure is non-fatal by design.
        }
      },
    }),
    {
      name: 'scan-meter-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
