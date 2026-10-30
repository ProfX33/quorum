import { sql } from "./db.ts";
import { findPaymentGroup } from "./settlement.ts";

export const KINDS = ["data", "service", "product"] as const;
type Kind = (typeof KINDS)[number];

const MAX_DEADLINE_MS = 365 * 24 * 60 * 60 * 1000;

export const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const isSats = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;

const text = (v: unknown, max: number) =>
  typeof v === "string" && v.trim().length > 0 && v.trim().length <= max ? v.trim() : null;

type Listing = {
  kind: Kind;
  category: string;
  region: string;
  name: string;
  description: string;
  deadline: Date;
};

/** Validates the attributes shared by sell offers and requests. */
function parseListing(body: Record<string, unknown>): Listing | string {
  const kind = body.kind ?? "data";
  if (!KINDS.includes(kind as Kind)) return `kind must be one of ${KINDS.join(", ")}`;
  const category = text(body.category, 100);
  const region = text(body.region, 100);
  const name = text(body.name, 200);
  if (!category || !region || !name) return "category, region and name are required (max 100/100/200 chars)";
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 5000) : "";
  const deadline = new Date(typeof body.deadline === "string" || typeof body.deadline === "number" ? body.deadline : NaN);
  const msLeft = deadline.getTime() - Date.now();
  if (!(msLeft > 0 && msLeft <= MAX_DEADLINE_MS)) return "deadline must be a future date within one year";
  return { kind: kind as Kind, category, region, name, description, deadline };
}

export type Filters = { q?: string | null; kind?: string | null; category?: string | null; region?: string | null; status?: string | null };

export function filtersFrom(url: URL): Filters {
  const p = url.searchParams;
  return { q: p.get("q"), kind: p.get("kind"), category: p.get("category"), region: p.get("region"), status: p.get("status") };
}

const likePattern = (q: string | null | undefined) =>
  q?.trim() ? `%${q.trim().replace(/[\\%_]/g, (c) => "\\" + c)}%` : null;
const exact = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);

// ---------- Sell offers ----------

const toOffer = (row: any, userId: string | null) => {
  const price = Number(row.price);
  const maxima: number[] = (typeof row.bid_maxima === "string" ? JSON.parse(row.bid_maxima) : row.bid_maxima).map(Number);
  // Preview of the deadline algorithm on the current bids; individual maxima stay private.
  const group = row.status === "open" ? findPaymentGroup(price, maxima.map((maxPrice, i) => ({ id: String(i), maxPrice }))) : null;
  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    region: row.region,
    name: row.name,
    description: row.description,
    price,
    deadline: new Date(row.deadline).toISOString(),
    dataHash: row.data_hash,
    status: row.status,
    seller: row.seller_key,
    createdAt: new Date(row.created_at).toISOString(),
    settledAt: row.settled_at ? new Date(row.settled_at).toISOString() : null,
    bidCount: maxima.length,
    payers: row.status === "open" ? (group?.length ?? 0) : Number(row.winner_count),
    share: group ? group[0]!.amount : null,
    mine: userId !== null && row.seller_id === userId,
    myBid: row.my_max_price == null
      ? null
      : { maxPrice: Number(row.my_max_price), status: row.my_status, amount: row.my_amount == null ? null : Number(row.my_amount) },
  };
};

