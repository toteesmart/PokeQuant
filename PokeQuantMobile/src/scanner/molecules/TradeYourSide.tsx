import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { colors } from '../../constants/colors';
import { formatCurrency, tableMoney } from '../../utils/format';
import type { InventoryCard } from '../../store/inventoryStore';
import type { TradeEntry } from '../services/deal/tradeEval';
import { TradeEntryRow } from './TradeEntryRow';
import { tradeSheetStyles as styles } from './tradeSheetStyles';

/** "You give" — inventory search, the binder carousel, picked entries,
 *  and the side total with its cash top-up. */
export function TradeYourSide({
  query,
  onQueryChange,
  results,
  onAdd,
  inventory,
  entries,
  onQty,
  onRemove,
  onOpen,
  effective,
  cashText,
  onCashChange,
}: {
  query: string;
  onQueryChange: (t: string) => void;
  results: InventoryCard[];
  onAdd: (invId: string) => void;
  inventory: InventoryCard[];
  entries: TradeEntry[];
  onQty: (e: TradeEntry, delta: number) => void;
  onRemove: (e: TradeEntry) => void;
  onOpen: (e: TradeEntry) => void;
  effective: number;
  cashText: string;
  onCashChange: (t: string) => void;
}) {
  return (
    <>
          {/* They want — picked from your active inventory. Label
              matches the matchup stack so the mapping is glanceable. */}
              <Text style={styles.sideLabel}>You give</Text>
              <TextInput
                value={query}
                onChangeText={onQueryChange}
                placeholder="Search your inventory…"
                placeholderTextColor={colors.textMuted}
                style={styles.search}
              />
              {results.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => onAdd(c.id)}
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
                    {formatCurrency(c.liveMarket ?? 0)}
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
                    onPress={() => onAdd(c.id)}
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
                      {formatCurrency(c.liveMarket ?? 0)}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
    
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
                  Your side: {tableMoney(effective)}
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
    </>
  );
}
