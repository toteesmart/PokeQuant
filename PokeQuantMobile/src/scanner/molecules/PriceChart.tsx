import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { colors } from '../../constants/colors';
import type { PricePoint } from '../../db/catalogDb';

const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 4;

type Props = {
  points: PricePoint[]; // ascending by date
  height?: number;
};

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

export function PriceChart({ points, height = 150 }: Props) {
  const [width, setWidth] = useState(0);
  const [scrubIdx, setScrubIdx] = useState<number | null>(null);
  const geomRef = useRef<{ width: number; times: number[]; minT: number; spanT: number }>({
    width: 0,
    times: [],
    minT: 0,
    spanT: 1,
  });

  const geom = useMemo(() => {
    if (points.length < 2 || width <= 0) return null;
    const times = points.map((p) => new Date(`${p.date}T00:00:00`).getTime());
    const prices = points.map((p) => p.marketPrice);
    const minT = times[0];
    const spanT = Math.max(1, times[times.length - 1] - minT);
    let minP = Math.min(...prices);
    let maxP = Math.max(...prices);
    if (minP === maxP) {
      minP *= 0.9;
      maxP *= 1.1;
    }
    const padP = (maxP - minP) * 0.08;
    minP -= padP;
    maxP += padP;
    const innerW = width - PAD_L - PAD_R;
    const innerH = height - PAD_T - PAD_B;
    const x = (t: number) => PAD_L + ((t - minT) / spanT) * innerW;
    const y = (p: number) => PAD_T + (1 - (p - minP) / (maxP - minP)) * innerH;
    const line =
      `M ${x(times[0]).toFixed(1)} ${y(prices[0]).toFixed(1)} ` +
      times
        .slice(1)
        .map((t, i) => `L ${x(t).toFixed(1)} ${y(prices[i + 1]).toFixed(1)}`)
        .join(' ');
    const area =
      `${line} L ${x(times[times.length - 1]).toFixed(1)} ${height - PAD_B} ` +
      `L ${x(times[0]).toFixed(1)} ${height - PAD_B} Z`;
    const rising = prices[prices.length - 1] >= prices[0];
    const lineColor = rising ? colors.velocityPositive : colors.velocityNegative;
    geomRef.current = { width, times, minT, spanT };
    return { line, area, x, y, lineColor, times, prices, rising };
  }, [points, width, height]);

  const handleTouch = (locationX: number) => {
    const g = geomRef.current;
    if (!g || g.times.length < 2 || g.width <= 0) return;
    const innerW = g.width - PAD_L - PAD_R;
    const frac = Math.min(1, Math.max(0, (locationX - PAD_L) / innerW));
    const target = g.minT + frac * g.spanT;
    // Binary search nearest timestamp.
    let lo = 0;
    let hi = g.times.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (g.times[mid] <= target) lo = mid;
      else hi = mid;
    }
    const idx =
      Math.abs(g.times[lo] - target) <= Math.abs(g.times[hi] - target)
        ? lo
        : hi;
    setScrubIdx((prev) => (prev === idx ? prev : idx));
  };

  // points swaps when the finish or timeframe changes — a stale index would
  // land outside the shorter array and crash the readout.
  useEffect(() => {
    setScrubIdx(null);
  }, [points]);

  // Touch anywhere scrubs — locationX maps to a date, then to the nearest
  // actual price event (points are unevenly spaced sparse events).
  // Claim the gesture ONLY on horizontal intent: an unconditional true
  // would eat the sheet's vertical scroll and feel like a freeze.
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (e, g) =>
        Math.abs(g.dx) > Math.abs(g.dy) && Math.abs(g.dx) > 4,
      onPanResponderTerminationRequest: () => true,
      onPanResponderGrant: (e) => handleTouch(e.nativeEvent.locationX),
      onPanResponderMove: (e) => handleTouch(e.nativeEvent.locationX),
      onPanResponderRelease: () => {},
      onPanResponderTerminate: () => {},
    })
  ).current;

  if (points.length < 2) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>Not enough history to chart</Text>
      </View>
    );
  }

  const last = points.length - 1;
  const shown = Math.min(scrubIdx ?? last, last);
  const sp = points[shown] ?? points[last];
  const sx = geom ? geom.x(geom.times[shown] ?? geom.times[last]) : 0;
  const sy = geom ? geom.y(geom.prices[shown] ?? geom.prices[last]) : 0;

  return (
    <View
      style={{ height }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      {...pan.panHandlers}
    >
      {geom ? (
        <>
          <Svg width={width} height={height}>
            <Defs>
              <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={geom.lineColor} stopOpacity="0.28" />
                <Stop offset="1" stopColor={geom.lineColor} stopOpacity="0" />
              </LinearGradient>
            </Defs>
            <Path d={geom.area} fill="url(#fade)" />
            <Path
              d={geom.line}
              fill="none"
              stroke={geom.lineColor}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {scrubIdx !== null ? (
              <Path
                d={`M ${sx} ${PAD_T} L ${sx} ${height - PAD_B}`}
                stroke={colors.textMuted}
                strokeWidth={1}
                strokeDasharray="3,3"
              />
            ) : null}
            <Circle
              cx={geom.x(geom.times[last])}
              cy={geom.y(geom.prices[last])}
              r={4}
              fill={geom.lineColor}
              stroke={colors.background}
              strokeWidth={1.5}
            />
            {scrubIdx !== null && scrubIdx !== last ? (
              <Circle
                cx={sx}
                cy={sy}
                r={5}
                fill={colors.primary}
                stroke={colors.onAccent} strokeWidth={1.5}
              />
            ) : null}
          </Svg>
          <View style={styles.readout} pointerEvents="none">
            <Text style={styles.readoutPrice}>
              ${sp.marketPrice.toFixed(2)}
            </Text>
            <Text style={styles.readoutDate}>{fmtDate(sp.date)}</Text>
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.textMuted, fontSize: 12 },
  readout: {
    position: 'absolute',
    top: 2,
    right: 8,
    alignItems: 'flex-end',
  },
  readoutPrice: { color: colors.text, fontSize: 14, fontWeight: '700' },
  readoutDate: { color: colors.textMuted, fontSize: 10, marginTop: 1 },
});
