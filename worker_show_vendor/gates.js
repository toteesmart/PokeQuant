// Vendor gating: the paid-vendor check (payments_live flag, direct
// Cardcache_pro subscription, or active team membership) and the composite
// vendor status payload returned by GET /vendor/me.

import {
  getFounderSeatsRemaining,
  isPaymentsLive,
  isVendorActive,
} from "./vendors.js";
import { getTeamForMember, isActiveTeamMember } from "./teams.js";

export async function assertIsPaidVendor(env, userId) {
  if (!(await isPaymentsLive(env))) return true;
  if (await isVendorActive(env, userId)) return true;
  if (await isActiveTeamMember(env, userId)) return true;
  throw new Error("subscription_required");
}

export async function getVendorStatus(env, userId, vendor) {
  const paymentsLive = await isPaymentsLive(env);
  const isFounder = Number(vendor?.is_founder) || 0;
  const isDirectActive = paymentsLive ? await isVendorActive(env, userId) : false;
  const isTeamMember = await isActiveTeamMember(env, userId);
  // Founder status is now a discount/seat label, not an active-membership bypass.
  const active = paymentsLive ? (isDirectActive || isTeamMember) : false;
  const memberTeam = isTeamMember ? await getTeamForMember(env, userId) : null;
  return {
    payments_live: paymentsLive ? 1 : 0,
    is_vendor: paymentsLive ? (active ? 1 : 0) : 0,
    is_founder: isFounder,
    founder_seat_number: vendor?.founder_seat_number ?? null,
    founder_seats_remaining: await getFounderSeatsRemaining(env),
    is_team_member: isTeamMember ? 1 : 0,
    team_id: memberTeam ? memberTeam.owner_user_id : null,
  };
}
