// Vendor-facing handlers: profile/status, show list + balances, table
// requests, show-inventory CRUD, subscription sync, account deletion.

import {
  deleteSupabaseAuthUser,
  getAuthenticatedUser,
} from "../auth.js";
import { errorResponse, jsonResponse } from "../http.js";
import { ensureSchema } from "../schema.js";
import {
  allRows,
  buildExecute,
  firstRow,
  tursoPipeline,
} from "../turso.js";
import {
  getOrCreateVendor,
  getVendorByUserId,
} from "../vendors.js";
import {
  formatTeam,
  recalculateTeamSeats,
} from "../teams.js";
import {
  assertIsPaidVendor,
  getVendorStatus,
  loadGateContext,
} from "../gates.js";
import { assertShowAccess, getShowById } from "../shows.js";
import {
  batchInsertOrUpdateRows,
  sanitizeShowRow,
} from "../inventory.js";
import { buildDedupeKey } from "../dedupe.js";
import { syncVendorSubscriptionFromRevenueCat } from "../subscriptions.js";

export async function handleDeleteAccount(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);

  const vendor = await getVendorByUserId(env, user.userId);
  const vendorId = vendor ? vendor.id : null;

  // All deletes key on vendorId/userId computed upfront with no
  // inter-statement data deps — one pipeline carries them all.
  const statements = [];
  if (vendorId) {
    statements.push(
      buildExecute("DELETE FROM public_show_inventory WHERE vendor_id = ?", [vendorId])
    );
  }
  // team_members.team_id is the owner's user_id, not the vendor slug.
  statements.push(
    buildExecute("DELETE FROM team_members WHERE team_id = ?", [user.userId]),
    buildExecute("DELETE FROM team_members WHERE member_user_id = ?", [user.userId]),
    buildExecute("DELETE FROM teams WHERE owner_user_id = ?", [user.userId]),
    buildExecute("DELETE FROM vendor_subscriptions WHERE user_id = ?", [user.userId])
  );
  if (vendor && vendor.founder_seat_number != null) {
    statements.push(
      buildExecute(
        "UPDATE founder_counter SET claimed = claimed - 1 WHERE id = 'founder' AND claimed > 0",
        []
      )
    );
  }
  statements.push(buildExecute("DELETE FROM vendors WHERE user_id = ?", [user.userId]));
  statements.push({ type: "close" });
  await tursoPipeline(env, statements);

  // Delete the Supabase auth identity (this is the action that cannot be undone).
  await deleteSupabaseAuthUser(env, user.userId);

  return jsonResponse({ ok: true, deleted: true });
}

export async function handleRequestShowAccess(request, env, showId) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  const vendor = await getOrCreateVendor(env, user);

  const show = await getShowById(env, showId);
  if (!show) return errorResponse("Show not found", 404);
  if (Number(show.is_active) !== 1) return errorResponse("Show is not active", 400);
  if (String(show.vendor_id) === String(vendor.id)) {
    return errorResponse("Organizer already owns this show", 400);
  }

  const body = await request.json().catch(() => ({}));
  const vendorName = String(body.vendor_name || vendor.name || vendor.id).trim();
  const vendorTable = String(body.vendor_table || "").trim();
  const now = Math.floor(Date.now() / 1000);

  // Re-request after a rejection flips the row back to pending.
  await tursoPipeline(env, [
    buildExecute(
      `INSERT INTO vendor_show_registrations
        (vendor_id, show_id, status, vendor_name, vendor_table, created_at)
       VALUES (?, ?, 'pending', ?, ?, ?)
       ON CONFLICT(vendor_id, show_id) DO UPDATE SET
        status = 'pending',
        vendor_name = excluded.vendor_name`,
      [vendor.id, showId, vendorName, vendorTable, now]
    ),
    { type: "close" },
  ]);

  return jsonResponse({ ok: true, status: "pending" });
}

export async function handleGetMyBalances(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  const vendor = await getOrCreateVendor(env, user);

  const data = await tursoPipeline(env, [
    buildExecute(
      `SELECT
         vsr.show_id,
         s.name AS show_name,
         s.pay_instructions,
         ov.name AS organizer_name,
         vsr.table_number,
         vsr.total_due,
         vsr.paid_amount
       FROM vendor_show_registrations vsr
       JOIN shows s ON s.id = vsr.show_id
       LEFT JOIN vendors ov ON ov.id = s.vendor_id
       WHERE vsr.vendor_id = ?
         AND vsr.status = 'approved'
         AND vsr.total_due > vsr.paid_amount
         AND s.is_active = 1
       ORDER BY s.start_date`,
      [vendor.id]
    ),
    { type: "close" },
  ]);

  const balances = allRows(data.results).map((r) => ({
    show_id: String(r.show_id ?? ""),
    show_name: String(r.show_name ?? ""),
    organizer_name: String(r.organizer_name ?? ""),
    pay_instructions: String(r.pay_instructions ?? ""),
    table_number: String(r.table_number ?? ""),
    total_due: Number(r.total_due) || 0,
    paid_amount: Number(r.paid_amount) || 0,
    remaining: Math.max(0, (Number(r.total_due) || 0) - (Number(r.paid_amount) || 0)),
  }));
  return jsonResponse({ ok: true, balances });
}

