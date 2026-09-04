import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { INVENTORY_IMAGE_BASE } from '../constants/api';
import { getDrizzle } from './database';
import { inventory, syncMetadata } from './schema';

type InventorySelect = InferSelectModel<typeof inventory>;
type InventoryInsert = InferInsertModel<typeof inventory>;

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

/**
 * Parses a product identifier as an integer, returning `null` for missing,
 * non-numeric, or zero values. Replaces the previous `Math.trunc` coercion.
 */
function asProductId(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || Number.isNaN(n)) return null;
  const int = Number.parseInt(String(n), 10);
  return int === 0 || Number.isNaN(int) ? null : int;
}

/**
 * Coerces remote/local flag values to a JS boolean. Drizzle's `mode: 'boolean'`
 * columns then map `true`/`false` to `1`/`0` for SQLite.
 */
function asBoolean(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  if (raw == null || raw === '') return false;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    const lower = raw.trim().toLowerCase();
    return lower === 'true' || lower === '1' || lower === 'yes' || lower === 'on';
  }
  return false;
}

function toNullableString(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) return raw.toISOString();
  return String(raw);
}

function toNullableDateText(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) return raw.toISOString();
  const n = Number(raw);
  if (!Number.isNaN(n) && n > 0) return new Date(n).toISOString();
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

function isBase64Image(value?: string): boolean {
  if (!value || value.trim().length < 100) return false;
  const base64Pattern = /^[A-Za-z0-9+/=\r\n]+$/;
  return base64Pattern.test(value.replace(/\s/g, ''));
}

function prefixBase64Image(value: string): string | undefined {
  const cleaned = value.replace(/\s/g, '');
  if (cleaned.startsWith('data:')) return cleaned;
  if (cleaned.startsWith('iVBORw0K')) {
    return `data:image/png;base64,${cleaned}`;
  }
  if (cleaned.startsWith('/9j/')) {
    return `data:image/jpeg;base64,${cleaned}`;
  }
  return undefined;
}

export function sanitizeImageUrl(url?: string): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (trimmed.startsWith('https://') || trimmed.startsWith('data:') || trimmed.startsWith('file://')) {
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
  if (raw.startsWith('data:') || isBase64Image(raw)) {
    return { imageUrl: raw };
  }
  try {
    return JSON.parse(raw) as CustomData;
  } catch {
    return {};
  }
}

function resolveInventoryImageUrl(row: InventorySelect): string | undefined {
  const extra = parseCustomData(row.customImageData);
  if (extra.imageUrl) {
    const sanitized = sanitizeImageUrl(extra.imageUrl);
    if (sanitized) return sanitized;
  }
  const productId = asProductId(row.productId);
  if (productId == null) return undefined;
  return `${INVENTORY_IMAGE_BASE}/${productId}.jpg`;
}

function mapRowToInventory(row: InventorySelect): PersistedInventory {
  const extra = parseCustomData(row.customImageData);
  const stickerPrice = row.stickerPrice ?? 0;
  const amountPaid = row.purchasePrice ?? 0;
  const liveMarket =
    typeof extra.liveMarket === 'number'
      ? extra.liveMarket
      : asNumber(extra.liveMarket, stickerPrice);

  return {
    id: row.id,
    name: row.cardName ?? '',
    number: row.cardNumber || undefined,
    set: row.setName || undefined,
    rarity: row.variant || undefined,
    productType: extra.productType,
    condition: row.condition || undefined,
    liveMarket,
    amountPaid,
    stickerPrice,
    isBulk: row.isBulkDeal ?? false,
    imageUrl: resolveInventoryImageUrl(row),
    productId: asProductId(row.productId),
  };
}

function mapRowToCompletedSale(row: InventorySelect): PersistedCompletedSale {
  return {
    id: row.id,
    name: row.cardName ?? '',
    number: row.cardNumber || undefined,
    set: row.setName || undefined,
    condition: row.condition || undefined,
    acquiredCost: row.purchasePrice ?? 0,
    soldPrice: row.soldPrice ?? 0,
    dateSold: row.dateSold || new Date().toISOString(),
  };
}

