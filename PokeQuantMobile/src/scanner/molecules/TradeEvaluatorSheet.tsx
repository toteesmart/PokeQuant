import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../constants/colors';
import {
  getCardSignals,
  openCatalogDatabase,
  searchCatalogCards,
  type CardSignal,
} from '../../db/catalogDb';
import { useInventoryStore } from '../../store/inventoryStore';
import { VerdictChip } from '../atoms/VerdictChip';
import {
  evaluateTrade,
  type TradeEntry,
  type TradeVerdict,
} from '../services/deal/tradeEval';

type Props = { onClose: () => void };

let entrySeq = 0;
const nextKey = () => `te${++entrySeq}`;

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

async function signalFor(
  productId: number,
  preferSubType?: string | null
): Promise<CardSignal | undefined> {
  try {
    const db = await openCatalogDatabase();
    const map = await getCardSignals(db, [productId]);
    const subs = map[productId] ?? {};
    if (preferSubType && subs[preferSubType]) return subs[preferSubType];
    return subs['Normal'] ?? subs['Holofoil'] ?? Object.values(subs)[0];
  } catch {
    return undefined;
  }
}

function EntryRow({
  entry,
  onQty,
  onRemove,
}: {
  entry: TradeEntry;
  onQty: (delta: number) => void;
  onRemove: () => void;
}) {
  return (
    <View style={styles.entryRow}>
      <View style={styles.entryInfo}>
        <Text style={styles.entryName} numberOfLines={1}>
          {entry.name}
        </Text>
        <Text style={styles.entryMeta} numberOfLines={1}>
          {entry.subType ?? '—'} · {money(entry.price)}
        </Text>
      </View>
      {entry.signal ? <VerdictChip signal={entry.signal} /> : null}
      <View style={styles.qtyBox}>
        <Pressable onPress={() => onQty(-1)} hitSlop={6}>
          <Ionicons name="remove" size={15} color={colors.text} />
        </Pressable>
        <Text style={styles.qtyText}>{entry.qty}</Text>
        <Pressable onPress={() => onQty(1)} hitSlop={6}>
          <Ionicons name="add" size={15} color={colors.text} />
        </Pressable>
      </View>
      <Text style={styles.entryTotal}>{money(entry.price * entry.qty)}</Text>
      <Pressable onPress={onRemove} hitSlop={8}>
        <Ionicons name="close" size={15} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

export function TradeEvaluatorSheet({ onClose }: Props) {
  const insets = useSafeAreaInsets();
  const inventory = useInventoryStore((s) => s.activeInventory);

  const [yours, setYours] = useState<TradeEntry[]>([]);
  const [theirs, setTheirs] = useState<TradeEntry[]>([]);
  const [yourQuery, setYourQuery] = useState('');
  const [theirQuery, setTheirQuery] = useState('');
  const [theirResults, setTheirResults] = useState<
    Array<{ productId: number; name: string; set: string; marketPrice: number }>
  >([]);
  const [searching, setSearching] = useState(false);

  // Your side searches the live inventory store — local, instant.
  const yourResults = useMemo(() => {
    const q = yourQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return inventory
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.set ?? '').toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [inventory, yourQuery]);

  // Their side searches the shipped catalog — debounced SQLite hits.
  useEffect(() => {
    const q = theirQuery.trim();
    if (q.length < 2) {
      setTheirResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const db = await openCatalogDatabase();
        const res = await searchCatalogCards(
          db,
          { query: q, rarity: 'All', sortBy: 'Name A-Z' },
          8
        );
        setTheirResults(
          res.cards.map((c) => ({
            productId: c.productId,
            name: `${c.name} · ${c.number ?? ''}`,
            set: c.set ?? '',
            marketPrice: c.liveMarket ?? 0,
          }))
        );
      } catch {
        setTheirResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [theirQuery]);

  const addYours = async (invId: string) => {
    const c = inventory.find((i) => i.id === invId);
    if (!c) return;
    setYourQuery('');
    const signal =
      c.productId != null
        ? await signalFor(c.productId, c.productType)
        : undefined;
    setYours((prev) => [
      ...prev,
      {
        key: nextKey(),
        productId: c.productId ?? null,
        subType: c.productType ?? null,
        name: c.name,
        qty: 1,
        price: c.liveMarket ?? 0,
        signal,
      },
    ]);
  };

  const addTheirs = async (r: {
    productId: number;
    name: string;
    marketPrice: number;
  }) => {
    setTheirQuery('');
    setTheirResults([]);
    const signal = await signalFor(r.productId);
    setTheirs((prev) => [
      ...prev,
      {
        key: nextKey(),
        productId: r.productId,
        subType: signal?.subType ?? 'Normal',
        name: r.name,
        qty: 1,
        price: r.marketPrice,
        signal,
      },
    ]);
  };

  const bumpQty =
    (setter: typeof setYours) =>
    (key: string, delta: number) =>
      setter((prev) =>
        prev.map((e) =>
          e.key === key ? { ...e, qty: Math.max(1, e.qty + delta) } : e
        )
      );

  const remove = (setter: typeof setYours) => (key: string) =>
    setter((prev) => prev.filter((e) => e.key !== key));

  const verdict: TradeVerdict | null = useMemo(
    () => evaluateTrade(yours, theirs),
    [yours, theirs]
  );

  const verdictColor =
    verdict?.verdict === 'win'
      ? colors.velocityPositive
      : verdict?.verdict === 'lose'
        ? colors.velocityNegative
        : colors.warning;

  return (
    <View style={[styles.overlay, { paddingTop: insets.top + 20 }]}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title}>Trade evaluator</Text>
          <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
            <Ionicons name="close" size={20} color={colors.text} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* They want — picked from your active inventory. */}
          <Text style={styles.sideLabel}>They want (your side)</Text>
          <TextInput
            value={yourQuery}
            onChangeText={setYourQuery}
            placeholder="Search your inventory…"
            placeholderTextColor={colors.textMuted}
            style={styles.search}
          />
          {yourResults.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => addYours(c.id)}
              style={styles.resultRow}
            >
              <Text style={styles.resultName} numberOfLines={1}>
                {c.name} · {c.number}
              </Text>
              <Text style={styles.resultMeta}>
                {money(c.liveMarket ?? 0)}
              </Text>
            </Pressable>
          ))}
          {yours.map((e) => (
            <EntryRow
              key={e.key}
              entry={e}
              onQty={(d) => bumpQty(setYours)(e.key, d)}
              onRemove={() => remove(setYours)(e.key)}
            />
          ))}
          <Text style={styles.sideTotal}>
            Your side: {money(verdict?.yourSide.total ?? 0)}
          </Text>

          {/* They offer — picked from the catalog. */}
          <Text style={[styles.sideLabel, { marginTop: 18 }]}>
            They offer (their side)
          </Text>
          <View style={styles.searchRow}>
            <TextInput
              value={theirQuery}
              onChangeText={setTheirQuery}
              placeholder="Search catalog for their cards…"
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
          </View>
          {theirResults.map((r) => (
            <Pressable
              key={r.productId}
              onPress={() => addTheirs(r)}
              style={styles.resultRow}
            >
              <View style={styles.resultInfo}>
                <Text style={styles.resultName} numberOfLines={1}>
                  {r.name}
                </Text>
                <Text style={styles.resultSet} numberOfLines={1}>
                  {r.set}
                </Text>
              </View>
              <Text style={styles.resultMeta}>{money(r.marketPrice)}</Text>
            </Pressable>
          ))}
          {theirs.map((e) => (
            <EntryRow
              key={e.key}
              entry={e}
              onQty={(d) => bumpQty(setTheirs)(e.key, d)}
              onRemove={() => remove(setTheirs)(e.key)}
            />
          ))}
          <Text style={styles.sideTotal}>
            Their side: {money(verdict?.theirSide.total ?? 0)}
          </Text>

          {verdict && (yours.length > 0 || theirs.length > 0) ? (
            <View
              style={[styles.verdictCard, { borderLeftColor: verdictColor }]}
            >
              <Text style={[styles.verdictLabel, { color: verdictColor }]}>
                {verdict.verdict.toUpperCase()}
              </Text>
              <Text style={styles.verdictHeadline}>{verdict.headline}</Text>
              <Text style={styles.verdictNumbers}>
                Face {verdict.faceDelta >= 0 ? '+' : ''}
                {money(verdict.faceDelta)} ({verdict.facePct.toFixed(0)}%) ·
                30d proj {verdict.trajDelta >= 0 ? '+' : ''}
                {money(verdict.trajDelta)}
              </Text>
              {verdict.counterSuggestion ? (
                <Text style={styles.counter}>
                  {verdict.counterSuggestion}
                </Text>
              ) : null}
              {verdict.notes.map((n, i) => (
                <Text key={i} style={styles.note}>
                  • {n}
                </Text>
              ))}
            </View>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  sheet: {
    flex: 1,
    backgroundColor: '#10151c',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  title: { color: colors.text, fontSize: 16, fontWeight: 'bold' },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { padding: 16, paddingTop: 6, paddingBottom: 30 },
  sideLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  searchRow: { flexDirection: 'row', alignItems: 'center' },
  searchSpin: { marginLeft: -26, marginRight: 10 },
  search: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: colors.text,
    fontSize: 13,
    marginBottom: 6,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginBottom: 4,
  },
  resultInfo: { flex: 1 },
  resultName: { color: colors.text, fontSize: 13, fontWeight: '600', flex: 1 },
  resultSet: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  resultMeta: { color: colors.primary, fontSize: 12, fontWeight: 'bold' },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.07)',
    marginTop: 4,
  },
  entryInfo: { flex: 1 },
  entryName: { color: colors.text, fontSize: 13, fontWeight: '600' },
  entryMeta: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  qtyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  qtyText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: 'bold',
    minWidth: 14,
    textAlign: 'center',
  },
  entryTotal: {
    color: colors.text,
    fontSize: 12,
    fontWeight: 'bold',
    minWidth: 48,
    textAlign: 'right',
  },
  sideTotal: {
    color: colors.text,
    fontSize: 13,
    fontWeight: 'bold',
    textAlign: 'right',
    marginTop: 6,
  },
  verdictCard: {
    marginTop: 18,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 10,
    borderLeftWidth: 3,
    padding: 12,
  },
  verdictLabel: { fontSize: 14, fontWeight: 'bold', letterSpacing: 0.5 },
  verdictHeadline: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  verdictNumbers: { color: colors.textMuted, fontSize: 12, marginTop: 6 },
  counter: {
    color: colors.warning,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
  },
  note: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 5,
    lineHeight: 15,
  },
});
