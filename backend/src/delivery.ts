import { Transaction, Utils } from "@bsv/sdk";
import { sql } from "./db.ts";
import {
  ANYONE_KEY,
  broadcast,
  networkStatus,
  parsePayment,
  paymentLockingScript,
  tagLockingScript,
  txUrl,
} from "./payments.ts";

// After settlement every winner pays their share straight to the seller (BRC-29, see
// payments.ts). The server checks the transaction, broadcasts it through Arcade and waits
// until the network has seen it. Then the seller's wallet (browser or agent) claims the
// payment and wraps the data key for that buyer. Each buyer is served as soon as their own
// payment is through, so a group member who does not pay never blocks or costs the others.

export const MAX_DATA_BYTES = Number(process.env.MAX_DATA_MB ?? 20) * 1024 * 1024;
const MAX_BEEF_BYTES = 1024 * 1024;
const MAX_UNLISTED_FILES = 20;
const MAX_DELIVERY_ATTEMPTS = 3;

type Failure = { error: string; status: number };
const fail = (status: number, error: string): Failure => ({ error, status });

const isHex = (v: unknown, maxBytes: number): v is string =>
  typeof v === "string" && v.length > 0 && v.length % 2 === 0 && v.length <= maxBytes * 2 && /^[0-9a-f]+$/i.test(v);

const hex = (bytes: Uint8Array | null) => (bytes ? Buffer.from(bytes).toString("hex") : null);

// ---------- Encrypted data ----------

