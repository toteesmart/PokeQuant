// Vendor identity: app_config flags, founder-seat accounting, vendor row
// lookup/creation (slug generation + retry), and subscription row upsert.

import {
  buildExecute,
  firstRow,
  tursoPipeline,
} from "./turso.js";

export async function getAppConfig(env, key) {
  const data = await tursoPipeline(env, [
    buildExecute("SELECT value FROM app_config WHERE key = ?", [key]),
    { type: "close" },
  ]);
  const row = firstRow(data.results);
  return row ? row.value : null;
}

export async function isPaymentsLive(env) {
  return (await getAppConfig(env, "payments_live")) === "1";
}

export async function getFounderSeatLimit(env) {
  const value = await getAppConfig(env, "founder_seat_limit");
  return value ? Number(value) : 50;
}

export async function getFounderSeatsRemaining(env) {
  // A founder seat is claimed once and stays claimed even if the vendor churns
  // (churn does not refill seats). Count by founder_seat_number, not the
  // current is_founder flag.
  const [countData, limit] = await Promise.all([
    tursoPipeline(env, [
      buildExecute("SELECT COUNT(*) AS c FROM vendors WHERE founder_seat_number IS NOT NULL"),
      { type: "close" },
    ]),
    getFounderSeatLimit(env),
  ]);
  const row = firstRow(countData.results);
  const claimed = row ? Number(row.c) : 0;
  return Math.max(0, limit - claimed);
}

async function tryClaimFounderSeat(env, vendor) {
  // A founder seat is assigned once per vendor and is never reassigned. If the
  // vendor row already has a founder_seat_number, do not claim again (and do
  // not increment the seat number when is_founder is toggled off/on by churn).
  if (vendor?.founder_seat_number != null) return vendor;

  const limit = await getFounderSeatLimit(env);

  // Atomically claim the next available seat if any remain. The seat number
  // uses MAX+1 so deleted rows leave gaps and churn does not refill seats.
  const result = await tursoPipeline(env, [
    buildExecute(
      `
        UPDATE vendors
        SET is_founder = 1,
            founder_seat_number = (SELECT COALESCE(MAX(founder_seat_number), 0) + 1 FROM vendors)
        WHERE id = ?
          AND founder_seat_number IS NULL
          AND (SELECT COUNT(*) FROM vendors WHERE founder_seat_number IS NOT NULL) < ?
      `,
      [vendor.id, limit]
    ),
    buildExecute("SELECT changes() AS changes"),
    { type: "close" },
  ]);
  const changed = firstRow(result.results[1]);

  if (changed && Number(changed.changes) > 0) {
    await tursoPipeline(env, [
      buildExecute("DELETE FROM founder_counter WHERE id = 'founder'"),
      buildExecute("INSERT INTO founder_counter (id, claimed) SELECT 'founder', COUNT(*) FROM vendors WHERE founder_seat_number IS NOT NULL"),
      { type: "close" },
    ]);
  }

  const data = await tursoPipeline(env, [
    buildExecute("SELECT * FROM vendors WHERE id = ?", [vendor.id]),
    { type: "close" },
  ]);
  return firstRow(data.results);
}

export async function getVendorByUserId(env, userId) {
  const data = await tursoPipeline(env, [
    buildExecute("SELECT * FROM vendors WHERE user_id = ?", [userId]),
    { type: "close" },
  ]);
  return firstRow(data.results);
}

export async function isVendorActive(env, userId) {
  const now = Math.floor(Date.now() / 1000);
  const data = await tursoPipeline(env, [
    buildExecute(
      "SELECT 1 FROM vendor_subscriptions WHERE user_id = ? AND entitlement_id = ? AND is_active = 1 AND (expires_at IS NULL OR expires_at > ?) LIMIT 1",
      [userId, "Cardcache_pro", now]
    ),
    { type: "close" },
  ]);
  return !!firstRow(data.results);
}

export async function upsertVendorSubscription(env, userId, entitlementId, productId, isActive, expiresAt, updatedAt) {
  const product = productId || "";
  await tursoPipeline(env, [
    buildExecute(
      `
        INSERT INTO vendor_subscriptions (user_id, entitlement_id, product_id, is_active, expires_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, product_id) DO UPDATE SET
          entitlement_id = excluded.entitlement_id,
          is_active = excluded.is_active,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
      `,
      [userId, entitlementId, product, isActive ? 1 : 0, expiresAt, updatedAt]
    ),
    { type: "close" },
  ]);
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function generateUniqueVendorId(username, attempt = 0) {
  const base = slugify(username);
  if (!base) return `vendor-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  if (attempt === 0) return base;
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
  return `${base}-${suffix}`;
}

export async function getOrCreateVendor(env, { userId, username, email }) {
  const data = await tursoPipeline(env, [
    buildExecute("SELECT * FROM vendors WHERE user_id = ?", [userId]),
    { type: "close" },
  ]);
  const existing = firstRow(data.results);
  // Existing vendors who were never grandfathered (rows created between the
  // schema migration and now) still get a seat if any remain — same outcome as
  // a fresh sign-up claiming on first profile load.
  if (existing) return await tryClaimFounderSeat(env, existing);

  const now = Math.floor(Date.now() / 1000);
  const name = username || email.split("@")[0] || "vendor";

  for (let attempt = 0; attempt < 5; attempt++) {
    const vendorId = generateUniqueVendorId(username || email, attempt);
    try {
      await tursoPipeline(env, [
        buildExecute(
          "INSERT INTO vendors (id, user_id, name, table_default, created_at) VALUES (?, ?, ?, '', ?)",
          [vendorId, userId, name, now]
        ),
        { type: "close" },
      ]);

      const fresh = await getVendorByUserId(env, userId);
      if (!fresh) {
        throw new Error("Failed to read newly created vendor row");
      }
      return await tryClaimFounderSeat(env, fresh);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("UNIQUE") || message.toLowerCase().includes("duplicate")) {
        continue;
      }
      throw err;
    }
  }

  throw new Error("Failed to generate a unique vendor id after 5 attempts");
}

export async function getVendorNameByUserId(env, userId) {
  const data = await tursoPipeline(env, [
    buildExecute("SELECT name FROM vendors WHERE user_id = ?", [userId]),
    { type: "close" },
  ]);
  const row = firstRow(data.results);
  return row?.name || null;
}
