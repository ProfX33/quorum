import { Transaction, Utils } from "@bsv/sdk";
import { sql } from "./db.ts";
import { paymentWindowEnd } from "./market.ts";
import {
  ANYONE_KEY,
  PLEDGE_FEE,
  broadcast,
  groupOutputs,
  groupTransaction,
  networkStatus,
  parsePledge,
  parseRefund,
  spentBy,
  txUrl,
} from "./payments.ts";
import { rewardSale } from "./reputation.ts";
import { denominations, findPaymentGroup, pickDenominations } from "./settlement.ts";

// The payment group pays the seller in one transaction, so the seller is paid the full price
// or nothing, and no buyer gets the data unless the seller is paid.
// A bid is paid for up front: the buyer pledges their maximum, in outputs locked to their
// own wallet key and signed with ALL|ANYONECANPAY for the group outputs (see payments.ts).
// At the deadline the group is formed from pledged money only, so no member has anything
// left to do: the server combines their pledges into the group payment and broadcasts it
// through Arcade. When the network has seen it, the seller's wallet (browser or agent)
// claims the payment and wraps the data key for each buyer.
// A pledge stays in the buyer's control, so a member can still spend it elsewhere. The network
// then rejects the payment, and that member is dropped and the others are regrouped at once
// from what they have already pledged, or the offer fails. Pledges that end up unused stay
// the buyer's: they take them back with a refund their own wallet signs.

export const MAX_DATA_BYTES = Number(process.env.MAX_DATA_MB ?? 20) * 1024 * 1024;
const MAX_BEEF_BYTES = 1024 * 1024;
const MAX_UNLISTED_FILES = 20;
const MAX_DELIVERY_ATTEMPTS = 3;
// A group payment the network keeps rejecting without any pledge being spent elsewhere
// (so nobody to drop) fails the offer after this many attempts.
const MAX_PAYMENT_REJECTIONS = 3;
// The seller output comes first in groupOutputs.
const SELLER_OUTPUT = 0;

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

// ---------- Pledges ----------

async function loadBid(bidId: string) {
  const [bid] = await sql`
    SELECT b.*, s.kind, s.price, s.data_hash, s.seller_key_wrap, s.payment_deadline, s.seller_id,
      s.status AS offer_status, s.deadline AS offer_deadline,
      s.payment_prefix AS group_prefix, s.payment_suffix AS group_suffix, s.payment_seen_at AS group_seen_at,
      u.identity_key AS seller_key, bu.identity_key AS buyer_key,
      EXISTS (SELECT 1 FROM data_files f WHERE f.hash = s.data_hash) AS has_data,
      COALESCE((SELECT sum(p.satoshis - ${PLEDGE_FEE}) FROM pledges p
                WHERE p.bid_id = b.id AND p.status IN ('active', 'used')), 0) AS credited,
      (SELECT count(*) FROM pledges p WHERE p.bid_id = b.id)::int AS pledge_count
    FROM buy_offers b
    JOIN sell_offers s ON s.id = b.sell_offer_id
    JOIN users u ON u.id = s.seller_id
    JOIN users bu ON bu.id = b.buyer_id
    WHERE b.id = ${bidId}`;
  return bid as any;
}

const outputsOf = (bid: any) =>
  groupOutputs(bid.seller_key, bid.group_prefix, bid.group_suffix, bid.sell_offer_id, Number(bid.price));

/**
 * What the buyer's wallet needs to fund an open bid: the outputs to create (the unpledged
 * rest of their maximum in denominations, each with its fee contribution), the key to lock
 * them to, and the group outputs to sign. Raising a maximum pledges the difference.
 */
