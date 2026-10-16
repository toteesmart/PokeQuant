// RevenueCat webhook: signature/static-secret verification, then reconcile
// vendor_subscriptions + team seats. cc_scan_* events must not write vendor
// rows (see NON_VENDOR_PRODUCTS).

import { errorResponse, jsonResponse } from "../http.js";
import { ensureSchema } from "../schema.js";
import { buildExecute, tursoPipeline } from "../turso.js";
import { upsertVendorSubscription } from "../vendors.js";
import { recalculateTeamSeats } from "../teams.js";
import {
  NON_VENDOR_PRODUCTS,
  syncVendorSubscriptionFromRevenueCat,
} from "../subscriptions.js";

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

export async function handleRevenueCatWebhook(request, env) {
  if (!env.REVENUECAT_WEBHOOK_SECRET) {
    return errorResponse("Webhook secret not configured", 500);
  }

  const signature = request.headers.get("X-RevenueCat-Signature");
  const authHeader = request.headers.get("Authorization");
  const bodyText = await request.text();

  let isValid = false;

  if (signature) {
    // RevenueCat v2 signed webhooks.
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(env.REVENUECAT_WEBHOOK_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );
    isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      hexToBytes(signature),
      encoder.encode(bodyText)
    );
  } else if (authHeader) {
    // RevenueCat "Authorization header value" static secret.
    const expected = String(env.REVENUECAT_WEBHOOK_SECRET).trim();
    const provided = String(authHeader).replace(/^Bearer\s+/i, "").trim();
    isValid = provided === expected;
  }

  if (!isValid) {
    return errorResponse("Invalid signature", 401);
  }

  let body;
  try {
    body = JSON.parse(bodyText);
  } catch (e) {
    return errorResponse("Invalid JSON body", 400);
  }

  const event = body.event || {};
  const userId = event.app_user_id || event.original_app_user_id;
  if (!userId) {
    return errorResponse("Missing app_user_id", 400);
  }

  await ensureSchema(env);

  const eventType = event.type;
  const productId = event.product_id || null;

  const rawExpires = event.expiration_at_ms ?? event.expires_date_ms ?? event.expiration_at;
  const expiresAt = rawExpires
    ? Math.floor(Number(rawExpires) / (Number(rawExpires) > 9999999999 ? 1000 : 1))
    : null;

  // Non-vendor products (e.g. Cardcache_scan collector subs) must not create
  // vendor_subscriptions rows. RevenueCat events carry entitlement_ids;
  // fall back to the product denylist when they are absent.
  const entitlementIds = Array.isArray(event.entitlement_ids)
    ? event.entitlement_ids
    : null;
  const isVendorEvent = entitlementIds
    ? entitlementIds.includes("Cardcache_pro")
    : !NON_VENDOR_PRODUCTS.has(String(productId));

  if (!isVendorEvent) {
    return jsonResponse({ ok: true });
  }

  // When the secret API key is available, reconcile the full subscription
  // state from RevenueCat. Otherwise fall back to the single-event product.
  if (env.REVENUECAT_SECRET_API_KEY) {
    await syncVendorSubscriptionFromRevenueCat(env, userId);
  } else {
    const isActiveEvent = eventType === "INITIAL_PURCHASE" || eventType === "RENEWAL";
    await upsertVendorSubscription(env, userId, "Cardcache_pro", productId, isActiveEvent, expiresAt, Math.floor(Date.now() / 1000));
    if (!isActiveEvent) {
      await tursoPipeline(env, [
        buildExecute("UPDATE vendors SET is_founder = 0 WHERE user_id = ? AND is_founder = 1", [userId]),
        { type: "close" },
      ]);
    }
  }

  await recalculateTeamSeats(env, userId);

  return jsonResponse({ ok: true });
}
