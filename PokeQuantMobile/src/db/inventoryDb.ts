import type { SQLiteDatabase } from 'expo-sqlite';
import { INVENTORY_IMAGE_BASE } from '../constants/api';

export type PersistedInventory = {
  id: string;
  name: string;
  number?: string;
  set?: string;
  rarity?: string;
  productType?: string;
  condition?: string;
  liveMarket: number;
  amountPaid: number;
  stickerPrice: number;
  isBulk: boolean;
  imageUrl?: string;
  productId?: number | null;
};

export type PersistedCompletedSale = {
  id: string;
  name: string;
  number?: string;
  set?: string;
  condition?: string;
  acquiredCost: number;
  soldPrice: number;
  dateSold: string;
};

export type InventoryUpsert = PersistedInventory & {
  userId: string;
  isSold?: boolean;
  soldPrice?: number;
  dateSold?: string;
  isDeleted?: boolean;
  dateBought?: string;
  productId?: number | null;
};

type CustomData = {
  liveMarket?: number;
  imageUrl?: string;
  productType?: string;
};

function buildCustomData(
  liveMarket: number,
  imageUrl?: string,
  productType?: string
): string {
  const payload: CustomData = { liveMarket };
  if (imageUrl) payload.imageUrl = imageUrl;
  if (productType) payload.productType = productType;
  return JSON.stringify(payload);
}

function asNumber(value: unknown, fallback: number): number {
  const n = Number.parseFloat(String(value));
  return Number.isNaN(n) ? fallback : n;
}

function asProductId(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  const int = Math.trunc(n);
  return int > 0 ? int : null;
}

function isBase64Image(value?: string): boolean {
  if (!value || value.trim().length < 100) return false;
  const base64Pattern = /^[A-Za-z0-9+/=\r\n]+$/;
  return base64Pattern.test(value.replace(/\s/g, ''));
}

function sanitizeImageUrl(url?: string): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (trimmed.startsWith('http') || trimmed.startsWith('data:')) {
    return trimmed;
  }
  if (isBase64Image(trimmed)) {
    const cleaned = trimmed.replace(/\s/g, '');
    return `data:image/jpeg;base64,${cleaned}`;
  }
  return trimmed;
}

function parseCustomData(json?: string | null): CustomData {
  if (!json) return {};
  const raw = json.trim();
  // Cloud rows from the PWA may store a raw data URI or bare base64 string
  // directly in custom_image_data instead of the mobile JSON wrapper.
  if (raw.startsWith('data:') || isBase64Image(raw)) {
    return { imageUrl: raw };
  }
  try {
    return JSON.parse(raw) as CustomData;
  } catch {
    return {};
  }
}

function resolveInventoryImageUrl(row: any): string | undefined {
  const extra = parseCustomData(row.custom_image_data);
  if (extra.imageUrl) {
    const sanitized = sanitizeImageUrl(extra.imageUrl);
    if (sanitized) return sanitized;
  }
  const productId = asProductId(row.product_id);
  if (productId) {
    return `${INVENTORY_IMAGE_BASE}/${productId}.jpg`;
  }
  return undefined;
}

function mapRowToInventory(row: any): PersistedInventory {
  const extra = parseCustomData(row.custom_image_data);
  const stickerPrice = row.sticker_price ?? 0;
  const amountPaid = row.purchase_price ?? 0;
  const liveMarket =
    typeof extra.liveMarket === 'number'
      ? extra.liveMarket
      : asNumber(extra.liveMarket, stickerPrice);

  return {
    id: row.id,
    name: row.card_name ?? '',
    number: row.card_number || undefined,
    set: row.set_name || undefined,
    rarity: row.variant || undefined,
    productType: extra.productType,
    condition: row.condition || undefined,
    liveMarket,
    amountPaid,
    stickerPrice,
    isBulk: row.is_bulk_deal === 1,
    imageUrl: resolveInventoryImageUrl(row),
    productId: asProductId(row.product_id),
  };
}

function mapRowToCompletedSale(row: any): PersistedCompletedSale {
  return {
    id: row.id,
    name: row.card_name ?? '',
    number: row.card_number || undefined,
    set: row.set_name || undefined,
    condition: row.condition || undefined,
    acquiredCost: row.purchase_price ?? 0,
    soldPrice: row.sold_price ?? 0,
    dateSold: row.date_sold ?? new Date().toISOString(),
  };
}