export async function paymentRequest(buyerId: string, bidId: string) {
  const bid = await loadBid(bidId);
  if (!bid || bid.buyer_id !== buyerId) return fail(404, "Not found");
  if (bid.status !== "open" || bid.offer_status !== "open" || new Date(bid.offer_deadline) <= new Date()) {
    return fail(409, "Bidding has closed, there is nothing to pledge for this bid");
  }
  if (bid.kind === "data" && (!bid.has_data || !bid.seller_key_wrap)) {
    return fail(409, "The seller never uploaded the data, so this offer cannot be paid");
  }
  const amount = Number(bid.max_price);
  const pledged = Number(bid.credited);
  const due = amount - pledged;
  if (due <= 0) return fail(409, "Your bid is fully pledged already");
  return {
    amount,
    pledged,
    due,
    fee: PLEDGE_FEE,
    outputs: denominations(due).map((v) => v + PLEDGE_FEE),
    keyID: `${bid.id} ${bid.pledge_count}`,
    deadline: new Date(bid.offer_deadline).toISOString(),
    description: "Data market pledge",
    // The buyer's wallet re-derives the seller output from these before signing.
    offerId: bid.sell_offer_id as string,
    price: Number(bid.price),
    seller: bid.seller_key as string,
    derivationPrefix: bid.group_prefix as string,
    derivationSuffix: bid.group_suffix as string,
    groupOutputs: await outputsOf(bid),
  };
}

/**
 * Accepts a pledge: { beef (AtomicBEEF hex of the pledge transaction), pledges (the
 * { vout, unlockingScript } of each output), keyID }. It is verified, broadcast and recorded.
 * A pledge arriving after bidding closed is recorded too, so it can be refunded. Idempotent.
 */
export async function submitPledge(buyerId: string, bidId: string, body: Record<string, unknown>) {
  const { beef, pledges, keyID } = body;
  if (!isHex(beef, MAX_BEEF_BYTES)) return fail(400, "beef must be the hex AtomicBEEF of the pledge transaction");
  if (!Array.isArray(pledges) || !pledges.every((p) => isHex(p?.unlockingScript, 1024))) {
    return fail(400, "pledges must list { vout, unlockingScript } with the script in hex");
  }
  if (typeof keyID !== "string" || !keyID || keyID.length > 200) return fail(400, "keyID of the pledge key is required");
  const bid = await loadBid(bidId);
  if (!bid || bid.buyer_id !== buyerId) return fail(404, "Not found");
  if (!bid.group_prefix) return fail(409, "This bid has no group payment");

  const bytes = Utils.toArray(beef, "hex");
  const pledge = await parsePledge(bytes, pledges, await outputsOf(bid));
  if ("error" in pledge) return fail(400, pledge.error!);

  const [known] = await sql`SELECT bid_id FROM pledges WHERE txid = ${pledge.txid} LIMIT 1`;
  if (known && known.bid_id !== bidId) return fail(409, "This pledge belongs to another bid");
  if (!known) {
    let network;
    try {
      network = await broadcast(pledge.tx);
    } catch (e) {
      console.error("Pledge broadcast failed", e);
      return fail(502, "Could not reach the network, please retry (your pledge is safe to resubmit)");
    }
    if (network.state === "rejected") return fail(400, `The network rejected the pledge: ${network.reason}`);
    await sql.begin(async (tx) => {
      for (const o of pledge.outputs) {
        await tx`
          INSERT INTO pledges (bid_id, txid, vout, satoshis, key_id, beef, unlocking_script)
          VALUES (${bidId}, ${pledge.txid}, ${o.vout}, ${o.satoshis}, ${keyID}, ${Buffer.from(bytes)}, ${o.unlockingScript})
          ON CONFLICT (txid, vout) DO NOTHING`;
      }
    });
  }

  const now = await loadBid(bidId);
  if (!["open", "pledged", "paid"].includes(now.status)) {
    return fail(409, "This bid is out of the running. Your pledge is recorded and you can take it back.");
  }
  return { status: now.status as string, pledged: Number(now.credited), amount: Number(now.amount ?? now.max_price) };
}

// ---------- The group payment ----------

/**
 * Builds the group payment and broadcasts it. Per member, exactly the pledge outputs that add
 * up to the share are used; the others stay refundable. A member whose outputs cannot make
 * up the share is dropped and the group formed again.
 */
