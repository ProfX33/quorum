import { sql } from "./db.ts";
import { PLEDGE_FEE, derivationNonce, txUrl } from "./payments.ts";
import { DELIVERY_GRACE_MS } from "./reputation.ts";
import { person } from "./profiles.ts";
import { type Bid, findPaymentGroup, projectBid, smallestJoiningBid } from "./settlement.ts";

export const KINDS = ["data", "service"] as const;
type Kind = (typeof KINDS)[number];

const MAX_DEADLINE_MS = 365 * 24 * 60 * 60 * 1000;
// How long a settled group has for its payment to get built before it is given up.
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
  const category = text(body.category, 100) ?? "other";
  const region = text(body.region, 100) ?? "";
  const name = text(body.name, 200);
  if (!name) return "name is required (max 200 chars)";
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
  status?: string | null; myBids?: boolean;
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

/**
 * Where a bid's pledges went, in satoshis as they are on-chain: `pledged` always equals
 * `toSeller` + `fees` + `back`, and `returned` is the part of `back` already in the wallet.
 * The wallet's own mining fee for the pledge transaction comes on top. Spent pledges are left out.
 */
function pledgeStatement(row: any) {
  const p = typeof row.my_pledges === "string" ? JSON.parse(row.my_pledges) : row.my_pledges;
  const pledged = Number(p.satoshis);
  const toSeller = Number(p.used_satoshis) - Number(p.used_outputs) * PLEDGE_FEE;
  const fees = Number(p.outputs) * PLEDGE_FEE;
  return {
    pledged,
    toSeller,
    fees,
    back: pledged - toSeller - fees,
    returned: Number(p.refunded_satoshis) - Number(p.refunded_outputs) * PLEDGE_FEE,
  };
}

const toOffer = (row: any, userId: string | null) => {
  const price = Number(row.price);
  const maxima: number[] = (typeof row.bid_maxima === "string" ? JSON.parse(row.bid_maxima) : row.bid_maxima).map(Number);
  // Preview of the deadline algorithm on the funded bids; individual maxima stay private.
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
    sellerKind: row.seller_kind,
    sellerReputation: Number(row.seller_reputation),
    createdAt: new Date(row.created_at).toISOString(),
    settledAt: row.settled_at ? new Date(row.settled_at).toISOString() : null,
    bidCount: row.status === "open" ? maxima.length : Number(row.bid_count),
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
          statement: pledgeStatement(row),
          refundable: Number(row.my_refundable ?? 0),
          refundFee: Number(row.my_refund_outputs ?? 0) * PLEDGE_FEE,
          txid: GROUP_STATES.includes(row.my_status) ? row.payment_txid : null,
          txUrl: GROUP_STATES.includes(row.my_status) && row.payment_txid ? txUrl(row.payment_txid) : null,
          paymentSeen: GROUP_STATES.includes(row.my_status) && row.payment_seen_at != null,
          paymentError: row.payment_error,
          disputeReason: row.my_dispute_reason,
          reportedAt: row.my_reported_at ? new Date(row.my_reported_at).toISOString() : null,
          hasKey: row.my_has_key === true,
          // Until then a data buyer waiting for the key cannot report the seller.
          reportFrom: row.kind === "data" && row.my_status === "paid" && row.payment_seen_at
            ? new Date(new Date(row.payment_seen_at).getTime() + DELIVERY_GRACE_MS).toISOString()
            : null,
        },
  };
};

