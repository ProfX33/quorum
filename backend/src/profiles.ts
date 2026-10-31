import { sql } from "./db.ts";
import { txUrl } from "./payments.ts";

// Profiles are public and addressed by identity key: anybody can see a user's name,
// picture, offers, requests, bids and transactions. Bid maxima stay private to the bidder.

export const MAX_NAME_LENGTH = 50;
export const MAX_AVATAR_BYTES = 512 * 1024;

// Raster images only (no SVG, which could carry scripts), recognised by their magic bytes.
export const IMAGE_TYPES: Record<string, (b: Uint8Array) => boolean> = {
  "image/png": (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/gif": (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
  "image/webp": (b) =>
    String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP",
};

// Bid states in which the buyer's share has been paid to the seller.
export const PAID_STATES = ["paid", "delivered", "received", "disputed"];
// Bid states in which the bid is (or was) in the payment group, so its amount is set.
const GROUP_STATES = ["won", "pledged", "defaulted", ...PAID_STATES];

const fail = (status: number, error: string) => ({ error, status });

/** Versioned, so the picture can be cached for good. */
export const avatarUrl = (identityKey: string, updatedAt: unknown) =>
  updatedAt ? `/api/users/${identityKey}/avatar?v=${new Date(updatedAt as string).getTime()}` : null;

/** How a user appears next to an offer, request, bid or transaction. */
export const person = (identityKey: string, name: string | null, avatarAt: unknown) => ({
  identityKey,
  name: name ?? null,
  avatarUrl: avatarUrl(identityKey, avatarAt),
});

/** Sets the display name; an empty name removes it. */
export async function updateProfile(userId: string, body: Record<string, unknown>) {
  if (body.name !== null && typeof body.name !== "string") return fail(400, "name must be a string");
  const name = (body.name ?? "").trim() || null;
  if (name && name.length > MAX_NAME_LENGTH) return fail(400, `name must be at most ${MAX_NAME_LENGTH} characters`);
  await sql`UPDATE users SET display_name = ${name} WHERE id = ${userId}`;
  return { ok: true };
}

export async function setAvatar(userId: string, bytes: Uint8Array, contentType: string | null) {
  const type = contentType?.split(";")[0]!.trim().toLowerCase() ?? "";
  const matches = IMAGE_TYPES[type];
  if (!matches) return fail(415, `Picture must be one of ${Object.keys(IMAGE_TYPES).join(", ")}`);
  if (bytes.length === 0) return fail(400, "Empty picture");
  if (bytes.length > MAX_AVATAR_BYTES) return fail(413, "Picture too large");
  if (!matches(bytes)) return fail(415, `This is not a ${type} file`);
  await sql`UPDATE users SET avatar = ${bytes}, avatar_type = ${type}, avatar_updated_at = now() WHERE id = ${userId}`;
  return { ok: true };
}

export async function removeAvatar(userId: string) {
  await sql`UPDATE users SET avatar = NULL, avatar_type = NULL, avatar_updated_at = NULL WHERE id = ${userId}`;
  return { ok: true };
}

export async function avatar(identityKey: string) {
  const [row] = await sql`
    SELECT avatar, avatar_type FROM users WHERE identity_key = ${identityKey} AND avatar IS NOT NULL`;
  return row ? { bytes: row.avatar as Uint8Array, type: row.avatar_type as string } : null;
}

/** The public part of a user, or null when nobody has signed in with this key. */
export async function publicUser(identityKey: string) {
  const [row] = await sql`
    SELECT id, identity_key, kind, display_name, avatar_updated_at, created_at, reputation
    FROM users WHERE identity_key = ${identityKey}`;
  if (!row) return null;
  return {
    id: row.id as string,
    user: {
      ...person(row.identity_key, row.display_name, row.avatar_updated_at),
      kind: row.kind,
      reputation: Number(row.reputation),
      createdAt: new Date(row.created_at).toISOString(),
    },
  };
}

/** The user's bids on sell offers, newest first. The maximum is shown to the bidder only. */
export async function userBids(userId: string, viewerId: string | null) {
  const rows = await sql`
    SELECT b.id, b.status, b.max_price, b.amount, b.created_at,
      s.id AS offer_id, s.name, s.kind, s.price, s.status AS offer_status, s.deadline,
      s.payment_txid, s.payment_seen_at,
      u.identity_key AS seller_key, u.display_name AS seller_name, u.avatar_updated_at AS seller_avatar_at
    FROM buy_offers b
    JOIN sell_offers s ON s.id = b.sell_offer_id
    JOIN users u ON u.id = s.seller_id
    WHERE b.buyer_id = ${userId}
    ORDER BY b.created_at DESC
    LIMIT 200`;
  return rows.map((row: any) => {
    const paid = PAID_STATES.includes(row.status) && row.payment_txid != null;
    return {
      id: row.id,
      status: row.status,
      maxPrice: viewerId === userId ? Number(row.max_price) : null,
      amount: GROUP_STATES.includes(row.status) && row.amount != null ? Number(row.amount) : null,
      createdAt: new Date(row.created_at).toISOString(),
      offer: {
        id: row.offer_id,
        name: row.name,
        kind: row.kind,
        price: Number(row.price),
        status: row.offer_status,
        deadline: new Date(row.deadline).toISOString(),
      },
      seller: person(row.seller_key, row.seller_name, row.seller_avatar_at),
      txid: paid ? row.payment_txid : null,
      txUrl: paid ? txUrl(row.payment_txid) : null,
    };
  });
}

/**
 * The group payments the user received (sales) or took part in (purchases), newest first.
 * Each names the other side: the paying buyers of a sale, the seller of a purchase.
 */
export async function userTransactions(userId: string) {
  const [sales, purchases] = await Promise.all([
    sql`
      SELECT s.id AS offer_id, s.name, s.kind, s.price AS amount, s.payment_txid, s.payment_seen_at, s.paid_at,
        COALESCE((SELECT json_agg(json_build_object(
            'key', bu.identity_key, 'name', bu.display_name, 'avatarAt', bu.avatar_updated_at) ORDER BY b.created_at)
          FROM buy_offers b JOIN users bu ON bu.id = b.buyer_id
          WHERE b.sell_offer_id = s.id AND b.status = ANY(${PAID_STATES})), '[]') AS buyers
      FROM sell_offers s
      WHERE s.seller_id = ${userId} AND s.payment_txid IS NOT NULL
      ORDER BY s.paid_at DESC
      LIMIT 200`,
    sql`
      SELECT s.id AS offer_id, s.name, s.kind, b.amount, s.payment_txid, s.payment_seen_at, s.paid_at,
        u.identity_key AS seller_key, u.display_name AS seller_name, u.avatar_updated_at AS seller_avatar_at
      FROM buy_offers b
      JOIN sell_offers s ON s.id = b.sell_offer_id
      JOIN users u ON u.id = s.seller_id
      WHERE b.buyer_id = ${userId} AND b.status = ANY(${PAID_STATES}) AND s.payment_txid IS NOT NULL
      ORDER BY s.paid_at DESC
      LIMIT 200`,
  ]);
  const tx = (role: "sale" | "purchase", row: any, counterparties: ReturnType<typeof person>[]) => ({
    role,
    offer: { id: row.offer_id, name: row.name, kind: row.kind },
    amount: Number(row.amount),
    txid: row.payment_txid,
    txUrl: txUrl(row.payment_txid),
    seen: row.payment_seen_at != null,
    at: row.paid_at ? new Date(row.paid_at).toISOString() : null,
    counterparties,
  });
  const buyers = (v: any): any[] => (typeof v === "string" ? JSON.parse(v) : v);
  return [
    ...sales.map((row: any) => tx("sale", row, buyers(row.buyers).map((b) => person(b.key, b.name, b.avatarAt)))),
    ...purchases.map((row: any) => tx("purchase", row, [person(row.seller_key, row.seller_name, row.seller_avatar_at)])),
  ].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}
