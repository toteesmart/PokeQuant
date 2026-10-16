import { useCallback, useState } from 'react';
import { type ListRenderItem } from '@shopify/flash-list';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';
import { layout, radius } from '../constants/theme';
import { ShowVendorInventoryRow } from '../components/ShowVendorInventoryRow';
import { ShowVendorListingRow } from '../components/ShowVendorListingRow';
import { GlassBackButton, SegmentedPills } from '../components/ui';
import { VendorSetupCard } from '../components/shows/VendorSetupCard';
import { PickCardsPanel } from '../components/shows/PickCardsPanel';
import { ListingsPanel } from '../components/shows/ListingsPanel';
import { useShowVendor } from '../hooks/useShowVendor';
import { PricingPreview } from '../components/PricingPreview';
import type { ShowItem } from '../services/ShowListService';
import type { ShowListingItem } from '../services/showVendorService';
import type { InventoryCard } from '../store/inventoryStore';

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
  const v = useShowVendor(show);

  const renderSelectItem: ListRenderItem<InventoryCard> = useCallback(
    ({ item }) => <ShowVendorInventoryRow showId={show.id} card={item} />,
    [show.id],
  );

  const renderListingItem: ListRenderItem<ShowListingItem> = useCallback(
    ({ item }) => <ShowVendorListingRow showId={show.id} item={item} />,
    [show.id],
  );

  const { handleUpload } = v;
  const onUpload = useCallback(async () => {
    if (await handleUpload()) setActiveTab('listings');
  }, [handleUpload]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <View style={styles.inner}>
        <View style={[styles.header, { paddingTop: insets.top + layout.screenTop }]}>
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

          <SegmentedPills tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />
        </View>

        {!v.paymentsLive && (
          <View style={styles.launchBanner}>
            <Ionicons name="information-circle-outline" size={14} color={colors.accentPurple} />
            <Text style={styles.launchBannerText}>
              Vendor tools are free during launch — a Pro plan will be required after launch pricing
              ends.
            </Text>
          </View>
        )}

        <VendorSetupCard
          vendorName={v.effectiveVendorName}
          onNameChange={v.setVendorName}
          vendorTable={v.effectiveVendorTable}
          onTableChange={v.setVendorTable}
        />

        {activeTab === 'select' ? (
          <PickCardsPanel
            searchQuery={v.searchQuery}
            onSearchChange={v.setSearchQuery}
            filteredInventory={v.filteredInventory}
            renderItem={renderSelectItem}
            selectedCount={v.selectedCount}
            selectedTotal={v.selectedTotal}
            uploadError={v.uploadError}
            isUploading={v.isUploading}
            canUpload={v.selectedCount > 0 && !!v.effectiveVendorName.trim()}
            onUpload={onUpload}
          />
        ) : (
          <ListingsPanel
            isLoadingListings={v.isLoadingListings}
            listingData={v.listingData}
            listingsError={v.listingsError}
            renderItem={renderListingItem}
            publishMessage={v.publishMessage}
            isTriggering={v.isTriggering}
            onPublish={v.handlePublish}
          />
        )}
      </View>

      <Modal
        visible={v.showPaywall}
        animationType="slide"
        onRequestClose={() => v.setShowPaywall(false)}
      >
        <PricingPreview
          onComplete={() => v.setShowPaywall(false)}
          onClose={() => v.setShowPaywall(false)}
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
});
