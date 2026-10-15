// EventListScreen's brain: show list loading (cached-first, then fresh,
// then vendor-side calls that degrade to an inline notice), refresh,
// vendor gating, and per-card handler factories.
//
// Boundary: owns all store subscriptions, effects, and async work; the
// screen keeps chrome, header, and JSX.

import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  getCachedShowsList,
  getShowsList,
  type ShowItem,
} from '../services/ShowListService';
import { useShowVendorStore } from '../store/showVendorStore';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { isOfflineError, toErrorMessage } from '../utils/log';

export function useEventList(
  onSelectShow: (show: ShowItem) => void,
  onReportShow: (show: ShowItem) => void
) {
  const [shows, setShows] = useState<ShowItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vendorNotice, setVendorNotice] = useState<string | null>(null);

  const profile = useShowVendorStore((state) => state.profile);
  const showsWithAccess = useShowVendorStore((state) => state.showsWithAccess);
  const requestsByShow = useShowVendorStore((state) => state.requestsByShow);
  const balances = useShowVendorStore((state) => state.balances);
  const loadVendorProfile = useShowVendorStore((state) => state.loadVendorProfile);
  const loadVendorShows = useShowVendorStore((state) => state.loadVendorShows);
  const loadBalances = useShowVendorStore((state) => state.loadBalances);
  const requestTable = useShowVendorStore((state) => state.requestTable);

  const paymentsLive = profile?.paymentsLive ?? false;
  const hasVendorEntitlement = useSubscriptionStore((state) => state.hasVendorEntitlement());
  const canUseVendorFeatures =
    !paymentsLive ||
    !!profile?.isVendor ||
    !!profile?.isTeamMember ||
    hasVendorEntitlement;

  const loadData = useCallback(
    async (isRefresh = false) => {
      if (!isRefresh) {
        setIsLoading(true);
      }
      setError(null);
      setVendorNotice(null);

      // Render the cached/static list immediately — the network fetch below
      // waits out its own timeout before falling back internally, which would
      // otherwise leave an offline user on a spinner for ~15s.
      const cachedShows = await getCachedShowsList();
      setShows((prev) => (prev.length > 0 ? prev : cachedShows));
      setIsLoading(false);

      // Vendor calls are network-only: they never block the show list and a
      // failure only surfaces as an inline notice, never as a screen-level
      // error that hides the shows.
      const vendorSettled = Promise.allSettled([
        loadVendorProfile(),
        loadVendorShows(),
        loadBalances(),
      ]).then(([profileResult, vendorShowsResult, balancesResult]) => {
        const vendorErrors = Array.from(
        new Set(
          [profileResult, vendorShowsResult, balancesResult]
            .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
            .map((r) =>
              isOfflineError(r.reason)
                ? 'No internet — selling tools unavailable.'
                : toErrorMessage(r.reason)
            )
        )
      );
      if (vendorErrors.length > 0) {
        setVendorNotice(vendorErrors.join('; '));
      }
      });

      try {
        const freshShows = await getShowsList();
        setShows(freshShows);
      } catch (err) {
        // getShowsList falls back to the cache internally, so this is
        // belt-and-suspenders — keep whatever list we already rendered.
        setShows((prev) => (prev.length > 0 ? prev : cachedShows));
        setError(
          isOfflineError(err)
            ? 'No internet — showing the last downloaded show list.'
            : toErrorMessage(err)
        );
      }

      setRefreshing(false);
      await vendorSettled;
    },
    [loadVendorProfile, loadVendorShows, loadBalances]
  );

  // Only the focus effect loads data — it fires on mount too, so a separate
  // mount effect would double-fetch.
  useFocusEffect(
    useCallback(() => {
      loadData(true).catch((err) => {
        setError(
          isOfflineError(err)
            ? 'No internet — showing the last downloaded show list.'
            : toErrorMessage(err)
        );
        setIsLoading(false);
        setRefreshing(false);
      });
    }, [loadData])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData(true).catch(() => {});
  }, [loadData]);

  const handleBrowse = useCallback(
    (show: ShowItem) => () => onSelectShow(show),
    [onSelectShow]
  );

  const handleReport = useCallback(
    (show: ShowItem) => () => onReportShow(show),
    [onReportShow]
  );

  const handleRequest = useCallback(
    (show: ShowItem) => () => {
      requestTable(show.id).catch((err) => {
        setVendorNotice(toErrorMessage(err));
      });
    },
    [requestTable]
  );

  return {
    shows,
    isLoading,
    refreshing,
    error,
    vendorNotice,
    balances,
    paymentsLive,
    canUseVendorFeatures,
    showsWithAccess,
    requestsByShow,
    isOrganizer: !!profile?.isOrganizer,
    onRefresh,
    handleBrowse,
    handleReport,
    handleRequest,
  };
}
