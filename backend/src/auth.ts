import { ProtoWallet, PublicKey } from "@bsv/sdk";
import { sql } from "./db.ts";
import { avatarUrl } from "./profiles.ts";

// Wallet and agent sign with the same BRC-43 protocol, counterparty "anyone",
// so the server can verify against the user's identity key alone.
export const AUTH_PROTOCOL: [2, string] = [2, "tum hackathon login"];
export const AUTH_KEY_ID = "1";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const verifier = new ProtoWallet("anyone");

export type User = {
  id: string;
  identityKey: string;
  kind: "human" | "agent";
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
};

export const loginMessage = (identityKey: string, nonce: string) =>
  `TUM Blockchain Hackathon login\nidentity: ${identityKey}\nnonce: ${nonce}`;

const sha256Hex = async (s: string) =>
  new Bun.CryptoHasher("sha256").update(s).digest("hex");

export const isIdentityKey = (k: unknown): k is string => {
  if (typeof k !== "string" || !/^0[23][0-9a-f]{64}$/i.test(k)) return false;
  try {
    PublicKey.fromString(k);
    return true;
  } catch {
    return false;
  }
};

export async function createChallenge(identityKey: string) {
  const nonce = crypto.randomUUID() + crypto.randomUUID().replaceAll("-", "");
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
  await sql`DELETE FROM login_challenges WHERE expires_at < now()`;
  await sql`INSERT INTO login_challenges (nonce, identity_key, expires_at)
            VALUES (${nonce}, ${identityKey}, ${expiresAt})`;
  return { nonce, message: loginMessage(identityKey, nonce), expiresAt };
}

/** Verifies the signed challenge, creates the account on first login, opens a session. */
export async function verifyLogin(
  identityKey: string,
  nonce: string,
  signatureHex: string,
  kind: "human" | "agent",
) {
  // Single-use: consume the challenge before checking the signature.
  const [challenge] = await sql`
    DELETE FROM login_challenges
    WHERE nonce = ${nonce} AND identity_key = ${identityKey} AND expires_at > now()
    RETURNING nonce`;
  if (!challenge) return null;

  try {
    const { valid } = await verifier.verifySignature({
      data: Array.from(new TextEncoder().encode(loginMessage(identityKey, nonce))),
      signature: Array.from(Buffer.from(signatureHex, "hex")),
      protocolID: AUTH_PROTOCOL,
      keyID: AUTH_KEY_ID,
      counterparty: identityKey,
    });
    if (!valid) return null;
  } catch {
    return null;
  }

  const [row] = await sql`
    INSERT INTO users (identity_key, kind) VALUES (${identityKey}, ${kind})
    ON CONFLICT (identity_key) DO UPDATE SET last_login_at = now()
    RETURNING id, identity_key, kind, display_name, avatar_updated_at, created_at, (xmax = 0) AS created`;
  const user = toUser(row);

  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await sql`INSERT INTO sessions (token_hash, user_id, expires_at)
            VALUES (${await sha256Hex(token)}, ${user.id}, ${expiresAt})`;
  return { token, expiresAt, user, created: Boolean(row.created) };
}

const toUser = (row: any): User => ({
  id: row.id,
  identityKey: row.identity_key,
  kind: row.kind,
  name: row.display_name ?? null,
  avatarUrl: avatarUrl(row.identity_key, row.avatar_updated_at),
  createdAt: new Date(row.created_at).toISOString(),
});

export function readToken(req: Request): string | null {
  const bearer = req.headers.get("authorization")?.match(/^Bearer (.+)$/i);
  if (bearer) return bearer[1]!;
  return req.headers.get("cookie")?.match(/(?:^|;\s*)session=([^;]+)/)?.[1] ?? null;
}

export async function userFromRequest(req: Request): Promise<User | null> {
  const token = readToken(req);
  if (!token) return null;
  const [row] = await sql`
    SELECT u.id, u.identity_key, u.kind, u.display_name, u.avatar_updated_at, u.created_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${await sha256Hex(token)} AND s.expires_at > now()`;
  return row ? toUser(row) : null;
}

export async function logout(req: Request) {
  const token = readToken(req);
  if (token) await sql`DELETE FROM sessions WHERE token_hash = ${await sha256Hex(token)}`;
}