export async function loadActiveInventory(
  db: SQLiteDatabase,
  userId: string
): Promise<PersistedInventory[]> {
  const rows = await db.getAllAsync<any>(
    `SELECT id, product_id, card_name, card_number, set_name, variant, condition,
            purchase_price, sticker_price, is_bulk_deal, custom_image_data
     FROM inventory
     WHERE user_id = ? AND is_sold = 0 AND is_deleted = 0
     ORDER BY updated_at DESC`,
    userId
  );
  return rows.map(mapRowToInventory);
}

export async function loadCompletedSales(
  db: SQLiteDatabase,
  userId: string
): Promise<PersistedCompletedSale[]> {
  const rows = await db.getAllAsync<any>(
    `SELECT id, card_name, card_number, set_name, condition,
            purchase_price, sold_price, date_sold
     FROM inventory
     WHERE user_id = ? AND is_sold = 1 AND is_deleted = 0
     ORDER BY date_sold DESC`,
    userId
  );
  return rows.map(mapRowToCompletedSale);
}

export async function getInventoryItem(
  db: SQLiteDatabase,
  id: string
): Promise<PersistedInventory | null> {
  const row = await db.getFirstAsync<any>(
    `SELECT id, product_id, card_name, card_number, set_name, variant, condition,
            purchase_price, sticker_price, is_bulk_deal, custom_image_data
     FROM inventory
     WHERE id = ?`,
    id
  );
  return row ? mapRowToInventory(row) : null;
}

export async function upsertInventoryItem(
  db: SQLiteDatabase,
  item: InventoryUpsert
): Promise<void> {
  let dateBought = item.dateBought;
  let productId = item.productId;

  if (!dateBought || productId === undefined) {
    const existing = await db.getFirstAsync<{
      date_bought: string;
      product_id: number | null;
    }>(
      `SELECT date_bought, product_id FROM inventory WHERE id = ?`,
      item.id
    );
    if (!dateBought) {
      dateBought = existing ? existing.date_bought : new Date().toISOString();
    }
    if (productId === undefined) {
      productId = existing?.product_id ?? null;
    }
  }

  const customData = buildCustomData(
    item.liveMarket,
    item.imageUrl,
    item.productType
  );

  await db.runAsync(
    `INSERT OR REPLACE INTO inventory (
      id, user_id, product_id, card_name, card_number, set_name, variant, condition,
      purchase_price, sticker_price, date_bought, is_bulk_deal, is_sold, sold_price,
      date_sold, custom_image_data, is_deleted, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    item.id,
    item.userId,
    productId,
    item.name,
    item.number ?? '',
    item.set ?? '',
    item.rarity ?? '',
    item.condition ?? '',
    item.amountPaid,
    item.stickerPrice,
    dateBought,
    item.isBulk ? 1 : 0,
    item.isSold ? 1 : 0,
    item.soldPrice ?? 0,
    item.dateSold ?? '',
    customData,
    item.isDeleted ? 1 : 0,
    Date.now()
  );
}

export async function softDeleteInventoryItem(
  db: SQLiteDatabase,
  id: string
): Promise<void> {
  await db.runAsync(
    `UPDATE inventory SET is_deleted = 1, updated_at = ? WHERE id = ?`,
    Date.now(),
    id
  );
}

export async function markInventorySold(
  db: SQLiteDatabase,
  id: string,
  soldPrice: number,
  dateSold: string
): Promise<void> {
  await db.runAsync(
    `UPDATE inventory
     SET is_sold = 1, sold_price = ?, date_sold = ?, updated_at = ?
     WHERE id = ?`,
    soldPrice,
    dateSold,
    Date.now(),
    id
  );
}

export async function unmarkInventorySold(
  db: SQLiteDatabase,
  id: string
): Promise<void> {
  await db.runAsync(
    `UPDATE inventory
     SET is_sold = 0, sold_price = 0, date_sold = '', updated_at = ?
     WHERE id = ?`,
    Date.now(),
    id
  );
}
