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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';
import { radius } from '../constants/theme';
import { TopChrome, TOP_CHROME_CLEARANCE } from '../components/ui';
import { SyncButton } from '../components/SyncButton';
import { SettingsGear } from '../components/SettingsGear';
import { ShowCard } from '../components/shows/ShowCard';
import { EventListNotices } from '../components/shows/EventListNotices';
import { useEventList } from '../hooks/useEventList';
import type { ShowItem } from '../services/ShowListService';

type Props = {
  onSelectShow: (show: ShowItem) => void;
  onReportShow: (show: ShowItem) => void;
  onOrganize: () => void;
};

export function EventListScreen({ onSelectShow, onReportShow, onOrganize }: Props) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const cardWidth = Math.max(1, width - 32);
  const v = useEventList(onSelectShow, onReportShow);

  return (
    <View style={styles.container}>
      <TopChrome
        left={<SyncButton variant="glass" />}
        right={<SettingsGear variant="glass" />}
      />
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + TOP_CHROME_CLEARANCE },
        ]}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Upcoming Shows</Text>
            <Text style={styles.subtitle}>
              Download a show&rsquo;s listings and browse them at the event.
            </Text>
          </View>
          {v.isOrganizer ? (
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

      <EventListNotices
        balances={v.balances}
        vendorNotice={v.vendorNotice}
        showLaunchNotice={!v.paymentsLive && v.showsWithAccess.length > 0}
        error={v.error}
        hasShows={v.shows.length > 0}
      />

      {v.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : v.error && v.shows.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{v.error}</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.listWrapper}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={v.refreshing}
              onRefresh={v.onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }>
          {v.shows.map((show) => (
            <ShowCard
              key={show.id}
              show={show}
              isReportable={
                v.showsWithAccess.includes(show.id) && v.canUseVendorFeatures
              }
              requestStatus={v.requestsByShow[show.id]?.status}
              onBrowse={v.handleBrowse(show)}
              onReport={v.handleReport(show)}
              onRequest={v.handleRequest(show)}
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
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primaryTint,
    marginTop: 2,
  },
  organizeText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
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
});
