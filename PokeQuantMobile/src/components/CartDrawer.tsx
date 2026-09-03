import { useCallback, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors } from '../constants/colors';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { initializeDatabase } from '../db/database';
import { logCartItemsToInventory } from '../db/inventoryDb';

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function CartDrawer() {
  const {
    cartItems,
    isOpen,
    totalMarket,
    totalOffer,
    offerPercent,
    removeFromCart,
    closeDrawer,
    clearCart,
  } = useCart();

  const { userId } = useAuth();
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
      clearCart();
      closeDrawer();
      Alert.alert(
        'Lot Logged',
        `${cartItems.length} item${
          cartItems.length !== 1 ? 's' : ''
        } added to inventory.`
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to log lot to inventory';
      console.error('Log lot to inventory failed:', err);
      Alert.alert('Error', message);
    } finally {
      setIsLogging(false);
    }
  }, [cartItems, clearCart, closeDrawer, userId]);

  return (
    <Modal
      animationType="slide"
      transparent
      visible={isOpen}
      onRequestClose={closeDrawer}
      presentationStyle="overFullScreen">
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={closeDrawer} />
        <View style={styles.sheet}>
          <View style={styles.handleRow}>
            <Text style={styles.title}>Lot Cart</Text>
            <TouchableOpacity onPress={closeDrawer} activeOpacity={0.7}>
              <Text style={styles.closeText}>Close</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.totals}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total Market Value</Text>
              <Text style={styles.totalValue}>{formatCurrency(totalMarket)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total Cash Offer</Text>
              <Text style={styles.totalValue}>{formatCurrency(totalOffer)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Effective Margin</Text>
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
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}>
              {cartItems.map((item, index) => (
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
                      activeOpacity={0.7}>
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
              ))}
            </ScrollView>
          )}

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.button, styles.clearButton]}
              activeOpacity={0.7}
              onPress={handleClear}>
              <Text style={styles.clearButtonText}>Clear Lot</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.logButton]}
              activeOpacity={0.7}
              onPress={handleLogToInventory}
              disabled={cartItems.length === 0 || !userId || isLogging}>
              <Text
                style={[
                  styles.logButtonText,
                  (cartItems.length === 0 || !userId || isLogging) && {
                    opacity: 0.6,
                  },
                ]}>
                {isLogging ? 'Logging...' : 'Log to Inventory'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    maxHeight: '85%',
    zIndex: 10,
  },
  handleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: 'bold',
  },
  closeText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  totals: {
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
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
    fontWeight: 'bold',
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
  list: {
    maxHeight: 320,
  },
  listContent: {
    paddingBottom: 8,
  },
  item: {
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
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
    fontWeight: 'bold',
  },
  itemSub: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  removeText: {
    color: colors.error,
    fontSize: 22,
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
    fontWeight: 'bold',
  },
  itemOffer: {
    color: colors.success,
    fontSize: 12,
    fontWeight: 'bold',
  },
  itemPct: {
    color: colors.metricLabel,
    fontSize: 11,
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  button: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  clearButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: colors.error,
  },
  clearButtonText: {
    color: colors.error,
    fontSize: 14,
    fontWeight: '600',
  },
  logButton: {
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
  },
  logButtonText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
});
