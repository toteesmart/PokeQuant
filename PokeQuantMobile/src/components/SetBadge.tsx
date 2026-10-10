import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

/** Deterministic per-set badge color — same set always gets the same hue. */
export function setTone(set?: string): { fg: string; bg: string } {
  let h = 0;
  const s = set ?? '?';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return {
    fg: `hsl(${hue}, 72%, 62%)`,
    bg: `hsla(${hue}, 72%, 62%, 0.14)`,
  };
}

export function SetBadge({
  set,
  style,
}: {
  set?: string | null;
  style?: ViewStyle;
}) {
  if (!set) return null;
  const tone = setTone(set);
  return (
    <View
      style={[
        styles.badge,
        { borderColor: tone.fg, backgroundColor: tone.bg },
        style,
      ]}
    >
      <Text style={[styles.text, { color: tone.fg }]} numberOfLines={1}>
        {set}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    maxWidth: '100%',
  },
  text: { fontSize: 11, fontWeight: '700' },
});