async function assembleGroupPayment(offerId: string): Promise<void> {
  let regrouped = false;
  const payment = await sql.begin(async (tx) => {
    const [offer] = await tx`
      SELECT s.price, s.payment_prefix, s.payment_suffix, u.identity_key AS seller_key
      FROM sell_offers s JOIN users u ON u.id = s.seller_id
      WHERE s.id = ${offerId} AND s.status = 'sold' AND s.payment_txid IS NULL
      FOR UPDATE OF s`;
    if (!offer) return null;
    const members = await tx`
      SELECT id, amount FROM buy_offers WHERE sell_offer_id = ${offerId} AND status = 'pledged'`;
    if (members.length === 0) return null;

    const pledges = await tx`
      SELECT p.id, p.bid_id, p.vout, p.satoshis, p.beef, p.unlocking_script FROM pledges p
      JOIN buy_offers b ON b.id = p.bid_id
      WHERE b.sell_offer_id = ${offerId} AND b.status = 'pledged' AND p.status = 'active'
      ORDER BY p.created_at, p.vout`;
    const use: any[] = [];
    const short: string[] = [];
    for (const m of members) {
      const mine = pledges.filter((p: any) => p.bid_id === m.id);
      const picked = pickDenominations(mine.map((p: any) => Number(p.satoshis) - PLEDGE_FEE), Number(m.amount));
      if (picked) use.push(...picked.map((i) => mine[i]));
      else short.push(m.id);
    }
    if (short.length > 0) {
      await tx`UPDATE buy_offers SET status = 'defaulted' WHERE id::text = ANY(${short})`;
      await regroup(tx, offerId);
      regrouped = true;
      return null;
    }

    const outputs = await groupOutputs(offer.seller_key, offer.payment_prefix, offer.payment_suffix, offerId, Number(offer.price));
    let payment: Transaction, beef: number[];
    try {
      payment = groupTransaction(outputs, use.map((p: any) => ({
        sourceTransaction: Transaction.fromAtomicBEEF(Array.from(p.beef as Uint8Array)),
        vout: p.vout,
        unlockingScript: p.unlocking_script,
      })));
      beef = payment.toAtomicBEEF();
    } catch (e) {
      console.error(`Could not build the group payment of offer ${offerId}`, e);
      return null;
    }
    await tx`UPDATE pledges SET status = 'used' WHERE id::text = ANY(${use.map((p: any) => p.id)})`;
    await tx`UPDATE buy_offers SET status = 'paid' WHERE sell_offer_id = ${offerId} AND status = 'pledged'`;
    await tx`
      UPDATE sell_offers SET payment_txid = ${payment.id("hex")}, payment_beef = ${Buffer.from(beef)},
        paid_at = now(), payment_checked_at = NULL
      WHERE id = ${offerId}`;
    return payment;
  });
  if (regrouped) return assembleGroupPayment(offerId);
  if (!payment) return;
  // Recorded first, so nothing is lost if this fails; checkPayments follows it from here.
  try {
    const network = await broadcast(payment);
    if (network.state === "seen") await sql`UPDATE sell_offers SET payment_seen_at = now() WHERE id = ${offerId}`;
  } catch (e) {
    console.error(`Broadcasting the group payment of offer ${offerId} failed`, e);
  }
}

/** Ends an offer whose group cannot pay; every member's pledges become refundable. */
async function failOffer(tx: typeof sql, offerId: string) {
  await tx`UPDATE buy_offers SET status = 'lost' WHERE sell_offer_id = ${offerId} AND status IN ('won', 'pledged', 'paid')`;
  await tx`UPDATE sell_offers SET status = 'unsold' WHERE id = ${offerId}`;
}

/**
 * Forms the group again from the members left, on what they have pledged and not spent:
 * the price is split over those who can cover the larger share. No one has to act. When
 * nobody can, the offer fails.
 */