export async function handleGetMe(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  const ctx = await loadGateContext(env, user.userId);
  const vendor = await getOrCreateVendor(env, user, ctx);
  const status = getVendorStatus(ctx, vendor);
  // Owners always see their own team first, even if they also happen to be a
  // member of another team (e.g. manual data repair). Both team rows already
  // rode the gate batch; a member team's teams row is the same row.
  const teamRow = ctx.ownTeam ?? (status.team_id ? ctx.memberTeam : null);
  const team = teamRow ? await formatTeam(env, teamRow, user.userId) : null;
  return jsonResponse({
    ok: true,
    vendor: {
      id: vendor.id,
      user_id: vendor.user_id,
      name: vendor.name,
      table_default: vendor.table_default || "",
      is_organizer: Number(vendor.is_organizer) || 0,
      ...status,
      team,
    },
  });
}

export async function handleGetVendorShows(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  const ctx = await loadGateContext(env, user.userId);
  const vendor = await getOrCreateVendor(env, user, ctx);

  try {
    assertIsPaidVendor(ctx);
  } catch (err) {
    if (err.message === "subscription_required") {
      // Organizers always keep access to their own shows — running a show is
      // not a paid-vendor feature. Their registration rows may also appear,
      // which is harmless.
      if (Number(vendor.is_organizer) !== 1) {
        return jsonResponse({ ok: true, shows: [] });
      }
    } else {
      throw err;
    }
  }

  const data = await tursoPipeline(env, [
    buildExecute(
      `
        SELECT
          s.id,
          s.vendor_id,
          s.name,
          s.start_date,
          s.location,
          s.is_active,
          s.table_count,
          s.pay_instructions,
          vsr.status AS my_status_raw,
          vsr.table_number AS my_table
        FROM shows s
        LEFT JOIN vendor_show_registrations vsr
          ON s.id = vsr.show_id AND vsr.vendor_id = ?
        WHERE s.is_active = 1
          AND (s.vendor_id = ? OR vsr.status IN ('approved', 'pending'))
        ORDER BY s.start_date
      `,
      [vendor.id, vendor.id]
    ),
    { type: "close" },
  ]);

  const rows = allRows(data.results).map((row) => ({
    id: String(row.id ?? ""),
    vendor_id: String(row.vendor_id ?? ""),
    name: String(row.name ?? ""),
    start_date: String(row.start_date ?? ""),
    location: String(row.location ?? ""),
    is_active: Number(row.is_active) || 0,
    table_count: row.table_count != null ? Number(row.table_count) : null,
    pay_instructions: String(row.pay_instructions ?? ""),
    // The vendor's own relationship to the show: owner wins over any
    // registration row so organizers see their own shows as 'owner'.
    my_status:
      String(row.vendor_id) === String(vendor.id)
        ? "owner"
        : String(row.my_status_raw ?? ""),
    my_table: String(row.my_table ?? ""),
  }));
  return jsonResponse({ ok: true, shows: rows });
}

export async function handleGetInventory(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  const ctx = await loadGateContext(env, user.userId);
  const vendor = await getOrCreateVendor(env, user, ctx);

  assertIsPaidVendor(ctx);

  const url = new URL(request.url);
  const showId = url.searchParams.get("show_id");
  if (!showId) return errorResponse("Missing show_id", 400);

  const data = await tursoPipeline(env, [
    buildExecute(
      "SELECT * FROM public_show_inventory WHERE vendor_id = ? AND show_id = ? ORDER BY name COLLATE NOCASE",
      [vendor.id, showId]
    ),
    { type: "close" },
  ]);

  const rows = allRows(data.results).map(sanitizeShowRow);
  return jsonResponse({ ok: true, show_id: showId, rows });
}