export async function listOffers(filters: Filters, userId: string | null, id: string | null = null) {
  const status = filters.status === "all" || ["sold", "unsold"].includes(filters.status ?? "") ? filters.status! : "open";
  const rows = await sql`
    SELECT s.*, u.identity_key AS seller_key, u.display_name AS seller_name, u.avatar_updated_at AS seller_avatar_at, u.kind AS seller_kind,
      u.reputation AS seller_reputation,
      COALESCE((SELECT json_agg(f.funded ORDER BY f.created_at) FROM (
        SELECT b.created_at, LEAST(b.max_price, COALESCE((SELECT sum(p.satoshis - ${PLEDGE_FEE}) FROM pledges p
                                 WHERE p.bid_id = b.id AND p.status = 'active'), 0)) AS funded
        FROM buy_offers b
        WHERE b.sell_offer_id = s.id AND b.status = 'open') f WHERE f.funded > 0), '[]') AS bid_maxima,
      (SELECT count(*) FROM buy_offers b WHERE b.sell_offer_id = s.id) AS bid_count,
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
      my.dispute_reason AS my_dispute_reason, my.reported_at AS my_reported_at, my.wrapped_key IS NOT NULL AS my_has_key,
      (SELECT sum(p.satoshis - ${PLEDGE_FEE}) FROM pledges p WHERE p.bid_id = my.id AND p.status IN ('active', 'used')) AS my_credited,
      (SELECT json_build_object(
          'satoshis', COALESCE(sum(p.satoshis), 0), 'outputs', count(*),
          'used_satoshis', COALESCE(sum(p.satoshis) FILTER (WHERE p.status = 'used'), 0),
          'used_outputs', count(*) FILTER (WHERE p.status = 'used'),
          'refunded_satoshis', COALESCE(sum(p.satoshis) FILTER (WHERE p.status = 'refunded'), 0),
          'refunded_outputs', count(*) FILTER (WHERE p.status = 'refunded'))
        FROM pledges p WHERE p.bid_id = my.id AND p.status <> 'spent') AS my_pledges,
      (SELECT sum(p.satoshis) FROM pledges p WHERE p.bid_id = my.id AND p.status = 'active'
         AND NOT (my.status IN ('open', 'won', 'pledged') OR (my.status = 'paid' AND s.payment_seen_at IS NULL))) AS my_refundable,
      (SELECT count(*) FROM pledges p WHERE p.bid_id = my.id AND p.status = 'active'
         AND NOT (my.status IN ('open', 'won', 'pledged') OR (my.status = 'paid' AND s.payment_seen_at IS NULL))) AS my_refund_outputs
    FROM sell_offers s
    JOIN users u ON u.id = s.seller_id
    LEFT JOIN data_files f ON f.hash = s.data_hash
    LEFT JOIN buy_offers my ON my.sell_offer_id = s.id AND my.buyer_id = ${userId}::uuid
    WHERE (${id}::uuid IS NULL OR s.id = ${id}::uuid)
      AND (${!filters.myBids}::boolean OR my.id IS NOT NULL)
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

/**
 * How the group of an offer is forming, and, for `maxPriceParam` or else the caller's own
 * maximum, what that bid would get if bidding closed now and what is still to pledge for it.
 * Maxima stay private, but funded amounts do not: pledges are public on-chain anyway.
 */
export async function quoteOffer(offerId: string, userId: string | null, maxPriceParam: string | null) {
  const maxPrice = maxPriceParam === null ? null : Number(maxPriceParam);
  if (maxPrice !== null && !isSats(maxPrice)) return { error: "maxPrice must be a positive integer (satoshis)", status: 400 };
  const [offer] = await sql`
    SELECT id, seller_id, status, price, deadline, deadline > now() AS running FROM sell_offers WHERE id = ${offerId}`;
  if (!offer) return { error: "Not found", status: 404 };
  const price = Number(offer.price);
  const open = offer.status === "open" && offer.running;

  const rows = await sql`
    SELECT b.buyer_id, b.max_price, b.status,
      COALESCE(sum(p.satoshis - ${PLEDGE_FEE}), 0) AS credited
    FROM buy_offers b LEFT JOIN pledges p ON p.bid_id = b.id AND p.status = 'active'
    WHERE b.sell_offer_id = ${offerId} AND (b.status = 'open' OR b.buyer_id = ${userId}::uuid)
    GROUP BY b.id`;
  const all = (rows as any[]).map((b) => ({
    buyerId: b.buyer_id as string,
    open: b.status === "open",
    maxPrice: Number(b.max_price),
    credited: Number(b.credited),
    funded: Math.min(Number(b.max_price), Number(b.credited)),
  }));
  // The caller's bid may be withdrawn: out of the group, but its pledges count if they come back.
  const mine = all.find((b) => b.buyerId === userId);
  const bids = all.filter((b) => b.open);
  const funded = bids.filter((b) => b.funded > 0);
  const others = funded.filter((b) => b !== mine).map((b) => b.funded);
  const group = findPaymentGroup(price, funded.map((b, i) => ({ id: String(i), maxPrice: b.funded })));

  const quote = {
    offerId,
    status: offer.status as string,
    price,
    deadline: new Date(offer.deadline).toISOString(),
    secondsLeft: open ? Math.ceil((new Date(offer.deadline).getTime() - Date.now()) / 1000) : 0,
    biddingOpen: open,
    // Only while bidding runs; the group of a settled offer is in its groupPayment.
    group: open
      ? {
          fundedBidders: funded.length,
          unfundedBidders: bids.length - funded.length,
          fundedTotal: funded.reduce((sum, b) => sum + b.funded, 0),
          forms: group !== null,
          size: group?.length ?? 0,
          share: group?.[0]!.amount ?? null,
        }
      : null,
    // The smallest maximum that would put the caller in the group right now.
    minBidToJoin: open ? smallestJoiningBid(price, others) : null,
  };

  const candidate = maxPrice ?? (mine?.open ? mine.maxPrice : null);
  if (!open || candidate === null || offer.seller_id === userId) return { ...quote, bid: null };
  const credited = mine?.credited ?? 0;
  const outcome = projectBid(price, others, candidate);
  return {
    ...quote,
    bid: {
      maxPrice: candidate,
      ...outcome,
      share: outcome.inGroup ? outcome.share : null,
      alreadyPledged: credited,
      // What is still to pledge for this maximum, before network fees.
      due: Math.max(0, candidate - credited),
    },
  };
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
      INSERT INTO sell_offers (seller_id, kind, category, region, name, description, price, deadline, data_hash,
                               seller_key_wrap, payment_prefix, payment_suffix)
      VALUES (${sellerId}, ${listing.kind}, ${listing.category}, ${listing.region}, ${listing.name},
              ${listing.description}, ${body.price}, ${listing.deadline}, ${dataHash},
              ${listing.kind === "data" ? keyWrap : null}, ${derivationNonce()}, ${derivationNonce()})
      RETURNING id`;
    // The requester becomes the first bidder on the answering offer.
    if (requestId) await tx`UPDATE buy_offers SET sell_offer_id = ${row.id} WHERE id = ${requestId}`;
    return { id: row.id as string };
  });
}

