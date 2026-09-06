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

type ShowCardProps = {
  show: ShowItem;
  onPress: () => void;
  width: number;
};

const ShowCard = memo(function ShowCard({ show, onPress, width }: ShowCardProps) {
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      style={[styles.card, { width }]}>
      <View style={styles.cardHeader}>
        <Text style={styles.name} numberOfLines={2}>
          {show.name}
        </Text>
        <Text style={styles.date}>{show.startDate}</Text>
      </View>
      <Text style={styles.location} numberOfLines={2}>
        {show.location}
      </Text>
      <View style={styles.row}>
        <Text style={styles.browse}>Browse inventory</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.primary} />
      </View>
    </TouchableOpacity>
  );
});

type Props = {
  onSelectShow: (show: ShowItem) => void;
};

export function EventListScreen({ onSelectShow }: Props) {
  const { width } = useWindowDimensions();
  const cardWidth = Math.max(1, width - 32);

  const [shows, setShows] = useState<ShowItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setError(null);
    setIsLoading(true);

    getShowsList()
      .then((data) => {
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
  }, []);

  const handlePress = useCallback(
    (show: ShowItem) => () => onSelectShow(show),
    [onSelectShow]
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
              width={cardWidth}
              onPress={handlePress(show)}
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  browse: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
    marginRight: 4,
  },
});
