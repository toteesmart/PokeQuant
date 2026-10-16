// Horizontal filter bar for EventSearchScreen: sort + vendor/set/rarity/
// condition/price dropdowns. Owns the option lists and the mapping from
// dropdown values to EventSearchFilters patches.

import { memo, useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Dropdown } from '../Dropdown';
import type {
  EventDistinctValues,
  EventSearchFilters,
  EventSearchSort,
} from '../../db/eventCatalogDb';

const SORT_OPTIONS: { value: EventSearchSort; label: string }[] = [
  { value: 'name', label: 'Name A-Z' },
  { value: 'price-low', label: 'Price: Low' },
  { value: 'price-high', label: 'Price: High' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'set', label: 'Set' },
];

const SORT_LABELS: Record<string, string> = Object.fromEntries(
  SORT_OPTIONS.map((o) => [o.value, o.label]),
);
const SORT_VALUES = SORT_OPTIONS.map((o) => o.value);

const PRICE_OPTIONS: { value: string; label: string; min?: number; max?: number }[] = [
  { value: '', label: 'All Prices' },
  { value: 'under10', label: '< $10', min: 0, max: 9.99 },
  { value: '10to50', label: '$10 - $50', min: 10, max: 50 },
  { value: '50to100', label: '$50 - $100', min: 50, max: 100 },
  { value: 'over100', label: '> $100', min: 100 },
];

const PRICE_LABELS: Record<string, string> = Object.fromEntries(
  PRICE_OPTIONS.map((o) => [o.value, o.label]),
);
const PRICE_VALUES = PRICE_OPTIONS.map((o) => o.value);

const withAll = (values: string[]) => ['', ...values];

type Props = {
  sort: EventSearchSort;
  onSortChange: (sort: EventSearchSort) => void;
  filters: EventSearchFilters;
  onPatchFilters: (patch: Partial<EventSearchFilters>) => void;
  filterOptions: EventDistinctValues;
};

export const EventFilterBar = memo(function EventFilterBar({
  sort,
  onSortChange,
  filters,
  onPatchFilters,
  filterOptions,
}: Props) {
  const handlePriceChange = useCallback(
    (value: string) => {
      const option = PRICE_OPTIONS.find((o) => o.value === value);
      onPatchFilters({ minPrice: option?.min, maxPrice: option?.max });
    },
    [onPatchFilters],
  );

  return (
    <View style={styles.filterBar}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterScroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.filterItem}>
          <Dropdown
            label="Sort"
            options={SORT_VALUES}
            value={sort}
            onChange={(value) => onSortChange(value as EventSearchSort)}
            labels={SORT_LABELS}
          />
        </View>
        <View style={styles.filterItem}>
          <Dropdown
            label="Vendor"
            options={withAll(filterOptions.vendors)}
            value={filters.vendorName ?? ''}
            onChange={(value) => onPatchFilters({ vendorName: value || undefined })}
            labels={{ '': 'All Vendors' }}
          />
        </View>
        <View style={styles.filterItem}>
          <Dropdown
            label="Set"
            options={withAll(filterOptions.sets)}
            value={filters.setName ?? ''}
            onChange={(value) => onPatchFilters({ setName: value || undefined })}
            labels={{ '': 'All Sets' }}
          />
        </View>
        <View style={styles.filterItem}>
          <Dropdown
            label="Rarity"
            options={withAll(filterOptions.rarities)}
            value={filters.rarity ?? ''}
            onChange={(value) => onPatchFilters({ rarity: value || undefined })}
            labels={{ '': 'All Rarities' }}
          />
        </View>
        <View style={styles.filterItem}>
          <Dropdown
            label="Condition"
            options={withAll(filterOptions.conditions)}
            value={filters.condition ?? ''}
            onChange={(value) => onPatchFilters({ condition: value || undefined })}
            labels={{ '': 'All Conditions' }}
          />
        </View>
        <View style={styles.filterItem}>
          <Dropdown
            label="Price"
            options={PRICE_VALUES}
            value={
              filters.minPrice === 0 && filters.maxPrice === 9.99
                ? 'under10'
                : filters.minPrice === 10 && filters.maxPrice === 50
                  ? '10to50'
                  : filters.minPrice === 50 && filters.maxPrice === 100
                    ? '50to100'
                    : filters.minPrice === 100 && filters.maxPrice === undefined
                      ? 'over100'
                      : ''
            }
            onChange={handlePriceChange}
            labels={PRICE_LABELS}
          />
        </View>
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  filterBar: {
    marginTop: 8,
    height: 88,
  },
  filterScroll: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingRight: 16,
    gap: 8,
  },
  filterItem: {
    width: 140,
  },
});
