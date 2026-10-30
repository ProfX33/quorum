import {
  createChallenge,
  isIdentityKey,
  logout,
  userFromRequest,
  verifyLogin,
} from "./auth.ts";
import { migrate } from "./db.ts";

const port = Number(process.env.PORT ?? 5000);
const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:3000";

const corsHeaders = {
  "Access-Control-Allow-Origin": corsOrigin,
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const json = (body: unknown, init: ResponseInit = {}) =>
  Response.json(body, { ...init, headers: { ...corsHeaders, ...init.headers } });

const readBody = async (req: Request): Promise<Record<string, unknown>> =>
  (await req.json().catch(() => ({}))) as Record<string, unknown>;

await migrate();

const server = Bun.serve({
  port,
  routes: {
    "/api/health": () => json({ status: "ok" }),

    // Step 1: ask for a challenge for an identity key (humans and agents alike).
    "/api/auth/challenge": {
      POST: async (req) => {
        const { identityKey } = await readBody(req);
        if (!isIdentityKey(identityKey)) return json({ error: "Invalid identityKey" }, { status: 400 });
        const { nonce, message, expiresAt } = await createChallenge(identityKey);
        return json({ nonce, message, expiresAt });
      },
    },

    // Step 2: return the signature. Creates the account on first login.
    "/api/auth/login": {
      POST: async (req) => {
        const { identityKey, nonce, signature, kind } = await readBody(req);
        if (!isIdentityKey(identityKey) || typeof nonce !== "string" || typeof signature !== "string") {
          return json({ error: "identityKey, nonce and signature are required" }, { status: 400 });
        }
        const result = await verifyLogin(identityKey, nonce, signature, kind === "agent" ? "agent" : "human");
        if (!result) return json({ error: "Invalid or expired challenge or signature" }, { status: 401 });
        const maxAge = Math.floor((result.expiresAt.getTime() - Date.now()) / 1000);
        return json(
          { token: result.token, expiresAt: result.expiresAt, user: result.user, created: result.created },
          {
            headers: {
              "Set-Cookie": `session=${result.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`,
            },
          },
        );
      },
    },

    "/api/auth/me": async (req) => {
      const user = await userFromRequest(req);
      return user ? json({ user }) : json({ error: "Unauthorized" }, { status: 401 });
    },

    "/api/auth/logout": {
      POST: async (req) => {
        await logout(req);
        return json({ ok: true }, { headers: { "Set-Cookie": "session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" } });
      },
    },
  },
  fetch(req) {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    return json({ error: "Not found" }, { status: 404 });
  },
});

console.log(`Backend listening on ${server.url}`);
