import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';
import { layout, radius } from '../constants/theme';
import { ShowVendorInventoryRow } from '../components/ShowVendorInventoryRow';
import { ShowVendorListingRow } from '../components/ShowVendorListingRow';
import { GlassBackButton, SegmentedPills } from '../components/ui';
import { useInventoryStore, type InventoryCard } from '../store/inventoryStore';
import { useShowVendorStore } from '../store/showVendorStore';
import { toErrorMessage } from '../utils/log';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { PricingPreview } from '../components/PricingPreview';
import type { ShowItem } from '../services/ShowListService';
import type { ShowListingItem } from '../services/showVendorService';
import { normalizeSearchTerm } from '../utils/search';
import { buildSearchIndex } from '../services/inventorySearch';

const TABS = [
  { key: 'select', label: 'Pick Cards', icon: 'checkbox-outline' },
  { key: 'listings', label: 'My Listings', icon: 'list-outline' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

type Props = {
  show: ShowItem;
  onBack: () => void;
};

export function ShowVendorScreen({ show, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<TabKey>('select');
  // null = untouched; the derived setup/profile default shows through until
  // the vendor types, so a profile that loads after mount still fills the
  // fields instead of leaving them empty.
  const [vendorName, setVendorName] = useState<string | null>(null);
  const [vendorTable, setVendorTable] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [publishMessage, setPublishMessage] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);
  const [showPaywall, setShowPaywall] = useState(false);

  const activeInventory = useInventoryStore((state) => state.activeInventory);
  const profile = useShowVendorStore((state) => state.profile);
  const setups = useShowVendorStore((state) => state.setups);
  const requestsByShow = useShowVendorStore((state) => state.requestsByShow);
  const selections = useShowVendorStore((state) => state.selections);
  const listings = useShowVendorStore((state) => state.listings);
  const isUploading = useShowVendorStore((state) => state.isUploading[show.id]);
  const uploadError = useShowVendorStore((state) => state.uploadError[show.id]);
  const isLoadingListings = useShowVendorStore(
    (state) => state.isLoadingListings[show.id]
  );
  const listingsError = useShowVendorStore(
    (state) => state.listingsError[show.id]
  );
  const isTriggering = useShowVendorStore(
    (state) => state.isTriggering[show.id]
  );
  const loadListings = useShowVendorStore((state) => state.loadListings);
  const uploadToShow = useShowVendorStore((state) => state.uploadToShow);
  const triggerSnapshot = useShowVendorStore((state) => state.triggerSnapshot);

  const refreshInventoryState = useInventoryStore(
    (state) => state.refreshInventoryState
  );
  const loadVendorProfile = useShowVendorStore((state) => state.loadVendorProfile);

  const paymentsLive = profile?.paymentsLive ?? false;
  const hasVendorEntitlement = useSubscriptionStore((state) => state.hasVendorEntitlement());
  const canUseVendorFeatures =
    !paymentsLive ||
    !!profile?.isVendor ||
    !!profile?.isTeamMember ||
    hasVendorEntitlement;

  useEffect(() => {
    loadVendorProfile().catch((err) => {
      console.error('Failed to load vendor profile:', err);
    });
  }, [loadVendorProfile]);

  useEffect(() => {
    if (canUseVendorFeatures) {
      setShowPaywall(false);
    }
  }, [canUseVendorFeatures]);

  useEffect(() => {
    loadListings(show.id).catch((err) => {
      console.error('Failed to load show listings:', err);
    });
  }, [loadListings, show.id]);

  useEffect(() => {
    if (activeInventory.length === 0) {
      refreshInventoryState();
    }
  }, [activeInventory.length, refreshInventoryState]);

  const showSetup = setups[show.id];
  const effectiveVendorName =
    vendorName ?? showSetup?.vendorName ?? profile?.name ?? '';
  // Organizer-assigned table number prefills when the vendor hasn't set one.
  const effectiveVendorTable =
    vendorTable ??
    showSetup?.vendorTable ??
    (requestsByShow[show.id]?.table || undefined) ??
    profile?.tableDefault ??
    '';

  const selectedMap = useMemo(
    () => selections[show.id] || {},
    [selections, show.id]
  );

  const selectedCount = useMemo(
    () => Object.keys(selectedMap).length,
    [selectedMap]
  );

  const searchIndex = useMemo(
    () => buildSearchIndex(activeInventory),
    [activeInventory]
  );

  const filteredInventory = useMemo(() => {
    const raw = searchQuery.trim();
    if (!raw) return activeInventory;
    const needle = normalizeSearchTerm(raw);
    if (!needle) return activeInventory;
    return searchIndex
      .filter((entry) => entry.haystack.includes(needle))
      .map((entry) => entry.card);
  }, [activeInventory, searchIndex, searchQuery]);

  const listingData = useMemo(
    () => listings[show.id] || [],
    [listings, show.id]
  );

  const renderSelectItem: ListRenderItem<InventoryCard> = useCallback(
    ({ item }) => (
      <ShowVendorInventoryRow showId={show.id} card={item} />
    ),
    [show.id]
  );

  const renderListingItem: ListRenderItem<ShowListingItem> = useCallback(
    ({ item }) => (
      <ShowVendorListingRow showId={show.id} item={item} />
    ),
    [show.id]
  );

  const handleUpload = useCallback(async () => {
    if (!canUseVendorFeatures) {
      setShowPaywall(true);
      return;
    }
    if (!effectiveVendorName.trim()) return;
    if (selectedCount === 0) return;
    try {
      await uploadToShow(
        show.id,
        effectiveVendorName.trim(),
        effectiveVendorTable.trim()
      );
      setActiveTab('listings');
    } catch {
      // Error is already in store state.
    }
  }, [canUseVendorFeatures, effectiveVendorName, effectiveVendorTable, selectedCount, show.id, uploadToShow]);

  const handlePublish = useCallback(async () => {
    if (!canUseVendorFeatures) {
      setShowPaywall(true);
      return;
    }
    setPublishMessage(null);
    try {
      await triggerSnapshot(show.id);
      setPublishMessage({
        text: 'Published! Attendees can refresh to see your listings.',
        isError: false,
      });
    } catch (err) {
      setPublishMessage({
        text: `Publish didn't go through — ${toErrorMessage(err)}`,
        isError: true,
      });
      console.error('Failed to trigger snapshot:', err);
    }
  }, [canUseVendorFeatures, show.id, triggerSnapshot]);

  const selectedTotal = useMemo(() => {
    return Object.values(selectedMap).reduce(
      (sum, s) => sum + (s?.stickerPrice || 0) * (s?.quantity || 0),
      0
    );
  }, [selectedMap]);

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
                {show.name}
              </Text>
              <Text style={styles.showMeta} numberOfLines={2}>
                {show.startDate}
                {show.startDate && show.location ? '\n' : ''}
                {show.location}
              </Text>
            </View>
          </View>

          <SegmentedPills
            tabs={TABS}
            activeTab={activeTab}
            onChange={setActiveTab}
          />
        </View>

        {!paymentsLive && (
          <View style={styles.launchBanner}>
            <Ionicons name="information-circle-outline" size={14} color={colors.accentPurple} />
            <Text style={styles.launchBannerText}>
              Vendor tools are free during launch — a Pro plan will be required
              after launch pricing ends.
            </Text>
          </View>
        )}

        <View style={styles.setupCard}>
          <Text style={styles.setupTitle}>Vendor setup for this show</Text>
          <View style={styles.setupRow}>
            <TextInput
              style={[styles.setupInput, { marginRight: 8 }]}
              placeholder="Vendor name"
              placeholderTextColor={colors.textMuted}
              value={effectiveVendorName}
              onChangeText={setVendorName}
            />
            <TextInput
              style={styles.setupInput}
              placeholder="Table / booth"
              placeholderTextColor={colors.textMuted}
              value={effectiveVendorTable}
              onChangeText={setVendorTable}
            />
          </View>
        </View>

        {activeTab === 'select' ? (
          <>
            <View style={styles.searchWrap}>
              <Ionicons
                name="search-outline"
                size={16}
                color={colors.textMuted}
              />
              <TextInput
                style={styles.searchInput}
                placeholder="Search your inventory..."
                placeholderTextColor={colors.textMuted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCorrect={false}
                autoCapitalize="none"
              />
            </View>

            <View style={styles.listContainer}>
              {filteredInventory.length === 0 ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>
                    {searchQuery.trim()
                      ? 'No cards match your search.'
                      : 'No active inventory to report.'}
                  </Text>
                </View>
              ) : (
                <FlashList
                  data={filteredInventory}
                  renderItem={renderSelectItem}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={styles.listContent}
                  ListFooterComponent={
                    <View style={{ height: 16 }} />
                  }
                />
              )}
            </View>

            <View style={styles.footer}>
              {uploadError ? (
                <Text style={styles.errorText}>{uploadError}</Text>
              ) : null}
              <View style={styles.footerRow}>
                <View style={styles.footerSummary}>
                  <Text style={styles.footerCount}>
                    {selectedCount} selected
                  </Text>
                  <Text style={styles.footerTotal}>
                    ${selectedTotal.toFixed(2)} total
                  </Text>
                </View>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={handleUpload}
                  disabled={selectedCount === 0 || isUploading || !effectiveVendorName.trim()}
                  style={[
                    styles.uploadButton,
                    (selectedCount === 0 || isUploading || !effectiveVendorName.trim()) &&
                      styles.uploadButtonDisabled,
                  ]}>
                  {isUploading ? (
                    <ActivityIndicator color={colors.background} size="small" />
                  ) : (
                    <Text style={styles.uploadButtonText}>Upload to show</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </>
        ) : (
          <>
            <View style={styles.listContainer}>
              {isLoadingListings ? (
                <View style={styles.empty}>
                  <ActivityIndicator color={colors.primary} size="large" />
                </View>
              ) : listingData.length === 0 ? (
                <View style={styles.empty}>
                  {listingsError ? (
                    <Text style={styles.errorText}>{listingsError}</Text>
                  ) : (
                    <Text style={styles.emptyText}>
                      No listings yet. Switch to Pick Cards to add some.
                    </Text>
                  )}
                </View>
              ) : (
                <FlashList
                  data={listingData}
                  renderItem={renderListingItem}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={styles.listContent}
                  ListFooterComponent={
                    <View style={{ height: 16 }} />
                  }
                />
              )}
            </View>

            <View style={styles.footer}>
              {listingsError && listingData.length > 0 ? (
                <Text style={styles.errorText}>{listingsError}</Text>
              ) : null}
              {publishMessage ? (
                <Text
                  style={[
                    styles.messageText,
                    publishMessage.isError
                      ? styles.messageError
                      : styles.messageSuccess,
                  ]}>
                  {publishMessage.text}
                </Text>
              ) : null}
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={handlePublish}
                disabled={isTriggering}
                style={[
                  styles.publishButton,
                  isTriggering && styles.publishButtonDisabled,
                ]}>
                {isTriggering ? (
                  <ActivityIndicator color={colors.background} size="small" />
                ) : (
                  <Text style={styles.publishButtonText}>
                    Publish to the show
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

      <Modal
        visible={showPaywall}
        animationType="slide"
        onRequestClose={() => setShowPaywall(false)}>
        <PricingPreview
          onComplete={() => setShowPaywall(false)}
          onClose={() => setShowPaywall(false)}
        />
      </Modal>
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
  },
  headerTitle: {
    flex: 1,
    marginLeft: 12,
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
  launchBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radius.controlLg,
    backgroundColor: colors.proTint,
    borderWidth: 1,
    borderColor: colors.accentPurple,
  },
  launchBannerText: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  setupCard: {
    backgroundColor: colors.overlay2,
    borderRadius: radius.cardLg,
    padding: layout.cardPadding,
    marginHorizontal: layout.screenPadding,
    marginBottom: layout.gridGap,
  },
  setupTitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  setupRow: {
    flexDirection: 'row',
  },
  setupInput: {
    flex: 1,
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 14,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    marginLeft: 8,
  },
  listContainer: {
    flex: 1,
    marginHorizontal: 16,
  },
  listContent: {
    paddingBottom: 8,
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
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  footerSummary: {
    flex: 1,
  },
  footerCount: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  footerTotal: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  uploadButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.controlLg,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  uploadButtonDisabled: {
    backgroundColor: colors.border,
  },
  uploadButtonText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: '700',
  },
  publishButton: {
    backgroundColor: colors.success,
    borderRadius: radius.controlLg,
    paddingVertical: 14,
    alignItems: 'center',
  },
  publishButtonDisabled: {
    backgroundColor: colors.border,
  },
  publishButtonText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: '700',
  },
  errorText: {
    color: colors.error,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 8,
  },
  messageText: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 8,
  },
  messageSuccess: {
    color: colors.success,
  },
  messageError: {
    color: colors.error,
  },
});