/**
 * Places or updates the caller's maximum price on an open offer, and brings a withdrawn bid
 * back. It only counts once pledged: see paymentRequest in delivery.ts.
 */
export async function placeBid(buyerId: string, offerId: string, maxPrice: unknown) {
  if (!isSats(maxPrice)) return { error: "maxPrice must be a positive integer (satoshis)" };
  const [row] = await sql`
    INSERT INTO buy_offers (buyer_id, sell_offer_id, max_price)
    SELECT ${buyerId}, s.id, ${maxPrice} FROM sell_offers s
    WHERE s.id = ${offerId} AND s.status = 'open' AND s.deadline > now() AND s.seller_id <> ${buyerId}
    FOR SHARE OF s
    ON CONFLICT (sell_offer_id, buyer_id) WHERE sell_offer_id IS NOT NULL
      DO UPDATE SET max_price = EXCLUDED.max_price, status = 'open'
    RETURNING id, COALESCE((SELECT sum(p.satoshis - ${PLEDGE_FEE}) FROM pledges p
                            WHERE p.bid_id = buy_offers.id AND p.status = 'active'), 0) AS pledged`;
  return row ? { id: row.id as string, pledged: Number(row.pledged) } : { error: "Offer is closed, unknown, or your own" };
}

/** A bid that pledged stays on record, as lost, so its pledges can be taken back. */
export async function withdrawBid(buyerId: string, offerId: string) {
  return sql.begin(async (tx) => {
    const [offer] = await tx`
      SELECT id FROM sell_offers WHERE id = ${offerId} AND status = 'open' AND deadline > now() FOR UPDATE`;
    if (!offer) return false;
    const [updated] = await tx`
      UPDATE buy_offers b SET status = 'lost'
      WHERE b.sell_offer_id = ${offerId} AND b.buyer_id = ${buyerId} AND b.status = 'open'
        AND EXISTS (SELECT 1 FROM pledges p WHERE p.bid_id = b.id)
      RETURNING b.id`;
    if (updated) return true;
    const deleted = await tx`
      DELETE FROM buy_offers b WHERE b.sell_offer_id = ${offerId} AND b.buyer_id = ${buyerId} AND b.status = 'open'
      RETURNING b.id`;
    return deleted.length > 0;
  });
}

