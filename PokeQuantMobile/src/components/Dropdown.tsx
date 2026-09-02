import { useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors } from '../constants/colors';

type DropdownProps = {
  label?: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
  labels?: Record<string, string>;
};

export function Dropdown({
  label,
  options,
  value,
  onChange,
  labels,
}: DropdownProps) {
  const [visible, setVisible] = useState(false);

  const displayValue = labels?.[value] ?? value;

  const handleSelect = (option: string) => {
    onChange(option);
    setVisible(false);
  };

  const renderOption = ({ item }: { item: string }) => {
    const selected = item === value;
    const displayOption = labels?.[item] ?? item;
    return (
      <TouchableOpacity
        style={[styles.option, selected && styles.optionSelected]}
        activeOpacity={0.7}
        onPress={() => handleSelect(item)}>
        <Text
          style={[
            styles.optionText,
            selected && styles.optionTextSelected,
          ]}>
          {displayOption}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TouchableOpacity
        style={styles.trigger}
        activeOpacity={0.7}
        onPress={() => setVisible(true)}>
        <Text style={styles.value} numberOfLines={1}>
          {displayValue}
        </Text>
        <Text style={styles.chevron}>▼</Text>
      </TouchableOpacity>

      <Modal
        animationType="fade"
        transparent
        visible={visible}
        onRequestClose={() => setVisible(false)}>
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.backdrop}
            onPress={() => setVisible(false)}
          />
          <View style={styles.modalContent}>
            <FlatList
              data={options}
              keyExtractor={(item) => item}
              renderItem={renderOption}
              contentContainerStyle={styles.modalList}
              showsVerticalScrollIndicator={false}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  label: {
    color: colors.text,
    fontSize: 12,
    marginBottom: 4,
    fontWeight: '600',
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 44,
  },
  value: {
    color: colors.text,
    fontSize: 13,
    flex: 1,
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 10,
    marginLeft: 4,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modalContent: {
    width: '80%',
    maxHeight: '70%',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
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
