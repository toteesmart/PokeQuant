import { memo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '../../constants/colors';
import type { ConditionCode } from '../types/scan';

type Props = {
  code: ConditionCode;
  label: string;
  selected: boolean;
  onPress: (code: ConditionCode) => void;
};

export const ConditionChip = memo(function ConditionChip({
  code,
  label,
  selected,
  onPress,
}: Props) {
  return (
    <Pressable
      onPress={() => onPress(code)}
      style={[styles.chip, selected && styles.chipSelected]}
      hitSlop={4}
    >
      <Text style={[styles.text, selected && styles.textSelected]}>
        {code} · {label}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipSelected: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(59,130,246,0.15)',
  },
  text: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  textSelected: {
    color: colors.primary,
  },
});
