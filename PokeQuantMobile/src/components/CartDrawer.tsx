import { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { colors } from '../constants/colors';
import { useCart } from '../context/CartContext';
import { useVendorSettings } from '../context/VendorSettingsContext';

const DRAWER_WIDTH = 280;
const HANDLE_WIDTH = 56;

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

export function CartDrawer({ containerHeight }: { containerHeight?: number }) {
  const {
    cartItems,
    isOpen,
    totalMarket,
    totalOffer,
    offerPercent,
    removeFromCart,
    closeDrawer,
    toggleDrawer,
    clearCart,
  } = useCart();

  const { height: screenHeight } = useWindowDimensions();
  const baseHeight = containerHeight || screenHeight;
  const DRAWER_HEIGHT = Math.min(440, baseHeight * 0.6);
  const maxY = Math.max(0, baseHeight - DRAWER_HEIGHT);

  const translateX = useRef(
    new Animated.Value(DRAWER_WIDTH - HANDLE_WIDTH)
  ).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const currentY = useRef(0);
  const panStartY = useRef(0);

  useEffect(() => {
    if (currentY.current > maxY) {
      currentY.current = maxY;
      translateY.setValue(maxY);
    }
  }, [maxY, translateY]);

  useEffect(() => {
    Animated.timing(translateX, {
      toValue: isOpen ? 0 : DRAWER_WIDTH - HANDLE_WIDTH,
      duration: 240,
      useNativeDriver: false,
    }).start();
  }, [isOpen, translateX]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gs) =>
          Math.abs(gs.dy) > 5 && Math.abs(gs.dy) > Math.abs(gs.dx),
        onPanResponderGrant: () => {
          panStartY.current = currentY.current;
        },
        onPanResponderMove: (_, gs) => {
          const next = panStartY.current + gs.dy;
          const clamped = Math.max(0, Math.min(maxY, next));
          currentY.current = clamped;
          translateY.setValue(clamped);
        },
        onPanResponderRelease: (_, gs) => {
          if (Math.abs(gs.dy) < 5 && Math.abs(gs.dx) < 5) {
            toggleDrawer();
          }
        },
      }),
    [maxY, toggleDrawer, translateY]
  );

  return (
    <>
      {isOpen && (
        <TouchableOpacity
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0, 0, 0, 0.35)', zIndex: 30 }]}
          activeOpacity={1}
          onPress={closeDrawer}
        />
      )}

      <Animated.View
        style={[
          styles.drawer,
          {
            width: DRAWER_WIDTH,
            height: DRAWER_HEIGHT,
            transform: [{ translateX }, { translateY }],
          },
        ]}>
        <View style={styles.drawerInner}>
          <View style={styles.handle} {...panResponder.panHandlers}>
            <View style={styles.handleContent}>
              <Text style={styles.handleLabel}>Lot</Text>
              <Text style={styles.handleTotal} numberOfLines={1}>
                {formatCurrency(totalOffer)}
              </Text>
              <Text style={styles.handleChevron}>{isOpen ? '›' : '‹'}</Text>
            </View>
          </View>

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
        </View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    zIndex: 30,
  },
  overlayVisible: {
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  drawer: {
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 40,
    backgroundColor: 'transparent',
  },
  drawerInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: 'transparent',
  },
  handle: {
    width: HANDLE_WIDTH,
    height: 110,
    alignSelf: 'center',
    backgroundColor: 'rgba(22, 27, 34, 0.92)',
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRightWidth: 0,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  handleContent: {
    width: HANDLE_WIDTH,
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  handleLabel: {
    color: colors.textMuted,
    fontSize: 8,
    fontWeight: '600',
  },
  handleTotal: {
    color: colors.success,
    fontSize: 10,
    fontWeight: 'bold',
    marginVertical: 2,
  },
  handleChevron: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
    backgroundColor: 'rgba(22, 27, 34, 0.92)',
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
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
