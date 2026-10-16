// Show queries and access assertions: show lookup, vendor-vs-show access
// (owner or approved registration), organizer ownership, and the
// registration row shape returned to organizers.

import {
  buildExecute,
  firstRow,
  tursoPipeline,
} from "./turso.js";

async function queryShowAccess(env, vendorId, showId) {
  const data = await tursoPipeline(env, [
    buildExecute(
      `
        SELECT
          s.id AS show_id,
          s.is_active AS is_active,
          s.vendor_id AS owner_vendor_id,
          COALESCE(vsr.status, '') AS registration_status
        FROM shows s
        LEFT JOIN vendor_show_registrations vsr
          ON s.id = vsr.show_id AND vsr.vendor_id = ?
        WHERE s.id = ?
      `,
      [vendorId, showId]
    ),
    { type: "close" },
  ]);
  return firstRow(data.results);
}

export async function assertShowAccess(env, showId, vendor) {
  const row = await queryShowAccess(env, vendor.id, showId);
  if (!row) throw new Error("Show not found");
  if (row.registration_status === "rejected") {
    throw new Error("Vendor is not authorized for this show");
  }
  if (Number(row.is_active) !== 1) {
    throw new Error("Show is not active");
  }
  const isOwner = String(row.owner_vendor_id) === String(vendor.id);
  const isApproved = String(row.registration_status) === "approved";
  if (!isOwner && !isApproved) {
    throw new Error("Vendor is not authorized for this show");
  }
}

export async function getShowById(env, showId) {
  const data = await tursoPipeline(env, [
    buildExecute("SELECT * FROM shows WHERE id = ?", [showId]),
    { type: "close" },
  ]);
  return firstRow(data.results);
}

export async function assertShowOwner(env, showId, vendor) {
  const show = await getShowById(env, showId);
  if (!show) throw new Error("Show not found");
  if (String(show.vendor_id) !== String(vendor.id)) {
    throw new Error("not authorized: not the show organizer");
  }
  return show;
}

export function sanitizeRegistrationRow(row) {
  const vendorId = String(row.vendor_id ?? "");
  return {
    vendor_id: vendorId,
    is_manual: vendorId.startsWith("manual:") ? 1 : 0,
    status: String(row.status ?? "pending"),
    vendor_name: String(row.vendor_name ?? ""),
    vendor_table: String(row.vendor_table ?? ""),
    table_number: String(row.table_number ?? ""),
    total_due: Number(row.total_due) || 0,
    paid_amount: Number(row.paid_amount) || 0,
    manual_name: String(row.manual_name ?? ""),
    manual_phone: String(row.manual_phone ?? ""),
    created_at: row.created_at != null ? Number(row.created_at) : null,
  };
}
