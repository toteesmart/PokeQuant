import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { initializeDatabase } from '../db/database';
import { colors } from '../constants/colors';

type InventoryItem = {
  id: string;
  card_name: string;
  card_number: string;
  set_name: string;
  variant: string;
  condition: string;
  sticker_price: number;
};

export function InventoryScreen() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadInventory() {
      try {
        setLoading(true);
        setError(null);

        const { db } = await initializeDatabase();

        const countRow = await db.getFirstAsync<{ count: number }>(
          'SELECT COUNT(*) AS count FROM inventory WHERE is_deleted = 0'
        );

        const rows = await db.getAllAsync<InventoryItem>(
          `SELECT
            id,
            card_name,
            card_number,
            set_name,
            variant,
            condition,
            sticker_price
          FROM inventory
          WHERE is_deleted = 0
          ORDER BY date_bought DESC, updated_at DESC
          LIMIT 200`
        );

        if (!cancelled) {
          setCount(countRow?.count ?? 0);
          setItems(rows);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadInventory();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.heading}>Inventory</Text>
        <Text style={styles.count}>
          {loading ? 'Loading...' : `Items: ${count ?? 0}`}
        </Text>
      </View>

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.status}>Reading local SQLite...</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          numColumns={2}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.emptyText}>No inventory items yet.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.cardName} numberOfLines={2}>
                {item.card_name}
              </Text>
              <Text style={styles.cardMeta}>{item.set_name}</Text>
              <Text style={styles.cardMeta}>
                {item.condition}
                {item.variant ? ` · ${item.variant}` : ''}
              </Text>
              <Text style={styles.cardPrice}>
                ${item.sticker_price?.toFixed(2) ?? '0.00'}
              </Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  heading: {
    color: colors.text,
    fontSize: 28,
    fontWeight: 'bold',
  },
  count: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 4,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  status: {
    color: colors.textMuted,
    marginTop: 12,
    fontSize: 14,
  },
  list: {
    padding: 12,
    flexGrow: 1,
  },
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    margin: 8,
    minHeight: 160,
    justifyContent: 'space-between',
  },
  cardName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  cardMeta: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
  cardPrice: {
    color: colors.success,
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 8,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 16,
  },
  errorBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: colors.error,
    borderWidth: 1,
    borderRadius: 8,
    margin: 16,
    padding: 12,
  },
  errorText: {
    color: colors.error,
    fontSize: 14,
  },
});
