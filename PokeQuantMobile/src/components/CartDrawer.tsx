import { useEffect, useRef } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors } from '../constants/colors';
import { useCart } from '../context/CartContext';
import { useVendorSettings } from '../context/VendorSettingsContext';

const DRAWER_WIDTH = 300;
const TAB_WIDTH = 70;
const TAB_HEIGHT = 44;

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function CartItemRow({
  item,
  onRemove,
}: {
  item: { cartItemId: string; card: { name: string; liveMarket: number } };
  onRemove: () => void;
}) {
  const { getCashOffer } = useVendorSettings();
  const offer = getCashOffer(item.card.liveMarket);

  return (
    <View style={styles.item}>
      <View style={styles.itemHeader}>
        <Text style={styles.itemName} numberOfLines={1}>
          {item.card.name}
        </Text>
        <TouchableOpacity onPress={onRemove} activeOpacity={0.7}>
          <Text style={styles.removeText}>×</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.itemRow}>
        <Text style={styles.itemLabel}>
          Market{' '}
          <Text style={styles.itemValue}>{formatCurrency(item.card.liveMarket)}</Text>
        </Text>
        <Text style={styles.itemLabel}>
          Offer{' '}
          <Text style={styles.itemOffer}>{formatCurrency(offer)}</Text>
        </Text>
      </View>
    </View>
  );
}

export function CartDrawer() {
  const {
    cartItems,
    isOpen,
    totalMarket,
    totalOffer,
    offerPercent,
    removeFromCart,
    toggleDrawer,
    clearCart,
  } = useCart();

  const translateX = useRef(new Animated.Value(DRAWER_WIDTH)).current;
  const didMount = useRef(false);

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }

    Animated.timing(translateX, {
      toValue: isOpen ? 0 : DRAWER_WIDTH,
      duration: 240,
      useNativeDriver: true,
    }).start();
  }, [isOpen]);

  return (
    <Animated.View
      style={[
        styles.drawer,
        { transform: [{ translateX }] },
      ]}>
      <Pressable
        onPress={toggleDrawer}
        style={({ pressed }) => [styles.tab, pressed && { opacity: 0.7 }]}>
        <View style={styles.tabContent}>
          <Text style={styles.tabLabel}>Lot</Text>
          <Text
            style={styles.tabValue}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.45}>
            {formatCurrency(totalOffer)} {isOpen ? '<' : '>'}
          </Text>
        </View>
      </Pressable>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Lot Cart</Text>
          {cartItems.length > 0 && (
            <TouchableOpacity onPress={clearCart} activeOpacity={0.7}>
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Lot Total</Text>
            <Text style={styles.totalValue}>{formatCurrency(totalOffer)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Market Total</Text>
            <Text style={styles.totalValue}>{formatCurrency(totalMarket)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Offer %</Text>
            <Text style={styles.totalValue}>{offerPercent.toFixed(1)}%</Text>
          </View>
        </View>

        {cartItems.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              Tap &quot;Log to Cart&quot; on a card to start a lot.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {cartItems.map((item) => (
              <CartItemRow
                key={item.cartItemId}
                item={item}
                onRemove={() => removeFromCart(item.cartItemId)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  drawer: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
    backgroundColor: colors.surface,
    zIndex: 40,
    shadowColor: '#000',
    shadowOffset: { width: -4, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 8,
  },
  tab: {
    position: 'absolute',
    left: -TAB_WIDTH,
    top: '40%',
    width: TAB_WIDTH,
    height: TAB_HEIGHT,
    backgroundColor: 'rgba(22, 27, 34, 0.95)',
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: -2, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 4,
  },
  tabContent: {
    width: '100%',
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  tabLabel: {
    color: colors.textMuted,
    fontSize: 8,
    fontWeight: '600',
    marginBottom: 1,
  },
  tabValue: {
    width: '100%',
    color: colors.success,
    fontSize: 10,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  content: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  contentInner: {
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: 'bold',
  },
  clearText: {
    color: colors.error,
    fontSize: 12,
  },
  totals: {
    backgroundColor: colors.surface,
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
    fontSize: 12,
  },
  totalValue: {
    color: colors.text,
    fontSize: 12,
    fontWeight: 'bold',
  },
  empty: {
    marginTop: 20,
    alignItems: 'center',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  list: {
    //
  },
  item: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    marginBottom: 10,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  itemName: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
    fontWeight: 'bold',
  },
  removeText: {
    color: colors.error,
    fontSize: 18,
    lineHeight: 18,
    marginLeft: 8,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  itemLabel: {
    color: colors.textMuted,
    fontSize: 10,
  },
  itemValue: {
    color: colors.text,
    fontSize: 10,
    fontWeight: 'bold',
  },
  itemOffer: {
    color: colors.success,
    fontSize: 10,
    fontWeight: 'bold',
  },
});
