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
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../constants/colors';
import {
  layout,
  radius,
  spacing,
  type_,
  weight,
} from '../../constants/theme';
import {
  getCardSignals,
  openCatalogDatabase,
  searchCatalogCards,
} from '../../db/catalogDb';
import { getCatalogImageUri } from '../../services/CatalogImageService';
import { useInventoryStore } from '../../store/inventoryStore';
import { DealClassBadge } from '../atoms/DealClassBadge';
import { SetBadge } from '../../components/SetBadge';
import { Tip } from '../atoms/ExplainChip';
import { displayCardName } from '../services/catalog/catalogMatcher';
import { DealAnalysisSheet } from './DealAnalysisSheet';
import type { CatalogMatch } from '../services/catalog/catalogMatcher';
import type { ScanCatalogVariant } from '../types/catalog';
import {
  evaluateTrade,
  type TradeEntry,
  type TradeVerdict,
} from '../services/deal/tradeEval';
import { completeTrade } from '../services/deal/tradeComplete';
import {
  AppButton,
  CardStack,
  DeltaPill,
  Disclosure,
  GlassSheet,
  StatRow,
} from '../../components/ui';
import { tintBg } from '../../utils/tint';
import { fmtDollars } from '../../utils/format';

type Props = {
  yours: TradeEntry[];
  theirs: TradeEntry[];
  onChangeYours: (entries: TradeEntry[]) => void;
  onChangeTheirs: (entries: TradeEntry[]) => void;
  /** Hand the camera to the user — the next confirmed match lands on
   *  their side. */
  onRequestScan: () => void;
  onClose: () => void;
};

let entrySeq = 0;
const nextKey = () => `te${++entrySeq}`;

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** Table-money — vendors deal in whole dollars, so anything that isn't
 *  the raw live market price renders rounded. */
function money0(n: number): string {
  return `$${Math.round(n)}`;
}

/** Table-standard trade-credit rates — their incoming cards count at
 *  this fraction of face. 80% is the dominant vendor convention. */
const RATE_OPTIONS = [0.7, 0.8, 0.85, 0.9, 1];

