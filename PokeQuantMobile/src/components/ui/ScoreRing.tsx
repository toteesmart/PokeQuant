import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors } from '../../constants/colors';
import { type_, weight } from '../../constants/theme';

type Segment = { fraction: number; color: string };

type Props = {
  /** Ring diameter in px. */
  size?: number;
  strokeWidth?: number;
  /** Single-value mode: 0..1 fill of `color` over the track. */
  value?: number;
  color?: string;
  /** Multi-segment mode: fractions should sum to ≤1. */
  segments?: Segment[];
  trackColor?: string;
  /** Center label (big number) + optional sublabel. */
  label?: string;
  sublabel?: string;
};

/** SVG arc ring for composed metrics — the data-viz trick from the
 *  reference: a grade/health read that's glanceable at thumbnail size.
 *  Green positive, red negative, blue neutral per the color contract. */
export function ScoreRing({
  size = 56,
  strokeWidth = 5,
  value,
  color = colors.primary,
  segments,
  trackColor = colors.overlay4,
  label,
  sublabel,
}: Props) {
  const r = (size - strokeWidth) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;

  const arcs: Segment[] =
    segments ?? (value != null ? [{ fraction: value, color }] : []);

  let offset = 0;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle
          cx={c}
          cy={c}
          r={r}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {arcs.map((seg, i) => {
          const frac = Math.max(0, Math.min(1, seg.fraction));
          const dash = frac * circumference;
          // Each segment starts where the previous ended; -90° so the
          // ring opens at 12 o'clock.
          const rotation = -90 + offset * 360;
          offset += frac;
          return (
            <Circle
              key={i}
              cx={c}
              cy={c}
              r={r}
              stroke={seg.color}
              strokeWidth={strokeWidth}
              fill="none"
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeLinecap="round"
              transform={`rotate(${rotation} ${c} ${c})`}
            />
          );
        })}
      </Svg>
      {label != null || sublabel != null ? (
        <View style={styles.center} pointerEvents="none">
          {label != null ? <Text style={styles.label}>{label}</Text> : null}
          {sublabel != null ? (
            <Text style={styles.sublabel}>{sublabel}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: colors.text,
    fontSize: type_.meta,
    fontWeight: weight.heavy,
  },
  sublabel: {
    color: colors.textMuted,
    fontSize: type_.micro,
    fontWeight: weight.semibold,
    marginTop: 1,
  },
});