export async function loadActiveInventory(
  db: SQLiteDatabase,
  userId: string
): Promise<PersistedInventory[]> {
  const d = getDrizzle(db);
  const rows = await d
    .select()
    .from(inventory)
    .where(
      and(
        eq(inventory.userId, userId),
        eq(inventory.isSold, false),
        eq(inventory.isDeleted, false)
      )
    )
    .orderBy(desc(inventory.updatedAt))
    .all();
  return rows.map(mapRowToInventory);
}

export async function loadCompletedSales(
  db: SQLiteDatabase,
  userId: string
): Promise<PersistedCompletedSale[]> {
  const d = getDrizzle(db);
  const rows = await d
    .select()
    .from(inventory)
    .where(
      and(
        eq(inventory.userId, userId),
        eq(inventory.isSold, true),
        eq(inventory.isDeleted, false)
      )
    )
    .orderBy(desc(inventory.dateSold))
    .all();
  return rows.map(mapRowToCompletedSale);
}

export async function getInventoryItem(
  db: SQLiteDatabase,
  id: string
): Promise<PersistedInventory | null> {
  const d = getDrizzle(db);
  const row = await d
    .select()
    .from(inventory)
    .where(eq(inventory.id, id))
    .get();
  return row ? mapRowToInventory(row) : null;
}

export async function upsertInventoryItem(
  db: SQLiteDatabase,
  item: InventoryUpsert
): Promise<void> {
  const d = getDrizzle(db);

  let dateBought = item.dateBought;
  let productId: number | null | undefined = item.productId;

  if (!dateBought || productId === undefined) {
    const existing = await d
      .select()
      .from(inventory)
      .where(eq(inventory.id, item.id))
      .get();
    if (!dateBought) {
      dateBought = existing?.dateBought ?? new Date().toISOString();
    }
    if (productId === undefined) {
      productId = existing?.productId ?? null;
    }
  }

  const customData = buildCustomData(
    item.liveMarket,
    item.imageUrl,
    item.productType
  );

  const values: InventoryInsert = {
    id: item.id,
    userId: item.userId,
    productId: productId ?? null,
    cardName: item.name,
    cardNumber: item.number ?? '',
    setName: item.set ?? '',
    variant: item.rarity ?? '',
    condition: item.condition ?? '',
    purchasePrice: item.amountPaid,
    stickerPrice: item.stickerPrice,
    dateBought,
    isBulkDeal: item.isBulk ?? false,
    isSold: item.isSold ?? false,
    soldPrice: item.soldPrice ?? 0,
    dateSold: item.dateSold ?? '',
    customImageData: customData,
    isDeleted: item.isDeleted ?? false,
    updatedAt: Date.now(),
  };

  const { id: _id, ...set } = values;
  await d
    .insert(inventory)
    .values(values)
    .onConflictDoUpdate({ target: inventory.id, set })
    .run();
}

export async function softDeleteInventoryItem(
  db: SQLiteDatabase,
  id: string
): Promise<void> {
  const d = getDrizzle(db);
  await d
    .update(inventory)
    .set({ isDeleted: true, updatedAt: Date.now() })
    .where(eq(inventory.id, id))
    .run();
}

export async function markInventorySold(
  db: SQLiteDatabase,
  id: string,
  soldPrice: number,
  dateSold: string
): Promise<void> {
  const d = getDrizzle(db);
  await d
    .update(inventory)
    .set({ isSold: true, soldPrice, dateSold, updatedAt: Date.now() })
    .where(eq(inventory.id, id))
    .run();
}

export async function unmarkInventorySold(
  db: SQLiteDatabase,
  id: string
): Promise<void> {
  const d = getDrizzle(db);
  await d
    .update(inventory)
    .set({
      isSold: false,
      soldPrice: 0,
      dateSold: '',
      updatedAt: Date.now(),
    })
    .where(eq(inventory.id, id))
    .run();
}

