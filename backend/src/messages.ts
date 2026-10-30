import { sql } from "./db.ts";
import { IMAGE_TYPES, PAID_STATES, person } from "./profiles.ts";

// Once an offer is sold, its seller and the buyers who paid chat on the offer's page,
// e.g. to arrange a service or a product's shipping. Everybody in the chat sees all of it.
// The seller can also upload files with the information the buyers need.
// Open pages follow the chat over server-sent events, so a new message or file shows at once.

export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 20;
const PAGE_SIZE = 200;

const fail = (status: number, error: string) => ({ error, status });
const notInChat = () => fail(403, "Only the seller and the buyers of a sold offer can chat");

/** Whether the user is the seller or a paying buyer of a sold offer. */
export async function inChat(userId: string, offerId: string) {
  const [row] = await sql`
    SELECT 1 FROM sell_offers s
    WHERE s.id = ${offerId} AND s.status = 'sold' AND s.payment_txid IS NOT NULL
      AND (s.seller_id = ${userId} OR EXISTS (
        SELECT 1 FROM buy_offers b
        WHERE b.sell_offer_id = s.id AND b.buyer_id = ${userId} AND b.status = ANY(${PAID_STATES})))`;
  return !!row;
}

// ---------- Live updates ----------

type Listener = { userId: string; send: (event: string, data: unknown) => void };
const listeners = new Map<string, Set<Listener>>();

/** Follows an offer's chat; returns the function that stops it. */
export function subscribe(offerId: string, listener: Listener) {
  let set = listeners.get(offerId);
  if (!set) listeners.set(offerId, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (!set.size) listeners.delete(offerId);
  };
}

/** Sends an event to everybody following the offer, shaped for each of them. */
function publish(offerId: string, event: string, data: (userId: string) => unknown) {
  for (const l of listeners.get(offerId) ?? []) l.send(event, data(l.userId));
}

// ---------- Messages ----------

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
  if (!(await inChat(userId, offerId))) return notInChat();
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
  if (!(await inChat(userId, offerId))) return notInChat();
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
  publish(offerId, "message", (viewerId) => toMessage(row, viewerId));
  return { message: toMessage(row, userId) };
}

/** The image of a message, for the people in its chat only. */
export async function messageImage(userId: string, messageId: string) {
  const [row] = await sql`SELECT offer_id, image, image_type FROM messages WHERE id = ${messageId} AND image IS NOT NULL`;
  if (!row || !(await inChat(userId, row.offer_id))) return null;
  return { bytes: row.image as Uint8Array, type: row.image_type as string };
}

// ---------- Files from the seller ----------

/** The files the seller uploaded for a sold offer, oldest first. */
export async function listFiles(userId: string, offerId: string) {
  if (!(await inChat(userId, offerId))) return notInChat();
  const rows = await sql`
    SELECT id, name, size, created_at FROM deal_files WHERE offer_id = ${offerId} ORDER BY created_at`;
  return {
    files: rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      size: row.size,
      url: `/api/deal-files/${row.id}`,
      createdAt: new Date(row.created_at).toISOString(),
    })),
  };
}

/** The seller of a sold offer uploads a file for its buyers. */
export async function uploadFile(userId: string, offerId: string, bytes: Uint8Array, name: string) {
  const [offer] = await sql`
    SELECT 1 FROM sell_offers
    WHERE id = ${offerId} AND seller_id = ${userId} AND status = 'sold' AND payment_txid IS NOT NULL`;
  if (!offer) return fail(403, "Only the seller of a sold offer can upload files");
  if (bytes.length === 0) return fail(400, "Empty file");
  if (bytes.length > MAX_FILE_BYTES) return fail(413, "File too large");
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM deal_files WHERE offer_id = ${offerId}`;
  if (count >= MAX_FILES) return fail(409, `At most ${MAX_FILES} files per offer`);
  const fileName = name.trim().replace(/[\\/\x00-\x1f]/g, "_").slice(0, 200) || "file";
  const [row] = await sql`
    INSERT INTO deal_files (offer_id, uploader_id, name, size, bytes)
    VALUES (${offerId}, ${userId}, ${fileName}, ${bytes.length}, ${bytes})
    RETURNING id`;
  publish(offerId, "files", () => ({}));
  return { id: row.id as string };
}

/** The seller removes one of their files. */
export async function deleteFile(userId: string, fileId: string) {
  const [row] = await sql`
    DELETE FROM deal_files f USING sell_offers s
    WHERE f.id = ${fileId} AND s.id = f.offer_id AND s.seller_id = ${userId}
    RETURNING f.offer_id`;
  if (!row) return fail(404, "No file of yours to delete");
  publish(row.offer_id, "files", () => ({}));
  return { ok: true };
}

/** A file of a sold offer, for the people in its chat only. */
export async function dealFile(userId: string, fileId: string) {
  const [row] = await sql`SELECT offer_id, name, bytes FROM deal_files WHERE id = ${fileId}`;
  if (!row || !(await inChat(userId, row.offer_id))) return null;
  return { bytes: row.bytes as Uint8Array, name: row.name as string };
}
