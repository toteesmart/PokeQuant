export type TestCatalogVariant = {
  subType: string;
  marketPrice: number;
  date: string;
};

export type TestCatalogCard = {
  productId: number;
  name: string;
  number: string;
  set: string;
  rarity: string | null;
  imageUrl: string;
  variants: TestCatalogVariant[];
};
