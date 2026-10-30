import { sql } from "./db.ts";
import { IMAGE_TYPES, PAID_STATES, person } from "./profiles.ts";

// Once an offer is sold, its seller and the buyers who paid chat on the offer's page,
// e.g. to arrange a service or a product's shipping. Everybody in the chat sees all of it.

export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const PAGE_SIZE = 200;

const fail = (status: number, error: string) => ({ error, status });

/** Whether the user is the seller or a paying buyer of a sold offer. */
async function inChat(userId: string, offerId: string) {
  const [row] = await sql`
    SELECT 1 FROM sell_offers s
    WHERE s.id = ${offerId} AND s.status = 'sold' AND s.payment_txid IS NOT NULL
      AND (s.seller_id = ${userId} OR EXISTS (
        SELECT 1 FROM buy_offers b
        WHERE b.sell_offer_id = s.id AND b.buyer_id = ${userId} AND b.status = ANY(${PAID_STATES})))`;
  return !!row;
}

const toMessage = (row: any, userId: string) => ({
  id: row.id,
  sender: person(row.identity_key, row.display_name, row.avatar_updated_at),
  mine: row.sender_id === userId,
  text: row.body,
  imageUrl: row.has_image ? `/api/messages/${row.id}/image` : null,
  createdAt: new Date(row.created_at).toISOString(),
});

/** The chat of an offer, oldest first; with `after`, only the messages since then. */
export async function listMessages(userId: string, offerId: string, after: string | null) {
  if (!(await inChat(userId, offerId))) return fail(403, "Only the seller and the buyers of a sold offer can chat");
  const since = after && !Number.isNaN(Date.parse(after)) ? new Date(after) : null;
  const rows = await sql`
    SELECT * FROM (
      SELECT m.id, m.sender_id, m.body, m.image IS NOT NULL AS has_image, m.created_at,
        u.identity_key, u.display_name, u.avatar_updated_at
      FROM messages m JOIN users u ON u.id = m.sender_id
      WHERE m.offer_id = ${offerId} AND (${since}::timestamptz IS NULL OR m.created_at > ${since})
      ORDER BY m.created_at DESC
      LIMIT ${PAGE_SIZE}
    ) recent ORDER BY created_at`;
  return { messages: rows.map((row: any) => toMessage(row, userId)) };
}

/** Posts a message with text, an image, or both. */
export async function postMessage(userId: string, offerId: string, form: { get(name: string): unknown }) {
  if (!(await inChat(userId, offerId))) return fail(403, "Only the seller and the buyers of a sold offer can chat");
  const textField = form.get("text");
  const body = typeof textField === "string" ? textField.trim() : "";
  if (body.length > MAX_MESSAGE_LENGTH) return fail(400, `Message must be at most ${MAX_MESSAGE_LENGTH} characters`);

  const file = form.get("image");
  let image: Uint8Array | null = null;
  let type: string | null = null;
  if (file instanceof Blob && file.size > 0) {
    if (file.size > MAX_IMAGE_BYTES) return fail(413, "Image too large");
    type = file.type.split(";")[0]!.trim().toLowerCase();
    const matches = IMAGE_TYPES[type];
    if (!matches) return fail(415, `Image must be one of ${Object.keys(IMAGE_TYPES).join(", ")}`);
    image = new Uint8Array(await file.arrayBuffer());
    if (!matches(image)) return fail(415, `This is not a ${type} file`);
  }
  if (!body && !image) return fail(400, "Write a message or attach an image");

  const [row] = await sql`
    WITH m AS (
      INSERT INTO messages (offer_id, sender_id, body, image, image_type)
      VALUES (${offerId}, ${userId}, ${body}, ${image}, ${type})
      RETURNING id, sender_id, body, image IS NOT NULL AS has_image, created_at
    )
    SELECT m.*, u.identity_key, u.display_name, u.avatar_updated_at FROM m JOIN users u ON u.id = m.sender_id`;
  return { message: toMessage(row, userId) };
}

/** The image of a message, for the people in its chat only. */
export async function messageImage(userId: string, messageId: string) {
  const [row] = await sql`SELECT offer_id, image, image_type FROM messages WHERE id = ${messageId} AND image IS NOT NULL`;
  if (!row || !(await inChat(userId, row.offer_id))) return null;
  return { bytes: row.image as Uint8Array, type: row.image_type as string };
}
