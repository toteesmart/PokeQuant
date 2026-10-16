// HTTP surface helpers: CORS, JSON envelope, bearer-token extraction.

export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json", ...extraHeaders },
  });
}

export function errorResponse(message, status = 400) {
  return jsonResponse({ ok: false, error: message }, status);
}

export function getAuthToken(request) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader && authHeader.trim().toLowerCase().startsWith("bearer ")) {
    return authHeader.trim().slice(7).trim();
  }
  return null;
}