export async function logCartItemsToInventory(
  db: SQLiteDatabase,
  userId: string,
  cartItems: any[]
): Promise<number> {
  if (!cartItems.length) return 0;

  const d = getDrizzle(db);
  const dateBought = new Date().toISOString().split('T')[0];
  const updatedAt = Date.now();

  const values: InventoryInsert[] = cartItems.map((item) => {
    const productId =
      item.productId == null
        ? null
        : Number.parseInt(String(item.productId), 10) || 0;

    const customData = buildCustomData(
      Number(item.marketPrice) || 0,
      item.imageUrl,
      item.variant
    );

    return {
      id: Crypto.randomUUID().replace(/-/g, ''),
      userId,
      productId,
      cardName: String(item.cardName || ''),
      cardNumber: String(item.cardNumber || ''),
      setName: String(item.setName || ''),
      variant: String(item.variant || ''),
      condition: String(item.condition || ''),
      purchasePrice: Number(item.cashOffer) || 0,
      stickerPrice: Number(item.marketPrice) || 0,
      dateBought,
      isBulkDeal: asBoolean(item.isBulkDeal),
      isSold: false,
      soldPrice: 0,
      dateSold: '',
      customImageData: customData,
      isDeleted: false,
      updatedAt,
    };
  });

  await d.insert(inventory).values(values).run();
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
  const d = getDrizzle(db);

  const productId =
    Number.parseInt(String(input.productId), 10) || 0;
  const customData = buildCustomData(
    input.liveMarket,
    input.imageUrl,
    input.variant
  );

  const values: InventoryInsert = {
    id: Crypto.randomUUID().replace(/-/g, ''),
    userId: input.userId,
    productId,
    cardName: input.cardName,
    cardNumber: input.cardNumber ?? '',
    setName: input.setName ?? '',
    variant: input.variant,
    condition: input.condition,
    purchasePrice: Number(input.cashOffer) || 0,
    stickerPrice: Number(input.stickerPrice) || 0,
    dateBought: new Date().toISOString().split('T')[0],
    isBulkDeal: false,
    isSold: false,
    soldPrice: 0,
    dateSold: '',
    customImageData: customData,
    isDeleted: false,
    updatedAt: Date.now(),
  };

  await d.insert(inventory).values(values).run();
}

