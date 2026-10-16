import { Text, View } from 'react-native';
import { Tip } from '../atoms/ExplainChip';
import { tableMoney } from '../../utils/format';
import type { TradeEntry, TradeVerdict } from '../services/deal/tradeEval';
import { tradeSheetStyles as styles } from './tradeSheetStyles';

export function TradeVerdictCard({
  theirs,
  verdict,
  verdictColor,
}: {
  theirs: TradeEntry[];
  verdict: TradeVerdict;
  verdictColor: string;
}) {
  const verdictLabel =
    verdict.verdict === 'win' ? 'GOOD DEAL' : verdict.verdict === 'lose' ? 'RISKY' : 'EVEN';
  return (
    <View style={[styles.verdictCard, { borderLeftColor: verdictColor }]}>
      <Text style={[styles.verdictLabel, { color: verdictColor }]}>{verdictLabel}</Text>
      <Text style={styles.verdictHeadline}>{verdict.headline}</Text>
      {/* Shielded ceiling — the trajectory-adjusted max for what
                  you give. Falls below your offer on falling cards,
                  rises above it on climbers. */}
      {theirs.length > 0 && Math.abs(verdict.recommendedMax - verdict.yourEffective) >= 1 ? (
        <Tip tip="The most their side is really worth at your credit rate — priced at where their cards are heading in 30 days, not today's sticker. Giving more than this means paying full price for cards that are already falling.">
          <Text style={styles.shieldLine}>
            Safe max ≈ {tableMoney(verdict.recommendedMax)}
            {verdict.recommendedMax < verdict.yourEffective
              ? ` — you're offering ${tableMoney(verdict.yourEffective)}`
              : ' — room to give more if you want'}
          </Text>
        </Tip>
      ) : null}
      {verdict.counterSuggestion ? (
        <Text style={styles.counter}>{verdict.counterSuggestion}</Text>
      ) : null}
      {verdict.notes.map((n, i) => (
        <View key={i} style={styles.noteRow}>
          <View style={styles.noteBar} />
          <Text style={styles.note}>{n}</Text>
        </View>
      ))}
    </View>
  );
}
