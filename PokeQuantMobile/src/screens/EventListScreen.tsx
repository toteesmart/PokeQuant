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
  onBrowse: () => void;
  onReport: () => void;
  width: number;
};

const ShowCard = memo(function ShowCard({
  show,
  isReportable,
  onBrowse,
  onReport,
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
        ) : (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={onBrowse}
            style={[styles.actionButton, styles.actionBrowse, styles.actionFull]}>
            <Text style={styles.browse}>Browse inventory</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.primary} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
});

type Props = {
  onSelectShow: (show: ShowItem) => void;
  onReportShow: (show: ShowItem) => void;
};

export function EventListScreen({ onSelectShow, onReportShow }: Props) {
  const { width } = useWindowDimensions();
  const cardWidth = Math.max(1, width - 32);

  const [shows, setShows] = useState<ShowItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vendorNotice, setVendorNotice] = useState<string | null>(null);

  const profile = useShowVendorStore((state) => state.profile);
  const showsWithAccess = useShowVendorStore((state) => state.showsWithAccess);
  const loadVendorProfile = useShowVendorStore((state) => state.loadVendorProfile);
  const loadVendorShows = useShowVendorStore((state) => state.loadVendorShows);

  const paymentsLive = profile?.paymentsLive ?? false;
  const hasVendorEntitlement = useSubscriptionStore((state) => state.hasVendorEntitlement());
  const canUseVendorFeatures = !paymentsLive || hasVendorEntitlement;

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
      ]).then(([profileResult, vendorShowsResult]) => {
        const vendorErrors = Array.from(
        new Set(
          [profileResult, vendorShowsResult]
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
    [loadVendorProfile, loadVendorShows]
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Upcoming Shows</Text>
        <Text style={styles.subtitle}>
          Download a vendor catalog and search offline at the show.
        </Text>
      </View>

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
              onBrowse={handleBrowse(show)}
              onReport={handleReport(show)}
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