export async function listOffers(filters: Filters, userId: string | null, id: string | null = null) {
  const status = filters.status === "all" || ["sold", "unsold"].includes(filters.status ?? "") ? filters.status! : "open";
  const rows = await sql`
    SELECT s.*, u.identity_key AS seller_key,
      COALESCE((SELECT json_agg(b.max_price ORDER BY b.created_at) FROM buy_offers b WHERE b.sell_offer_id = s.id), '[]') AS bid_maxima,
      (SELECT count(*) FROM buy_offers b WHERE b.sell_offer_id = s.id AND b.status = 'won') AS winner_count,
      my.max_price AS my_max_price, my.status AS my_status, my.amount AS my_amount
    FROM sell_offers s
    JOIN users u ON u.id = s.seller_id
    LEFT JOIN buy_offers my ON my.sell_offer_id = s.id AND my.buyer_id = ${userId}::uuid
    WHERE (${id}::uuid IS NULL OR s.id = ${id}::uuid)
      AND (${id}::uuid IS NOT NULL OR ${status}::text = 'all' OR s.status = ${status}::text)
      AND (${exact(filters.kind)}::text IS NULL OR s.kind = ${exact(filters.kind)}::text)
      AND (${exact(filters.category)}::text IS NULL OR s.category ILIKE ${exact(filters.category)}::text)
      AND (${exact(filters.region)}::text IS NULL OR s.region ILIKE ${exact(filters.region)}::text)
      AND (${likePattern(filters.q)}::text IS NULL OR concat_ws(' ', s.name, s.description, s.category, s.region) ILIKE ${likePattern(filters.q)}::text)
    ORDER BY s.status = 'open' DESC, s.deadline ASC
    LIMIT 200`;
  return rows.map((row: any) => toOffer(row, userId));
}

export async function createOffer(sellerId: string, body: Record<string, unknown>) {
  const listing = parseListing(body);
  if (typeof listing === "string") return { error: listing };
  if (!isSats(body.price)) return { error: "price must be a positive integer (satoshis)" };
  const dataHash = typeof body.dataHash === "string" && body.dataHash ? body.dataHash.toLowerCase() : null;
  if (dataHash && !/^[0-9a-f]{64}$/.test(dataHash)) return { error: "dataHash must be a hex sha256" };
  if (listing.kind === "data" && !dataHash) return { error: "Data offers need a dataHash committing to the encrypted data" };
  const requestId = body.requestId ?? null;
  if (requestId !== null && !isUuid(requestId)) return { error: "Invalid requestId" };

  return sql.begin(async (tx) => {
    if (requestId) {
      const [request] = await tx`
        SELECT buyer_id, deadline FROM buy_offers
        WHERE id = ${requestId} AND sell_offer_id IS NULL AND status = 'open' AND deadline > now()
        FOR UPDATE`;
      if (!request) return { error: "Request is no longer open" };
      if (request.buyer_id === sellerId) return { error: "You cannot answer your own request" };
      if (listing.deadline > new Date(request.deadline)) return { error: "Deadline must not be after the request's deadline" };
    }
    const [row] = await tx`
      INSERT INTO sell_offers (seller_id, kind, category, region, name, description, price, deadline, data_hash)
      VALUES (${sellerId}, ${listing.kind}, ${listing.category}, ${listing.region}, ${listing.name},
              ${listing.description}, ${body.price}, ${listing.deadline}, ${dataHash})
      RETURNING id`;
    // The requester becomes the first bidder on the answering offer.
    if (requestId) await tx`UPDATE buy_offers SET sell_offer_id = ${row.id} WHERE id = ${requestId}`;
    return { id: row.id as string };
  });
}

/** Places or updates the caller's maximum price on an open offer. */
export async function placeBid(buyerId: string, offerId: string, maxPrice: unknown) {
  if (!isSats(maxPrice)) return { error: "maxPrice must be a positive integer (satoshis)" };
  const [row] = await sql`
    INSERT INTO buy_offers (buyer_id, sell_offer_id, max_price)
    SELECT ${buyerId}, s.id, ${maxPrice} FROM sell_offers s
    WHERE s.id = ${offerId} AND s.status = 'open' AND s.deadline > now() AND s.seller_id <> ${buyerId}
    ON CONFLICT (sell_offer_id, buyer_id) WHERE sell_offer_id IS NOT NULL
      DO UPDATE SET max_price = EXCLUDED.max_price
    RETURNING id`;
  return row ? { id: row.id as string } : { error: "Offer is closed, unknown, or your own" };
}

export async function withdrawBid(buyerId: string, offerId: string) {
  const rows = await sql`
    DELETE FROM buy_offers b USING sell_offers s
    WHERE b.sell_offer_id = s.id AND s.id = ${offerId} AND b.buyer_id = ${buyerId}
      AND s.status = 'open' AND s.deadline > now()
    RETURNING b.id`;
  return rows.length > 0;
}

