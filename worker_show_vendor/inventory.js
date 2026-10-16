// public_show_inventory rows: the response sanitizer, the input sanitizer,
// and the batch upsert used by POST /vendor/inventory.

import {
  buildExecute,
  tursoPipeline,
} from "./turso.js";
import { buildDedupeKey } from "./dedupe.js";

export function sanitizeShowRow(row) {
  return {
    id: String(row.id ?? ""),
    show_id: String(row.show_id ?? ""),
    vendor_id: String(row.vendor_id ?? ""),
    product_id: Number(row.product_id) || 0,
    name: String(row.name ?? ""),
    set_name: String(row.set_name ?? ""),
    number: String(row.number ?? ""),
    rarity: String(row.rarity ?? ""),
    condition: String(row.condition ?? ""),
    sticker_price: Number(row.sticker_price) || 0,
    quantity: Number(row.quantity) || 0,
    vendor_name: String(row.vendor_name ?? ""),
    vendor_table: String(row.vendor_table ?? ""),
  };
}

function sanitizeInventoryRow(input) {
  const rawProductId = Number(input.product_id);
  const productId = Number.isNaN(rawProductId) ? 0 : Math.max(0, Math.floor(rawProductId));

  const rawQty = Number(input.quantity);
  const quantity = Number.isNaN(rawQty) ? 1 : Math.max(0, Math.floor(rawQty));

  const rawPrice = Number(input.sticker_price) || Number(input.stickerPrice);
  const stickerPrice = Number.isNaN(rawPrice) ? 0 : Math.max(0, rawPrice);

  // Identity key for dedupe/upsert. Rows that carry a real TCGplayer id key
  // off it; rows without one (matched by name/set/number) key off those fields
  // so unrelated "product_id = 0" cards never collapse into a single listing.
  const dedupeKey = buildDedupeKey(
    productId,
    input.name,
    input.set_name || input.set,
    input.number
  );

  return {
    productId,
    dedupeKey,
    name: String(input.name || ""),
    setName: String(input.set_name || input.set || ""),
    number: String(input.number || ""),
    rarity: String(input.rarity || input.productType || ""),
    condition: String(input.condition || "NM"),
    stickerPrice,
    quantity,
  };
}

export async function batchInsertOrUpdateRows(env, showId, vendor, vendorName, vendorTable, rows) {
  if (rows.length === 0) return { results: [] };

  const sanitized = [];
  const keyToIndex = new Map();

  for (let i = 0; i < rows.length; i++) {
    const row = sanitizeInventoryRow(rows[i]);
    const key = `${row.condition}|${row.dedupeKey}`;
    if (!keyToIndex.has(key)) {
      keyToIndex.set(key, sanitized.length);
      sanitized.push({ ...row, originalIndexes: [i] });
    } else {
      sanitized[keyToIndex.get(key)].originalIndexes.push(i);
    }
  }

  const statements = [];
  const results = new Array(rows.length);

  for (const item of sanitized) {
    const newId = crypto.randomUUID().replace(/-/g, "");
    const updatedAt = Date.now();

    statements.push(buildExecute(
      `INSERT INTO public_show_inventory
        (id, show_id, vendor_id, product_id, name, set_name, number, rarity, condition, sticker_price, quantity, vendor_name, vendor_table, dedupe_key, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(show_id, vendor_id, condition, dedupe_key) DO UPDATE SET
        product_id = excluded.product_id,
        name = excluded.name,
        set_name = excluded.set_name,
        number = excluded.number,
        rarity = excluded.rarity,
        condition = excluded.condition,
        sticker_price = excluded.sticker_price,
        quantity = excluded.quantity,
        vendor_name = excluded.vendor_name,
        vendor_table = excluded.vendor_table,
        updated_at = excluded.updated_at
      WHERE excluded.updated_at > public_show_inventory.updated_at`,
      [newId, showId, vendor.id, item.productId, item.name, item.setName, item.number, item.rarity, item.condition, item.stickerPrice, item.quantity, vendorName, vendorTable, item.dedupeKey, updatedAt]
    ));
    for (const idx of item.originalIndexes) {
      results[idx] = { id: newId, status: "upserted" };
    }
  }

  statements.push({ type: "close" });
  await tursoPipeline(env, statements);

  return { results };
}