async function regroup(tx: typeof sql, offerId: string) {
  const [offer] = await tx`SELECT price FROM sell_offers WHERE id = ${offerId}`;
  const rest = await tx`
    SELECT b.id, LEAST(b.max_price, COALESCE((SELECT sum(p.satoshis - ${PLEDGE_FEE}) FROM pledges p
                         WHERE p.bid_id = b.id AND p.status = 'active'), 0)) AS funded
    FROM buy_offers b WHERE b.sell_offer_id = ${offerId} AND b.status = 'pledged' ORDER BY b.created_at`;
  const group = findPaymentGroup(Number(offer.price), rest.map((b: any) => ({ id: b.id, maxPrice: Number(b.funded) })));
  if (!group) return failOffer(tx, offerId);
  const shares = new Map(group.map((p) => [p.id, p.amount]));
  for (const b of rest) {
    const amount = shares.get(b.id);
    await tx`
      UPDATE buy_offers SET amount = COALESCE(${amount ?? null}, amount), status = ${amount === undefined ? "lost" : "pledged"}
      WHERE id = ${b.id}`;
  }
  await tx`UPDATE sell_offers SET payment_deadline = ${paymentWindowEnd()} WHERE id = ${offerId}`;
}

/**
 * The network rejected the group payment, usually because a buyer spent their pledge
 * elsewhere. That buyer is dropped and the group is formed again from everybody else's
 * pledges, which stay in place.
 */
async function undoGroupPayment(offerId: string, txid: string, reason: string) {
  const used = await sql`
    SELECT p.id, p.txid, p.vout FROM pledges p JOIN buy_offers b ON b.id = p.bid_id
    WHERE b.sell_offer_id = ${offerId} AND p.status = 'used'`;
  const spent: string[] = [];
  for (const p of used) {
    const own = await networkStatus(p.txid);
    const by = own.state === "rejected" ? null : await spentBy(p.txid, p.vout);
    if (own.state === "rejected" || (by && by !== txid)) spent.push(p.id);
  }
  const collapsed = await sql.begin(async (tx) => {
    const [offer] = await tx`
      SELECT payment_rejections FROM sell_offers
      WHERE id = ${offerId} AND payment_txid = ${txid} AND payment_seen_at IS NULL FOR UPDATE`;
    if (!offer) return false;
    await tx`
      UPDATE pledges SET status = CASE WHEN id::text = ANY(${spent}) THEN 'spent' ELSE 'active' END
      WHERE status = 'used' AND bid_id IN (SELECT id FROM buy_offers WHERE sell_offer_id = ${offerId})`;
    const rejections = offer.payment_rejections + 1;
    await tx`
      UPDATE sell_offers SET payment_txid = NULL, payment_beef = NULL, paid_at = NULL, payment_checked_at = NULL,
        payment_error = ${`Group payment ${txid} was rejected: ${reason}`}, payment_rejections = ${rejections},
        payment_deadline = GREATEST(payment_deadline, ${paymentWindowEnd()})
      WHERE id = ${offerId}`;
    if (spent.length === 0 && rejections >= MAX_PAYMENT_REJECTIONS) {
      await failOffer(tx, offerId);
      return true;
    }
    await tx`
      UPDATE buy_offers b SET status = CASE WHEN EXISTS (
          SELECT 1 FROM pledges p WHERE p.bid_id = b.id AND p.status = 'spent') THEN 'defaulted' ELSE 'pledged' END
      WHERE b.sell_offer_id = ${offerId} AND b.status = 'paid'`;
    await regroup(tx, offerId);
    return false;
  });
  if (!collapsed) await assembleGroupPayment(offerId);
}

let checking = false;

/**
 * Follows group payments until the network has seen them. An unknown one is re-broadcast;
 * a rejected one is undone (see undoGroupPayment).
 */
