import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type CartItem = {
  id: string;
  productId: number;
  cardName: string;
  cardNumber: string;
  setName: string;
  variant: string;
  condition: string;
  marketPrice: number;
  buyPercentage: number;
  cashOffer: number;
  imageUrl?: string;
};

export type CartItemInput = Omit<CartItem, 'id' | 'buyPercentage'>;

type CartContextValue = {
  cartItems: CartItem[];
  isOpen: boolean;
  itemCount: number;
  totalMarket: number;
  totalOffer: number;
  offerPercent: number;
  addToCart: (item: CartItemInput, open?: boolean) => void;
  removeFromCart: (index: number) => void;
  clearCart: () => void;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  const addToCart = useCallback((item: CartItemInput, open = false) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const buyPercentage =
      item.marketPrice > 0
        ? Number(((item.cashOffer / item.marketPrice) * 100).toFixed(2))
        : 0;
    setCartItems((prev) => [...prev, { ...item, id, buyPercentage }]);
    if (open) {
      setIsOpen(true);
    }
  }, []);

  const removeFromCart = useCallback((index: number) => {
    setCartItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearCart = useCallback(() => {
    setCartItems([]);
  }, []);

  const openDrawer = useCallback(() => setIsOpen(true), []);
  const closeDrawer = useCallback(() => setIsOpen(false), []);
  const toggleDrawer = useCallback(() => setIsOpen((v) => !v), []);

  const { totalMarket, totalOffer, offerPercent, itemCount } = useMemo(() => {
    const totalMarket = cartItems.reduce(
      (sum, item) => sum + item.marketPrice,
      0
    );
    const totalOffer = cartItems.reduce(
      (sum, item) => sum + item.cashOffer,
      0
    );
    const offerPercent =
      totalMarket > 0 ? (totalOffer / totalMarket) * 100 : 0;
    return {
      totalMarket,
      totalOffer,
      offerPercent,
      itemCount: cartItems.length,
    };
  }, [cartItems]);

  const value = useMemo(
    () => ({
      cartItems,
      isOpen,
      itemCount,
      totalMarket,
      totalOffer,
      offerPercent,
      addToCart,
      removeFromCart,
      clearCart,
      openDrawer,
      closeDrawer,
      toggleDrawer,
    }),
    [
      cartItems,
      isOpen,
      itemCount,
      totalMarket,
      totalOffer,
      offerPercent,
      addToCart,
      removeFromCart,
      clearCart,
      openDrawer,
      closeDrawer,
      toggleDrawer,
    ]
  );

  return (
    <CartContext.Provider value={value}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}
