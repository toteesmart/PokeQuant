// "Pick Cards" tab of ShowVendorScreen: inventory search + selection list
// + upload footer (count, sticker total, upload button with busy/disabled).

import { memo } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../constants/colors';
import { showVendorPanelStyles as styles } from './showVendorPanelStyles';
import type { InventoryCard } from '../../store/inventoryStore';

type Props = {
  searchQuery: string;
  onSearchChange: (text: string) => void;
  filteredInventory: InventoryCard[];
  renderItem: ListRenderItem<InventoryCard>;
  selectedCount: number;
  selectedTotal: number;
  uploadError?: string | null;
  isUploading?: boolean;
  canUpload: boolean;
  onUpload: () => void;
};

export const PickCardsPanel = memo(function PickCardsPanel({
  searchQuery,
  onSearchChange,
  filteredInventory,
  renderItem,
  selectedCount,
  selectedTotal,
  uploadError,
  isUploading,
  canUpload,
  onUpload,
}: Props) {
  const uploadDisabled = !canUpload || isUploading;
  return (
    <>
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={16} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search your inventory..."
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={onSearchChange}
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
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            ListFooterComponent={<View style={{ height: 16 }} />}
          />
        )}
      </View>

      <View style={styles.footer}>
        {uploadError ? <Text style={styles.errorText}>{uploadError}</Text> : null}
        <View style={styles.footerRow}>
          <View style={styles.footerSummary}>
            <Text style={styles.footerCount}>{selectedCount} selected</Text>
            <Text style={styles.footerTotal}>${selectedTotal.toFixed(2)} total</Text>
          </View>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={onUpload}
            disabled={uploadDisabled}
            style={[styles.uploadButton, uploadDisabled && styles.uploadButtonDisabled]}
          >
            {isUploading ? (
              <ActivityIndicator color={colors.background} size="small" />
            ) : (
              <Text style={styles.uploadButtonText}>Upload to show</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </>
  );
});