export async function checkPayments() {
  if (checking) return;
  checking = true;
  try {
    const rows = await sql`
      SELECT id, payment_txid, payment_beef FROM sell_offers
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
          await sql`UPDATE sell_offers SET payment_seen_at = now(), payment_checked_at = now() WHERE id = ${row.id}`;
        } else if (network.state === "rejected") {
          await undoGroupPayment(row.id, row.payment_txid, network.reason ?? "unknown reason");
        } else {
          await sql`UPDATE sell_offers SET payment_checked_at = now() WHERE id = ${row.id}`;
        }
      } catch (e) {
        console.error(`Checking group payment ${row.payment_txid} failed`, e);
      }
    }
  } finally {
    checking = false;
  }
}

/**
 * Builds the group payment of settled offers. One that cannot be built before its window
 * closes fails, so that a stuck offer never keeps its buyers from their pledges. Also
 * removes uploads never listed within a day.
 */
export async function expireDue() {
  const due = await sql`
    SELECT s.id, s.payment_deadline <= now() AS closed FROM sell_offers s
    WHERE s.status = 'sold' AND s.payment_txid IS NULL
      AND EXISTS (SELECT 1 FROM buy_offers b WHERE b.sell_offer_id = s.id AND b.status = 'pledged')`;
  for (const { id, closed } of due) {
    await assembleGroupPayment(id);
    if (closed) {
      await sql.begin(async (tx) => {
        const [offer] = await tx`
          SELECT id FROM sell_offers WHERE id = ${id} AND status = 'sold' AND payment_txid IS NULL FOR UPDATE`;
        if (offer) await failOffer(tx, id);
      });
    }
  }
  await sql`
    DELETE FROM data_files f
    WHERE f.created_at < now() - interval '1 day'
      AND NOT EXISTS (SELECT 1 FROM sell_offers s WHERE s.data_hash = f.hash)`;
}

// ---------- Refunds ----------

const inGroup = (status: string) => ["open", "won", "pledged"].includes(status);

/** The buyer's unused pledges, for their wallet to sign a refund (only once out of the group). */
export async function refundRequest(buyerId: string, bidId: string) {
  const bid = await loadBid(bidId);
  if (!bid || bid.buyer_id !== buyerId) return fail(404, "Not found");
  if (inGroup(bid.status)) return fail(409, "Your pledge still backs your bid; withdraw the bid to take it back");
  const pledges = await sql`
    SELECT txid, vout, satoshis, key_id, beef FROM pledges WHERE bid_id = ${bidId} AND status = 'active'
    ORDER BY created_at`;
  if (pledges.length === 0) return fail(409, "There is nothing to refund");
  return {
    // The refund pays the fee contribution of each pledge to the miners.
    fee: PLEDGE_FEE * pledges.length,
    pledges: pledges.map((p: any) => ({
      txid: p.txid, vout: p.vout, satoshis: Number(p.satoshis), keyID: p.key_id, beef: hex(p.beef),
    })),
  };
}

/** Broadcasts a refund the buyer's wallet signed; it may only spend their unused pledges. */
export async function submitRefund(buyerId: string, bidId: string, beefHex: unknown) {
  if (!isHex(beefHex, MAX_BEEF_BYTES)) return fail(400, "beef must be the hex AtomicBEEF of the refund");
  const bid = await loadBid(bidId);
  if (!bid || bid.buyer_id !== buyerId) return fail(404, "Not found");
  if (inGroup(bid.status)) return fail(409, "Your pledge still backs your bid; withdraw the bid to take it back");
  const pledges = await sql`SELECT txid, vout, status, refund_txid FROM pledges WHERE bid_id = ${bidId}`;
  const refund = await parseRefund(
    Utils.toArray(beefHex, "hex"),
    new Set(pledges.filter((p: any) => ["active", "refunded"].includes(p.status)).map((p: any) => `${p.txid}:${p.vout}`)),
  );
  if ("error" in refund) return fail(400, refund.error!);
  const spent = pledges.filter((p: any) => refund.spends.includes(`${p.txid}:${p.vout}`));
  if (spent.every((p: any) => p.status === "refunded" && p.refund_txid === refund.txid)) {
    return { txid: refund.txid, txUrl: txUrl(refund.txid) };
  }
  if (spent.some((p: any) => p.status !== "active")) return fail(409, "Some of these pledges were refunded already");
  // All at once: what is left of a pledge might not make up a share exactly any more.
  if (spent.length !== pledges.filter((p: any) => p.status === "active").length) {
    return fail(400, "A refund must take back all your unused pledges");
  }

  let network;
  try {
    network = await broadcast(refund.tx);
  } catch (e) {
    console.error("Refund broadcast failed", e);
    return fail(502, "Could not reach the network, please retry (your refund is safe to resubmit)");
  }
  if (network.state === "rejected") return fail(400, `The network rejected the refund: ${network.reason}`);
  await sql`
    UPDATE pledges SET status = 'refunded', refund_txid = ${refund.txid}, refunded_at = now()
    WHERE bid_id = ${bidId} AND status = 'active' AND (txid || ':' || vout) = ANY(${refund.spends})`;
  return { txid: refund.txid, txUrl: txUrl(refund.txid) };
}

// ---------- Seller side ----------

/**
 * Work for the seller's wallet: group payments to claim (internalizeAction) and data keys
 * to wrap for the buyers of offers whose payment the network has seen.
 */
export async function sellerTasks(sellerId: string) {
  const claims = await sql`
    SELECT s.id, s.name, s.price, s.payment_txid, s.payment_beef, s.payment_prefix, s.payment_suffix
    FROM sell_offers s
    WHERE s.seller_id = ${sellerId} AND s.payment_seen_at IS NOT NULL AND s.internalized_at IS NULL
    ORDER BY s.paid_at LIMIT 20`;
  const deliveries = await sql`
    SELECT b.id, b.sell_offer_id, s.name, s.data_hash, s.seller_key_wrap, bu.identity_key AS buyer_key
    FROM buy_offers b
    JOIN sell_offers s ON s.id = b.sell_offer_id
    JOIN users bu ON bu.id = b.buyer_id
    WHERE s.seller_id = ${sellerId} AND s.kind = 'data' AND s.payment_seen_at IS NOT NULL AND b.status = 'paid'
    ORDER BY s.paid_at LIMIT 50`;
  return [
    ...claims.map((r: any) => ({
      offerId: r.id,
      offerName: r.name,
      amount: Number(r.price),
      txid: r.payment_txid,
      claim: {
        beef: hex(r.payment_beef),
        outputIndex: SELLER_OUTPUT,
        derivationPrefix: r.payment_prefix,
        derivationSuffix: r.payment_suffix,
        senderIdentityKey: ANYONE_KEY,
      },
      deliver: null,
    })),
    ...deliveries.map((r: any) => ({
      bidId: r.id,
      offerId: r.sell_offer_id,
      offerName: r.name,
      buyer: r.buyer_key,
      claim: null,
      deliver: { dataHash: r.data_hash, sellerKeyWrap: r.seller_key_wrap },
    })),
  ];
}

/** The seller's wallet has taken the group payment into its balance. */
export async function markClaimed(sellerId: string, offerId: string) {
  const rows = await sql`
    UPDATE sell_offers SET internalized_at = now()
    WHERE id = ${offerId} AND seller_id = ${sellerId} AND payment_seen_at IS NOT NULL
    RETURNING id`;
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
      AND b.status = 'paid' AND s.payment_seen_at IS NOT NULL
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
  const waiting = bid.status === "delivered" || (bid.status === "paid" && bid.kind !== "data" && bid.group_seen_at);
  if (!waiting) return fail(409, "Nothing to confirm for this bid");

  const why = typeof reason === "string" ? reason.slice(0, 500) : null;
  const status = ok === true ? "received"
    : bid.kind === "data" && bid.delivery_attempts < MAX_DELIVERY_ATTEMPTS ? "paid"
    : "disputed";
  const updated = await sql`
    UPDATE buy_offers SET status = ${status},
      received_at = ${status === "received" ? new Date() : null},
      wrapped_key = ${status === "paid" ? null : bid.wrapped_key},
      dispute_reason = ${ok === true ? null : why}
    WHERE id = ${bidId} AND status = ${bid.status}
    RETURNING id`;
  if (status === "received" && updated.length > 0) await rewardSale(bid.sell_offer_id);
  return { status };
}
