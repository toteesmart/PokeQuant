import { memo, useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import {
  getCachedShowsList,
  getShowsList,
  type ShowItem,
} from '../services/ShowListService';
import { useShowVendorStore } from '../store/showVendorStore';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { isOfflineError, toErrorMessage } from '../utils/log';

type ShowCardProps = {
  show: ShowItem;
  isReportable: boolean;
  requestStatus?: string;
  onBrowse: () => void;
  onReport: () => void;
  onRequest: () => void;
  width: number;
};

const ShowCard = memo(function ShowCard({
  show,
  isReportable,
  requestStatus,
  onBrowse,
  onReport,
  onRequest,
  width,
}: ShowCardProps) {
  return (
    <View style={[styles.card, { width }]}>
      <View style={styles.cardHeader}>
        <Text style={styles.name} numberOfLines={2}>
          {show.name}
        </Text>
        <Text style={styles.date}>{show.startDate}</Text>
      </View>
      <Text style={styles.location} numberOfLines={2}>
        {show.location}
      </Text>

      <View style={styles.actions}>
        {isReportable ? (
          <>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={onBrowse}
              style={[styles.actionButton, styles.actionBrowse]}>
              <Ionicons name="search-outline" size={14} color={colors.primary} />
              <Text style={styles.actionText}>Browse</Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={onReport}
              style={[styles.actionButton, styles.actionReport]}>
              <Ionicons name="add-circle-outline" size={14} color={colors.success} />
              <Text style={[styles.actionText, styles.reportText]}>Report inventory</Text>
            </TouchableOpacity>
          </>
        ) : requestStatus === 'pending' ? (
          <>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={onBrowse}
              style={[styles.actionButton, styles.actionBrowse]}>
              <Ionicons name="search-outline" size={14} color={colors.primary} />
              <Text style={styles.actionText}>Browse</Text>
            </TouchableOpacity>
            <View style={[styles.actionButton, styles.actionPending]}>
              <Ionicons name="time-outline" size={14} color={colors.textMuted} />
              <Text style={[styles.actionText, styles.pendingText]}>
                Request pending
              </Text>
            </View>
          </>
        ) : requestStatus === 'rejected' ? (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={onBrowse}
            style={[styles.actionButton, styles.actionBrowse, styles.actionFull]}>
            <Text style={styles.browse}>Browse inventory</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.primary} />
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={onBrowse}
              style={[styles.actionButton, styles.actionBrowse]}>
              <Ionicons name="search-outline" size={14} color={colors.primary} />
              <Text style={styles.actionText}>Browse</Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={onRequest}
              style={[styles.actionButton, styles.actionRequest]}>
              <Ionicons name="hand-right-outline" size={14} color={colors.warning} />
              <Text style={[styles.actionText, styles.requestText]}>
                Request a table
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
});

type Props = {
  onSelectShow: (show: ShowItem) => void;
  onReportShow: (show: ShowItem) => void;
  onOrganize: () => void;
};

export function EventListScreen({ onSelectShow, onReportShow, onOrganize }: Props) {
  const { width } = useWindowDimensions();
  const cardWidth = Math.max(1, width - 32);

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
                ? 'Internet connection is offline — vendor features unavailable.'
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
            ? 'Internet connection is offline — using cached show list.'
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
            ? 'Internet connection is offline — using cached show list.'
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Upcoming Shows</Text>
            <Text style={styles.subtitle}>
              Download a vendor catalog and search offline at the show.
            </Text>
          </View>
          {profile?.isOrganizer ? (
            <TouchableOpacity
              activeOpacity={0.7}
              style={styles.organizeBtn}
              onPress={onOrganize}>
              <Ionicons name="calendar-outline" size={15} color={colors.primary} />
              <Text style={styles.organizeText}>Organize</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {balances.length > 0
        ? balances.slice(0, 2).map((b) => (
            <View key={b.showId} style={styles.balanceBanner}>
              <Ionicons name="cash-outline" size={14} color={colors.warning} />
              <Text style={styles.noticeText}>
                Balance due: ${b.remaining.toFixed(2)} at {b.showName}
                {b.tableNumber ? ` (Table ${b.tableNumber})` : ''}
                {b.organizerName ? ` — pay ${b.organizerName}` : ''}
                {b.payInstructions ? ` · ${b.payInstructions}` : ''}
              </Text>
            </View>
          ))
        : null}
      {balances.length > 2 ? (
        <Text style={[styles.noticeText, { marginHorizontal: 16 }]}>
          +{balances.length - 2} more unpaid show{balances.length - 2 === 1 ? '' : 's'}
        </Text>
      ) : null}

      {vendorNotice ? (
        <View style={styles.noticeWrap}>
          <Ionicons
            name="cloud-offline-outline"
            size={14}
            color={colors.warning}
          />
          <Text style={styles.noticeText}>{vendorNotice}</Text>
        </View>
      ) : null}

      {/* Launch-pricing notice — only vendors (anyone with show access) see
          it; attendees browsing the catalog never do. */}
      {!paymentsLive && showsWithAccess.length > 0 ? (
        <View style={styles.noticeWrap}>
          <Ionicons
            name="information-circle-outline"
            size={14}
            color={colors.primary}
          />
          <Text style={styles.noticeText}>
            Vendor tools are free during launch — a Pro plan will be required
            after launch pricing ends.
          </Text>
        </View>
      ) : null}

      {error && shows.length > 0 ? (
        <View style={styles.noticeWrap}>
          <Ionicons name="warning-outline" size={14} color={colors.warning} />
          <Text style={styles.noticeText}>{error}</Text>
        </View>
      ) : null}

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : error && shows.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.listWrapper}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }>
          {shows.map((show) => (
            <ShowCard
              key={show.id}
              show={show}
              isReportable={showsWithAccess.includes(show.id) && canUseVendorFeatures}
              requestStatus={requestsByShow[show.id]?.status}
              onBrowse={handleBrowse(show)}
              onReport={handleReport(show)}
              onRequest={handleRequest(show)}
              width={cardWidth}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  organizeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: 'rgba(59,130,246,0.12)',
    marginTop: 2,
  },
  organizeText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: 'bold',
  },
  balanceBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: 'bold',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 4,
  },
  listWrapper: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  noticeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  noticeText: {
    color: colors.textMuted,
    fontSize: 12,
    flex: 1,
  },
  errorText: {
    color: colors.error,
    fontSize: 14,
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  cardHeader: {
    marginBottom: 8,
  },
  name: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  date: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  location: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  actionFull: {
    flex: 1,
  },
  actionBrowse: {
    flex: 1,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionReport: {
    flex: 1,
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    borderWidth: 1,
    borderColor: colors.success,
  },
  actionPending: {
    flex: 1,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pendingText: {
    color: colors.textMuted,
  },
  actionRequest: {
    flex: 1,
    backgroundColor: 'rgba(210, 153, 34, 0.12)',
    borderWidth: 1,
    borderColor: colors.warning,
  },
  requestText: {
    color: colors.warning,
  },
  browse: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
    marginRight: 4,
  },
  actionText: {
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 4,
  },
  reportText: {
    color: colors.success,
  },
});
