import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors } from '../constants/colors';

type Props = {
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
};

export const ShutterButton = memo(function ShutterButton({
  onPress,
  disabled,
  loading,
}: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.outer,
        (disabled || pressed) && styles.disabled,
      ]}
    >
      <View style={[styles.inner, loading && styles.loading]} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  outer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  disabled: {
    opacity: 0.5,
  },
  inner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.text,
  },
  loading: {
    backgroundColor: colors.primary,
  },
});
