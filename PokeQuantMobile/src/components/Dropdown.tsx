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
  onChange?: (value: string) => void;
  onSelect?: (value: string) => void;
  labels?: Record<string, string>;
};

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

  const handleSelect = (option: string) => {
    const handler = onSelect ?? onChange;
    if (handler) {
      handler(option);
    }
    setModalVisible(false);
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
      <View
        style={{
          height: 44,
          width: '100%',
          position: 'relative',
        }}>
        <TouchableOpacity
          onPress={() => setModalVisible(true)}
          activeOpacity={0.7}
          style={{
            flex: 1,
            backgroundColor: '#161b22',
            borderColor: '#30363d',
            borderWidth: 1,
            borderRadius: 8,
            justifyContent: 'center',
            paddingHorizontal: 12,
          }}>
          <Text
            style={{ color: value ? '#c9d1d9' : '#8b949e' }}
            numberOfLines={1}>
            {displayValue || 'Select...'}
          </Text>
        </TouchableOpacity>

        <Modal
          visible={modalVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setModalVisible(false)}>
          <View style={styles.modalOverlay}>
            <Pressable
              style={styles.backdrop}
              onPress={() => setModalVisible(false)}
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
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  backdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
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