/**
 * The seller takes back an offer before its deadline. Bids on it are dropped and a request it
 * answered is handed back to its buyer, open again. With pledges on it the offer stays on
 * record as unsold instead, so that their buyers can take them back.
 */
export async function withdrawOffer(sellerId: string, offerId: string) {
  return sql.begin(async (tx) => {
    const [offer] = await tx`
      SELECT id FROM sell_offers
      WHERE id = ${offerId} AND seller_id = ${sellerId} AND status = 'open' AND deadline > now()
      FOR UPDATE`;
    if (!offer) return false;
    await tx`
      UPDATE buy_offers b SET sell_offer_id = NULL
      WHERE b.sell_offer_id = ${offerId} AND b.name IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM pledges p WHERE p.bid_id = b.id)`;
    const [pledged] = await tx`
      SELECT 1 FROM pledges p JOIN buy_offers b ON b.id = p.bid_id WHERE b.sell_offer_id = ${offerId} LIMIT 1`;
    if (pledged) {
      await tx`UPDATE buy_offers SET status = 'lost' WHERE sell_offer_id = ${offerId}`;
      await tx`UPDATE sell_offers SET status = 'unsold', settled_at = now() WHERE id = ${offerId}`;
    } else {
      await tx`DELETE FROM sell_offers WHERE id = ${offerId}`;
    }
    return true;
  });
}

/**
 * What the user's pledges hold: `locked` still backs an open or settling bid, or a group
 * payment the network has not seen yet (a rejected one is rebuilt from it), `refundable`
 * can be taken back now. Both include the fee contributions; `refundFee` goes to the miners.
 */
