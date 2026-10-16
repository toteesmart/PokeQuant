// Vendor gating: the request-scoped gate context plus the pure paid-vendor
// check and composite vendor status payload built over it. loadGateContext
// collapses every independent read the gates and /vendor/me need into one
// pipeline; downstream logic is then pure reads over the result.

import {
  allRowsAt,
  buildExecute,
  rowAt,
  tursoPipeline,
} from "./turso.js";

// One round-trip loads every independent read keyed on userId: the two
// app_config flags (a single IN query replaces the per-key call-site reads),
// the vendor row, the active-subscription probe, the member-team row
// (the same row getTeamForMember returns — activity is evaluated locally
// against `now`, so the second query is dropped), the caller's own team, and
// both founder counts. COUNT(*) is the authoritative claim guard; the
// maintained founder_counter row is what seats-remaining reports (a 1-row
// read instead of a vendors scan). The count fields are mutable:
// tryClaimFounderSeat increments them after a successful claim so status
// math sees post-claim truth.
export async function loadGateContext(env, userId) {
  const now = Math.floor(Date.now() / 1000);
  const data = await tursoPipeline(env, [
    buildExecute(
      "SELECT key, value FROM app_config WHERE key IN ('payments_live', 'founder_seat_limit')"
    ),
    buildExecute("SELECT * FROM vendors WHERE user_id = ?", [userId]),
    buildExecute(
      "SELECT 1 FROM vendor_subscriptions WHERE user_id = ? AND entitlement_id = ? AND is_active = 1 AND (expires_at IS NULL OR expires_at > ?) LIMIT 1",
      [userId, "Cardcache_pro", now]
    ),
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
    buildExecute("SELECT * FROM teams WHERE owner_user_id = ?", [userId]),
    buildExecute("SELECT COUNT(*) AS c FROM vendors WHERE founder_seat_number IS NOT NULL"),
    buildExecute("SELECT claimed FROM founder_counter WHERE id = 'founder'"),
    { type: "close" },
  ]);

  const config = {};
  for (const row of allRowsAt(data.results, 0)) {
    config[String(row.key)] = row.value;
  }
  const memberTeam = rowAt(data.results, 3);
  const founderCount = rowAt(data.results, 5);
  const counterRow = rowAt(data.results, 6);
  const founderClaimed = founderCount ? Number(founderCount.c) : 0;

  return {
    paymentsLive: config.payments_live === "1",
    founderSeatLimit: config.founder_seat_limit ? Number(config.founder_seat_limit) : 50,
    vendor: rowAt(data.results, 1),
    vendorSubActive: !!rowAt(data.results, 2),
    memberTeam,
    teamMemberActive:
      !!memberTeam &&
      (memberTeam.expires_at == null || Number(memberTeam.expires_at) > now),
    ownTeam: rowAt(data.results, 4),
    founderClaimed,
    // A missing counter row falls back to the true count (pre-counter schema).
    founderCounterClaimed: counterRow ? Number(counterRow.claimed) : founderClaimed,
  };
}

export function assertIsPaidVendor(ctx) {
  if (!ctx.paymentsLive) return true;
  if (ctx.vendorSubActive) return true;
  if (ctx.teamMemberActive) return true;
  throw new Error("subscription_required");
}

export function getVendorStatus(ctx, vendor) {
  const paymentsLive = ctx.paymentsLive;
  const isFounder = Number(vendor?.is_founder) || 0;
  const isDirectActive = paymentsLive ? ctx.vendorSubActive : false;
  const isTeamMember = ctx.teamMemberActive;
  // Founder status is now a discount/seat label, not an active-membership bypass.
  const active = paymentsLive ? (isDirectActive || isTeamMember) : false;
  const memberTeam = isTeamMember ? ctx.memberTeam : null;
  return {
    payments_live: paymentsLive ? 1 : 0,
    is_vendor: paymentsLive ? (active ? 1 : 0) : 0,
    is_founder: isFounder,
    founder_seat_number: vendor?.founder_seat_number ?? null,
    founder_seats_remaining: Math.max(0, ctx.founderSeatLimit - ctx.founderCounterClaimed),
    is_team_member: isTeamMember ? 1 : 0,
    team_id: memberTeam ? memberTeam.owner_user_id : null,
  };
}
