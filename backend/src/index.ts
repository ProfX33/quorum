import {
  createChallenge,
  isIdentityKey,
  logout,
  userFromRequest,
  verifyLogin,
} from "./auth.ts";
import { migrate } from "./db.ts";
import {
  createOffer,
  createRequest,
  filtersFrom,
  isUuid,
  listOffers,
  listRequests,
  placeBid,
  settleDue,
  withdrawBid,
  withdrawRequest,
} from "./market.ts";

const port = Number(process.env.PORT ?? 5000);
const hostname = process.env.HOST ?? "0.0.0.0"; // all interfaces, so the API is reachable on the local network
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

const unauthorized = () => json({ error: "Unauthorized" }, { status: 401 });
const created = (result: { id: string } | { error: string }) =>
  "error" in result ? json(result, { status: 400 }) : json(result, { status: 201 });

await migrate();

// Deadlines are settled in the background; see settleDue in market.ts.
const settle = () => settleDue().catch((e) => console.error("Settlement failed", e));
await settle();
setInterval(settle, 3000);

const server = Bun.serve({
  hostname,
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

    // Marketplace. Reads are public (agents can search without logging in);
    // query params: q, kind, category, region, status.
    "/api/search": async (req) => {
      const user = await userFromRequest(req);
      const filters = filtersFrom(new URL(req.url));
      const [offers, requests] = await Promise.all([
        listOffers(filters, user?.id ?? null),
        listRequests(filters, user?.id ?? null),
      ]);
      return json({ offers, requests });
    },

    "/api/offers": {
      GET: async (req) => {
        const user = await userFromRequest(req);
        return json({ offers: await listOffers(filtersFrom(new URL(req.url)), user?.id ?? null) });
      },
      POST: async (req) => {
        const user = await userFromRequest(req);
        if (!user) return unauthorized();
        return created(await createOffer(user.id, await readBody(req)));
      },
    },

    "/api/offers/:id": async (req) => {
      if (!isUuid(req.params.id)) return json({ error: "Not found" }, { status: 404 });
      const user = await userFromRequest(req);
      const [offer] = await listOffers({}, user?.id ?? null, req.params.id);
      return offer ? json({ offer }) : json({ error: "Not found" }, { status: 404 });
    },

    // A buyer states the maximum they would pay; re-posting updates it.
    "/api/offers/:id/bid": {
      POST: async (req) => {
        const user = await userFromRequest(req);
        if (!user) return unauthorized();
        if (!isUuid(req.params.id)) return json({ error: "Not found" }, { status: 404 });
        const result = await placeBid(user.id, req.params.id, (await readBody(req)).maxPrice);
        return "error" in result ? json(result, { status: 409 }) : json(result);
      },
      DELETE: async (req) => {
        const user = await userFromRequest(req);
        if (!user) return unauthorized();
        const ok = isUuid(req.params.id) && (await withdrawBid(user.id, req.params.id));
        return ok ? json({ ok }) : json({ error: "No open bid to withdraw" }, { status: 404 });
      },
    },

    "/api/requests": {
      GET: async (req) => {
        const user = await userFromRequest(req);
        return json({ requests: await listRequests(filtersFrom(new URL(req.url)), user?.id ?? null) });
      },
      POST: async (req) => {
        const user = await userFromRequest(req);
        if (!user) return unauthorized();
        return created(await createRequest(user.id, await readBody(req)));
      },
    },

    "/api/requests/:id": {
      DELETE: async (req) => {
        const user = await userFromRequest(req);
        if (!user) return unauthorized();
        const ok = isUuid(req.params.id) && (await withdrawRequest(user.id, req.params.id));
        return ok ? json({ ok }) : json({ error: "No open request to withdraw" }, { status: 404 });
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
