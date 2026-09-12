import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { colors } from '../constants/colors';
import { CatalogCardItem } from '../molecules/CatalogCardItem';
import { loadTestCatalog } from '../services/catalog/TestCatalogProvider';
import type { TestCatalogCard } from '../types/catalog';

const COLUMNS = 2;
const GAP = 12;
const PADDING = 16;

function chunkPairs<T>(arr: T[]): Array<[T, T?]> {
  const pairs: Array<[T, T?]> = [];
  for (let i = 0; i < arr.length; i += 2) {
    pairs.push([arr[i], arr[i + 1]]);
  }
  return pairs;
}

type Pair = [TestCatalogCard, TestCatalogCard?];

function PairRow({ pair, rowWidth, cardWidth }: { pair: Pair; rowWidth: number; cardWidth: number }) {
  return (
    <View style={[styles.row, { width: rowWidth }]}>
      <CatalogCardItem card={pair[0]} width={cardWidth} />
      {pair[1] ? <CatalogCardItem card={pair[1]} width={cardWidth} /> : <View style={{ width: cardWidth }} />}
    </View>
  );
}

export function HomeScreen() {
  const { width } = useWindowDimensions();
  const [cards, setCards] = useState<TestCatalogCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTestCatalog()
      .then(setCards)
      .catch((err) => console.error('Failed to load catalog:', err))
      .finally(() => setLoading(false));
  }, []);

  const rowWidth = Math.max(1, width - PADDING * 2);
  const cardWidth = Math.max(1, (rowWidth - GAP * (COLUMNS - 1)) / COLUMNS);
  const pairs = chunkPairs(cards);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Card Cache Scanner</Text>
        <Text style={styles.subtitle}>Phase 0 — Test Catalog Loaded</Text>
      </View>
      {loading ? (
        <ActivityIndicator color={colors.primary} size="large" />
      ) : (
        <FlatList
          data={pairs}
          keyExtractor={([a]) => a.productId.toString()}
          renderItem={({ item }) => (
            <PairRow pair={item} rowWidth={rowWidth} cardWidth={cardWidth} />
          )}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No cards in catalog.</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: 50,
    paddingHorizontal: PADDING,
  },
  header: {
    marginBottom: 16,
    alignItems: 'center',
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: 'bold',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 4,
  },
  list: {
    paddingBottom: 32,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: GAP,
  },
  empty: {
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 32,
  },
});
