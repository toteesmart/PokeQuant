import { memo, useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import { getShowsList, type ShowItem } from '../services/ShowListService';
import { useShowVendorStore } from '../store/showVendorStore';

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
  const [error, setError] = useState<string | null>(null);

  const profile = useShowVendorStore((state) => state.profile);
  const loadVendorProfile = useShowVendorStore((state) => state.loadVendorProfile);

  useEffect(() => {
    let mounted = true;
    setError(null);
    setIsLoading(true);

    Promise.all([getShowsList(), loadVendorProfile()])
      .then(([data]) => {
        if (!mounted) return;
        setShows(data);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!mounted) return;
        setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [loadVendorProfile]);

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

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.listWrapper}
          contentContainerStyle={styles.listContent}>
          {shows.map((show) => (
            <ShowCard
              key={show.id}
              show={show}
              isReportable={Boolean(profile?.id && show.vendorId === profile.id)}
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
