// useSettingsBootstrap — the Settings mount refresh: RevenueCat
// customer info (best-effort, may be unconfigured/offline), then the
// worker subscription sync, then vendor profile + team in parallel.
// Team is optional — failures surface in the team card itself.
import { useEffect } from 'react';
import { useShowVendorStore } from '../store/showVendorStore';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { syncVendorSubscription } from '../services/showVendorService';

export function useSettingsBootstrap() {
  const loadTeam = useShowVendorStore((state) => state.loadTeam);
  const loadVendorProfile = useShowVendorStore((state) => state.loadVendorProfile);

  useEffect(() => {
    let mounted = true;

    const refresh = async () => {
      try {
        await useSubscriptionStore.getState().refreshCustomerInfo();
      } catch {
        // RevenueCat may not be configured or offline; continue with worker sync.
      }

      try {
        await syncVendorSubscription();
      } catch {
        // Worker sync is best-effort; offline failures are surfaced elsewhere.
      }

      if (!mounted) return;

      await Promise.all([
        loadVendorProfile().catch((err) => {
          console.error('Failed to load vendor profile from Settings:', err);
        }),
        loadTeam().catch(() => {
          // Team info is optional; failures are shown in the team card.
        }),
      ]);
    };

    refresh();

    return () => {
      mounted = false;
    };
  }, [loadVendorProfile, loadTeam]);
}
