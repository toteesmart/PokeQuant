import { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors } from '../constants/colors';

type NumericStepperProps = {
  label: string;
  value: number;
  step: number;
  min?: number;
  max?: number;
  decimalPlaces?: number;
  onChange: (value: number) => void;
};

function decimalPlacesFromStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 2;
  const s = step.toString();
  if (s.includes('e-')) {
    return parseInt(s.split('e-')[1] ?? '2', 10);
  }
  if (s.includes('.')) {
    return (s.split('.')[1] ?? '').length;
  }
  return 0;
}

function clampAndStep(
  value: number,
  step: number,
  min?: number,
  max?: number
): number {
  const places = decimalPlacesFromStep(step);
  let v = Math.round(value / step) * step;
  v = Number(v.toFixed(places));
  if (min !== undefined) v = Math.max(min, v);
  if (max !== undefined) v = Math.min(max, v);
  return v;
}

function formatValue(value: number, decimalPlaces: number): string {
  return value.toFixed(decimalPlaces);
}

export function NumericStepper({
  label,
  value,
  step,
  min,
  max,
  decimalPlaces = 2,
  onChange,
}: NumericStepperProps) {
  const [text, setText] = useState(formatValue(value, decimalPlaces));
  const [isValid, setIsValid] = useState(true);

  useEffect(() => {
    setText(formatValue(value, decimalPlaces));
    setIsValid(true);
  }, [value, decimalPlaces]);

  const validateAndUpdate = (raw: string) => {
    setText(raw);
    if (raw === '' || raw === '.' || raw === '-') {
      setIsValid(false);
      return;
    }
    const parsed = Number.parseFloat(raw);
    if (Number.isNaN(parsed)) {
      setIsValid(false);
      return;
    }
    if (min !== undefined && parsed < min) {
      setIsValid(false);
      return;
    }
    if (max !== undefined && parsed > max) {
      setIsValid(false);
      return;
    }
    setIsValid(true);
  };

  const onBlur = () => {
    const parsed = Number.parseFloat(text);
    if (Number.isNaN(parsed)) {
      setText(formatValue(value, decimalPlaces));
      setIsValid(true);
      return;
    }
    const clamped = clampAndStep(parsed, step, min, max);
    onChange(clamped);
  };

  const decrement = () => {
    onChange(clampAndStep(value - step, step, min, max));
  };

  const increment = () => {
    onChange(clampAndStep(value + step, step, min, max));
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <TouchableOpacity
          style={styles.button}
          activeOpacity={0.7}
          onPress={decrement}>
          <Text style={styles.buttonText}>-</Text>
        </TouchableOpacity>
        <TextInput
          style={[styles.input, !isValid && styles.inputInvalid]}
          keyboardType="decimal-pad"
          value={text}
          onChangeText={validateAndUpdate}
          onBlur={onBlur}
          placeholder="0.00"
          placeholderTextColor={colors.textMuted}
        />
        <TouchableOpacity
          style={styles.button}
          activeOpacity={0.7}
          onPress={increment}>
          <Text style={styles.buttonText}>+</Text>
        </TouchableOpacity>
      </View>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  button: {
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  buttonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
    lineHeight: 18,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 14,
    textAlign: 'center',
    marginHorizontal: 6,
  },
  inputInvalid: {
    borderColor: colors.error,
  },
});
