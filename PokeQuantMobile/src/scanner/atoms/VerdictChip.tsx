import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../constants/colors';
import type { CardSignal } from '../../db/catalogDb';

type ActionStyle = { label: string; fg: string; bg: string };

// Engine action vocabulary from quant.snapshot.classify — stamped nightly
// into card_signals. Colors mirror the buy/sell semantics at the table.
const ACTION_STYLES: Record<string, ActionStyle> = {
  SELL_NOW: { label: 'Sell now', fg: '#fff', bg: colors.error },
  SELL_STRENGTH: { label: 'Sell into bumps', fg: '#fff', bg: '#b45309' },
  BUY_HOLD: { label: 'Buy & hold', fg: '#fff', bg: colors.velocityPositive },
  BUY_FLIP: { label: 'Buy & flip', fg: '#fff', bg: '#0d9488' },
  HOLD: { label: 'Hold / wait', fg: '#fff', bg: colors.warning },
  NEUTRAL: { label: 'No clear read', fg: colors.text, bg: colors.surfaceLight },
};

export function actionStyle(action: string | null | undefined): ActionStyle {
  return ACTION_STYLES[action ?? ''] ?? ACTION_STYLES.NEUTRAL;
}

/** Re-derives the displayed action from the same signal's stamped fields —
 *  mirrors classifyDeal's hard rules so a benign stamp on a card whose own
 *  stamped returns say free-fall/decline (an action stamped before the
 *  slide) never argues with the deal class while waiting on the next
 *  catalog re-stamp. */
export function derivedAction(
  signal: CardSignal | null | undefined
): string | null {
  const stamped = signal?.action;
  if (!stamped || stamped === 'UNRATED') return stamped ?? null;
  const benign =
    stamped === 'NEUTRAL' ||
    stamped === 'HOLD' ||
    stamped.startsWith('BUY');
  if (!benign) return stamped;
  const r7 = signal.ret7d ?? 0;
  const r30 = signal.ret30d ?? 0;
  const r90 = signal.ret90d ?? 0;
  const cagr = signal.cagr ?? 0;
  // A dip inside an intact uptrend is Dip buy, not Free fall.
  const dipBuy = signal.trend === 'appreciating' && r90 > 0 && cagr > 0;
  if (signal.stance === 'falling') return dipBuy ? stamped : 'SELL_NOW';
  if (signal.stance === 'depressed' && (r30 <= -10 || r7 <= -7))
    return 'SELL_NOW';
  // 'depreciating' covers the whole window — only a slide still visible
  // in recent returns overrides a benign stamp; a flat card with an old
  // crash is dead/stable, and the stamp stands.
  const stillBleeding = r90 <= -15 || r30 <= -10 || r7 <= -7;
  if (signal.trend === 'depreciating' && stillBleeding)
    return 'SELL_STRENGTH';
  if (signal.stance === 'depressed' && r90 <= -15) return 'SELL_STRENGTH';
  return stamped;
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

type Props = {
  signal: CardSignal | null | undefined;
  /** The "low conf" sub-label — suppress where a richer confidence read
   *  already renders (e.g. the analysis sheet's colored conf text). */
  showConfFlag?: boolean;
};

export function VerdictChip({ signal, showConfFlag = true }: Props) {
  if (!signal?.action || signal.action === 'UNRATED') {
    return (
      <View style={[styles.chip, styles.lowDataChip]}>
        <Text style={styles.lowDataText}>Low data</Text>
      </View>
    );
  }
  const style = actionStyle(derivedAction(signal));
  return (
    <View style={styles.wrap}>
      <View style={[styles.chip, { backgroundColor: style.bg }]}>
        <Text style={[styles.chipText, { color: style.fg }]}>
          {style.label}
        </Text>
      </View>
      {showConfFlag && isLowConfidence(signal) ? (
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
