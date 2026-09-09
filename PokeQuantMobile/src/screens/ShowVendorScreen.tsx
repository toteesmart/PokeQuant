import {
  memo,
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
import { colors } from '../constants/colors';
import { ShowVendorInventoryRow } from '../components/ShowVendorInventoryRow';
import { ShowVendorListingRow } from '../components/ShowVendorListingRow';
import { useInventoryStore, type InventoryCard } from '../store/inventoryStore';
import { useShowVendorStore } from '../store/showVendorStore';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { PricingPreview } from '../components/PricingPreview';
import type { ShowItem } from '../services/ShowListService';
import type { ShowListingItem } from '../services/showVendorService';

const TABS = [
  { key: 'select', label: 'Select Cards' },
  { key: 'listings', label: 'My Listings' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function normalizeSearchTerm(term: string): string {
  return term.toLowerCase().replace(/['.\-]/g, '').trim();
}

function getSearchableText(card: InventoryCard): string {
  return [
    card.name,
    card.number,
    card.set,
    card.productType,
    card.rarity,
    card.condition,
  ]
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .join(' ');
}

type SearchEntry = { card: InventoryCard; haystack: string };

function buildSearchIndex(cards: InventoryCard[]): SearchEntry[] {
  return cards.map((card) => ({
    card,
    haystack: normalizeSearchTerm(getSearchableText(card)),
  }));
}

const SegmentedTabBar = memo(function SegmentedTabBar({
  activeTab,
  onChange,
}: {
  activeTab: TabKey;
  onChange: (tab: TabKey) => void;
}) {
  return (
    <View style={tabStyles.container}>
      {TABS.map((tab) => {
        const isActive = tab.key === activeTab;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[tabStyles.tab, isActive && tabStyles.activeTab]}
            activeOpacity={0.8}
            onPress={() => onChange(tab.key)}>
            <Text
              style={[tabStyles.tabText, isActive && tabStyles.activeTabText]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
});

type Props = {
  show: ShowItem;
  onBack: () => void;
};

export function ShowVendorScreen({ show, onBack }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('select');
  // null = untouched; the derived setup/profile default shows through until
  // the vendor types, so a profile that loads after mount still fills the
  // fields instead of leaving them empty.
  const [vendorName, setVendorName] = useState<string | null>(null);
  const [vendorTable, setVendorTable] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [publishMessage, setPublishMessage] = useState<string | null>(null);
  const [showPaywall, setShowPaywall] = useState(false);

  const activeInventory = useInventoryStore((state) => state.activeInventory);
  const profile = useShowVendorStore((state) => state.profile);
  const setups = useShowVendorStore((state) => state.setups);
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
    !!profile?.isFounder ||
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
  const effectiveVendorTable =
    vendorTable ?? showSetup?.vendorTable ?? profile?.tableDefault ?? '';

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
      setPublishMessage('Catalog published! Attendees can refresh to see it.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPublishMessage(`Publish failed: ${message}`);
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
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <TouchableOpacity onPress={onBack} activeOpacity={0.7}>
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
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

          <SegmentedTabBar activeTab={activeTab} onChange={setActiveTab} />
        </View>

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
                      No listings yet. Switch to Select Cards to add some.
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
                    publishMessage.startsWith('Publish failed')
                      ? styles.messageError
                      : styles.messageSuccess,
                  ]}>
                  {publishMessage}
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
                    Publish to show catalog
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

const tabStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 4,
    marginTop: 12,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 8,
  },
  activeTab: {
    backgroundColor: colors.primary,
  },
  tabText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  activeTabText: {
    color: colors.background,
    fontWeight: 'bold',
  },
});

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
    fontWeight: 'bold',
  },
  showMeta: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
    lineHeight: 15,
  },
  setupCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 12,
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
    backgroundColor: colors.background,
    color: colors.text,
    borderRadius: 8,
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
    borderRadius: 12,
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
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  uploadButtonDisabled: {
    backgroundColor: colors.border,
  },
  uploadButtonText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: 'bold',
  },
  publishButton: {
    backgroundColor: colors.success,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  publishButtonDisabled: {
    backgroundColor: colors.border,
  },
  publishButtonText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: 'bold',
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
