import * as Crypto from 'expo-crypto';
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
  if (Number.isNaN(n) || !Number.isFinite(n)) return null;
  const t = Math.trunc(n);
  return t === 0 ? null : t;
}

function isBase64Image(value?: string): boolean {
  if (!value || value.trim().length < 100) return false;
  const base64Pattern = /^[A-Za-z0-9+/=\r\n]+$/;
  return base64Pattern.test(value.replace(/\s/g, ''));
}

function prefixBase64Image(value: string): string | undefined {
  const cleaned = value.replace(/\s/g, '');
  if (cleaned.startsWith('data:')) return cleaned;
  // PNG base64 always begins with the magic string 'iVBORw0K'.
  if (cleaned.startsWith('iVBORw0K')) {
    return `data:image/png;base64,${cleaned}`;
  }
  // JPEG base64 always begins with the magic string '/9j/'.
  if (cleaned.startsWith('/9j/')) {
    return `data:image/jpeg;base64,${cleaned}`;
  }
  return undefined;
}

export function sanitizeImageUrl(url?: string): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  // Remote images must be served over HTTPS. React Native blocks cleartext
  // http:// URLs on iOS and Android by default, so upgrade them here.
  if (trimmed.startsWith('https://') || trimmed.startsWith('data:')) {
    return trimmed;
  }
  if (trimmed.startsWith('http://')) {
    return trimmed.replace(/^http:\/\//, 'https://');
  }
  const prefixed = prefixBase64Image(trimmed);
  if (prefixed) return prefixed;
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
  if (productId == null) return undefined;
  // INVENTORY_IMAGE_BASE is hardcoded to https:// to keep remote fallbacks secure.
  return `${INVENTORY_IMAGE_BASE}/${productId}.jpg`;
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

export async function logCartItemsToInventory(
  db: SQLiteDatabase,
  userId: string,
  cartItems: any[]
): Promise<number> {
  if (!cartItems.length) return 0;

  await db.withTransactionAsync(async () => {
    for (const item of cartItems) {
      const id = Crypto.randomUUID().replace(/-/g, '');
      const dateBought = new Date().toISOString().split('T')[0];
      const updatedAt = Math.floor(Date.now() / 1000);

      await db.runAsync(
        `INSERT INTO inventory (
          id, user_id, product_id, card_name, card_number, set_name, variant, condition,
          purchase_price, sticker_price, date_bought, is_bulk_deal, is_sold, sold_price,
          date_sold, custom_image_data, is_deleted, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        String(userId),
        Math.trunc(Number(item.productId)) || 0,
        String(item.cardName || ''),
        String(item.cardNumber || ''),
        String(item.setName || ''),
        String(item.variant || ''),
        String(item.condition || ''),
        Number(item.purchasePrice ?? item.cashOffer) || 0.0,
        Number(item.stickerPrice ?? item.marketPrice) || 0.0,
        dateBought,
        Number(Boolean(item.isBulkDeal)) || 0,
        0,
        0.0,
        null,
        null,
        0,
        updatedAt
      );
    }
  });

  return cartItems.length;
}

export type SearchInventoryInput = {
  userId: string;
  productId: number;
  cardName: string;
  cardNumber?: string;
  setName?: string;
  variant: string;
  condition: string;
  liveMarket: number;
  cashOffer: number;
  stickerPrice: number;
  imageUrl?: string;
};

export async function addInventoryFromSearch(
  db: SQLiteDatabase,
  input: SearchInventoryInput
): Promise<void> {
  await db.withTransactionAsync(async () => {
    const id = Crypto.randomUUID().replace(/-/g, '');
    const dateBought = new Date().toISOString().split('T')[0];
    const updatedAt = Date.now() / 1000;
    const customData = buildCustomData(
      input.liveMarket,
      input.imageUrl,
      input.variant
    );

    await db.runAsync(
      `INSERT INTO inventory (
        id, user_id, product_id, card_name, card_number, set_name, variant, condition,
        purchase_price, sticker_price, date_bought, is_bulk_deal, is_sold, sold_price,
        date_sold, custom_image_data, is_deleted, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      String(input.userId),
      Math.trunc(Number(input.productId)) || 0,
      String(input.cardName || ''),
      String(input.cardNumber || ''),
      String(input.setName || ''),
      String(input.variant || ''),
      String(input.condition || ''),
      Number(input.cashOffer) || 0.0,
      Number(input.stickerPrice) || 0.0,
      dateBought,
      0,
      0,
      0.0,
      '',
      customData,
      0,
      updatedAt
    );
  });
}

export async function getPendingSyncCount(
  db: SQLiteDatabase,
  userId: string
): Promise<number> {
  const result = await db.getAllAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM inventory
     WHERE user_id = ? AND updated_at > COALESCE(
       (SELECT last_updated FROM sync_metadata WHERE user_id = ?), 0
     )`,
    userId,
    userId
  );
  return result[0]?.count ?? 0;
}

// Headless LWW remote-apply engine

const INVENTORY_COLUMNS = [
  'id',
  'user_id',
  'product_id',
  'card_name',
  'card_number',
  'set_name',
  'variant',
  'condition',
  'purchase_price',
  'sticker_price',
  'date_bought',
  'is_bulk_deal',
  'is_sold',
  'sold_price',
  'date_sold',
  'custom_image_data',
  'is_deleted',
  'updated_at',
] as const;

type InventoryColumn = (typeof INVENTORY_COLUMNS)[number];

const UPSERT_SQL = (() => {
  const columns = INVENTORY_COLUMNS.join(', ');
  const placeholders = INVENTORY_COLUMNS.map(() => '?').join(', ');
  const setClause = INVENTORY_COLUMNS
    .filter((col) => col !== 'id')
    .map((col) => `${col} = excluded.${col}`)
    .join(', ');
  return `INSERT INTO inventory (${columns}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${setClause} WHERE excluded.updated_at > inventory.updated_at`;
})();

function toFlag(raw: unknown): number {
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || Number.isNaN(raw)) return 0;
    return raw ? 1 : 0;
  }
  if (typeof raw === 'string') {
    const lower = raw.trim().toLowerCase();
    if (lower === 'true' || lower === '1' || lower === 'yes' || lower === 'on') {
      return 1;
    }
    if (
      lower === 'false' ||
      lower === '0' ||
      lower === 'no' ||
      lower === 'off'
    ) {
      return 0;
    }
  }
  return Number(Boolean(raw)) || 0;
}

function toProductId(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || Number.isNaN(n)) return null;
  return Math.trunc(n) || null;
}

function toPrice(raw: unknown): number {
  if (raw == null || raw === '') return 0.0;
  const n = Number(raw);
  return Number.isNaN(n) ? 0.0 : n;
}

function toNullableText(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) return raw.toISOString();
  const n = Number(raw);
  if (!Number.isNaN(n) && n > 0) return new Date(n).toISOString();
  return String(raw);
}

function toNullableString(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) return raw.toISOString();
  return String(raw);
}

function toTimestamp(raw: unknown): number {
  if (typeof raw === 'number') return Number.isNaN(raw) ? 0 : raw;
  if (raw == null) return 0;
  if (raw instanceof Date) return raw.getTime();
  const str = String(raw);
  const n = Number(str);
  if (!Number.isNaN(n)) return n;
  const d = Date.parse(str);
  return Number.isNaN(d) ? 0 : d;
}

export function coerceInventoryRow(
  row: any,
  userId?: string
): Record<InventoryColumn, any> {
  const out = {} as Record<InventoryColumn, any>;

  out.id = String(row.id ?? '');
  if (out.id === '') {
    throw new Error('Inventory row missing required id');
  }

  out.user_id = String(
    row.user_id ?? row.userId ?? userId ?? ''
  );
  out.product_id = toProductId(row.product_id ?? row.productId);
  out.card_name = toNullableString(row.card_name ?? row.name);
  out.card_number = toNullableString(row.card_number ?? row.number);
  out.set_name = toNullableString(row.set_name ?? row.set);
  out.variant = toNullableString(
    row.variant ?? row.rarity ?? row.productType
  );
  out.condition = toNullableString(row.condition);
  out.purchase_price = toPrice(row.purchase_price ?? row.amountPaid);
  out.sticker_price = toPrice(row.sticker_price ?? row.stickerPrice);
  out.date_bought = toNullableText(row.date_bought ?? row.dateBought);
  out.is_bulk_deal = toFlag(row.is_bulk_deal ?? row.isBulk);
  out.is_sold = toFlag(row.is_sold ?? row.isSold);
  out.sold_price = toPrice(row.sold_price ?? row.soldPrice);
  out.date_sold = toNullableText(row.date_sold ?? row.dateSold);
  out.custom_image_data = toNullableString(
    row.custom_image_data ?? row.imageUrl ?? row.customData
  );
  out.is_deleted = toFlag(row.is_deleted ?? row.isDeleted);
  out.updated_at = toTimestamp(row.updated_at ?? row.updatedAt);

  return out;
}

export async function applyRemoteInventoryChunk(
  db: SQLiteDatabase,
  rows: any[],
  userId?: string
): Promise<number> {
  if (!rows.length) return 0;

  await db.withTransactionAsync(async () => {
    for (const row of rows) {
      const coerced = coerceInventoryRow(row, userId);
      const args = INVENTORY_COLUMNS.map((col) => coerced[col]);
      await db.runAsync(UPSERT_SQL, ...args);
    }
  });

  return rows.length;
}

export type BulkInventoryInput = {
  id?: string;
  userId: string;
  productId?: number | null;
  name: string;
  number?: string;
  set?: string;
  variant?: string;
  condition?: string;
  liveMarket: number;
  amountPaid: number;
  stickerPrice: number;
  isBulk?: boolean;
  imageUrl?: string;
};

export async function bulkInsertInventory(
  db: SQLiteDatabase,
  items: BulkInventoryInput[]
): Promise<number> {
  if (!items.length) return 0;

  const now = new Date().toISOString().split('T')[0];

  await db.withTransactionAsync(async () => {
    for (const item of items) {
      const id = item.id ?? Crypto.randomUUID().replace(/-/g, '');
      const productId = item.productId ?? null;
      const dateBought = now;
      const updatedAt = Math.floor(Date.now() / 1000);
      const customData = buildCustomData(
        item.liveMarket,
        item.imageUrl,
        item.variant
      );

      await db.runAsync(
        `INSERT INTO inventory (
          id, user_id, product_id, card_name, card_number, set_name, variant, condition,
          purchase_price, sticker_price, date_bought, is_bulk_deal, is_sold, sold_price,
          date_sold, custom_image_data, is_deleted, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        String(item.userId),
        productId === null ? null : Math.trunc(Number(productId)) || 0,
        String(item.name || ''),
        String(item.number || ''),
        String(item.set || ''),
        String(item.variant || ''),
        String(item.condition || ''),
        Number(item.amountPaid) || 0.0,
        Number(item.stickerPrice) || 0.0,
        dateBought,
        Number(Boolean(item.isBulk)) || 0,
        0,
        0.0,
        '',
        customData,
        0,
        updatedAt
      );
    }
  });

  return items.length;
}
