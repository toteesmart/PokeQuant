// Deploy via Wrangler CLI
export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Beta-Key, Authorization"
    };

    // Handle CORS preflight before any method validation.
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    // Validate the access gate key
    const betaKey = request.headers.get("X-Beta-Key");
    if (!betaKey || !betaKey.trim()) {
      return new Response("Missing Beta Key", { status: 401, headers: corsHeaders });
    }

    let body;
    try {
      body = await request.text();
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN) {
      return new Response(JSON.stringify({ error: "Turso environment not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const tursoUrl = `${env.TURSO_DATABASE_URL}/v2/pipeline`;

    const tursoReq = new Request(tursoUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.TURSO_AUTH_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: body
    });

    try {
      const response = await fetch(tursoReq);
      const responseHeaders = { ...corsHeaders };
      const contentType = response.headers.get("Content-Type");
      if (contentType) {
        responseHeaders["Content-Type"] = contentType;
      } else {
        responseHeaders["Content-Type"] = "application/json";
      }
      return new Response(response.body, {
        status: response.status,
        headers: responseHeaders
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  }
};