// ---------- Requests (buy offers without a sell offer) ----------

const toRequest = (row: any, userId: string | null) => ({
  id: row.id,
  kind: row.kind,
  category: row.category,
  region: row.region,
  name: row.name,
  description: row.description,
  maxPrice: Number(row.max_price),
  deadline: new Date(row.deadline).toISOString(),
  status: row.status,
  buyer: row.buyer_key,
  createdAt: new Date(row.created_at).toISOString(),
  mine: userId !== null && row.buyer_id === userId,
});

export async function listRequests(filters: Filters, userId: string | null) {
  const status = filters.status === "all" || filters.status === "expired" ? filters.status : "open";
  const rows = await sql`
    SELECT b.*, u.identity_key AS buyer_key
    FROM buy_offers b JOIN users u ON u.id = b.buyer_id
    WHERE b.sell_offer_id IS NULL
      AND (${status}::text = 'all' OR b.status = ${status}::text)
      AND (${exact(filters.kind)}::text IS NULL OR b.kind = ${exact(filters.kind)}::text)
      AND (${exact(filters.category)}::text IS NULL OR b.category ILIKE ${exact(filters.category)}::text)
      AND (${exact(filters.region)}::text IS NULL OR b.region ILIKE ${exact(filters.region)}::text)
      AND (${likePattern(filters.q)}::text IS NULL OR concat_ws(' ', b.name, b.description, b.category, b.region) ILIKE ${likePattern(filters.q)}::text)
    ORDER BY b.status = 'open' DESC, b.deadline ASC
    LIMIT 200`;
  return rows.map((row: any) => toRequest(row, userId));
}

export async function createRequest(buyerId: string, body: Record<string, unknown>) {
  const listing = parseListing(body);
  if (typeof listing === "string") return { error: listing };
  if (!isSats(body.maxPrice)) return { error: "maxPrice must be a positive integer (satoshis)" };
  const [row] = await sql`
    INSERT INTO buy_offers (buyer_id, max_price, kind, category, region, name, description, deadline)
    VALUES (${buyerId}, ${body.maxPrice}, ${listing.kind}, ${listing.category}, ${listing.region},
            ${listing.name}, ${listing.description}, ${listing.deadline})
    RETURNING id`;
  return { id: row.id as string };
}

export async function withdrawRequest(buyerId: string, requestId: string) {
  const rows = await sql`
    DELETE FROM buy_offers
    WHERE id = ${requestId} AND buyer_id = ${buyerId} AND sell_offer_id IS NULL AND status = 'open'
    RETURNING id`;
  return rows.length > 0;
}

// ---------- Deadline settlement ----------

/** Settles every open offer whose deadline has passed and expires unanswered requests. */
export async function settleDue() {
  const due = await sql`SELECT id FROM sell_offers WHERE status = 'open' AND deadline <= now()`;
  for (const { id } of due) {
    await sql.begin(async (tx) => {
      const [offer] = await tx`
        SELECT price FROM sell_offers WHERE id = ${id} AND status = 'open' FOR UPDATE SKIP LOCKED`;
      if (!offer) return;
      const bids = await tx`
        SELECT id, max_price FROM buy_offers
        WHERE sell_offer_id = ${id} AND status = 'open' ORDER BY created_at`;
      const group = findPaymentGroup(
        Number(offer.price),
        bids.map((b: any) => ({ id: b.id, maxPrice: Number(b.max_price) })),
      );
      for (const { id: bidId, amount } of group ?? []) {
        await tx`UPDATE buy_offers SET status = 'won', amount = ${amount} WHERE id = ${bidId}`;
      }
      await tx`UPDATE buy_offers SET status = 'lost' WHERE sell_offer_id = ${id} AND status = 'open'`;
      await tx`UPDATE sell_offers SET status = ${group ? "sold" : "unsold"}, settled_at = now() WHERE id = ${id}`;
    });
  }
  await sql`UPDATE buy_offers SET status = 'expired'
            WHERE sell_offer_id IS NULL AND status = 'open' AND deadline <= now()`;
}
