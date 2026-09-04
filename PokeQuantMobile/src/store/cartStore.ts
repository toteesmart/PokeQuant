import { create } from 'zustand';

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

type CartTotals = {
  itemCount: number;
  totalMarket: number;
  totalOffer: number;
  offerPercent: number;
};

type CartState = {
  cartItems: CartItem[];
  isDrawerOpen: boolean;
} & CartTotals;

type CartActions = {
  addToCart: (item: CartItemInput, open?: boolean) => void;
  removeFromCart: (index: number) => void;
  clearCart: () => void;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
};

function computeTotals(cartItems: CartItem[]): CartTotals {
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
    itemCount: cartItems.length,
    totalMarket,
    totalOffer,
    offerPercent,
  };
}

export const useCartStore = create<CartState & CartActions>((set) => ({
  cartItems: [],
  isDrawerOpen: false,
  ...computeTotals([]),

  addToCart: (item, open = false) =>
    set((state) => {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const buyPercentage =
        item.marketPrice > 0
          ? Number(((item.cashOffer / item.marketPrice) * 100).toFixed(2))
          : 0;
      const cartItems = [...state.cartItems, { ...item, id, buyPercentage }];
      return {
        cartItems,
        ...computeTotals(cartItems),
        ...(open ? { isDrawerOpen: true } : {}),
      };
    }),

  removeFromCart: (index) =>
    set((state) => {
      const cartItems = state.cartItems.filter((_, i) => i !== index);
      return { cartItems, ...computeTotals(cartItems) };
    }),

  clearCart: () => set({ cartItems: [], ...computeTotals([]) }),

  openDrawer: () => set({ isDrawerOpen: true }),
  closeDrawer: () => set({ isDrawerOpen: false }),
  toggleDrawer: () =>
    set((state) => ({ isDrawerOpen: !state.isDrawerOpen })),
}));
