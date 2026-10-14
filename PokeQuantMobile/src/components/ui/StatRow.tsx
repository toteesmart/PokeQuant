import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../constants/colors';
import { spacing, type_, weight } from '../../constants/theme';

type Props = {
  label: string;
  value: string;
  valueColor?: string;
};

/** Labeled stat line — the reference's detail-card row (generalized
 *  from the trade sheet's BreakRow). Muted label left, value right. */
export function StatRow({ label, value, valueColor }: Props) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, valueColor ? { color: valueColor } : null]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  label: {
    color: colors.textMuted,
    fontSize: type_.caption,
    fontWeight: weight.semibold,
  },
  value: {
    color: colors.text,
    fontSize: type_.body,
    fontWeight: weight.semibold,
  },
});