export async function handlePostInventory(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  const ctx = await loadGateContext(env, user.userId);
  const vendor = await getOrCreateVendor(env, user, ctx);

  assertIsPaidVendor(ctx);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse("Invalid JSON body", 400);
  }

  const showId = body.show_id;
  const vendorName = String(body.vendor_name || "");
  const vendorTable = String(body.vendor_table || "");
  const rows = Array.isArray(body.rows) ? body.rows : [];

  if (!showId) return errorResponse("Missing show_id", 400);
  if (!vendorName) return errorResponse("Missing vendor_name", 400);
  if (!rows.length) return errorResponse("No rows provided", 400);

  await assertShowAccess(env, showId, vendor);

  const { results } = await batchInsertOrUpdateRows(env, showId, vendor, vendorName, vendorTable, rows);
  const rowIds = results.map((r) => r.id);

  return jsonResponse({ ok: true, row_ids: rowIds, results });
}

export async function handleUpdateInventory(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  const ctx = await loadGateContext(env, user.userId);
  const vendor = await getOrCreateVendor(env, user, ctx);

  assertIsPaidVendor(ctx);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse("Invalid JSON body", 400);
  }

  const rowId = String(body.id || "");
  if (!rowId) return errorResponse("Missing id", 400);

  const existingResult = await tursoPipeline(env, [
    buildExecute(
      "SELECT vendor_id, product_id, name, set_name, number, condition, dedupe_key FROM public_show_inventory WHERE id = ?",
      [rowId]
    ),
    { type: "close" },
  ]);
  const row = firstRow(existingResult.results);
  if (!row) return errorResponse("Row not found", 404);
  if (String(row.vendor_id) !== String(vendor.id)) return errorResponse("Not authorized to edit this row", 403);

  const productId = Number(row.product_id) || 0;
  const name = body.name !== undefined ? String(body.name) : String(row.name || "");
  const setName = body.set_name !== undefined ? String(body.set_name) : String(row.set_name || "");
  const number = body.number !== undefined ? String(body.number) : String(row.number || "");
  const dedupeKey = buildDedupeKey(productId, name, setName, number);

  const updates = [];
  const args = [];

  if (body.name !== undefined) { updates.push("name = ?"); args.push(name); }
  if (body.set_name !== undefined) { updates.push("set_name = ?"); args.push(setName); }
  if (body.number !== undefined) { updates.push("number = ?"); args.push(number); }
  if (body.rarity !== undefined) { updates.push("rarity = ?"); args.push(String(body.rarity)); }
  if (body.condition !== undefined) { updates.push("condition = ?"); args.push(String(body.condition)); }
  if (body.sticker_price !== undefined) { updates.push("sticker_price = ?"); args.push(Math.max(0, Number(body.sticker_price) || 0)); }
  if (body.quantity !== undefined) { updates.push("quantity = ?"); args.push(Math.max(0, Math.floor(Number(body.quantity) || 0))); }
  if (body.vendor_name !== undefined) { updates.push("vendor_name = ?"); args.push(String(body.vendor_name)); }
  if (body.vendor_table !== undefined) { updates.push("vendor_table = ?"); args.push(String(body.vendor_table)); }

  if (dedupeKey !== row.dedupe_key) {
    updates.push("dedupe_key = ?");
    args.push(dedupeKey);
  }

  updates.push("updated_at = ?");
  args.push(Date.now());

  if (updates.length === 0) return errorResponse("No fields to update", 400);

  args.push(rowId);

  await tursoPipeline(env, [
    buildExecute(`UPDATE public_show_inventory SET ${updates.join(", ")} WHERE id = ?`, args),
    { type: "close" },
  ]);

  return jsonResponse({ ok: true, id: rowId });
}

export async function handleDeleteInventory(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  const ctx = await loadGateContext(env, user.userId);
  const vendor = await getOrCreateVendor(env, user, ctx);

  assertIsPaidVendor(ctx);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse("Invalid JSON body", 400);
  }

  const rowId = String(body.id || "");
  if (!rowId) return errorResponse("Missing id", 400);

  const ownership = await tursoPipeline(env, [
    buildExecute("SELECT vendor_id FROM public_show_inventory WHERE id = ?", [rowId]),
    { type: "close" },
  ]);
  const row = firstRow(ownership.results);
  if (!row) return errorResponse("Row not found", 404);
  if (String(row.vendor_id) !== String(vendor.id)) return errorResponse("Not authorized to delete this row", 403);

  await tursoPipeline(env, [
    buildExecute("DELETE FROM public_show_inventory WHERE id = ?", [rowId]),
    { type: "close" },
  ]);

  return jsonResponse({ ok: true, id: rowId });
}

export async function handleSyncSubscription(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  await getOrCreateVendor(env, user);

  const { isActive, productId, expiresAt } = await syncVendorSubscriptionFromRevenueCat(env, user.userId);
  const team = await recalculateTeamSeats(env, user.userId);

  return jsonResponse({
    ok: true,
    is_vendor: isActive ? 1 : 0,
    product_id: productId,
    expires_at: expiresAt,
    team,
  });
}
