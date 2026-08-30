// Deploy via Wrangler CLI
export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Beta-Key"
    };
    
    if (request.method === "OPTIONS") return new Response(null, { headers });

    // Validate the access gate key
    const betaKey = request.headers.get("X-Beta-Key");
    if (!betaKey) return new Response("Missing Beta Key", { status: 401, headers });

    const body = await request.text();
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
      return new Response(response.body, {
        status: response.status,
        headers: { ...headers, "Content-Type": "application/json" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
  }
};