import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useVendorSettings } from './VendorSettingsContext';

export type CartCard = {
  id?: string;
  name: string;
  number?: string;
  set?: string;
  rarity?: string;
  productType?: string;
  liveMarket: number;
};

export type CartItem = {
  cartItemId: string;
  card: CartCard;
};

type CartContextValue = {
  cartItems: CartItem[];
  isOpen: boolean;
  totalMarket: number;
  totalOffer: number;
  offerPercent: number;
  addToCart: (card: CartCard, open?: boolean) => void;
  removeFromCart: (cartItemId: string) => void;
  clearCart: () => void;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const { getCashOffer } = useVendorSettings();
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  const { totalMarket, totalOffer, offerPercent } = useMemo(() => {
    const totalMarket = cartItems.reduce(
      (sum, item) => sum + item.card.liveMarket,
      0
    );
    const totalOffer = cartItems.reduce(
      (sum, item) => sum + getCashOffer(item.card.liveMarket),
      0
    );
    const offerPercent =
      totalMarket > 0 ? (totalOffer / totalMarket) * 100 : 0;
    return { totalMarket, totalOffer, offerPercent };
  }, [cartItems, getCashOffer]);

  const addToCart = (card: CartCard, open = true) => {
    const cartItemId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    setCartItems((prev) => [...prev, { cartItemId, card }]);
    if (open) {
      setIsOpen(true);
    }
  };

  const removeFromCart = (cartItemId: string) => {
    setCartItems((prev) => prev.filter((item) => item.cartItemId !== cartItemId));
  };

  const clearCart = () => {
    setCartItems([]);
  };

  const openDrawer = () => setIsOpen(true);
  const closeDrawer = () => setIsOpen(false);
  const toggleDrawer = () => setIsOpen((v) => !v);

  const value = useMemo(
    () => ({
      cartItems,
      isOpen,
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
    [cartItems, isOpen, totalMarket, totalOffer, offerPercent]
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
