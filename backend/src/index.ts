import {
  createChallenge,
  isIdentityKey,
  logout,
  userFromRequest,
  verifyLogin,
} from "./auth.ts";
import { migrate } from "./db.ts";
import {
  MAX_DATA_BYTES,
  checkPayments,
  confirmReceipt,
  deliverKey,
  delivery,
  expireDue,
  markClaimed,
  offerData,
  paymentRequest,
  sellerTasks,
  storeData,
  submitPayment,
} from "./delivery.ts";
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
const notFound = () => json({ error: "Not found" }, { status: 404 });
/** Results of delivery.ts carry their HTTP status on failure. */
const reply = (result: object | { error: string; status: number }) =>
  "error" in result ? json({ error: result.error }, { status: result.status }) : json(result);
const created = (result: { id: string } | { error: string }) =>
  "error" in result ? json(result, { status: 400 }) : json(result, { status: 201 });

await migrate();

// Deadlines are settled in the background; see settleDue in market.ts. Payments are
// followed until the network has seen them; see checkPayments in delivery.ts.
let settling = false;
const settle = async () => {
  if (settling) return;
  settling = true;
  try {
    await settleDue();
    await expireDue();
  } catch (e) {
    console.error("Settlement failed", e);
  } finally {
    settling = false;
  }
};
await settle();
setInterval(settle, 3000);
setInterval(() => checkPayments().catch((e) => console.error("Payment check failed", e)), 5000);

const server = Bun.serve({
  hostname,
  port,
  maxRequestBodySize: MAX_DATA_BYTES + 1024 * 1024,
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

    // ---------- Encrypted data, payment and delivery (see delivery.ts) ----------

    // Seller uploads the ciphertext (raw body) before listing; returns its sha256 as dataHash.
    "/api/data": {
      POST: async (req) => {
        const user = await userFromRequest(req);
        if (!user) return unauthorized();
        if (Number(req.headers.get("content-length") ?? 0) > MAX_DATA_BYTES) {
          return json({ error: "File too large" }, { status: 413 });
        }
        const name = new URL(req.url).searchParams.get("name") ?? "data";
        return reply(await storeData(user.id, new Uint8Array(await req.arrayBuffer()), name));
      },
    },

    // The ciphertext of an offer; anybody can check it against the offer's dataHash.
    "/api/offers/:id/data": async (req) => {
      const file = isUuid(req.params.id) ? await offerData(req.params.id) : null;
      if (!file) return notFound();
      return new Response(file.bytes, {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="data.enc"; filename*=UTF-8''${encodeURIComponent(file.name + ".enc")}`,
          ETag: `"${file.hash}"`,
        },
      });
    },

    // A winner gets the outputs to pay, then submits the signed transaction (AtomicBEEF hex).
    "/api/bids/:id/payment": {
      GET: async (req) => {
        const user = await userFromRequest(req);
        if (!user) return unauthorized();
        return isUuid(req.params.id) ? reply(await paymentRequest(user.id, req.params.id)) : notFound();
      },
      POST: async (req) => {
        const user = await userFromRequest(req);
        if (!user) return unauthorized();
        if (!isUuid(req.params.id)) return notFound();
        return reply(await submitPayment(user.id, req.params.id, (await readBody(req)).beef));
      },
    },

    // Seller: payments to claim into the wallet and keys to deliver.
    "/api/seller/tasks": async (req) => {
      const user = await userFromRequest(req);
      if (!user) return unauthorized();
      return json({ tasks: await sellerTasks(user.id) });
    },

    "/api/bids/:id/claimed": {
      POST: async (req) => {
        const user = await userFromRequest(req);
        if (!user) return unauthorized();
        const ok = isUuid(req.params.id) && (await markClaimed(user.id, req.params.id));
        return ok ? json({ ok }) : notFound();
      },
    },

    // Seller posts the data key wrapped for the buyer; buyer fetches it.
    "/api/bids/:id/delivery": {
      GET: async (req) => {
        const user = await userFromRequest(req);
        if (!user) return unauthorized();
        return isUuid(req.params.id) ? reply(await delivery(user.id, req.params.id)) : notFound();
      },
      POST: async (req) => {
        const user = await userFromRequest(req);
        if (!user) return unauthorized();
        if (!isUuid(req.params.id)) return notFound();
        return reply(await deliverKey(user.id, req.params.id, (await readBody(req)).wrappedKey));
      },
    },

    // Buyer reports whether the data decrypted: { ok, reason? }.
    "/api/bids/:id/receipt": {
      POST: async (req) => {
        const user = await userFromRequest(req);
        if (!user) return unauthorized();
        if (!isUuid(req.params.id)) return notFound();
        const { ok, reason } = await readBody(req);
        return reply(await confirmReceipt(user.id, req.params.id, ok, reason));
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
