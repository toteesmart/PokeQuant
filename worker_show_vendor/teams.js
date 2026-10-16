// Team subscriptions: seat-count products, team/team_members queries, the
// formatted team payload, and seat recalculation after subscription changes.

import {
  allRows,
  buildExecute,
  firstRow,
  tursoPipeline,
} from "./turso.js";
import { getVendorNameByUserId } from "./vendors.js";

export async function isActiveTeamMember(env, userId) {
  const now = Math.floor(Date.now() / 1000);
  const data = await tursoPipeline(env, [
    buildExecute(
      `
        SELECT t.owner_user_id
        FROM team_members tm
        JOIN teams t ON tm.team_id = t.owner_user_id
        WHERE tm.member_user_id = ?
          AND (t.expires_at IS NULL OR t.expires_at > ?)
        LIMIT 1
      `,
      [userId, now]
    ),
    { type: "close" },
  ]);
  return !!firstRow(data.results);
}

const TEAM_3_SEAT_PRODUCTS = new Set([
  "cc_founder_team3_monthly",
  "cc_pro_team_base_monthly",
]);
const TEAM_1_SEAT_PRODUCTS = new Set([
  "cc_pro_team_extra_seat_monthly",
]);

function seatsForProduct(productId) {
  const id = String(productId || "");
  if (TEAM_3_SEAT_PRODUCTS.has(id)) return 3;
  if (TEAM_1_SEAT_PRODUCTS.has(id)) return 1;
  return 0;
}

export function generateInviteCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function recalculateTeamSeats(env, userId) {
  const now = Math.floor(Date.now() / 1000);

  const data = await tursoPipeline(env, [
    buildExecute(
      `SELECT product_id, is_active, expires_at FROM vendor_subscriptions WHERE user_id = ? AND is_active = 1`,
      [userId]
    ),
    { type: "close" },
  ]);
  const rows = allRows(data.results);

  let seatsTotal = 0;
  let farthestExpiresAt = null;
  let teamProductId = null;

  for (const row of rows) {
    const productId = row.product_id;
    const expiresAt = row.expires_at ? Number(row.expires_at) : null;

    if (expiresAt != null && expiresAt <= now) continue;

    const seats = seatsForProduct(productId);
    if (seats <= 0) continue;

    seatsTotal += seats;
    if (!teamProductId || seatsForProduct(teamProductId) < seats) {
      teamProductId = productId;
    }

    if (farthestExpiresAt === null || (expiresAt != null && expiresAt > farthestExpiresAt)) {
      farthestExpiresAt = expiresAt;
    }
  }

  if (seatsTotal === 0) {
    await tursoPipeline(env, [
      buildExecute("DELETE FROM team_members WHERE team_id = ?", [userId]),
      buildExecute("DELETE FROM teams WHERE owner_user_id = ?", [userId]),
      { type: "close" },
    ]);
    return null;
  }

  const updatedAt = now;
  const createdAt = now;
  const ownerName = await getVendorNameByUserId(env, userId);

  await tursoPipeline(env, [
    buildExecute(
      `
        INSERT INTO teams (owner_user_id, product_id, seats_total, expires_at, invite_code, name, updated_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_user_id) DO UPDATE SET
          product_id = excluded.product_id,
          seats_total = excluded.seats_total,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at,
          invite_code = COALESCE(teams.invite_code, excluded.invite_code),
          name = COALESCE(teams.name, excluded.name),
          created_at = COALESCE(teams.created_at, excluded.created_at)
      `,
      [userId, teamProductId, seatsTotal, farthestExpiresAt, generateInviteCode(), ownerName, updatedAt, createdAt]
    ),
    { type: "close" },
  ]);

  return await getTeamByOwner(env, userId);
}

export async function getTeamByOwner(env, userId) {
  const data = await tursoPipeline(env, [
    buildExecute("SELECT * FROM teams WHERE owner_user_id = ?", [userId]),
    { type: "close" },
  ]);
  return firstRow(data.results);
}

export async function getTeamByCode(env, code) {
  const data = await tursoPipeline(env, [
    buildExecute("SELECT * FROM teams WHERE invite_code = ?", [code]),
    { type: "close" },
  ]);
  return firstRow(data.results);
}

export async function getTeamMembers(env, teamId) {
  const data = await tursoPipeline(env, [
    buildExecute(
      `
        SELECT
          tm.member_user_id,
          v.name AS member_name,
          tm.created_at
        FROM team_members tm
        LEFT JOIN vendors v ON v.user_id = tm.member_user_id
        WHERE tm.team_id = ?
        ORDER BY tm.created_at
      `,
      [teamId]
    ),
    { type: "close" },
  ]);
  return allRows(data.results);
}

export async function getTeamForMember(env, userId) {
  const data = await tursoPipeline(env, [
    buildExecute(
      `
        SELECT t.*
        FROM team_members tm
        JOIN teams t ON tm.team_id = t.owner_user_id
        WHERE tm.member_user_id = ?
        LIMIT 1
      `,
      [userId]
    ),
    { type: "close" },
  ]);
  return firstRow(data.results);
}

export async function formatTeam(env, team, userId) {
  if (!team) return null;
  const isOwner = String(team.owner_user_id) === String(userId);
  const ownerName = await getVendorNameByUserId(env, team.owner_user_id);
  const members = await getTeamMembers(env, team.owner_user_id);
  const formattedMembers = members.map((m) => ({
    member_user_id: m.member_user_id,
    member_name: m.member_name || null,
    created_at: m.created_at != null ? Number(m.created_at) : null,
  }));
  const base = {
    team_id: team.owner_user_id,
    owner_user_id: team.owner_user_id,
    name: team.name || ownerName || null,
    owner_name: ownerName || null,
    product_id: team.product_id || null,
    seats_total: Number(team.seats_total) || 0,
    expires_at: team.expires_at != null ? Number(team.expires_at) : null,
    updated_at: team.updated_at != null ? Number(team.updated_at) : null,
    created_at: team.created_at != null ? Number(team.created_at) : null,
    members: formattedMembers,
    seats_used: members.length,
  };
  if (isOwner) {
    return {
      ...base,
      invite_code: team.invite_code || null,
      is_member: true,
      is_owner: true,
    };
  }
  return {
    ...base,
    is_member: true,
    is_owner: false,
  };
}
