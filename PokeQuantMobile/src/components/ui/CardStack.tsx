import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { colors } from '../../constants/colors';
import { CARD_ASPECT_RATIO, radius, spacing, type_, weight } from '../../constants/theme';

type Props = {
  /** Card art URIs; the first 3 render overlapped, the rest collapse
   *  into a +N chip. */
  images: string[];
  /** Total item count when it exceeds images.length (drives +N). */
  totalCount?: number;
  label: string;
  /** Preformatted total shown under the label ('$24', '—'). */
  value?: string;
};

/** Overlapped card-thumb stack + label + total — one side of a matchup
 *  header (generalized from the trade sheet's SideStack). */
export function CardStack({ images, totalCount, label, value }: Props) {
  const shown = images.slice(0, 3);
  const extra = (totalCount ?? images.length) - shown.length;
  return (
    <View style={styles.side}>
      <View style={styles.stackRow}>
        {shown.length === 0 ? (
          <View style={[styles.thumb, styles.placeholder]} />
        ) : (
          shown.map((uri, i) => (
            <Image
              key={`${uri}-${i}`}
              source={{ uri }}
              style={[styles.thumb, i > 0 && styles.thumbOverlap]}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ))
        )}
        {extra > 0 ? (
          <View style={[styles.moreChip, styles.thumbOverlap]}>
            <Text style={styles.moreText}>+{extra}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.total}>{value ?? '—'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  side: { flex: 1, alignItems: 'center' },
  stackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 64,
  },
  thumb: {
    width: 64 * CARD_ASPECT_RATIO,
    height: 64,
    borderRadius: radius.thumb,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  thumbOverlap: { marginLeft: -18 },
  placeholder: { backgroundColor: colors.surface },
  moreChip: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.overlay3,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  moreText: {
    color: colors.text,
    fontSize: type_.meta,
    fontWeight: weight.bold,
  },
  label: {
    color: colors.textMuted,
    fontSize: type_.label,
    fontWeight: weight.semibold,
    marginTop: spacing.lg,
  },
  total: {
    color: colors.text,
    fontSize: type_.display,
    fontWeight: weight.heavy,
    marginTop: spacing.xs,
  },
});
