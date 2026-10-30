import { sql } from "./db.ts";
import { PLEDGE_FEE, derivationNonce, txUrl } from "./payments.ts";
import { person } from "./profiles.ts";
import { findPaymentGroup } from "./settlement.ts";

export const KINDS = ["data", "service", "product"] as const;
type Kind = (typeof KINDS)[number];

const MAX_DEADLINE_MS = 365 * 24 * 60 * 60 * 1000;
const PAYMENT_WINDOW_MINUTES = Number(process.env.PAYMENT_WINDOW_MINUTES ?? 60);

/** End of a payment window starting now. */
export const paymentWindowEnd = () => new Date(Date.now() + PAYMENT_WINDOW_MINUTES * 60_000);

// Bid states of the buyers in (or dropped from) the payment group.
const GROUP_STATES = ["won", "pledged", "paid", "delivered", "received", "disputed", "defaulted"];

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

export type Filters = {
  q?: string | null;
  kind?: string | null;
  category?: string | null;
  region?: string | null;
  status?: string | null;
  // Only the listings of one user (their profile page); not taken from the URL.
  ownerId?: string | null;
};

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
    file: row.file_name ? { name: row.file_name, size: Number(row.file_size) } : null,
    status: row.status,
    paymentDeadline: row.payment_deadline ? new Date(row.payment_deadline).toISOString() : null,
    seller: row.seller_key,
    sellerProfile: person(row.seller_key, row.seller_name, row.seller_avatar_at),
    // Who bid, and how far each bid got; their maxima stay private.
    bidders: (typeof row.bidders === "string" ? JSON.parse(row.bidders) : row.bidders).map((b: any) => ({
      ...person(b.key, b.name, b.avatarAt),
      status: b.status,
    })),
    createdAt: new Date(row.created_at).toISOString(),
    settledAt: row.settled_at ? new Date(row.settled_at).toISOString() : null,
    bidCount: maxima.length,
    payers: row.status === "open" ? (group?.length ?? 0) : Number(row.winner_count),
    share: group ? group[0]!.amount : null,
    // The group payment: members still to pledge, and the transaction once it is built.
    groupPayment: row.status === "sold"
      ? {
          members: Number(row.member_count),
          pledged: Number(row.pledged_count),
          txid: row.payment_txid,
          txUrl: row.payment_txid ? txUrl(row.payment_txid) : null,
          seen: row.payment_seen_at != null,
        }
      : null,
    mine: userId !== null && row.seller_id === userId,
    // Counts per bid state of the payment group, for the seller only.
    sales: userId !== null && row.seller_id === userId && row.status === "sold" ? row.sales ?? {} : null,
    myBid: row.my_max_price == null
      ? null
      : {
          id: row.my_id,
          maxPrice: Number(row.my_max_price),
          status: row.my_status,
          amount: row.my_amount == null ? null : Number(row.my_amount),
          // What the buyer's pledges count towards the share, and what they can take back.
          pledged: Number(row.my_credited ?? 0),
          refundable: Number(row.my_refundable ?? 0),
          txid: GROUP_STATES.includes(row.my_status) ? row.payment_txid : null,
          txUrl: GROUP_STATES.includes(row.my_status) && row.payment_txid ? txUrl(row.payment_txid) : null,
          paymentSeen: GROUP_STATES.includes(row.my_status) && row.payment_seen_at != null,
          paymentError: row.payment_error,
          disputeReason: row.my_dispute_reason,
        },
  };
};

