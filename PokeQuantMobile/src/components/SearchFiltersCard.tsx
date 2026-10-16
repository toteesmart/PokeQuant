// SearchFiltersCard — the filter/sort card inside SearchBuyScreen's
// Disclosure. Owns its styles so components/ never imports screen styles.
import { memo } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../constants/colors';
import {
  LANGUAGES,
  PRODUCT_TYPES,
  RARITIES,
  SORT_OPTIONS,
} from '../hooks/useCatalogSearch';
import { Dropdown } from './Dropdown';

type Props = {
  rarity: string;
  setRarity: (value: string) => void;
  productType: string;
  setProductType: (value: string) => void;
  language: string;
  setLanguage: (value: string) => void;
  sortBy: string;
  setSortBy: (value: string) => void;
  maxPrice: string;
  setMaxPrice: (value: string) => void;
};

export const SearchFiltersCard = memo(function SearchFiltersCard({
  rarity,
  setRarity,
  productType,
  setProductType,
  language,
  setLanguage,
  sortBy,
  setSortBy,
  maxPrice,
  setMaxPrice,
}: Props) {
  return (
    <View style={styles.filterCard}>
      {/* filterRow zIndex order is load-bearing: an open Dropdown sheet
          renders inside its row, so earlier rows must stack above later
          ones or their sheets get clipped. */}
      <View style={[styles.filterRow, { zIndex: 3 }]}>
        <View style={styles.filterHalfLeft}>
          <Text style={styles.filterLabel}>Rarity</Text>
          <Dropdown options={RARITIES} value={rarity} onSelect={setRarity} />
        </View>
        <View style={styles.filterHalfRight}>
          <Text style={styles.filterLabel}>Product type</Text>
          <Dropdown options={PRODUCT_TYPES} value={productType} onSelect={setProductType} />
        </View>
      </View>

      <View style={[styles.filterRow, { zIndex: 2 }]}>
        <View style={styles.filterHalfLeft}>
          <Text style={styles.filterLabel}>Language</Text>
          <Dropdown options={LANGUAGES} value={language} onSelect={setLanguage} />
        </View>
        <View style={styles.filterHalfRight}>
          <Text style={styles.filterLabel}>Sort by</Text>
          <Dropdown options={SORT_OPTIONS} value={sortBy} onSelect={setSortBy} />
        </View>
      </View>

      <View style={[styles.filterRow, { zIndex: 1, marginBottom: 0 }]}>
        <View style={styles.filterHalfLeft}>
          <Text style={styles.filterLabel}>Max price ($)</Text>
          <TextInput
            style={styles.numberInput}
            placeholder="e.g. 50"
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
            value={maxPrice}
            onChangeText={setMaxPrice}
          />
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  filterCard: {
    backgroundColor: colors.overlay2,
    borderRadius: 12,
    padding: 12,
    marginBottom: 4,
  },
  filterRow: {
    flexDirection: 'row',
    marginBottom: 14,
    width: '100%',
  },
  filterHalfLeft: {
    flex: 1,
    paddingRight: 6,
  },
  filterHalfRight: {
    flex: 1,
    paddingLeft: 6,
  },
  filterLabel: {
    color: colors.text,
    fontSize: 12,
    marginBottom: 4,
    fontWeight: '600',
  },
  numberInput: {
    minHeight: 44,
    backgroundColor: colors.overlay3,
    borderRadius: 8,
    color: colors.text,
    paddingHorizontal: 12,
  },
});
