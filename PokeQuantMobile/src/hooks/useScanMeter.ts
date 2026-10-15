// Scan-meter plumbing — entitlement reads (RevenueCat + vendor/team flag),
// the 7-day trial / daily free-scan math, and the limit sheet's open state.
// Store reads stay reactive so a purchase in the sheet clears the gate
// instantly.
import { useCallback, useEffect, useState } from 'react';
import {
  SCAN_TRIAL_DAYS,
  todayKey,
  useScanMeterStore,
} from '../scanner/store/scanMeterStore';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { useShowVendorStore } from '../store/showVendorStore';
import {
  SCAN_ENTITLEMENT_ID,
  VENDOR_ENTITLEMENT_ID,
} from '../constants/revenuecat';

export function useScanMeter() {
  // Unlimited scans: Cardcache_pro, Cardcache_scan, or vendor/team profile
  // flag (team members hold no RevenueCat entitlement of their own).
  // Subscribed reactively so a purchase in the limit sheet clears the gate
  // instantly.
  const entitled = useSubscriptionStore(
    (s) =>
      !!s.customerInfo?.entitlements.active[VENDOR_ENTITLEMENT_ID] ||
      !!s.customerInfo?.entitlements.active[SCAN_ENTITLEMENT_ID]
  );
  const vendorOrTeam = useShowVendorStore(
    (s) => !!(s.profile?.isVendor || s.profile?.isTeamMember)
  );
  const unlimited = entitled || vendorOrTeam;
  const installedAt = useScanMeterStore((s) => s.installedAt);
  // Frozen "now" for the whole mount — time-derived meter reads must not
  // pull the clock mid-render (react-hooks/purity).
  const [nowMs] = useState(() => Date.now());
  const [today] = useState(() => todayKey());
  const scansLeft = useScanMeterStore((s) => s.scansRemaining(today));
  const [limitSheetOpen, setLimitSheetOpen] = useState(false);

  // The trial starts on the first visit to the Scan tab.
  useEffect(() => {
    useScanMeterStore.getState().ensureInstalledAt();
  }, []);

  const trialDaysLeft =
    installedAt != null
      ? Math.max(
          0,
          Math.ceil(
            (installedAt + SCAN_TRIAL_DAYS * 86_400_000 - nowMs) /
              86_400_000
          )
        )
      : SCAN_TRIAL_DAYS;

  const canScanToday = useCallback(
    () => useScanMeterStore.getState().canScanToday(unlimited),
    [unlimited]
  );
  const recordScan = useCallback(
    () => useScanMeterStore.getState().recordScan(),
    []
  );

  return {
    unlimited,
    scansLeft,
    trialDaysLeft,
    limitSheetOpen,
    setLimitSheetOpen,
    canScanToday,
    recordScan,
  };
}
