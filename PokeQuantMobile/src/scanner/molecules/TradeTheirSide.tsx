import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../constants/colors';
import { SetBadge } from '../../components/SetBadge';
import { Tip } from '../atoms/ExplainChip';
import { displayCardName } from '../services/catalog/catalogMatcher';
import { formatCurrency, tableMoney } from '../../utils/format';
import { TRADE_RATE_OPTIONS, type TradePick } from '../services/deal/tradeEntry';
import type { TradeEntry, TradeVerdict } from '../services/deal/tradeEval';
import { TradeEntryRow } from './TradeEntryRow';
import { tradeSheetStyles as styles } from './tradeSheetStyles';

/** "You get" — catalog search or a live scan, picked entries, the side
 *  total with its cash top-up, and the trade-credit rate chips (they sit
 *  under the Theirs total because that is the number they change). */
export function TradeTheirSide({
  query,
  onQueryChange,
  searching,
  results,
  onAdd,
  onRequestScan,
  entries,
  onQty,
  onRemove,
  onOpen,
  verdict,
  tradeRate,
  onRateChange,
  cashText,
  onCashChange,
}: {
  query: string;
  onQueryChange: (t: string) => void;
  searching: boolean;
  results: TradePick[];
  onAdd: (r: TradePick) => void;
  onRequestScan: () => void;
  entries: TradeEntry[];
  onQty: (e: TradeEntry, delta: number) => void;
  onRemove: (e: TradeEntry) => void;
  onOpen: (e: TradeEntry) => void;
  verdict: TradeVerdict | null;
  tradeRate: number;
  onRateChange: (r: number) => void;
  cashText: string;
  onCashChange: (t: string) => void;
}) {
  return (
    <>
          {/* They offer — catalog search OR a live scan of their card. */}
              <Text style={[styles.sideLabel, { marginTop: 18 }]}>
                You get
              </Text>
              <View style={styles.searchRow}>
                <TextInput
                  value={query}
                  onChangeText={onQueryChange}
                  placeholder="Search the price list for their cards…"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.search, { flex: 1 }]}
                />
                {searching ? (
                  <ActivityIndicator
                    size="small"
                    color={colors.primary}
                    style={styles.searchSpin}
                  />
                ) : null}
                <Pressable
                  onPress={onRequestScan}
                  style={styles.scanBtn}
                  hitSlop={6}
                >
                  <Ionicons name="scan" size={15} color={colors.primary} />
                  <Text style={styles.scanBtnText}>Scan their card</Text>
                </Pressable>
              </View>
              {results.map((r) => (
                <Pressable
                  key={r.productId}
                  onPress={() => onAdd(r)}
                  style={styles.resultRow}
                >
                  {r.imageUrl ? (
                    <Image
                      source={{ uri: r.imageUrl }}
                      style={styles.resultThumb}
                      contentFit="contain"
                      cachePolicy="memory-disk"
                    />
                  ) : (
                    <View
                      style={[styles.resultThumb, styles.thumbPlaceholder]}
                    />
                  )}
                  <View style={styles.resultInfo}>
                    <Text style={styles.resultName} numberOfLines={1}>
                      {displayCardName(r.name)} · {r.number}
                    </Text>
                    <SetBadge set={r.set} style={styles.resultSetBadge} />
                  </View>
                  <Text style={styles.resultMeta}>{formatCurrency(r.marketPrice)}</Text>
                </Pressable>
              ))}
              {entries.map((e) => (
                <TradeEntryRow
                  key={e.key}
                  entry={e}
                  onQty={(d: number) => onQty(e, d)}
                  onRemove={() => onRemove(e)}
                  onOpen={() => onOpen(e)}
                />
              ))}
              <View style={styles.sideTotalRow}>
                <Text style={styles.sideTotal}>
                  Their side: {tableMoney(verdict?.theirEffective ?? 0)}
                  {verdict && tradeRate < 0.999
                    ? ` (${formatCurrency(verdict.theirSide.total)} at ${verdict.ratePct}% credit)`
                    : ''}
                </Text>
                <View style={styles.cashBox}>
                  <Text style={styles.cashPrefix}>+ cash $</Text>
                  <TextInput
                    value={cashText}
                    onChangeText={onCashChange}
                    placeholder="0"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"
                    style={styles.cashInput}
                  />
                </View>
              </View>
    
              {/* Vendor convention — incoming cards count at your trade rate,
                  not face. Cash always counts at 100%. Sits under the Theirs
                  total because that's the number it changes. */}
              <View style={styles.rateRow}>
                <Tip tip="Trade credit — what incoming cards count for. At 80%, their $10 card puts $8 toward the deal. Cash always counts at 100%.">
                  <Text style={styles.rateLabel}>Credit</Text>
                </Tip>
                {TRADE_RATE_OPTIONS.map((r) => (
                  <Pressable
                    key={r}
                    onPress={() => onRateChange(r)}
                    style={[
                      styles.rateChip,
                      tradeRate === r && styles.rateChipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.rateText,
                        tradeRate === r && styles.rateTextActive,
                      ]}
                    >
                      {r >= 0.999 ? 'even' : `${Math.round(r * 100)}%`}
                    </Text>
                  </Pressable>
                ))}
              </View>
    </>
  );
}