export async function getPendingSyncCount(
  db: SQLiteDatabase,
  userId: string
): Promise<number> {
  const d = getDrizzle(db);

  const syncRow = await d
    .select({ lastUpdated: syncMetadata.lastUpdated })
    .from(syncMetadata)
    .where(eq(syncMetadata.userId, userId))
    .get();
  const lastSync = syncRow?.lastUpdated ?? 0;

  const row = await d
    .select({ count: sql<number>`COUNT(*)` })
    .from(inventory)
    .where(
      and(eq(inventory.userId, userId), gt(inventory.updatedAt, lastSync))
    )
    .get();

  return row?.count ?? 0;
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

function inventoryRecordToInsert(
  record: Record<InventoryColumn, any>
): InventoryInsert {
  return {
    id: record.id,
    userId: record.user_id,
    productId: record.product_id,
    cardName: record.card_name,
    cardNumber: record.card_number,
    setName: record.set_name,
    variant: record.variant,
    condition: record.condition,
    purchasePrice: record.purchase_price,
    stickerPrice: record.sticker_price,
    dateBought: record.date_bought,
    isBulkDeal: record.is_bulk_deal,
    isSold: record.is_sold,
    soldPrice: record.sold_price,
    dateSold: record.date_sold,
    customImageData: record.custom_image_data,
    isDeleted: record.is_deleted,
    updatedAt: record.updated_at,
  };
}

const LWW_UPSERT_SET: Record<string, ReturnType<typeof sql.raw>> = {
  userId: sql.raw('excluded."user_id"'),
  productId: sql.raw('excluded."product_id"'),
  cardName: sql.raw('excluded."card_name"'),
  cardNumber: sql.raw('excluded."card_number"'),
  setName: sql.raw('excluded."set_name"'),
  variant: sql.raw('excluded."variant"'),
  condition: sql.raw('excluded."condition"'),
  purchasePrice: sql.raw('excluded."purchase_price"'),
  stickerPrice: sql.raw('excluded."sticker_price"'),
  dateBought: sql.raw('excluded."date_bought"'),
  isBulkDeal: sql.raw('excluded."is_bulk_deal"'),
  isSold: sql.raw('excluded."is_sold"'),
  soldPrice: sql.raw('excluded."sold_price"'),
  dateSold: sql.raw('excluded."date_sold"'),
  customImageData: sql.raw('excluded."custom_image_data"'),
  isDeleted: sql.raw('excluded."is_deleted"'),
  updatedAt: sql.raw('excluded."updated_at"'),
};

const LWW_SET_WHERE = sql.raw(
  'excluded."updated_at" > "updated_at"'
);

export function coerceInventoryRow(
  row: any,
  userId?: string
): Record<InventoryColumn, any> {
  const out = {} as Record<InventoryColumn, any>;

  out.id = String(row.id ?? '');
  if (out.id === '') {
    throw new Error('Inventory row missing required id');
  }

  out.user_id = String(row.user_id ?? row.userId ?? userId ?? '');
  out.product_id = asProductId(row.product_id ?? row.productId);
  out.card_name = toNullableString(row.card_name ?? row.name);
  out.card_number = toNullableString(row.card_number ?? row.number);
  out.set_name = toNullableString(row.set_name ?? row.set);
  out.variant = toNullableString(
    row.variant ?? row.rarity ?? row.productType
  );
  out.condition = toNullableString(row.condition);
  out.purchase_price = asNumber(row.purchase_price ?? row.amountPaid, 0);
  out.sticker_price = asNumber(row.sticker_price ?? row.stickerPrice, 0);
  out.date_bought = toNullableDateText(row.date_bought ?? row.dateBought);
  out.is_bulk_deal = asBoolean(row.is_bulk_deal ?? row.isBulk);
  out.is_sold = asBoolean(row.is_sold ?? row.isSold);
  out.sold_price = asNumber(row.sold_price ?? row.soldPrice, 0);
  out.date_sold = toNullableDateText(row.date_sold ?? row.dateSold) ?? '';
  out.custom_image_data = toNullableString(
    row.custom_image_data ?? row.imageUrl ?? row.customData
  );
  out.is_deleted = asBoolean(row.is_deleted ?? row.isDeleted);
  out.updated_at = toTimestamp(row.updated_at ?? row.updatedAt);

  return out;
}

export async function applyRemoteInventoryChunk(
  db: SQLiteDatabase,
  rows: any[],
  userId?: string
): Promise<number> {
  if (!rows.length) return 0;

  const d = getDrizzle(db);
  const BATCH = 500;
  let applied = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const inserts = chunk
      .map((row) => inventoryRecordToInsert(coerceInventoryRow(row, userId)))
      .filter((row) => row.id);

    if (inserts.length === 0) continue;

    await d
      .insert(inventory)
      .values(inserts)
      .onConflictDoUpdate({
        target: inventory.id,
        set: LWW_UPSERT_SET,
        setWhere: LWW_SET_WHERE,
      })
      .run();

    applied += inserts.length;
  }

  return applied;
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

  const d = getDrizzle(db);
  const dateBought = new Date().toISOString().split('T')[0];
  const updatedAt = Date.now();

  const values: InventoryInsert[] = items.map((item) => {
    const productId =
      item.productId == null
        ? null
        : Number.parseInt(String(item.productId), 10) || 0;

    const customData = buildCustomData(
      item.liveMarket,
      item.imageUrl,
      item.variant
    );

    return {
      id: item.id ?? Crypto.randomUUID().replace(/-/g, ''),
      userId: item.userId,
      productId,
      cardName: item.name,
      cardNumber: item.number ?? '',
      setName: item.set ?? '',
      variant: item.variant ?? '',
      condition: item.condition ?? '',
      purchasePrice: Number(item.amountPaid) || 0,
      stickerPrice: Number(item.stickerPrice) || 0,
      dateBought,
      isBulkDeal: asBoolean(item.isBulk),
      isSold: false,
      soldPrice: 0,
      dateSold: '',
      customImageData: customData,
      isDeleted: false,
      updatedAt,
    };
  });

  await d.insert(inventory).values(values).run();
  return items.length;
}
