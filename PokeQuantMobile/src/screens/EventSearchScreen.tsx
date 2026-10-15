import {
  useCallback,
  useMemo,
  useState,
} from 'react';
import { FlashList } from '@shopify/flash-list';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';
import { layout, radius } from '../constants/theme';
import { GlassBackButton } from '../components/ui';
import { EventFilterBar } from '../components/events/EventFilterBar';
import {
  chunkQuads,
  EventSearchPage,
} from '../components/events/EventSearchPage';
import { useEventSearch } from '../hooks/useEventSearch';
import type { EventInventoryItem } from '../db/eventCatalogDb';

type Props = {
  showId: string;
  showName: string;
  showStartDate?: string;
  showLocation?: string;
  onBack: () => void;
};

export function EventSearchScreen({
  showId,
  showName,
  showStartDate,
  showLocation,
  onBack,
}: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const {
    isReady,
    query,
    setQuery,
    results,
    isSearching,
    isLoadingMore,
    error,
    notice,
    filters,
    patchFilters,
    sort,
    setSort,
    filterOptions,
    isRefreshing,
    downloadProgress,
    downloadStatus,
    loadMore,
    refresh,
    retry,
  } = useEventSearch(showId);

  const [wrapperSize, setWrapperSize] = useState({
    width,
    height: Math.max(400, height - 220),
  });

  const pageWidth = wrapperSize.width;
  const pageHeight = wrapperSize.height;
  const groupedResults = useMemo(() => chunkQuads(results), [results]);

  const renderItem = useCallback(
    ({ item }: { item: EventInventoryItem[] }) => (
      <EventSearchPage
        items={item}
        pageWidth={pageWidth}
        pageHeight={pageHeight}
      />
    ),
    [pageWidth, pageHeight]
  );

  const handleWrapperLayout = useCallback((e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    setWrapperSize({ width: w, height: h });
  }, []);

  const hasQuery = query
    .toLowerCase()
    .replace(/[''\-.]/g, '')
    .replace(/\s+/g, ' ')
    .trim().length > 0;

  const bannerMessage = error ?? notice;
  const bannerIsError = !!error;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}>
      <View style={styles.inner}>
        <View
          style={[styles.header, { paddingTop: insets.top + layout.screenTop }]}>
          <View style={styles.headerTop}>
            <GlassBackButton onPress={onBack} label="Back to shows" />
            <View style={styles.headerTitle}>
              <Text style={styles.title} numberOfLines={1}>
                {showName}
              </Text>
              {(showStartDate || showLocation) && (
                <Text style={styles.showMeta} numberOfLines={2}>
                  {showStartDate}
                  {showStartDate && showLocation ? '\n' : ''}
                  {showLocation}
                </Text>
              )}
            </View>
            <TouchableOpacity
              onPress={refresh}
              disabled={isRefreshing}
              activeOpacity={0.7}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Refresh listings"
              style={styles.refreshButton}>
              {isRefreshing ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <Ionicons name="refresh-outline" size={20} color={colors.primary} />
              )}
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.searchInput}
            placeholder="Search show inventory..."
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={setQuery}
          />
          <Text style={styles.resultsCount}>
            {isSearching && results.length === 0
              ? 'Searching...'
              : `${results.length} result${results.length !== 1 ? 's' : ''}`}
          </Text>

          <EventFilterBar
            sort={sort}
            onSortChange={setSort}
            filters={filters}
            onPatchFilters={patchFilters}
            filterOptions={filterOptions}
          />
        </View>

        <View style={styles.listWrapper} onLayout={handleWrapperLayout}>
          {!isReady && !error && !notice ? (
            <View style={styles.empty}>
              <ActivityIndicator color={colors.primary} size="large" />
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${Math.round(downloadProgress * 100)}%` },
                  ]}
                />
              </View>
              <Text style={[styles.emptyText, { marginTop: 16 }]}>
                {downloadStatus}
              </Text>
            </View>
          ) : (error || notice) && results.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons
                name={bannerIsError ? 'warning-outline' : 'cloud-offline-outline'}
                size={32}
                color={bannerIsError ? colors.error : colors.warning}
                style={{ marginBottom: 12 }}
              />
              <Text
                style={[
                  styles.emptyText,
                  { color: bannerIsError ? colors.error : colors.textMuted },
                ]}>
                {bannerMessage}
              </Text>
              <TouchableOpacity
                style={styles.retryButton}
                activeOpacity={0.7}
                onPress={retry}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {(error || notice) ? (
                <View style={styles.inlineErrorWrap}>
                  <Ionicons
                    name={bannerIsError ? 'warning-outline' : 'cloud-offline-outline'}
                    size={14}
                    color={bannerIsError ? colors.error : colors.warning}
                  />
                  <Text style={[styles.inlineErrorText, bannerIsError ? { color: colors.error } : undefined]}>
                    {bannerMessage}
                  </Text>
                </View>
              ) : null}
            <FlashList
              data={groupedResults}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              nestedScrollEnabled
              style={{ width: pageWidth, height: pageHeight }}
              contentContainerStyle={styles.listContent}
              keyExtractor={(item) =>
                item.map((i) => i.id).join('-')
              }
              renderItem={renderItem}
              onEndReached={loadMore}
              onEndReachedThreshold={0.5}
              ListFooterComponent={
                isLoadingMore ? (
                  <View style={styles.footerSpinner}>
                    <ActivityIndicator color={colors.text} />
                  </View>
                ) : null
              }
              ListEmptyComponent={
                isSearching ? (
                  <View style={styles.empty}>
                    <Text style={styles.emptyText}>Searching...</Text>
                  </View>
                ) : (
                  <View style={styles.empty}>
                    <Text style={styles.emptyText}>
                      {hasQuery
                        ? 'No cards match your search.'
                        : 'No cards in this show.'}
                    </Text>
                  </View>
                )
              }
            />
            </>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  inner: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  headerTitle: {
    flex: 1,
    marginLeft: 12,
  },
  refreshButton: {
    marginLeft: 8,
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.overlay3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  showMeta: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
    lineHeight: 15,
  },
  searchInput: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 10,
  },
  resultsCount: {
    color: colors.textMuted,
    fontSize: 13,
  },
  retryButton: {
    marginTop: 16,
    backgroundColor: colors.primaryTint,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  retryText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  inlineErrorWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: colors.warningTint,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: radius.controlLg,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  inlineErrorText: {
    color: colors.textMuted,
    fontSize: 12,
    flex: 1,
  },
  listWrapper: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 0,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
  },
  progressTrack: {
    width: 200,
    height: 4,
    backgroundColor: colors.overlay4,
    borderRadius: radius.badge,
    marginTop: 16,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
  },
  footerSpinner: {
    paddingVertical: 16,
    alignItems: 'center',
  },
});
