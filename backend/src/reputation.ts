import { sql } from "./db.ts";

// A seller's reputation, 0 to MAX_REPUTATION: how reliably they hand over what they sold.
// A sold offer adds one when a buyer confirms receipt; a buyer reporting that the seller did
// not hand it over halves it, rounded down. Each offer counts once either way, so several
// buyers of one offer neither multiply the reward nor the penalty, and a reported offer earns
// nothing afterwards.
export const MAX_REPUTATION = 10;
const MAX_REASON_LENGTH = 500;

// Bid states in which the buyer has paid but not confirmed receipt, so they can report.
const REPORTABLE_STATES = ["paid", "delivered", "disputed"];

type Failure = { error: string; status: number };
const fail = (status: number, error: string): Failure => ({ error, status });

/** Called once a buyer confirms receipt: the offer's seller gains a point, once per offer. */
export async function rewardSale(offerId: string) {
  await sql.begin(async (tx) => {
    const [offer] = await tx`
      UPDATE sell_offers SET reputation_awarded_at = now()
      WHERE id = ${offerId} AND reputation_awarded_at IS NULL AND reported_at IS NULL
      RETURNING seller_id`;
    if (offer) {
      await tx`UPDATE users SET reputation = LEAST(${MAX_REPUTATION}, reputation + 1) WHERE id = ${offer.seller_id}`;
    }
  });
}

/**
 * A paying buyer reports that the seller did not hand over what they sold. The bid is marked
 * disputed with the reason, and the seller's reputation halves, the first time for this offer.
 */
export async function reportSeller(buyerId: string, bidId: string, reason: unknown) {
  const why = typeof reason === "string" ? reason.trim().slice(0, MAX_REASON_LENGTH) : "";
  if (!why) return fail(400, "Say what went wrong");
  return sql.begin(async (tx) => {
    const [bid] = await tx`
      SELECT b.buyer_id, b.status, b.reported_at, b.sell_offer_id, s.seller_id, s.payment_seen_at, s.reported_at AS offer_reported_at
      FROM buy_offers b JOIN sell_offers s ON s.id = b.sell_offer_id
      WHERE b.id = ${bidId}
      FOR UPDATE OF b, s`;
    if (!bid || bid.buyer_id !== buyerId) return fail(404, "Not found");
    if (bid.reported_at) return fail(409, "You have already reported this seller for this offer");
    if (!REPORTABLE_STATES.includes(bid.status) || !bid.payment_seen_at) {
      return fail(409, "Only a buyer who paid and has not confirmed receipt can report the seller");
    }
    await tx`
      UPDATE buy_offers SET status = 'disputed', dispute_reason = ${why}, reported_at = now()
      WHERE id = ${bidId}`;
    if (!bid.offer_reported_at) {
      await tx`UPDATE sell_offers SET reported_at = now() WHERE id = ${bid.sell_offer_id}`;
      await tx`UPDATE users SET reputation = reputation / 2 WHERE id = ${bid.seller_id}`;
    }
    return { status: "disputed" };
  });
}
