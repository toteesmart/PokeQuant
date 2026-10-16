// inventory/pricing — catalog-side resolution for inventory cards:
// image-URL derivation, variant maps, market-price lookups, and the
// cash-offer / sticker derivation shared by single and bulk adds.
// Pure helpers; the only store read is useVendorStore for offer math.
import {
  getProductMarketPrices,
  openCatalogDatabase,
  type ProductMarketData,
  type ProductMarketPriceMap,
} from '../../db/catalogDb';
import { getCatalogImageUri } from '../../services/CatalogImageService';
import { CATALOG_IMAGE_BASE, INVENTORY_IMAGE_BASE } from '../../constants/api';
import { useVendorStore } from '../vendorStore';

export function buildInventoryImageUrl(
  imageUrl: string | undefined,
  productId: number | null | undefined,
  catalogImageUrl?: string,
): string | undefined {
  const trimmed = imageUrl?.trim() ?? '';
  // file:// URLs point to a catalog-image cache on a specific device/install
  // and are not portable across phones or rebuilds, so treat them like the
  // generated CDN URLs and re-derive an image from productId instead.
  const isReproducibleUrl =
    trimmed.startsWith(INVENTORY_IMAGE_BASE) ||
    trimmed.startsWith(CATALOG_IMAGE_BASE) ||
    trimmed.startsWith('file://');

  if (trimmed && !isReproducibleUrl) {
    if (trimmed.startsWith('http://')) {
      return trimmed.replace(/^http:\/\//, 'https://');
    }
    return trimmed;
  }

  if (catalogImageUrl) {
    return catalogImageUrl;
  }

  if (trimmed && productId != null && productId !== 0) {
    return getCatalogImageUri(productId) ?? trimmed;
  }

  if (productId == null || productId === 0) return undefined;
  return getCatalogImageUri(productId);
}

export function buildVariantMap(
  cards: {
    productId?: number | null;
    productType?: string;
    rarity?: string;
  }[],
): Record<number, string> {
  const map: Record<number, string> = {};
  for (const card of cards) {
    if (card.productId == null) continue;
    if (map[card.productId] == null) {
      map[card.productId] = card.productType ?? card.rarity ?? 'Normal';
    }
  }
  return map;
}

export async function lookupMarketData(
  productIds: number[],
  variantMap: Record<number, string>,
): Promise<{
  marketMap: ProductMarketPriceMap;
  imageUrlMap: Record<number, string | undefined>;
}> {
  const catalog = await openCatalogDatabase();
  const marketMap = await getProductMarketPrices(catalog, productIds, variantMap);
  const imageUrlMap: Record<number, string | undefined> = {};
  for (const productId of productIds) {
    imageUrlMap[productId] = getCatalogImageUri(productId);
  }
  return { marketMap, imageUrlMap };
}

// Resolves a card's pricing triple against its catalog match. The image URL
// rebuilds whenever a productId exists — even on a price miss — so rows
// always upgrade from file:// leftovers to the local/CDN image.
export function resolveCardMarket(
  card: {
    productId?: number | null;
    condition?: string;
    liveMarket: number;
    productType?: string;
    imageUrl?: string;
  },
  market: Pick<ProductMarketData, 'marketPrice' | 'matchedSubType'> | undefined,
  catalogImageUrl: string | undefined,
): {
  liveMarket: number;
  productType: string | undefined;
  imageUrl: string | undefined;
} {
  const { getConditionedMarket } = useVendorStore.getState();
  return {
    liveMarket: market ? getConditionedMarket(market.marketPrice, card.condition) : card.liveMarket,
    productType: market ? market.matchedSubType : card.productType,
    imageUrl: buildInventoryImageUrl(card.imageUrl, card.productId, catalogImageUrl),
  };
}

// Cash-offer / sticker derivation shared by single and bulk adds.
// getStickerPrice runs even on explicit stickers — the rounding rules apply
// to vendor-entered prices too.
export function derivePaidAndSticker(
  liveMarket: number,
  amountPaid: number | undefined,
  stickerPrice: number | undefined,
): { amountPaid: number; stickerPrice: number } {
  const { getCashOffer, getStickerPrice } = useVendorStore.getState();
  const paid = typeof amountPaid === 'number' ? amountPaid : Math.round(getCashOffer(liveMarket));
  const rawSticker = typeof stickerPrice === 'number' ? stickerPrice : getStickerPrice(liveMarket);
  return { amountPaid: paid, stickerPrice: getStickerPrice(rawSticker) };
}
