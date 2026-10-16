import { Text, View } from 'react-native';
import { CardStack, DeltaPill } from '../../components/ui';
import { fmtDollars, tableMoney } from '../../utils/format';
import type { TradeEntry, TradeVerdict } from '../services/deal/tradeEval';
import { tradeSheetStyles as styles } from './tradeSheetStyles';

export function TradeMatchupHeader({
  yours,
  theirs,
  verdict,
  verdictColor,
}: {
  yours: TradeEntry[];
  theirs: TradeEntry[];
  verdict: TradeVerdict | null;
  verdictColor: string;
}) {
  return (
    <View style={styles.matchup}>
      <CardStack
        images={yours.flatMap((e) => (e.imageUrl ? [e.imageUrl] : []))}
        totalCount={yours.length}
        label="You give"
        value={verdict ? tableMoney(verdict.yourEffective) : undefined}
      />
      <View style={styles.matchupCenter}>
        <Text style={styles.vsText}>VS</Text>
        {verdict ? (
          <DeltaPill
            text={`${verdict.tradeDelta >= 0 ? '+' : '−'}$${fmtDollars(verdict.tradeDelta)}`}
            color={verdictColor}
            style={styles.matchupDelta}
          />
        ) : null}
      </View>
      <CardStack
        images={theirs.flatMap((e) => (e.imageUrl ? [e.imageUrl] : []))}
        totalCount={theirs.length}
        label="You get"
        value={verdict ? tableMoney(verdict.theirEffective) : undefined}
      />
    </View>
  );
}
