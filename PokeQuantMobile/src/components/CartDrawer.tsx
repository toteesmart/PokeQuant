import { useCallback, useState } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors } from '../constants/colors';
import { useAuth } from '../hooks/useAuth';
import { useCartStore } from '../store/cartStore';
import { useInventoryStore } from '../store/inventoryStore';
import { initializeDatabase } from '../db/database';
import { logCartItemsToInventory } from '../db/inventoryDb';
import { formatCurrency } from '../utils/format';
import { AppButton, GlassSheet } from './ui';
import { toErrorMessage } from '../utils/log';

export function CartDrawer() {
  const cartItems = useCartStore((state) => state.cartItems);
  const isDrawerOpen = useCartStore((state) => state.isDrawerOpen);
  const totalMarket = useCartStore((state) => state.totalMarket);
  const totalOffer = useCartStore((state) => state.totalOffer);
  const offerPercent = useCartStore((state) => state.offerPercent);
  const removeFromCart = useCartStore((state) => state.removeFromCart);
  const closeDrawer = useCartStore((state) => state.closeDrawer);
  const clearCart = useCartStore((state) => state.clearCart);

  const { userId } = useAuth();
  const refreshInventoryState = useInventoryStore(
    (state) => state.refreshInventoryState
  );
  const [isLogging, setIsLogging] = useState(false);

  const handleClear = useCallback(() => {
    closeDrawer();
    clearCart();
  }, [closeDrawer, clearCart]);

  const handleLogToInventory = useCallback(async () => {
    if (cartItems.length === 0 || !userId) return;
    setIsLogging(true);
    try {
      const { db } = await initializeDatabase();
      await logCartItemsToInventory(db, userId, cartItems);
      await refreshInventoryState();
      clearCart();
      closeDrawer();
      Alert.alert(
        'Lot added',
        `${cartItems.length} card${
          cartItems.length !== 1 ? 's' : ''
        } added to your inventory.`
      );
    } catch (err) {
      console.error('Log lot to inventory failed:', err);
      Alert.alert("Couldn't add the lot", toErrorMessage(err));
    } finally {
      setIsLogging(false);
    }
  }, [cartItems, clearCart, closeDrawer, refreshInventoryState, userId]);

  if (!isDrawerOpen) return null;

  return (
    <GlassSheet
      title="Lot"
      onClose={closeDrawer}
      footer={
        <View style={styles.footerRow}>
          <AppButton
            title="Clear lot"
            variant="danger"
            onPress={handleClear}
            style={styles.footerBtn}
          />
          <AppButton
            title={isLogging ? 'Adding…' : 'Add to inventory'}
            onPress={handleLogToInventory}
            disabled={cartItems.length === 0 || !userId || isLogging}
            loading={isLogging}
            style={styles.footerBtn}
          />
        </View>
      }>
      <>
        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Market value</Text>
            <Text style={styles.totalValue}>{formatCurrency(totalMarket)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>You pay</Text>
            <Text style={styles.totalValue}>{formatCurrency(totalOffer)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Offer vs market</Text>
            <Text style={styles.totalValue}>{offerPercent.toFixed(1)}%</Text>
          </View>
        </View>

        {cartItems.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              Your lot is empty. Add cards from the search results.
            </Text>
          </View>
        ) : (
          // Items flow inside the sheet's own scroll — a bounded inner
          // ScrollView would fight it for gestures.
          cartItems.map((item, index) => (
            <View key={item.id} style={styles.item}>
              <View style={styles.itemHeader}>
                <View style={styles.itemMeta}>
                  <Text style={styles.itemName} numberOfLines={1}>
                    {item.cardName}
                  </Text>
                  <Text style={styles.itemSub} numberOfLines={1}>
                    {item.variant} · {item.condition}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => removeFromCart(index)}
                  activeOpacity={0.7}
                  hitSlop={8}
                  accessibilityLabel={`Remove ${item.cardName}`}
                  accessibilityRole="button">
                  <Text style={styles.removeText}>×</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.itemRow}>
                <Text style={styles.itemLabel}>
                  Market{' '}
                  <Text style={styles.itemValue}>
                    {formatCurrency(item.marketPrice)}
                  </Text>
                </Text>
                <Text style={styles.itemLabel}>
                  Offer{' '}
                  <Text style={styles.itemOffer}>
                    {formatCurrency(item.cashOffer)}
                  </Text>
                </Text>
              </View>
              <Text style={styles.itemPct}>
                {item.buyPercentage.toFixed(1)}% of market
              </Text>
            </View>
          ))
        )}
      </>
    </GlassSheet>
  );
}

const styles = StyleSheet.create({
  footerRow: {
    flexDirection: 'row',
    gap: 10,
  },
  footerBtn: {
    flex: 1,
  },
  totals: {
    backgroundColor: colors.overlay2,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  totalLabel: {
    color: colors.textMuted,
    fontSize: 13,
  },
  totalValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  empty: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
  },
  item: {
    backgroundColor: colors.overlay2,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  itemMeta: {
    flex: 1,
    marginRight: 8,
  },
  itemName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  itemSub: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  removeText: {
    color: colors.error,
    fontSize: 24,
    lineHeight: 22,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  itemLabel: {
    color: colors.textMuted,
    fontSize: 12,
  },
  itemValue: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  itemOffer: {
    color: colors.success,
    fontSize: 12,
    fontWeight: '700',
  },
  itemPct: {
    color: colors.metricLabel,
    fontSize: 11,
  },
});
