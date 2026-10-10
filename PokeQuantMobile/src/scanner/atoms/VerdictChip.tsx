import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../constants/colors';
import type { CardSignal } from '../../db/catalogDb';

type ActionStyle = { label: string; fg: string; bg: string };

// Engine action vocabulary from quant.snapshot.classify — stamped nightly
// into card_signals. Colors mirror the buy/sell semantics at the table.
const ACTION_STYLES: Record<string, ActionStyle> = {
  SELL_NOW: { label: 'Sell now', fg: '#fff', bg: colors.error },
  SELL_STRENGTH: { label: 'Sell strength', fg: '#fff', bg: '#b45309' },
  BUY_HOLD: { label: 'Buy & hold', fg: '#fff', bg: colors.velocityPositive },
  BUY_FLIP: { label: 'Buy & flip', fg: '#fff', bg: '#0d9488' },
  HOLD: { label: 'Hold / wait', fg: '#fff', bg: colors.warning },
  NEUTRAL: { label: 'Neutral', fg: colors.text, bg: colors.surfaceLight },
};

export function actionStyle(action: string | null | undefined): ActionStyle {
  return ACTION_STYLES[action ?? ''] ?? ACTION_STYLES.NEUTRAL;
}

/** Thin data honesty flag — shown whenever the engine can't rate the card
 * or confidence isn't high, so a badge never reads as fake precision. */
export function isLowConfidence(signal: CardSignal | null | undefined): boolean {
  return (
    !signal?.action ||
    signal.action === 'UNRATED' ||
    (signal.confidence != null && signal.confidence !== 'high')
  );
}

type Props = { signal: CardSignal | null | undefined };

export function VerdictChip({ signal }: Props) {
  if (!signal?.action || signal.action === 'UNRATED') {
    return (
      <View style={[styles.chip, styles.lowDataChip]}>
        <Text style={styles.lowDataText}>Low data</Text>
      </View>
    );
  }
  const style = actionStyle(signal.action);
  return (
    <View style={styles.wrap}>
      <View style={[styles.chip, { backgroundColor: style.bg }]}>
        <Text style={[styles.chipText, { color: style.fg }]}>
          {style.label}
        </Text>
      </View>
      {isLowConfidence(signal) ? (
        <Text style={styles.confText}>low conf</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  chipText: { fontSize: 10, fontWeight: 'bold' },
  lowDataChip: { backgroundColor: colors.surfaceLight },
  lowDataText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  confText: { color: colors.textMuted, fontSize: 9, marginTop: 2 },
});
