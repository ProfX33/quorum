const port = Number(process.env.PORT ?? 5000);
const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:3000";

const corsHeaders = {
  "Access-Control-Allow-Origin": corsOrigin,
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const server = Bun.serve({
  port,
  routes: {
    "/api/health": () => Response.json({ status: "ok" }, { headers: corsHeaders }),
  },
  fetch(req) {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
  },
});

console.log(`Backend listening on ${server.url}`);
