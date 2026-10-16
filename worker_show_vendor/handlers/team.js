// Team handlers: /vendor/team routes — view, regenerate invite code, rename,
// redeem, remove member, leave.

import { getAuthenticatedUser } from "../auth.js";
import { errorResponse, jsonResponse } from "../http.js";
import { ensureSchema } from "../schema.js";
import { buildExecute, tursoPipeline } from "../turso.js";
import { getOrCreateVendor } from "../vendors.js";
import {
  formatTeam,
  generateInviteCode,
  getTeamByCode,
  getTeamByOwner,
  getTeamForMember,
  getTeamMembers,
  recalculateTeamSeats,
} from "../teams.js";
import { syncVendorSubscriptionFromRevenueCat } from "../subscriptions.js";

export async function handleGetTeam(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  await getOrCreateVendor(env, user);

  const ownTeam = await getTeamByOwner(env, user.userId);
  if (ownTeam) {
    return jsonResponse({ ok: true, team: await formatTeam(env, ownTeam, user.userId) });
  }

  const memberTeam = await getTeamForMember(env, user.userId);
  if (memberTeam) {
    return jsonResponse({ ok: true, team: await formatTeam(env, memberTeam, user.userId) });
  }

  return jsonResponse({ ok: true, team: null });
}

export async function handleRegenerateTeamCode(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  await getOrCreateVendor(env, user);

  let team = await getTeamByOwner(env, user.userId);
  if (!team) {
    await syncVendorSubscriptionFromRevenueCat(env, user.userId);
    await recalculateTeamSeats(env, user.userId);
    team = await getTeamByOwner(env, user.userId);
  }

  if (!team) {
    return errorResponse("subscription_required", 403);
  }

  for (let attempts = 0; attempts < 20; attempts++) {
    const code = generateInviteCode();
    try {
      await tursoPipeline(env, [
        buildExecute(
          "UPDATE teams SET invite_code = ? WHERE owner_user_id = ?",
          [code, user.userId]
        ),
        { type: "close" },
      ]);
      const updated = await getTeamByOwner(env, user.userId);
      if (updated && updated.invite_code === code) {
        return jsonResponse({ ok: true, team: await formatTeam(env, updated, user.userId) });
      }
    } catch (err) {
      // Unique constraint collision or other error — try another code.
      console.warn("Regenerate invite code attempt failed:", err.message);
    }
  }

  return errorResponse("Could not generate a unique invite code", 500);
}

export async function handleRenameTeam(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  await getOrCreateVendor(env, user);

  let team = await getTeamByOwner(env, user.userId);
  if (!team) {
    await syncVendorSubscriptionFromRevenueCat(env, user.userId);
    await recalculateTeamSeats(env, user.userId);
    team = await getTeamByOwner(env, user.userId);
  }

  if (!team) {
    return errorResponse("subscription_required", 403);
  }

  let newName;
  try {
    const body = await request.json();
    newName = String(body.name || "").trim();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  if (!newName) {
    return errorResponse("Team name is required", 400);
  }

  if (newName.length > 80) {
    return errorResponse("Team name must be 80 characters or less", 400);
  }

  await tursoPipeline(env, [
    buildExecute(
      "UPDATE teams SET name = ?, updated_at = ? WHERE owner_user_id = ?",
      [newName, Math.floor(Date.now() / 1000), user.userId]
    ),
    { type: "close" },
  ]);

  const updated = await getTeamByOwner(env, user.userId);
  return jsonResponse({ ok: true, team: await formatTeam(env, updated, user.userId) });
}

export async function handleRedeemTeamCode(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  await getOrCreateVendor(env, user);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse("Invalid JSON body", 400);
  }

  const code = String(body.code || "").trim();
  if (!code) return errorResponse("Missing code", 400);

  const team = await getTeamByCode(env, code);
  if (!team) return errorResponse("Team not found", 404);

  if (String(team.owner_user_id) === String(user.userId)) {
    return jsonResponse({ ok: true, team: await formatTeam(env, team, user.userId) });
  }

  const existingMemberTeam = await getTeamForMember(env, user.userId);
  if (existingMemberTeam) {
    if (String(existingMemberTeam.owner_user_id) === String(team.owner_user_id)) {
      return jsonResponse({ ok: true, team: await formatTeam(env, team, user.userId) });
    }
    return jsonResponse({ ok: true, team: await formatTeam(env, existingMemberTeam, user.userId) });
  }

  const ownTeam = await getTeamByOwner(env, user.userId);
  if (ownTeam) {
    return jsonResponse({ ok: true, team: await formatTeam(env, ownTeam, user.userId) });
  }

  const now = Math.floor(Date.now() / 1000);
  if (team.expires_at != null && Number(team.expires_at) <= now) {
    return errorResponse("Team subscription expired", 403);
  }

  const members = await getTeamMembers(env, team.owner_user_id);
  if (members.length >= Number(team.seats_total)) {
    return errorResponse("no seats available", 403);
  }

  await tursoPipeline(env, [
    buildExecute(
      "INSERT OR IGNORE INTO team_members (team_id, member_user_id, created_at) VALUES (?, ?, ?)",
      [team.owner_user_id, user.userId, now]
    ),
    { type: "close" },
  ]);

  const updatedTeam = { ...team };
  updatedTeam.members = await getTeamMembers(env, team.owner_user_id);
  return jsonResponse({ ok: true, team: await formatTeam(env, updatedTeam, user.userId) });
}

export async function handleRemoveTeamMember(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  await getOrCreateVendor(env, user);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse("Invalid JSON body", 400);
  }

  const memberUserId = String(body.member_user_id || "");
  if (!memberUserId) return errorResponse("Missing member_user_id", 400);
  if (memberUserId === user.userId) return errorResponse("Cannot remove owner", 400);

  const team = await getTeamByOwner(env, user.userId);
  if (!team) return errorResponse("No team", 403);

  await tursoPipeline(env, [
    buildExecute(
      "DELETE FROM team_members WHERE team_id = ? AND member_user_id = ?",
      [team.owner_user_id, memberUserId]
    ),
    { type: "close" },
  ]);

  return jsonResponse({ ok: true });
}

export async function handleLeaveTeam(request, env) {
  const user = await getAuthenticatedUser(request, env);
  await ensureSchema(env);
  await getOrCreateVendor(env, user);

  const team = await getTeamForMember(env, user.userId);
  if (!team) return jsonResponse({ ok: true });

  await tursoPipeline(env, [
    buildExecute(
      "DELETE FROM team_members WHERE team_id = ? AND member_user_id = ?",
      [team.owner_user_id, user.userId]
    ),
    { type: "close" },
  ]);

  return jsonResponse({ ok: true });
}
