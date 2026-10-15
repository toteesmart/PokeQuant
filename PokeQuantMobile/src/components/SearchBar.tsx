// SearchBar — the inventory list filter field with a trailing slot
// for the Select toggle (one unified list toolbar).
import type { ReactNode } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import { controls, radius, spacing } from '../constants/theme';

export function SearchBar({
  value,
  onChange,
  trailing,
}: {
  value: string;
  onChange: (text: string) => void;
  trailing?: ReactNode;
}) {
  return (
    <View style={searchStyles.container}>
      <Ionicons name="search-outline" size={16} color={colors.textMuted} />
      <TextInput
        style={searchStyles.input}
        value={value}
        onChangeText={onChange}
        placeholder="Search active inventory..."
        placeholderTextColor={colors.textMuted}
        autoCorrect={false}
        autoCapitalize="none"
      />
      {trailing}
    </View>
  );
}

const searchStyles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.overlay3,
    borderRadius: radius.controlLg,
    paddingHorizontal: spacing['2xl'],
    minHeight: controls.minTouchTarget,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    marginLeft: 8,
  },
});
