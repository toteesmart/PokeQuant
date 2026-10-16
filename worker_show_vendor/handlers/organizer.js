// Show-organizer handlers: show CRUD, vendor list, and the registration
// ledger (approve/reject, table, dues). All require vendors.is_organizer and
// show ownership.

import { getAuthenticatedUser } from "../auth.js";
import { errorResponse, jsonResponse } from "../http.js";
import { ensureSchema } from "../schema.js";
import {
  allRows,
  buildExecute,
  firstRow,
  tursoPipeline,
} from "../turso.js";
import { getOrCreateVendor } from "../vendors.js";
import { assertShowOwner, sanitizeRegistrationRow } from "../shows.js";

function assertIsOrganizer(vendor) {
  if (Number(vendor?.is_organizer) !== 1) {
    throw new Error("not authorized: organizer flag required");
  }
}

export async function handleCreateShow(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  const vendor = await getOrCreateVendor(env, user);
  assertIsOrganizer(vendor);

  const body = await request.json().catch(() => null);
  if (!body) return errorResponse("Invalid JSON body", 400);

  const name = String(body.name || "").trim();
  if (!name) return errorResponse("Missing name", 400);

  const id = crypto.randomUUID().replace(/-/g, "");
  const startDate = String(body.start_date || "").trim();
  const location = String(body.location || "").trim();
  const tableCount =
    body.table_count != null && Number.isFinite(Number(body.table_count))
      ? Math.max(0, Math.floor(Number(body.table_count)))
      : null;
  const payInstructions = String(body.pay_instructions || "").trim();

  await tursoPipeline(env, [
    buildExecute(
      `INSERT INTO shows (id, vendor_id, name, start_date, location, is_active, table_count, pay_instructions)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      [id, vendor.id, name, startDate, location, tableCount, payInstructions]
    ),
    { type: "close" },
  ]);

  return jsonResponse({
    ok: true,
    show: {
      id,
      vendor_id: vendor.id,
      name,
      start_date: startDate,
      location,
      is_active: 1,
      table_count: tableCount,
      pay_instructions: payInstructions,
    },
  });
}

export async function handlePatchShow(request, env, showId) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  const vendor = await getOrCreateVendor(env, user);
  const show = await assertShowOwner(env, showId, vendor);

  const body = await request.json().catch(() => null);
  if (!body) return errorResponse("Invalid JSON body", 400);

  const next = {
    name: body.name !== undefined ? String(body.name).trim() : String(show.name ?? ""),
    start_date:
      body.start_date !== undefined ? String(body.start_date).trim() : String(show.start_date ?? ""),
    location: body.location !== undefined ? String(body.location).trim() : String(show.location ?? ""),
    is_active: body.is_active !== undefined ? (body.is_active ? 1 : 0) : Number(show.is_active) || 0,
    table_count:
      body.table_count !== undefined
        ? body.table_count == null
          ? null
          : Math.max(0, Math.floor(Number(body.table_count) || 0))
        : show.table_count != null
          ? Number(show.table_count)
          : null,
    pay_instructions:
      body.pay_instructions !== undefined
        ? String(body.pay_instructions).trim()
        : String(show.pay_instructions ?? ""),
  };
  if (!next.name) return errorResponse("Missing name", 400);

  await tursoPipeline(env, [
    buildExecute(
      `UPDATE shows SET name = ?, start_date = ?, location = ?, is_active = ?, table_count = ?, pay_instructions = ? WHERE id = ?`,
      [next.name, next.start_date, next.location, next.is_active, next.table_count, next.pay_instructions, showId]
    ),
    { type: "close" },
  ]);

  return jsonResponse({ ok: true, show: { id: showId, vendor_id: vendor.id, ...next } });
}

export async function handleListVendors(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  const vendor = await getOrCreateVendor(env, user);
  assertIsOrganizer(vendor);

  const data = await tursoPipeline(env, [
    buildExecute(`SELECT id, name FROM vendors WHERE id NOT LIKE 'manual:%' ORDER BY name COLLATE NOCASE`),
    { type: "close" },
  ]);
  const vendors = allRows(data.results).map((r) => ({
    id: String(r.id ?? ""),
    name: String(r.name ?? ""),
  }));
  return jsonResponse({ ok: true, vendors });
}

export async function handleGetShowRegistrations(request, env, showId) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  const vendor = await getOrCreateVendor(env, user);
  await assertShowOwner(env, showId, vendor);

  const data = await tursoPipeline(env, [
    buildExecute(
      `SELECT * FROM vendor_show_registrations WHERE show_id = ? ORDER BY COALESCE(created_at, 0) DESC`,
      [showId]
    ),
    { type: "close" },
  ]);
  const registrations = allRows(data.results).map(sanitizeRegistrationRow);
  return jsonResponse({ ok: true, show_id: showId, registrations });
}

export async function handlePostShowRegistration(request, env, showId) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  const vendor = await getOrCreateVendor(env, user);
  await assertShowOwner(env, showId, vendor);

  const body = await request.json().catch(() => null);
  if (!body) return errorResponse("Invalid JSON body", 400);

  const targetVendorId = String(body.vendor_id || "").trim();
  const manualName = String(body.manual_name || "").trim();
  const manualPhone = String(body.manual_phone || "").trim();
  const tableNumber = String(body.table_number || "").trim();
  const totalDue = Math.max(0, Number(body.total_due) || 0);

  let vendorId;
  let vendorName;
  if (targetVendorId) {
    const target = firstRow((await tursoPipeline(env, [
      buildExecute("SELECT id, name FROM vendors WHERE id = ?", [targetVendorId]),
      { type: "close" },
    ])).results);
    if (!target) return errorResponse("Vendor not found", 404);
    vendorId = String(target.id);
    vendorName = String(target.name || target.id);
  } else if (manualName) {
    vendorId = `manual:${crypto.randomUUID().replace(/-/g, "")}`;
    vendorName = manualName;
  } else {
    return errorResponse("Missing vendor_id or manual_name", 400);
  }

  const now = Math.floor(Date.now() / 1000);
  await tursoPipeline(env, [
    buildExecute(
      `INSERT INTO vendor_show_registrations
        (vendor_id, show_id, status, vendor_name, vendor_table, table_number, total_due, paid_amount, manual_name, manual_phone, created_at)
       VALUES (?, ?, 'approved', ?, '', ?, ?, 0, ?, ?, ?)
       ON CONFLICT(vendor_id, show_id) DO UPDATE SET
        status = 'approved',
        vendor_name = excluded.vendor_name,
        table_number = excluded.table_number,
        total_due = excluded.total_due,
        manual_name = excluded.manual_name,
        manual_phone = excluded.manual_phone`,
      [vendorId, showId, vendorName, tableNumber, totalDue, manualName, manualPhone, now]
    ),
    { type: "close" },
  ]);

  return jsonResponse({ ok: true, vendor_id: vendorId, status: "approved" });
}

export async function handlePatchRegistration(request, env, showId, vendorId) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  const vendor = await getOrCreateVendor(env, user);
  await assertShowOwner(env, showId, vendor);

  const body = await request.json().catch(() => null);
  if (!body) return errorResponse("Invalid JSON body", 400);

  const existing = firstRow((await tursoPipeline(env, [
    buildExecute(
      "SELECT * FROM vendor_show_registrations WHERE show_id = ? AND vendor_id = ?",
      [showId, vendorId]
    ),
    { type: "close" },
  ])).results);
  if (!existing) return errorResponse("Registration not found", 404);

  const status =
    body.status !== undefined ? String(body.status) : String(existing.status ?? "pending");
  if (!["pending", "approved", "rejected"].includes(status)) {
    return errorResponse("Invalid status", 400);
  }
  const tableNumber =
    body.table_number !== undefined
      ? String(body.table_number).trim()
      : String(existing.table_number ?? "");
  const vendorTable =
    body.vendor_table !== undefined
      ? String(body.vendor_table).trim()
      : String(existing.vendor_table ?? "");
  const totalDue =
    body.total_due !== undefined
      ? Math.max(0, Number(body.total_due) || 0)
      : Number(existing.total_due) || 0;
  const paidAmount =
    body.paid_amount !== undefined
      ? Math.max(0, Number(body.paid_amount) || 0)
      : Number(existing.paid_amount) || 0;
  // manual_phone doubles as the show-scoped contact number — usable for app
  // vendors too (their accounts carry no phone).
  const manualPhone =
    body.manual_phone !== undefined
      ? String(body.manual_phone).trim()
      : String(existing.manual_phone ?? "");
  const manualName =
    body.manual_name !== undefined
      ? String(body.manual_name).trim()
      : String(existing.manual_name ?? "");

  await tursoPipeline(env, [
    buildExecute(
      `UPDATE vendor_show_registrations
       SET status = ?, table_number = ?, vendor_table = ?, total_due = ?, paid_amount = ?, manual_phone = ?, manual_name = ?
       WHERE show_id = ? AND vendor_id = ?`,
      [status, tableNumber, vendorTable, totalDue, paidAmount, manualPhone, manualName, showId, vendorId]
    ),
    { type: "close" },
  ]);

  return jsonResponse({ ok: true });
}