/** Stores ciphertext uploaded by a seller; the hash is computed here, not trusted from the client. */
export async function storeData(ownerId: string, bytes: Uint8Array, name: string) {
  // AES-GCM output is at least iv (12) + tag (16) + one byte.
  if (bytes.length < 29) return fail(400, "This is not encrypted data");
  if (bytes.length > MAX_DATA_BYTES) return fail(413, `Files are limited to ${MAX_DATA_BYTES / 1024 / 1024} MB`);
  const fileName = name.replace(/[\\/\x00-\x1f"]/g, "_").trim().slice(0, 200) || "data";
  const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

  const [{ n }] = await sql`
    SELECT count(*)::int AS n FROM data_files f
    WHERE f.owner_id = ${ownerId} AND NOT EXISTS (SELECT 1 FROM sell_offers s WHERE s.data_hash = f.hash)`;
  if (n >= MAX_UNLISTED_FILES) return fail(429, "Too many uploads that are not listed yet");

  const [row] = await sql`
    INSERT INTO data_files (hash, owner_id, name, size, bytes)
    VALUES (${hash}, ${ownerId}, ${fileName}, ${bytes.length}, ${Buffer.from(bytes)})
    ON CONFLICT (hash) DO UPDATE SET name = EXCLUDED.name WHERE data_files.owner_id = EXCLUDED.owner_id
    RETURNING hash`;
  if (!row) return fail(409, "This data was uploaded by someone else");
  return { dataHash: hash, size: bytes.length };
}

/** The ciphertext of an offer. Public: anybody may check it against the commitment. */
export async function offerData(offerId: string) {
  const [row] = await sql`
    SELECT f.bytes, f.name, f.hash FROM sell_offers s JOIN data_files f ON f.hash = s.data_hash
    WHERE s.id = ${offerId}`;
  return row ? { bytes: row.bytes as Uint8Array, name: row.name as string, hash: row.hash as string } : null;
}

// ---------- Payment ----------

async function loadBid(bidId: string) {
  const [bid] = await sql`
    SELECT b.*, s.kind, s.data_hash, s.seller_key_wrap, s.payment_deadline, s.seller_id,
      u.identity_key AS seller_key, bu.identity_key AS buyer_key,
      EXISTS (SELECT 1 FROM data_files f WHERE f.hash = s.data_hash) AS has_data
    FROM buy_offers b
    JOIN sell_offers s ON s.id = b.sell_offer_id
    JOIN users u ON u.id = s.seller_id
    JOIN users bu ON bu.id = b.buyer_id
    WHERE b.id = ${bidId}`;
  return bid as any;
}

/** The outputs the buyer's wallet must create (createAction) to pay for a won bid. */
export async function paymentRequest(buyerId: string, bidId: string) {
  const bid = await loadBid(bidId);
  if (!bid || bid.buyer_id !== buyerId) return fail(404, "Not found");
  if (bid.status !== "won") return fail(409, bid.payment_txid ? "Already paid" : "There is nothing to pay for this bid");
  if (new Date(bid.payment_deadline) <= new Date()) return fail(409, "The payment window has closed");
  if (bid.kind === "data" && (!bid.has_data || !bid.seller_key_wrap)) {
    return fail(409, "The seller never uploaded the data, so this offer cannot be paid");
  }
  const amount = Number(bid.amount);
  return {
    amount,
    seller: bid.seller_key as string,
    deadline: new Date(bid.payment_deadline).toISOString(),
    description: "Data market purchase",
    outputs: [
      {
        lockingScript: await paymentLockingScript(bid.seller_key, bid.payment_prefix, bid.payment_suffix),
        satoshis: amount,
        outputDescription: "Payment to the seller",
      },
      { lockingScript: tagLockingScript(bid.sell_offer_id, bid.id), satoshis: 0, outputDescription: "Data market tag" },
    ],
  };
}

/**
 * Accepts the buyer's signed payment (AtomicBEEF, hex), verifies it and broadcasts it.
 * Idempotent: re-submitting the same transaction returns the recorded payment.
 * A payment arriving after the window closed is still accepted; the money reached the seller.
 */
export async function submitPayment(buyerId: string, bidId: string, beefHex: unknown) {
  if (!isHex(beefHex, MAX_BEEF_BYTES)) return fail(400, "beef must be the hex AtomicBEEF from createAction");
  const bid = await loadBid(bidId);
  if (!bid || bid.buyer_id !== buyerId) return fail(404, "Not found");

  const lockingScript = await paymentLockingScript(bid.seller_key, bid.payment_prefix ?? "", bid.payment_suffix ?? "");
  const payment = await parsePayment(Utils.toArray(beefHex, "hex"), lockingScript, Number(bid.amount));
  if ("error" in payment) return fail(400, payment.error!);
  if (bid.payment_txid) {
    return bid.payment_txid === payment.txid
      ? { txid: payment.txid, txUrl: txUrl(payment.txid) }
      : fail(409, "This bid is already paid");
  }
  if (!["won", "defaulted"].includes(bid.status)) return fail(409, "This bid cannot be paid");

  let network;
  try {
    network = await broadcast(payment.tx);
  } catch (e) {
    console.error("Broadcast failed", e);
    return fail(502, "Could not reach the network, please retry (your payment is safe to resubmit)");
  }
  if (network.state === "rejected") return fail(400, `The network rejected the payment: ${network.reason}`);

  try {
    const [row] = await sql`
      UPDATE buy_offers SET status = 'paid', payment_txid = ${payment.txid}, payment_vout = ${payment.vout},
        payment_beef = ${Buffer.from(Utils.toArray(beefHex, "hex"))}, paid_at = now(), payment_error = NULL,
        payment_seen_at = ${network.state === "seen" ? new Date() : null}
      WHERE id = ${bidId} AND status IN ('won', 'defaulted') AND payment_txid IS NULL
      RETURNING id`;
    if (!row) {
      const again = await loadBid(bidId);
      if (again.payment_txid !== payment.txid) return fail(409, "This bid is already paid");
    }
  } catch (e: any) {
    if (e?.errno === "23505" || e?.code === "23505") return fail(409, "This transaction already paid another bid");
    throw e;
  }
  return { txid: payment.txid, txUrl: txUrl(payment.txid) };
}

let checking = false;

/**
 * Follows submitted payments until the network has seen them. A rejected payment (e.g.
 * double spend) is undone so the buyer can pay again; an unknown one is re-broadcast.
 */
export async function checkPayments() {
  if (checking) return;
  checking = true;
  try {
    const rows = await sql`
      SELECT id, payment_txid, payment_beef FROM buy_offers
      WHERE payment_txid IS NOT NULL AND payment_seen_at IS NULL
        AND (payment_checked_at IS NULL OR payment_checked_at < now() - interval '10 seconds')
      ORDER BY paid_at LIMIT 20`;
    for (const row of rows) {
      try {
        let network = await networkStatus(row.payment_txid);
        if (network.state === "unknown") {
          network = await broadcast(Transaction.fromAtomicBEEF(Array.from(row.payment_beef as Uint8Array)));
        }
        if (network.state === "seen") {
          await sql`UPDATE buy_offers SET payment_seen_at = now(), payment_checked_at = now() WHERE id = ${row.id}`;
        } else if (network.state === "rejected") {
          await sql`
            UPDATE buy_offers b SET
              status = CASE WHEN s.payment_deadline > now() THEN 'won' ELSE 'defaulted' END,
              payment_txid = NULL, payment_vout = NULL, payment_beef = NULL, paid_at = NULL, payment_checked_at = NULL,
              payment_error = ${`Payment ${row.payment_txid} was rejected: ${network.reason ?? "unknown reason"}`}
            FROM sell_offers s
            WHERE b.id = ${row.id} AND s.id = b.sell_offer_id AND b.status = 'paid' AND b.payment_seen_at IS NULL`;
        } else {
          await sql`UPDATE buy_offers SET payment_checked_at = now() WHERE id = ${row.id}`;
        }
      } catch (e) {
        console.error(`Checking payment ${row.payment_txid} failed`, e);
      }
    }
  } finally {
    checking = false;
  }
}

/** Winners who missed the payment window; uploads never listed within a day. */
export async function expireDue() {
  await sql`
    UPDATE buy_offers b SET status = 'defaulted' FROM sell_offers s
    WHERE b.sell_offer_id = s.id AND b.status = 'won' AND s.payment_deadline <= now()`;
  await sql`
    DELETE FROM data_files f
    WHERE f.created_at < now() - interval '1 day'
      AND NOT EXISTS (SELECT 1 FROM sell_offers s WHERE s.data_hash = f.hash)`;
}

// ---------- Seller side ----------

/**
 * Work for the seller's wallet: payments to claim (internalizeAction) and data keys to
 * wrap for buyers whose payment the network has seen.
 */
export async function sellerTasks(sellerId: string) {
  const rows = await sql`
    SELECT b.id, b.sell_offer_id, b.status, b.payment_txid, b.payment_vout, b.payment_beef,
      b.payment_prefix, b.payment_suffix, b.internalized_at, b.amount,
      s.kind, s.name, s.data_hash, s.seller_key_wrap, bu.identity_key AS buyer_key
    FROM buy_offers b
    JOIN sell_offers s ON s.id = b.sell_offer_id
    JOIN users bu ON bu.id = b.buyer_id
    WHERE s.seller_id = ${sellerId} AND b.payment_seen_at IS NOT NULL
      AND (b.internalized_at IS NULL OR (b.status = 'paid' AND s.kind = 'data'))
    ORDER BY b.paid_at LIMIT 50`;
  return rows.map((r: any) => ({
    bidId: r.id,
    offerId: r.sell_offer_id,
    offerName: r.name,
    buyer: r.buyer_key,
    amount: Number(r.amount),
    txid: r.payment_txid,
    claim: r.internalized_at
      ? null
      : {
          beef: hex(r.payment_beef),
          outputIndex: r.payment_vout,
          derivationPrefix: r.payment_prefix,
          derivationSuffix: r.payment_suffix,
          senderIdentityKey: ANYONE_KEY,
        },
    deliver: r.status === "paid" && r.kind === "data"
      ? { dataHash: r.data_hash, sellerKeyWrap: r.seller_key_wrap }
      : null,
  }));
}

/** The seller's wallet has taken the payment into its balance. */
export async function markClaimed(sellerId: string, bidId: string) {
  const rows = await sql`
    UPDATE buy_offers b SET internalized_at = now() FROM sell_offers s
    WHERE b.id = ${bidId} AND s.id = b.sell_offer_id AND s.seller_id = ${sellerId}
      AND b.payment_seen_at IS NOT NULL
    RETURNING b.id`;
  return rows.length > 0;
}

/** Stores the data key, encrypted by the seller's wallet for this buyer (BRC-2). */
export async function deliverKey(sellerId: string, bidId: string, wrappedKey: unknown) {
  if (!isHex(wrappedKey, 1024)) return fail(400, "wrappedKey must be hex");
  const rows = await sql`
    UPDATE buy_offers b SET status = 'delivered', wrapped_key = ${wrappedKey.toLowerCase()},
      delivered_at = now(), delivery_attempts = b.delivery_attempts + 1
    FROM sell_offers s
    WHERE b.id = ${bidId} AND s.id = b.sell_offer_id AND s.seller_id = ${sellerId} AND s.kind = 'data'
      AND b.status = 'paid' AND b.payment_seen_at IS NOT NULL
    RETURNING b.id`;
  return rows.length > 0 ? { ok: true } : fail(409, "This bid is not waiting for delivery");
}

// ---------- Buyer side ----------

/** What the buyer needs to decrypt: their wrapped key and who wrapped it. */
export async function delivery(buyerId: string, bidId: string) {
  const bid = await loadBid(bidId);
  if (!bid || bid.buyer_id !== buyerId) return fail(404, "Not found");
  if (!["delivered", "received"].includes(bid.status)) return fail(409, "The key has not been delivered yet");
  return {
    offerId: bid.sell_offer_id as string,
    seller: bid.seller_key as string,
    dataHash: bid.data_hash as string,
    wrappedKey: bid.wrapped_key as string,
  };
}

/**
 * The buyer reports whether decryption worked. A failure sends the bid back to the seller
 * for another delivery; after MAX_DELIVERY_ATTEMPTS it is marked disputed.
 */
export async function confirmReceipt(buyerId: string, bidId: string, ok: unknown, reason: unknown) {
  const bid = await loadBid(bidId);
  if (!bid || bid.buyer_id !== buyerId) return fail(404, "Not found");
  if (bid.status === "received" && ok === true) return { status: "received" };
  const waiting = bid.status === "delivered" || (bid.status === "paid" && bid.kind !== "data" && bid.payment_seen_at);
  if (!waiting) return fail(409, "Nothing to confirm for this bid");

  const why = typeof reason === "string" ? reason.slice(0, 500) : null;
  const status = ok === true ? "received"
    : bid.kind === "data" && bid.delivery_attempts < MAX_DELIVERY_ATTEMPTS ? "paid"
    : "disputed";
  await sql`
    UPDATE buy_offers SET status = ${status},
      received_at = ${status === "received" ? new Date() : null},
      wrapped_key = ${status === "paid" ? null : bid.wrapped_key},
      dispute_reason = ${ok === true ? null : why}
    WHERE id = ${bidId} AND status = ${bid.status}`;
  return { status };
}
