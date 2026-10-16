// RevenueCat reconciliation: subscriber fetch, expiry parsing, and the
// vendor_subscriptions upsert sweep (plus the founder-flag side effect).

import {
  buildExecute,
  tursoPipeline,
} from "./turso.js";

// Collector scan subscriptions must never be written to vendor_subscriptions
// as Cardcache_pro rows — the is_vendor check accepts any active
// Cardcache_pro row, so a $4.99 scan sub would otherwise grant vendor access.
export const NON_VENDOR_PRODUCTS = new Set([
  "cc_scan_unlimited_monthly",
  "cc_scan_unlimited_yearly",
]);

async function fetchRevenueCatSubscriber(env, userId) {
  if (!env.REVENUECAT_SECRET_API_KEY) {
    throw new Error("RevenueCat secret API key not configured");
  }
  const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${userId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${env.REVENUECAT_SECRET_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RevenueCat subscriber fetch failed: ${res.status} ${text}`);
  }
  return res.json();
}

function parseExpiresAt(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") {
    return Math.floor(raw > 9999999999 ? raw / 1000 : raw);
  }
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
  }
  return null;
}

export async function syncVendorSubscriptionFromRevenueCat(env, userId) {
  const body = await fetchRevenueCatSubscriber(env, userId);
  // v1 /subscribers responses nest data under a "subscriber" key; fall back to
  // the top-level object so either shape works.
  const subscriber = body?.subscriber ?? body ?? {};
  const entitlements = subscriber.entitlements || subscriber.entitlement_infos || {};
  const entitlement = entitlements["Cardcache_pro"];

  if (!entitlement) {
    // No entitlement found: clear the cached subscription.
    await tursoPipeline(env, [
      buildExecute("DELETE FROM vendor_subscriptions WHERE user_id = ?", [userId]),
      buildExecute("UPDATE vendors SET is_founder = 0 WHERE user_id = ? AND is_founder = 1", [userId]),
      { type: "close" },
    ]);
    return { isActive: false, productId: null, expiresAt: null, activeProductIds: [] };
  }

  const now = Math.floor(Date.now() / 1000);
  const updatedAt = now;
  const activeProductIds = new Set();
  const productExpires = new Map();

  // The entitlement points at one representative product, but a user may have
  // multiple active subscription products (e.g. Pro Team base + extra seats).
  const primaryProductId = entitlement.product_identifier || null;
  if (primaryProductId) {
    activeProductIds.add(primaryProductId);
    productExpires.set(primaryProductId, parseExpiresAt(entitlement.expires_date));
  }

  const subscriptions = subscriber.subscriptions || {};
  for (const [productId, info] of Object.entries(subscriptions)) {
    if (!info || NON_VENDOR_PRODUCTS.has(String(productId))) continue;
    const expiresAt = parseExpiresAt(info.expires_date);
    if (expiresAt == null || expiresAt > now) {
      activeProductIds.add(productId);
      if (!productExpires.has(productId)) {
        productExpires.set(productId, expiresAt);
      }
    }
  }

  const statements = [];
  for (const productId of activeProductIds) {
    const expiresAt = productExpires.get(productId) ?? null;
    statements.push(buildExecute(
      `
        INSERT INTO vendor_subscriptions (user_id, entitlement_id, product_id, is_active, expires_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?)
        ON CONFLICT(user_id, product_id) DO UPDATE SET
          entitlement_id = excluded.entitlement_id,
          is_active = 1,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
      `,
      [userId, "Cardcache_pro", productId, expiresAt, updatedAt]
    ));
  }

  // Remove stale products that are no longer active.
  if (activeProductIds.size > 0) {
    const placeholders = Array.from(activeProductIds).map(() => "?").join(", ");
    statements.push(buildExecute(
      `DELETE FROM vendor_subscriptions WHERE user_id = ? AND product_id NOT IN (${placeholders})`,
      [userId, ...Array.from(activeProductIds)]
    ));
  } else {
    statements.push(buildExecute("DELETE FROM vendor_subscriptions WHERE user_id = ?", [userId]));
  }

  const primaryExpiresAt = productExpires.get(primaryProductId) ?? null;
  const isActive = activeProductIds.size > 0;

  // A churned founder loses the founder discount eligibility. A founder with an
  // active subscription (any paid product) keeps the founder flag.
  if (!isActive) {
    statements.push(buildExecute("UPDATE vendors SET is_founder = 0 WHERE user_id = ? AND is_founder = 1", [userId]));
  } else {
    statements.push(buildExecute("UPDATE vendors SET is_founder = 1 WHERE user_id = ? AND founder_seat_number IS NOT NULL AND is_founder = 0", [userId]));
  }

  statements.push({ type: "close" });
  await tursoPipeline(env, statements);

  return { isActive, productId: primaryProductId, expiresAt: primaryExpiresAt, activeProductIds: Array.from(activeProductIds) };
}