export async function pledgeExposure(userId: string) {
  const rows = await sql`
    SELECT b.id, b.status, b.max_price, s.id AS offer_id, s.name, s.deadline, s.payment_seen_at,
      sum(p.satoshis) AS satoshis, count(*)::int AS outputs
    FROM pledges p
    JOIN buy_offers b ON b.id = p.bid_id
    JOIN sell_offers s ON s.id = b.sell_offer_id
    WHERE b.buyer_id = ${userId} AND p.status = 'active'
    GROUP BY b.id, s.id
    ORDER BY s.deadline`;
  const bids = (rows as any[]).map((r) => {
    const held = ["open", "won", "pledged"].includes(r.status) || (r.status === "paid" && !r.payment_seen_at);
    return {
      bidId: r.id as string,
      offerId: r.offer_id as string,
      offerName: r.name as string,
      status: r.status as string,
      maxPrice: Number(r.max_price),
      deadline: new Date(r.deadline).toISOString(),
      locked: held ? Number(r.satoshis) : 0,
      refundable: held ? 0 : Number(r.satoshis),
      refundFee: held ? 0 : r.outputs * PLEDGE_FEE,
    };
  });
  return {
    locked: bids.reduce((sum, b) => sum + b.locked, 0),
    refundable: bids.reduce((sum, b) => sum + b.refundable, 0),
    refundFee: bids.reduce((sum, b) => sum + b.refundFee, 0),
    bids,
  };
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

// ---------- Public activity ----------

/**
 * The latest events of the market, by humans and agents alike, with the transactions behind
 * them. All of it is public anyway; a bidder's maximum stays private and is not included.
 */
export async function listActivity() {
  const rows = await sql`
    SELECT * FROM (
      SELECT 'listed' AS type, s.created_at AS at, s.id AS offer_id, s.name AS offer_name,
        u.identity_key AS actor, u.kind AS actor_kind, s.price AS satoshis, NULL::text AS txid
      FROM sell_offers s JOIN users u ON u.id = s.seller_id
      UNION ALL
      SELECT 'bid', b.created_at, s.id, s.name, u.identity_key, u.kind, NULL, NULL
      FROM buy_offers b JOIN sell_offers s ON s.id = b.sell_offer_id JOIN users u ON u.id = b.buyer_id
      UNION ALL
      SELECT s.status, s.settled_at, s.id, s.name, u.identity_key, u.kind, s.price, NULL
      FROM sell_offers s JOIN users u ON u.id = s.seller_id
      WHERE s.settled_at IS NOT NULL
      UNION ALL
      SELECT 'pledge', min(p.created_at), s.id, s.name, u.identity_key, u.kind, sum(p.satoshis - ${PLEDGE_FEE})::bigint, p.txid
      FROM pledges p JOIN buy_offers b ON b.id = p.bid_id
      JOIN sell_offers s ON s.id = b.sell_offer_id JOIN users u ON u.id = b.buyer_id
      WHERE p.status <> 'spent'
      GROUP BY p.txid, s.id, s.name, u.identity_key, u.kind
      UNION ALL
      SELECT 'payment', s.paid_at, s.id, s.name, u.identity_key, u.kind, s.price, s.payment_txid
      FROM sell_offers s JOIN users u ON u.id = s.seller_id
      WHERE s.payment_txid IS NOT NULL
      UNION ALL
      SELECT 'delivered', b.delivered_at, s.id, s.name, u.identity_key, u.kind, NULL, NULL
      FROM buy_offers b JOIN sell_offers s ON s.id = b.sell_offer_id JOIN users u ON u.id = s.seller_id
      WHERE b.delivered_at IS NOT NULL
      UNION ALL
      SELECT 'received', b.received_at, s.id, s.name, u.identity_key, u.kind, NULL, NULL
      FROM buy_offers b JOIN sell_offers s ON s.id = b.sell_offer_id JOIN users u ON u.id = b.buyer_id
      WHERE b.received_at IS NOT NULL
      UNION ALL
      SELECT 'refund', max(p.refunded_at), s.id, s.name, u.identity_key, u.kind, sum(p.satoshis - ${PLEDGE_FEE})::bigint, p.refund_txid
      FROM pledges p JOIN buy_offers b ON b.id = p.bid_id
      JOIN sell_offers s ON s.id = b.sell_offer_id JOIN users u ON u.id = b.buyer_id
      WHERE p.refunded_at IS NOT NULL
      GROUP BY p.refund_txid, s.id, s.name, u.identity_key, u.kind
    ) e
    ORDER BY at DESC
    LIMIT 50`;
  return rows.map((r: any) => ({
    type: r.type,
    at: new Date(r.at).toISOString(),
    offerId: r.offer_id,
    offerName: r.offer_name,
    actor: r.actor,
    actorKind: r.actor_kind,
    satoshis: r.satoshis == null ? null : Number(r.satoshis),
    txid: r.txid,
    txUrl: r.txid ? txUrl(r.txid) : null,
  }));
}

// ---------- Deadline settlement ----------

/**
 * Settles every open offer whose deadline has passed and expires unanswered requests. Only
 * pledged money counts, so the group is already paid for: expireDue in delivery.ts builds
 * its payment. Bids without enough pledged lose, and their pledges can be taken back.
 */
export async function settleDue() {
  const due = await sql`SELECT id FROM sell_offers WHERE status = 'open' AND deadline <= now()`;
  for (const { id } of due) {
    await sql.begin(async (tx) => {
      const [offer] = await tx`
        SELECT price FROM sell_offers WHERE id = ${id} AND status = 'open' FOR UPDATE SKIP LOCKED`;
      if (!offer) return;
      const bids = await tx`
        SELECT b.id, LEAST(b.max_price, COALESCE((SELECT sum(p.satoshis - ${PLEDGE_FEE}) FROM pledges p
                             WHERE p.bid_id = b.id AND p.status = 'active'), 0)) AS funded
        FROM buy_offers b
        WHERE b.sell_offer_id = ${id} AND b.status = 'open' ORDER BY b.created_at`;
      const group = findPaymentGroup(
        Number(offer.price),
        bids.map((b: any) => ({ id: b.id, maxPrice: Number(b.funded) })).filter((b: Bid) => b.maxPrice > 0),
      );
      for (const { id: bidId, amount } of group ?? []) {
        await tx`UPDATE buy_offers SET status = 'pledged', amount = ${amount} WHERE id = ${bidId}`;
      }
      await tx`UPDATE buy_offers SET status = 'lost' WHERE sell_offer_id = ${id} AND status = 'open'`;
      // The group pays the whole price in one transaction to one BRC-29 key of the seller.
      await tx`UPDATE sell_offers SET status = ${group ? "sold" : "unsold"}, settled_at = now(),
                 payment_deadline = ${group ? paymentWindowEnd() : null}
               WHERE id = ${id}`;
    });
  }
  await sql`UPDATE buy_offers SET status = 'expired'
            WHERE sell_offer_id IS NULL AND status = 'open' AND deadline <= now()`;
}
