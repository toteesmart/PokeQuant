// Route table: path + method → handler, with the shared error→status mapping.
// Route params are decodeURIComponent'd because url.pathname stays
// percent-encoded (manual vendor ids contain ':' → %3A and never match raw).

import { corsHeaders, errorResponse, jsonResponse } from "./http.js";
import {
  handleCreateShow,
  handleGetShowRegistrations,
  handleListVendors,
  handlePatchRegistration,
  handlePatchShow,
  handlePostShowRegistration,
} from "./handlers/organizer.js";
import {
  handleDeleteAccount,
  handleDeleteInventory,
  handleGetInventory,
  handleGetMe,
  handleGetMyBalances,
  handleGetVendorShows,
  handlePostInventory,
  handleRequestShowAccess,
  handleSyncSubscription,
  handleUpdateInventory,
} from "./handlers/vendor.js";
import {
  handleGetTeam,
  handleLeaveTeam,
  handleRedeemTeamCode,
  handleRegenerateTeamCode,
  handleRemoveTeamMember,
  handleRenameTeam,
} from "./handlers/team.js";
import { handleRevenueCatWebhook } from "./handlers/webhook.js";

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/vendor/delete-account" && request.method === "POST") {
        return await handleDeleteAccount(request, env);
      }
      if (path === "/vendor/me" && request.method === "GET") {
        return await handleGetMe(request, env);
      }
      if (path === "/vendor/shows" && request.method === "GET") {
        return await handleGetVendorShows(request, env);
      }
      if (path === "/vendor/balances" && request.method === "GET") {
        return await handleGetMyBalances(request, env);
      }
      if (path === "/vendors" && request.method === "GET") {
        return await handleListVendors(request, env);
      }
      if (path === "/shows" && request.method === "POST") {
        return await handleCreateShow(request, env);
      }
      // /shows/{id} and /shows/{id}/registrations[/{vendorId}]
      // url.pathname stays percent-encoded — decode captures (manual vendor
      // ids contain ':' which encodes to %3A and would never match).
      const showMatch = path.match(/^\/shows\/([^/]+)$/);
      if (showMatch && request.method === "PATCH") {
        return await handlePatchShow(request, env, decodeURIComponent(showMatch[1]));
      }
      const regsMatch = path.match(/^\/shows\/([^/]+)\/registrations$/);
      if (regsMatch && request.method === "GET") {
        return await handleGetShowRegistrations(request, env, decodeURIComponent(regsMatch[1]));
      }
      if (regsMatch && request.method === "POST") {
        return await handlePostShowRegistration(request, env, decodeURIComponent(regsMatch[1]));
      }
      const regMatch = path.match(/^\/shows\/([^/]+)\/registrations\/([^/]+)$/);
      if (regMatch && request.method === "PATCH") {
        return await handlePatchRegistration(
          request,
          env,
          decodeURIComponent(regMatch[1]),
          decodeURIComponent(regMatch[2])
        );
      }
      const reqMatch = path.match(/^\/vendor\/shows\/([^/]+)\/request$/);
      if (reqMatch && request.method === "POST") {
        return await handleRequestShowAccess(request, env, decodeURIComponent(reqMatch[1]));
      }
      if (path === "/vendor/inventory" && request.method === "GET") {
        return await handleGetInventory(request, env);
      }
      if (path === "/vendor/inventory" && request.method === "POST") {
        return await handlePostInventory(request, env);
      }
      if (path === "/vendor/inventory/update" && request.method === "POST") {
        return await handleUpdateInventory(request, env);
      }
      if (path === "/vendor/inventory/delete" && request.method === "POST") {
        return await handleDeleteInventory(request, env);
      }
      if (path === "/vendor/sync-subscription" && request.method === "POST") {
        return await handleSyncSubscription(request, env);
      }
      if (path === "/vendor/team" && request.method === "GET") {
        return await handleGetTeam(request, env);
      }
      if (path === "/vendor/team/regenerate-code" && request.method === "POST") {
        return await handleRegenerateTeamCode(request, env);
      }
      if (path === "/vendor/team/rename" && request.method === "POST") {
        return await handleRenameTeam(request, env);
      }
      if (path === "/vendor/team/redeem" && request.method === "POST") {
        return await handleRedeemTeamCode(request, env);
      }
      if (path === "/vendor/team/remove" && request.method === "POST") {
        return await handleRemoveTeamMember(request, env);
      }
      if (path === "/vendor/team/leave" && request.method === "POST") {
        return await handleLeaveTeam(request, env);
      }
      if (path === "/revenuecat-webhook" && request.method === "POST") {
        return await handleRevenueCatWebhook(request, env);
      }
      if (path === "/health") {
        return jsonResponse({ ok: true });
      }
      return errorResponse("Not found", 404);
    } catch (err) {
      console.error("worker_show_vendor error:", err.message);
      const msg = err.message;
      let status = 500;
      if (msg.includes("Missing Authorization") || msg.includes("JWT") || msg.includes("Invalid JWT") || msg.includes("JWT not yet valid") || msg.includes("JWT expired") || msg.includes("token")) {
        status = 401;
      } else if (msg.includes("not authorized") || msg.includes("Not authorized") || msg.includes("not active") || msg.includes("not registered")) {
        status = 403;
      } else if (msg.includes("not found")) {
        status = 404;
      }
      return errorResponse(msg, status);
    }
  },
};
