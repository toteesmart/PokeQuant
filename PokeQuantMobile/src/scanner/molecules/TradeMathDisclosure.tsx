import { View } from 'react-native';
import { Disclosure, StatRow } from '../../components/ui';
import { fmtDollars, tableMoney } from '../../utils/format';

import type { TradeVerdict } from '../services/deal/tradeEval';
import { tradeSheetStyles as styles } from './tradeSheetStyles';

export function TradeMathDisclosure({
  verdict,
  verdictColor,
  expanded,
  onToggle,
}: {
  verdict: TradeVerdict;
  verdictColor: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Disclosure
      label="The math"
      expanded={expanded}
      onToggle={onToggle}
    >
              <View style={styles.mathCard}>
                <StatRow
                  label="Your cards today"
                  value={tableMoney(verdict.yourSide.total)}
                />
                <StatRow
                  label="Their cards today"
                  value={tableMoney(verdict.theirSide.total)}
                />
                <StatRow
                  label="Their side counts as"
                  value={
                    verdict.ratePct >= 100
                      ? 'Even money'
                      : `${verdict.ratePct}%`
                  }
                />
                <StatRow
                  label="Yours in 30 days"
                  value={tableMoney(verdict.yourSide.proj30)}
                />
                <StatRow
                  label="Theirs in 30 days"
                  value={tableMoney(verdict.theirSide.proj30)}
                />
                <StatRow
                  label="Difference today"
                  value={`${
                    verdict.tradeDelta >= 0 ? '+' : '−'
                  }$${fmtDollars(verdict.tradeDelta)}`}
                  valueColor={verdictColor}
                />
                {Math.abs(verdict.smartDelta - verdict.tradeDelta) >= 1 ? (
                  <StatRow
                    label="After 30 days of price moves"
                    value={`${
                      verdict.smartDelta >= 0 ? '+' : '−'
                    }$${fmtDollars(verdict.smartDelta)}`}
                    valueColor={verdictColor}
                  />
                ) : null}
              </View>
    </Disclosure>
  );
}
