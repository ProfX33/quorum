import { SQL } from "bun";

export const sql = new SQL(
  process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/app",
);

export async function migrate() {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      identity_key text NOT NULL UNIQUE,
      kind text NOT NULL DEFAULT 'human' CHECK (kind IN ('human', 'agent')),
      created_at timestamptz NOT NULL DEFAULT now(),
      last_login_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS login_challenges (
      nonce text PRIMARY KEY,
      identity_key text NOT NULL,
      expires_at timestamptz NOT NULL
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash text PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL
    )`;

  // Marketplace. Prices are integer satoshis.
  await sql`
    CREATE TABLE IF NOT EXISTS sell_offers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      seller_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind text NOT NULL DEFAULT 'data' CHECK (kind IN ('data', 'service', 'product')),
      category text NOT NULL,
      region text NOT NULL,
      name text NOT NULL,
      description text NOT NULL DEFAULT '',
      price bigint NOT NULL CHECK (price > 0),
      deadline timestamptz NOT NULL,
      -- sha256 commitment to the encrypted data
      data_hash text CHECK (data_hash ~ '^[0-9a-f]{64}$'),
      status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'sold', 'unsold')),
      settled_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS sell_offers_open_deadline ON sell_offers (deadline) WHERE status = 'open'`;

  // A buy offer either bids on a sell offer, or (sell_offer_id NULL) is a standalone
  // request describing what the buyer wants, until a seller answers it with an offer.
  await sql`
    CREATE TABLE IF NOT EXISTS buy_offers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      buyer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sell_offer_id uuid REFERENCES sell_offers(id) ON DELETE CASCADE,
      max_price bigint NOT NULL CHECK (max_price > 0),
      kind text CHECK (kind IN ('data', 'service', 'product')),
      category text,
      region text,
      name text,
      description text,
      deadline timestamptz,
      status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost', 'expired')),
      -- what the buyer pays once status = 'won'
      amount bigint,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (sell_offer_id IS NOT NULL OR (name IS NOT NULL AND deadline IS NOT NULL))
    )`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS buy_offers_one_bid_per_buyer
            ON buy_offers (sell_offer_id, buyer_id) WHERE sell_offer_id IS NOT NULL`;

  // ---------- Payment and data delivery (see delivery.ts) ----------

  // Encrypted data uploaded by sellers, addressed by the sha256 of the ciphertext.
  // The server never sees the key: it is AES-256-GCM, chosen in the seller's browser.
  await sql`
    CREATE TABLE IF NOT EXISTS data_files (
      hash text PRIMARY KEY CHECK (hash ~ '^[0-9a-f]{64}$'),
      owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name text NOT NULL,
      size integer NOT NULL,
      bytes bytea NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;

  await sql`
    ALTER TABLE sell_offers
      -- the data key, encrypted by the seller's wallet to itself (BRC-2, counterparty 'self')
      ADD COLUMN IF NOT EXISTS seller_key_wrap text,
      -- winners must pay before this, set at settlement
      ADD COLUMN IF NOT EXISTS payment_deadline timestamptz`;

  // Bid lifecycle after settlement:
  //   won → paid (txid submitted, broadcast) → delivered (key wrapped for the buyer) → received
  //   won → defaulted (payment window missed; a late valid payment still counts)
  //   delivered → paid again when the buyer cannot decrypt, until disputed after 3 attempts
  await sql`
    ALTER TABLE buy_offers
      ADD COLUMN IF NOT EXISTS payment_prefix text,
      ADD COLUMN IF NOT EXISTS payment_suffix text,
      ADD COLUMN IF NOT EXISTS payment_txid text,
      ADD COLUMN IF NOT EXISTS payment_vout integer,
      ADD COLUMN IF NOT EXISTS payment_beef bytea,
      ADD COLUMN IF NOT EXISTS paid_at timestamptz,
      ADD COLUMN IF NOT EXISTS payment_seen_at timestamptz,
      ADD COLUMN IF NOT EXISTS payment_checked_at timestamptz,
      ADD COLUMN IF NOT EXISTS payment_error text,
      ADD COLUMN IF NOT EXISTS internalized_at timestamptz,
      ADD COLUMN IF NOT EXISTS wrapped_key text,
      ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
      ADD COLUMN IF NOT EXISTS delivery_attempts integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS received_at timestamptz,
      ADD COLUMN IF NOT EXISTS dispute_reason text`;
  await sql`
    ALTER TABLE buy_offers DROP CONSTRAINT IF EXISTS buy_offers_status_check,
      ADD CONSTRAINT buy_offers_status_check CHECK (status IN
        ('open', 'won', 'lost', 'expired', 'paid', 'delivered', 'received', 'disputed', 'defaulted'))`;
  // One transaction pays exactly one bid.
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS buy_offers_payment_txid
            ON buy_offers (payment_txid) WHERE payment_txid IS NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS buy_offers_unconfirmed
            ON buy_offers (paid_at) WHERE payment_txid IS NOT NULL AND payment_seen_at IS NULL`;
}
