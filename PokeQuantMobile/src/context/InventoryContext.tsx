import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useVendorSettings } from './VendorSettingsContext';

export type InventoryCard = {
  id: string;
  name: string;
  number?: string;
  set?: string;
  rarity?: string;
  productType?: string;
  liveMarket: number;
  amountPaid: number;
  stickerPrice: number;
  projProfit: number;
  stock: number;
};

export type InventoryInput = {
  id?: string;
  name: string;
  number?: string;
  set?: string;
  rarity?: string;
  productType?: string;
  liveMarket: number;
};

const DEFAULT_INVENTORY: InventoryCard[] = [
  { id: '1', name: 'Blastoise ex CN 176', liveMarket: 12.34, amountPaid: 5.0, stickerPrice: 8.0, projProfit: 3.0, stock: 2 },
  { id: '2', name: 'Charizard ex OB 054', liveMarket: 25.5, amountPaid: 15.0, stickerPrice: 22.0, projProfit: 7.0, stock: 1 },
  { id: '3', name: 'Pikachu ex PA 094', liveMarket: 9.1, amountPaid: 4.5, stickerPrice: 7.0, projProfit: -0.5, stock: 3 },
  { id: '4', name: 'Venusaur ex CL 003', liveMarket: 6.75, amountPaid: 3.25, stickerPrice: 5.0, projProfit: 1.75, stock: 2 },
  { id: '5', name: 'Mewtwo ex GG 082', liveMarket: 18.2, amountPaid: 10.0, stickerPrice: 15.0, projProfit: 5.0, stock: 1 },
  { id: '6', name: 'Rayquaza V AA 145', liveMarket: 42.0, amountPaid: 30.0, stickerPrice: 38.0, projProfit: 8.0, stock: 1 },
  { id: '7', name: 'Gengar VMAX BD 157', liveMarket: 34.1, amountPaid: 20.0, stickerPrice: 28.0, projProfit: 8.0, stock: 2 },
  { id: '8', name: 'Lugia V AA 138', liveMarket: 55.0, amountPaid: 40.0, stickerPrice: 48.0, projProfit: 8.0, stock: 1 },
  { id: '9', name: 'Darkrai VSTAR AS 123', liveMarket: 11.4, amountPaid: 6.0, stickerPrice: 9.0, projProfit: 3.0, stock: 2 },
  { id: '10', name: 'Lucario V AA 071', liveMarket: 7.8, amountPaid: 4.0, stickerPrice: 6.5, projProfit: 2.5, stock: 3 },
  { id: '11', name: 'Eevee VMAX PR 017', liveMarket: 14.6, amountPaid: 9.0, stickerPrice: 12.0, projProfit: 3.0, stock: 1 },
  { id: '12', name: 'Zoroark VSTAR AR 120', liveMarket: 21.3, amountPaid: 14.0, stickerPrice: 18.0, projProfit: 4.0, stock: 2 },
  { id: '13', name: 'Giratina VSTAR LM 080', liveMarket: 48.0, amountPaid: 35.0, stickerPrice: 42.0, projProfit: 7.0, stock: 1 },
  { id: '14', name: 'Dialga VSTAR AS 112', liveMarket: 26.7, amountPaid: 18.0, stickerPrice: 23.0, projProfit: 5.0, stock: 1 },
  { id: '15', name: 'Palkia VSTAR AS 040', liveMarket: 24.5, amountPaid: 17.0, stickerPrice: 21.0, projProfit: 4.0, stock: 1 },
];

type InventoryContextValue = {
  inventory: InventoryCard[];
  addInventoryCard: (card: InventoryInput) => void;
  removeInventoryCard: (id: string) => void;
  clearInventory: () => void;
};

const InventoryContext = createContext<InventoryContextValue | null>(null);

export function InventoryProvider({ children }: { children: ReactNode }) {
  const { getCashOffer } = useVendorSettings();
  const [inventory, setInventory] = useState<InventoryCard[]>(DEFAULT_INVENTORY);

  const addInventoryCard = (card: InventoryInput) => {
    const offer = getCashOffer(card.liveMarket);
    const newCard: InventoryCard = {
      ...card,
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      amountPaid: offer,
      stickerPrice: card.liveMarket,
      projProfit: card.liveMarket - offer,
      stock: 1,
    };
    setInventory((prev) => [newCard, ...prev]);
  };

  const removeInventoryCard = (id: string) => {
    setInventory((prev) => prev.filter((c) => c.id !== id));
  };

  const clearInventory = () => {
    setInventory([]);
  };

  const value = useMemo(
    () => ({ inventory, addInventoryCard, removeInventoryCard, clearInventory }),
    [inventory]
  );

  return (
    <InventoryContext.Provider value={value}>
      {children}
    </InventoryContext.Provider>
  );
}

export function useInventory() {
  const context = useContext(InventoryContext);
  if (!context) {
    throw new Error('useInventory must be used within an InventoryProvider');
  }
  return context;
}