export async function listOffers(filters: Filters, userId: string | null, id: string | null = null) {
  const status = filters.status === "all" || ["sold", "unsold"].includes(filters.status ?? "") ? filters.status! : "open";
  const rows = await sql`
    SELECT s.*, u.identity_key AS seller_key, u.display_name AS seller_name, u.avatar_updated_at AS seller_avatar_at,
      COALESCE((SELECT json_agg(b.max_price ORDER BY b.created_at) FROM buy_offers b WHERE b.sell_offer_id = s.id), '[]') AS bid_maxima,
      COALESCE((SELECT json_agg(json_build_object(
          'key', bu.identity_key, 'name', bu.display_name, 'avatarAt', bu.avatar_updated_at, 'status', b.status)
          ORDER BY b.created_at)
        FROM buy_offers b JOIN users bu ON bu.id = b.buyer_id WHERE b.sell_offer_id = s.id), '[]') AS bidders,
      (SELECT count(*) FROM buy_offers b WHERE b.sell_offer_id = s.id AND b.status = ANY(${GROUP_STATES})) AS winner_count,
      (SELECT json_object_agg(g.status, g.n) FROM (
        SELECT b.status, count(*) AS n FROM buy_offers b
        WHERE b.sell_offer_id = s.id AND b.status = ANY(${GROUP_STATES}) GROUP BY b.status) g) AS sales,
      (SELECT count(*) FROM buy_offers b WHERE b.sell_offer_id = s.id AND b.status IN ('won', 'pledged')) AS member_count,
      (SELECT count(*) FROM buy_offers b WHERE b.sell_offer_id = s.id AND b.status = 'pledged') AS pledged_count,
      f.name AS file_name, f.size AS file_size,
      my.id AS my_id, my.max_price AS my_max_price, my.status AS my_status, my.amount AS my_amount,
      my.dispute_reason AS my_dispute_reason,
      (SELECT sum(p.satoshis - ${PLEDGE_FEE}) FROM pledges p WHERE p.bid_id = my.id AND p.status IN ('active', 'used')) AS my_credited,
      (SELECT sum(p.satoshis) FROM pledges p WHERE p.bid_id = my.id AND p.status = 'active'
         AND my.status NOT IN ('won', 'pledged')) AS my_refundable
    FROM sell_offers s
    JOIN users u ON u.id = s.seller_id
    LEFT JOIN data_files f ON f.hash = s.data_hash
    LEFT JOIN buy_offers my ON my.sell_offer_id = s.id AND my.buyer_id = ${userId}::uuid
    WHERE (${id}::uuid IS NULL OR s.id = ${id}::uuid)
      AND (${id}::uuid IS NOT NULL OR ${status}::text = 'all' OR s.status = ${status}::text)
      AND (${filters.ownerId ?? null}::uuid IS NULL OR s.seller_id = ${filters.ownerId ?? null}::uuid)
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
  const keyWrap = typeof body.sellerKeyWrap === "string" ? body.sellerKeyWrap.toLowerCase() : null;
  if (listing.kind === "data" && !(keyWrap && /^[0-9a-f]{2,1024}$/.test(keyWrap) && keyWrap.length % 2 === 0)) {
    return { error: "Data offers need sellerKeyWrap: the data key encrypted by your wallet to itself" };
  }
  const requestId = body.requestId ?? null;
  if (requestId !== null && !isUuid(requestId)) return { error: "Invalid requestId" };

  return sql.begin(async (tx) => {
    if (listing.kind === "data") {
      // The data must be uploaded first (POST /api/data), by this seller.
      const [file] = await tx`SELECT owner_id FROM data_files WHERE hash = ${dataHash}`;
      if (!file || file.owner_id !== sellerId) return { error: "Upload the encrypted data before listing it" };
    }
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
      INSERT INTO sell_offers (seller_id, kind, category, region, name, description, price, deadline, data_hash, seller_key_wrap)
      VALUES (${sellerId}, ${listing.kind}, ${listing.category}, ${listing.region}, ${listing.name},
              ${listing.description}, ${body.price}, ${listing.deadline}, ${dataHash},
              ${listing.kind === "data" ? keyWrap : null})
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
  buyerProfile: person(row.buyer_key, row.buyer_name, row.buyer_avatar_at),
  createdAt: new Date(row.created_at).toISOString(),
  mine: userId !== null && row.buyer_id === userId,
});

export async function listRequests(filters: Filters, userId: string | null) {
  const status = filters.status === "all" || filters.status === "expired" ? filters.status : "open";
  const rows = await sql`
    SELECT b.*, u.identity_key AS buyer_key, u.display_name AS buyer_name, u.avatar_updated_at AS buyer_avatar_at
    FROM buy_offers b JOIN users u ON u.id = b.buyer_id
    WHERE b.sell_offer_id IS NULL
      AND (${status}::text = 'all' OR b.status = ${status}::text)
      AND (${filters.ownerId ?? null}::uuid IS NULL OR b.buyer_id = ${filters.ownerId ?? null}::uuid)
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
      // The group pays the whole price in one transaction to one BRC-29 key of the seller.
      await tx`UPDATE sell_offers SET status = ${group ? "sold" : "unsold"}, settled_at = now(),
                 payment_deadline = ${group ? paymentWindowEnd() : null},
                 payment_prefix = ${group ? derivationNonce() : null}, payment_suffix = ${group ? derivationNonce() : null}
               WHERE id = ${id}`;
    });
  }
  await sql`UPDATE buy_offers SET status = 'expired'
            WHERE sell_offer_id IS NULL AND status = 'open' AND deadline <= now()`;
}