function parseCash(text: string): number {
  const n = Number.parseFloat(text.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** All finish variants for a product from the stamped signals table —
 *  doubles as the nested analysis sheet's finish switcher. */
async function variantsFor(
  productId: number,
  preferSubType?: string | null
): Promise<ScanCatalogVariant[]> {
  try {
    const db = await openCatalogDatabase();
    const subs = (await getCardSignals(db, [productId]))[productId] ?? {};
    const list = Object.values(subs).map((s) => ({
      subType: s.subType,
      marketPrice: s.price ?? 0,
      date: s.priceDate ?? '',
      signal: s,
    }));
    return list.sort((a, b) =>
      a.subType === preferSubType
        ? -1
        : b.subType === preferSubType
          ? 1
          : b.marketPrice - a.marketPrice
    );
  } catch {
    return [];
  }
}

function entryMatch(entry: TradeEntry): CatalogMatch {
  return {
    card: {
      productId: entry.productId ?? 0,
      name: entry.name,
      number: entry.number ?? '',
      set: entry.set ?? '',
      rarity: null,
      imageUrl: entry.imageUrl ?? '',
      variants:
        entry.variants ??
        (entry.subType
          ? [
              {
                subType: entry.subType,
                marketPrice: entry.price,
                date: '',
                signal: entry.signal,
              },
            ]
          : []),
    },
    method: 'fused',
    confidence: 1,
  };
}

function EntryRow({
  entry,
  onQty,
  onRemove,
  onOpen,
}: {
  entry: TradeEntry;
  onQty: (delta: number) => void;
  onRemove: () => void;
  onOpen: () => void;
}) {
  return (
    <Pressable onPress={onOpen} style={styles.entryRow}>
      {entry.imageUrl ? (
        <Image
          source={{ uri: entry.imageUrl }}
          style={styles.entryThumb}
          contentFit="contain"
          cachePolicy="memory-disk"
        />
      ) : (
        <View style={[styles.entryThumb, styles.thumbPlaceholder]} />
      )}
      <View style={styles.entryInfo}>
        <View style={styles.entryNameRow}>
          <Text style={styles.entryName} numberOfLines={1}>
            {displayCardName(entry.name)}
            {entry.number ? ` · ${entry.number}` : ''}
          </Text>
          <Ionicons
            name="analytics-outline"
            size={11}
            color={colors.primary}
          />
        </View>
        <Text style={styles.entryMeta} numberOfLines={1}>
          {entry.subType ?? '—'} · {money(entry.price)}
        </Text>
      </View>
      {entry.signal ? <DealClassBadge signal={entry.signal} /> : null}
      {/* Inventory rows are one physical card each — dupes are separate
          entries, so the stepper only appears on catalog/scan entries. */}
      {entry.inventoryId ? null : (
        <View
          style={styles.qtyBox}
          onStartShouldSetResponder={() => true}
        >
          <Pressable
            onPress={() => onQty(-1)}
            hitSlop={8}
            accessibilityLabel="Decrease quantity"
            accessibilityRole="button"
          >
            <Ionicons name="remove" size={15} color={colors.text} />
          </Pressable>
          <Text style={styles.qtyText}>{entry.qty}</Text>
          <Pressable
            onPress={() => onQty(1)}
            hitSlop={8}
            accessibilityLabel="Increase quantity"
            accessibilityRole="button"
          >
            <Ionicons name="add" size={15} color={colors.text} />
          </Pressable>
        </View>
      )}
      <Text style={styles.entryTotal}>{money(entry.price * entry.qty)}</Text>
      <Pressable
        onPress={onRemove}
        hitSlop={8}
        onStartShouldSetResponder={() => true}
        accessibilityLabel={`Remove ${entry.name}`}
        accessibilityRole="button"
      >
        <Ionicons name="close" size={15} color={colors.textMuted} />
      </Pressable>
    </Pressable>
  );
}

export function TradeEvaluatorSheet({
  yours,
  theirs,
  onChangeYours,
  onChangeTheirs,
  onRequestScan,
  onClose,
}: Props) {
  const inventory = useInventoryStore((s) => s.activeInventory);

  const [yourQuery, setYourQuery] = useState('');
  const [theirQuery, setTheirQuery] = useState('');
  const [theirResults, setTheirResults] = useState<
    Array<{
      productId: number;
      name: string;
      number: string;
      set: string;
      marketPrice: number;
      imageUrl: string | undefined;
    }>
  >([]);
  const [searching, setSearching] = useState(false);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  const [analysisFor, setAnalysisFor] = useState<TradeEntry | null>(null);
  const [mathOpen, setMathOpen] = useState(false);
  // Trade terms — the 80%-credit convention plus optional cash top-ups.
  const [tradeRate, setTradeRate] = useState(0.8);
  const [yourCashText, setYourCashText] = useState('');
  const [theirCashText, setTheirCashText] = useState('');

  // The engine reads N-vs-1 — many cards on one side against a single card
  // on the other. Adding to a side is blocked only if it would make BOTH
  // sides multi-card (fairness can't attribute across multi-vs-multi).
  const canAddTo = (side: TradeEntry[], other: TradeEntry[]) =>
    !(side.length >= 1 && other.length >= 2);

  const tryAdd = (
    side: TradeEntry[],
    other: TradeEntry[],
    apply: (e: TradeEntry[]) => void,
    entry: TradeEntry
  ) => {
    if (!canAddTo(side, other)) {
      setLimitMsg(
        'Trade eval is many-vs-one — one side stays a single card'
      );
      return;
    }
    setLimitMsg(null);
    apply([...side, entry]);
  };

  // Your side searches the live inventory store — local, instant. The
  // horizontal carousel underneath keeps the binder browsable without
  // needing to type at all.
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
            name: c.name,
            number: c.number ?? '',
            set: c.set ?? '',
            marketPrice: c.liveMarket ?? 0,
            imageUrl: c.imageUrl || getCatalogImageUri(c.productId),
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
    const variants =
      c.productId != null
        ? await variantsFor(c.productId, c.productType)
        : [];
    tryAdd(yours, theirs, onChangeYours, {
      key: nextKey(),
      inventoryId: c.id,
      paidPrice: c.amountPaid,
      productId: c.productId ?? null,
      subType: c.productType ?? null,
      name: c.name,
      number: c.number,
      set: c.set,
      imageUrl: c.imageUrl,
      qty: 1,
      price: c.liveMarket ?? 0,
      signal: variants.find((v) => v.subType === c.productType)?.signal,
      variants: variants.length > 0 ? variants : undefined,
    });
  };

  const addTheirs = async (r: {
    productId: number;
    name: string;
    number: string;
    set: string;
    marketPrice: number;
    imageUrl: string | undefined;
  }) => {
    setTheirQuery('');
    setTheirResults([]);
    const variants = await variantsFor(r.productId);
    const top = variants[0];
    tryAdd(theirs, yours, onChangeTheirs, {
      key: nextKey(),
      productId: r.productId,
      subType: top?.subType ?? 'Normal',
      name: displayCardName(r.name),
      number: r.number,
      set: r.set,
      imageUrl: r.imageUrl,
      qty: 1,
      price: top?.signal?.price ?? r.marketPrice,
      signal: top?.signal,
      variants: variants.length > 0 ? variants : undefined,
    });
  };

  const bumpQty =
    (entries: TradeEntry[], apply: (e: TradeEntry[]) => void) =>
    (key: string, delta: number) =>
      apply(
        entries.map((e) =>
          e.key === key ? { ...e, qty: Math.max(1, e.qty + delta) } : e
        )
      );

  const removeEntry =
    (entries: TradeEntry[], apply: (e: TradeEntry[]) => void) =>
    (key: string) =>
      apply(entries.filter((e) => e.key !== key));

  const verdict: TradeVerdict | null = useMemo(
    () =>
      evaluateTrade(yours, theirs, {
        tradeRate,
        yourCash: parseCash(yourCashText),
        theirCash: parseCash(theirCashText),
      }),
    [yours, theirs, tradeRate, yourCashText, theirCashText]
  );

  const verdictColor =
    verdict?.verdict === 'win'
      ? colors.velocityPositive
      : verdict?.verdict === 'lose'
        ? colors.velocityNegative
        : colors.warning;

  // Glossy backdrop — each side's lead card bleeds into its half of the
  // page, the matchup-poster look from the reference.
  const bgLeft = yours.find((e) => e.imageUrl)?.imageUrl;
  const bgRight = theirs.find((e) => e.imageUrl)?.imageUrl;

  const verdictLabel =
    verdict?.verdict === 'win'
      ? 'GOOD DEAL'
      : verdict?.verdict === 'lose'
        ? 'RISKY'
        : 'EVEN';

  // Complete trade — both sides write for real: outgoing sells at its
  // share of the pot, incoming lands in inventory at carry-over basis.
  const [completing, setCompleting] = useState(false);
  const [completeMsg, setCompleteMsg] = useState<string | null>(null);
  const ctaDisabled =
    completing ||
    !verdict ||
    (yours.length === 0 && parseCash(yourCashText) <= 0) ||
    (theirs.length === 0 && parseCash(theirCashText) <= 0);
  const handleComplete = async () => {
    if (!verdict || completing) return;
    setCompleting(true);
    setCompleteMsg(null);
    try {
      const res = await completeTrade(
        yours,
        theirs,
        verdict,
        parseCash(yourCashText),
        parseCash(theirCashText)
      );
      if (res.ok) {
        onChangeYours([]);
        onChangeTheirs([]);
        onClose();
      } else {
        setCompleteMsg(res.message);
      }
    } catch {
      setCompleteMsg("Couldn't save the trade — nothing was recorded");
    } finally {
      setCompleting(false);
    }
  };

  return (
    <GlassSheet
      title="Check a trade"
      onClose={onClose}
      artUris={[bgLeft, bgRight]}
      keyboardAware
      scrollProps={{
        keyboardShouldPersistTaps: 'handled',
        keyboardDismissMode: 'on-drag',
      }}
      footer={
        <>
          {completeMsg ? (
            <Text style={styles.errorMsg}>{completeMsg}</Text>
          ) : null}
          {/* Pinned CTA — the "Get ticket" slot. Disabled until both
              sides have something real; colored by the verdict like the
              reference's single primary action. */}
          <AppButton
            title="Log this trade"
            onPress={handleComplete}
            color={verdictColor}
            loading={completing}
            disabled={ctaDisabled}
            accessibilityLabel="Log this trade"
            style={styles.completeBtn}
          />
        </>
      }
    >
          {/* Matchup — your stack vs theirs, like the flags header. */}
          <View style={styles.matchup}>
            <CardStack
              images={yours.flatMap((e) =>
                e.imageUrl ? [e.imageUrl] : []
              )}
              totalCount={yours.length}
              label="You give"
              value={
                verdict ? money0(verdict.yourEffective) : undefined
              }
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
              images={theirs.flatMap((e) =>
                e.imageUrl ? [e.imageUrl] : []
              )}
              totalCount={theirs.length}
              label="You get"
              value={
                verdict ? money0(verdict.theirEffective) : undefined
              }
            />
          </View>

          {/* The verdict — the "is this a good trade" answer reads first,
              before the build-up sections. */}
          {verdict && (yours.length > 0 || theirs.length > 0) ? (
            <View
              style={[styles.verdictCard, { borderLeftColor: verdictColor }]}
            >
              <Text style={[styles.verdictLabel, { color: verdictColor }]}>
                {verdictLabel}
              </Text>
              <Text style={styles.verdictHeadline}>{verdict.headline}</Text>
              {/* Shielded ceiling — the trajectory-adjusted max for what
                  you give. Falls below your offer on falling cards,
                  rises above it on climbers. */}
              {theirs.length > 0 &&
              Math.abs(verdict.recommendedMax - verdict.yourEffective) >=
                1 ? (
                <Tip tip="The most their side is really worth at your credit rate — priced at where their cards are heading in 30 days, not today's sticker. Giving more than this means paying full price for cards that are already falling.">
                  <Text style={styles.shieldLine}>
                    Safe max ≈ {money0(verdict.recommendedMax)}
                    {verdict.recommendedMax < verdict.yourEffective
                      ? ` — you're offering ${money0(verdict.yourEffective)}`
                      : ' — room to give more if you want'}
                  </Text>
                </Tip>
              ) : null}
              {verdict.counterSuggestion ? (
                <Text style={styles.counter}>
                  {verdict.counterSuggestion}
                </Text>
              ) : null}
              {verdict.notes.map((n, i) => (
                <View key={i} style={styles.noteRow}>
                  <View style={styles.noteBar} />
                  <Text style={styles.note}>{n}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* The math — a bare disclosure line, not a module; the verdict
              card above is the glanceable answer, this is the receipts for
              anyone who wants them. Plain-language labels, no table jargon. */}
          {verdict ? (
            <Disclosure
              label="The math"
              expanded={mathOpen}
              onToggle={() => setMathOpen((o) => !o)}
            >
              <View style={styles.mathCard}>
                <StatRow
                  label="Your cards today"
                  value={money0(verdict.yourSide.total)}
                />
                <StatRow
                  label="Their cards today"
                  value={money0(verdict.theirSide.total)}
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
                  value={money0(verdict.yourSide.proj30)}
                />
                <StatRow
                  label="Theirs in 30 days"
                  value={money0(verdict.theirSide.proj30)}
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
          ) : null}

          {/* They want — picked from your active inventory. Label
              matches the matchup stack so the mapping is glanceable. */}
          <Text style={styles.sideLabel}>You give</Text>
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
              {c.imageUrl ? (
                <Image
                  source={{ uri: c.imageUrl }}
                  style={styles.resultThumb}
                  contentFit="contain"
                  cachePolicy="memory-disk"
                />
              ) : (
                <View
                  style={[styles.resultThumb, styles.thumbPlaceholder]}
                />
              )}
              <Text style={styles.resultName} numberOfLines={1}>
                {c.name} · {c.number}
              </Text>
              <Text style={styles.resultMeta}>
                {money(c.liveMarket ?? 0)}
              </Text>
            </Pressable>
          ))}

          {/* Binder carousel — tap a card to add it to your side. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.carousel}
            keyboardShouldPersistTaps="handled"
          >
            {inventory.slice(0, 60).map((c) => (
              <Pressable
                key={c.id}
                onPress={() => addYours(c.id)}
                style={styles.carouselCard}
              >
                {c.imageUrl ? (
                  <Image
                    source={{ uri: c.imageUrl }}
                    style={styles.carouselThumb}
                    contentFit="contain"
                    cachePolicy="memory-disk"
                  />
                ) : (
                  <View
                    style={[styles.carouselThumb, styles.thumbPlaceholder]}
                  />
                )}
                <Text style={styles.carouselName} numberOfLines={1}>
                  {c.name}
                </Text>
                <Text style={styles.carouselPrice}>
                  {money(c.liveMarket ?? 0)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {yours.map((e) => (
            <EntryRow
              key={e.key}
              entry={e}
              onQty={(d) => bumpQty(yours, onChangeYours)(e.key, d)}
              onRemove={() => removeEntry(yours, onChangeYours)(e.key)}
              onOpen={() => setAnalysisFor(e)}
            />
          ))}
          <View style={styles.sideTotalRow}>
            <Text style={styles.sideTotal}>
              Your side: {money0(verdict?.yourEffective ?? 0)}
            </Text>
            <View style={styles.cashBox}>
              <Text style={styles.cashPrefix}>+ cash $</Text>
              <TextInput
                value={yourCashText}
                onChangeText={setYourCashText}
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                style={styles.cashInput}
              />
            </View>
          </View>

          {/* They offer — catalog search OR a live scan of their card. */}
          <Text style={[styles.sideLabel, { marginTop: 18 }]}>
            You get
          </Text>
          <View style={styles.searchRow}>
            <TextInput
              value={theirQuery}
              onChangeText={setTheirQuery}
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
          {theirResults.map((r) => (
            <Pressable
              key={r.productId}
              onPress={() => addTheirs(r)}
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
              <Text style={styles.resultMeta}>{money(r.marketPrice)}</Text>
            </Pressable>
          ))}
          {theirs.map((e) => (
            <EntryRow
              key={e.key}
              entry={e}
              onQty={(d) => bumpQty(theirs, onChangeTheirs)(e.key, d)}
              onRemove={() => removeEntry(theirs, onChangeTheirs)(e.key)}
              onOpen={() => setAnalysisFor(e)}
            />
          ))}
          <View style={styles.sideTotalRow}>
            <Text style={styles.sideTotal}>
              Their side: {money0(verdict?.theirEffective ?? 0)}
              {verdict && tradeRate < 0.999
                ? ` (${money(verdict.theirSide.total)} at ${verdict.ratePct}% credit)`
                : ''}
            </Text>
            <View style={styles.cashBox}>
              <Text style={styles.cashPrefix}>+ cash $</Text>
              <TextInput
                value={theirCashText}
                onChangeText={setTheirCashText}
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
            {RATE_OPTIONS.map((r) => (
              <Pressable
                key={r}
                onPress={() => setTradeRate(r)}
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

          {limitMsg ? (
            <Text style={styles.limitMsg}>{limitMsg}</Text>
          ) : null}

      {/* Tap any entry for its full timeline + deal read. */}
      {analysisFor ? (
        <DealAnalysisSheet
          match={entryMatch(analysisFor)}
          subType={analysisFor.subType ?? undefined}
          onClose={() => setAnalysisFor(null)}
        />
      ) : null}
    </GlassSheet>
  );
}

const styles = StyleSheet.create({
  // Chrome (Modal, split-bleed backdrop, header, scroll, CTA bar) now
  // comes from ui/GlassSheet — these styles are page content only.
  matchup: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: spacing.lg,
    marginBottom: spacing['4xl'],
  },
  matchupCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing['2xl'],
    minWidth: 72,
  },
  vsText: {
    color: colors.textMuted,
    fontSize: type_.label,
    fontWeight: weight.heavy,
    letterSpacing: 1,
  },
  matchupDelta: { marginTop: spacing.md },
  mathCard: {
    backgroundColor: colors.overlay2,
    borderRadius: radius.cardLg,
    paddingHorizontal: layout.cardPadding,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
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
    backgroundColor: colors.overlay3,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: colors.text,
    fontSize: 13,
    marginBottom: 6,
  },
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: colors.primaryStrong,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  scanBtnText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: colors.overlay1,
    marginBottom: 4,
  },
  resultThumb: { width: 30, height: 42, borderRadius: 4, marginRight: 8 },
  thumbPlaceholder: { backgroundColor: colors.surface },
  resultInfo: { flex: 1 },
  resultName: { color: colors.text, fontSize: 13, fontWeight: '600', flex: 1 },
  resultSetBadge: { marginTop: 3 },
  resultMeta: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  carousel: { marginTop: 4, marginBottom: 6, maxHeight: 108 },
  carouselCard: { width: 62, alignItems: 'center', marginRight: 8 },
  carouselThumb: {
    width: 58,
    height: 80,
    borderRadius: 6,
    backgroundColor: colors.surface,
  },
  carouselName: {
    color: colors.textMuted,
    fontSize: 9,
    marginTop: 3,
    maxWidth: 58,
  },
  carouselPrice: { color: colors.primary, fontSize: 9, fontWeight: '700' },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: colors.overlay3,
    marginTop: 4,
  },
  entryThumb: { width: 30, height: 42, borderRadius: 4 },
  entryInfo: { flex: 1 },
  entryNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  entryName: { color: colors.text, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  entryMeta: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  qtyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.overlay3,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  qtyText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    minWidth: 14,
    textAlign: 'center',
  },
  entryTotal: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    minWidth: 48,
    textAlign: 'right',
  },
  sideTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    gap: 10,
  },
  sideTotal: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  cashBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.overlay4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
  },
  cashPrefix: { color: colors.textMuted, fontSize: 14, fontWeight: '700' },
  cashInput: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    paddingVertical: 9,
    paddingLeft: 3,
    minWidth: 62,
    textAlign: 'right',
  },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
  },
  rateLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  rateChip: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: colors.overlay3,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rateChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryActive,
  },
  rateText: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  rateTextActive: { color: colors.primary },
  limitMsg: {
    color: colors.warning,
    fontSize: 12,
    marginTop: 10,
    textAlign: 'center',
  },
  errorMsg: {
    color: colors.error,
    fontSize: 12,
    marginBottom: 8,
    textAlign: 'center',
  },
  verdictCard: {
    marginTop: 18,
    backgroundColor: colors.overlay2,
    borderRadius: 10,
    borderLeftWidth: 3,
    padding: 12,
  },
  verdictLabel: { fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },
  verdictHeadline: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  shieldLine: {
    color: colors.warning,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 5,
  },
  counter: {
    color: colors.warning,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.lg,
    marginTop: spacing.lg,
  },
  noteBar: {
    width: 3,
    height: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.overlay4,
    marginTop: 1,
  },
  note: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
  },
  completeBtn: { marginTop: spacing['2xl'] },
});
