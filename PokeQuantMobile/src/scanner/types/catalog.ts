export type ScanCatalogVariant = {
  subType: string;
  marketPrice: number;
  date: string;
};

export type ScanCatalogCard = {
  productId: number;
  name: string;
  number: string;
  set: string;
  rarity: string | null;
  imageUrl: string;
  variants: ScanCatalogVariant[];
};

// Pre-normalized L2 unit vectors keyed by productId (cosine = dot).
export type EmbeddingMap = Map<number, Float32Array>;
