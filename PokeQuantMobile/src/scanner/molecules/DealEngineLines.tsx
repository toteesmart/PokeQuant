// DealEngineLines — the "why" rows under the deal read. The pure
// strings live in sheetReads so the coherence harness renders the same
// wording the user sees; this file is just the render + staleness gate.
import { Text, View } from 'react-native';
import {
  deepComputedDaysAgo,
  DEEP_STALE_DAYS,
  type CardDeep,
  type PatternStat,
} from '../../db/catalogDb';
import { engineLines } from '../services/deal/sheetReads';
import type { DealRead } from '../services/deal/dealClassify';
import { styles } from './dealSheetStyles';

export function DealEngineLines({
  read,
  deep,
  deepStale,
  patterns,
}: {
  read: DealRead;
  deep: CardDeep | null;
  deepStale: boolean;
  patterns: Record<string, PatternStat>;
}) {
  const lines = engineLines(
    read,
    deep,
    deepStale,
    patterns,
    (p) => (deepComputedDaysAgo(p?.computedAt ?? null) ?? 0) > DEEP_STALE_DAYS,
  );
  if (lines.length === 0) return null;
  return (
    <View style={styles.engineBlock}>
      {lines.map((l) => (
        <Text key={l.text} style={[styles.engineLine, l.warn && styles.engineWarn]}>
          {l.text}
        </Text>
      ))}
    </View>
  );
}
