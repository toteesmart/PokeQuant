import { memo, useCallback, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors } from '../constants/colors';
import { GlassSheet } from './ui';

type DropdownProps = {
  label?: string;
  options: string[];
  value: string;
  onChange?: (value: string) => void;
  onSelect?: (value: string) => void;
  labels?: Record<string, string>;
};

type OptionItemProps = {
  option: string;
  selected: boolean;
  display: string;
  onPress: (option: string) => void;
};

const OptionItem = memo(function OptionItem({
  option,
  selected,
  display,
  onPress,
}: OptionItemProps) {
  return (
    <TouchableOpacity
      style={[styles.option, selected && styles.optionSelected]}
      activeOpacity={0.7}
      onPress={() => onPress(option)}>
      <Text
        style={[
          styles.optionText,
          selected && styles.optionTextSelected,
        ]}>
        {display}
      </Text>
    </TouchableOpacity>
  );
});

export function Dropdown({
  label,
  options,
  value,
  onChange,
  onSelect,
  labels,
}: DropdownProps) {
  const [modalVisible, setModalVisible] = useState(false);

  const displayValue = labels?.[value] ?? value;

  const handleSelect = useCallback(
    (option: string) => {
      const handler = onSelect ?? onChange;
      if (handler) {
        handler(option);
      }
      setModalVisible(false);
    },
    [onChange, onSelect]
  );

  const renderItem = useCallback(
    ({ item }: { item: string }) => (
      <OptionItem
        option={item}
        selected={item === value}
        display={labels?.[item] ?? item}
        onPress={handleSelect}
      />
    ),
    [value, labels, handleSelect]
  );

  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View
        style={{
          height: 44,
          width: '100%',
          position: 'relative',
        }}>
        <TouchableOpacity
          onPress={() => setModalVisible(true)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={label ? `${label}: ${displayValue || 'Select'}` : displayValue || 'Select'}
          style={{
            flex: 1,
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: 8,
            justifyContent: 'center',
            paddingHorizontal: 12,
          }}>
          <Text
            style={{ color: value ? colors.text : colors.textMuted }}
            numberOfLines={1}>
            {displayValue || 'Select...'}
          </Text>
        </TouchableOpacity>

        {modalVisible ? (
          <GlassSheet
            title={label ? `Select ${label.toLowerCase()}` : 'Select'}
            onClose={() => setModalVisible(false)}
            scrollable={false}
            contentStyle={{ paddingHorizontal: 0 }}>
            <FlashList
              data={options}
              keyExtractor={(item) => item}
              renderItem={renderItem}
              contentContainerStyle={styles.modalList}
              showsVerticalScrollIndicator={false}
              style={{ flex: 1 }}
            />
          </GlassSheet>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  label: {
    color: colors.text,
    fontSize: 12,
    marginBottom: 4,
    fontWeight: '600',
  },
  modalList: {
    paddingVertical: 8,
  },
  option: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  optionSelected: {
    backgroundColor: colors.surfaceLight,
  },
  optionText: {
    color: colors.text,
    fontSize: 14,
  },
  optionTextSelected: {
    color: colors.primary,
    fontWeight: '600',
  },
});
