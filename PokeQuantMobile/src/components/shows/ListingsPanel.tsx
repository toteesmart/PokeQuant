// "My Listings" tab of ShowVendorScreen: uploaded rows + publish footer
// (listing errors, publish result message, trigger-snapshot button).

import { memo } from 'react';
import {
  ActivityIndicator,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import { colors } from '../../constants/colors';
import { showVendorPanelStyles as styles } from './showVendorPanelStyles';
import type { ShowListingItem } from '../../services/showVendorService';

type Props = {
  isLoadingListings?: boolean;
  listingData: ShowListingItem[];
  listingsError?: string | null;
  renderItem: ListRenderItem<ShowListingItem>;
  publishMessage: { text: string; isError: boolean } | null;
  isTriggering?: boolean;
  onPublish: () => void;
};

export const ListingsPanel = memo(function ListingsPanel({
  isLoadingListings,
  listingData,
  listingsError,
  renderItem,
  publishMessage,
  isTriggering,
  onPublish,
}: Props) {
  return (
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
            renderItem={renderItem}
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
          onPress={onPublish}
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
  );
});
