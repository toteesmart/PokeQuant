import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../constants/colors';

type DropdownProps = {
  label: string;
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
  const [isOpen, setIsOpen] = useState(false);

  const displayValue = labels?.[value] ?? value;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        style={styles.button}
        activeOpacity={0.7}
        onPress={() => setIsOpen((v) => !v)}>
        <Text style={styles.value} numberOfLines={1}>
          {displayValue}
        </Text>
        <Text style={styles.chevron}>{isOpen ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {isOpen && (
        <View style={styles.list}>
          {options.map((option) => {
            const selected = option === value;
            const displayOption = labels?.[option] ?? option;
            return (
              <TouchableOpacity
                key={option}
                style={[styles.option, selected && styles.optionSelected]}
                activeOpacity={0.7}
                onPress={() => {
                  onChange(option);
                  setIsOpen(false);
                }}>
                <Text
                  style={[
                    styles.optionText,
                    selected && styles.optionTextSelected,
                  ]}>
                  {displayOption}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  label: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 4,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
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
  list: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    marginTop: 4,
    overflow: 'hidden',
  },
  option: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  optionSelected: {
    backgroundColor: colors.surfaceLight,
  },
  optionText: {
    color: colors.text,
    fontSize: 13,
  },
  optionTextSelected: {
    color: colors.primary,
    fontWeight: '600',
  },
});
