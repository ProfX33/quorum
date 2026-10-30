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
  // Profile: a display name and a picture (stored here, served by /api/users/:key/avatar).
  await sql`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS display_name text,
      ADD COLUMN IF NOT EXISTS avatar bytea,
      ADD COLUMN IF NOT EXISTS avatar_type text,
      ADD COLUMN IF NOT EXISTS avatar_updated_at timestamptz`;
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

  // Bid lifecycle (see delivery.ts; the group pays in one transaction):
  //   open: the buyer pledges their maximum while bidding; only pledged money takes part
  //   open → pledged (in the payment group at the deadline) or lost (withdrawn, not in it)
  //   pledged → paid (the group payment is built and broadcast, nobody has to act)
  //   paid → delivered (key wrapped for the buyer) → received
  //   paid → defaulted (spent their pledge elsewhere, so the network rejected the payment);
  //     the others are regrouped at once with new shares, or the offer fails and they
  //     become lost. Pledges not used in a payment can be refunded.
  //   delivered → paid again when the buyer cannot decrypt, until disputed after 3 attempts
  //   ('won' is from when buyers pledged after the deadline.)
  // (The per-bid payment_* columns are from when each buyer paid separately.)
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
        ('open', 'won', 'pledged', 'lost', 'expired', 'paid', 'delivered', 'received', 'disputed', 'defaulted'))`;
  await sql`DROP INDEX IF EXISTS buy_offers_payment_txid`;
  await sql`DROP INDEX IF EXISTS buy_offers_unconfirmed`;

  // The group payment of a sold offer: one transaction paying the full price to the seller.
  await sql`
    ALTER TABLE sell_offers
      ADD COLUMN IF NOT EXISTS payment_prefix text,
      ADD COLUMN IF NOT EXISTS payment_suffix text,
      ADD COLUMN IF NOT EXISTS payment_txid text UNIQUE,
      ADD COLUMN IF NOT EXISTS payment_beef bytea,
      ADD COLUMN IF NOT EXISTS paid_at timestamptz,
      ADD COLUMN IF NOT EXISTS payment_seen_at timestamptz,
      ADD COLUMN IF NOT EXISTS payment_checked_at timestamptz,
      ADD COLUMN IF NOT EXISTS payment_error text,
      ADD COLUMN IF NOT EXISTS payment_rejections integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS internalized_at timestamptz`;
  await sql`CREATE INDEX IF NOT EXISTS sell_offers_unconfirmed
            ON sell_offers (paid_at) WHERE payment_txid IS NOT NULL AND payment_seen_at IS NULL`;

  // A buyer's share, locked to their own key and signed for the group payment only.
  //   active: usable (or refundable once the bid is out of the group)
  //   used: input of the group payment   spent: spent elsewhere, worthless here
  //   refunded: returned to the buyer's wallet
  await sql`
    CREATE TABLE IF NOT EXISTS pledges (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bid_id uuid NOT NULL REFERENCES buy_offers(id) ON DELETE CASCADE,
      txid text NOT NULL,
      vout integer NOT NULL,
      satoshis bigint NOT NULL,
      key_id text NOT NULL,
      beef bytea NOT NULL,
      unlocking_script text NOT NULL,
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'spent', 'refunded')),
      refund_txid text,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (txid, vout)
    )`;
  await sql`CREATE INDEX IF NOT EXISTS pledges_bid ON pledges (bid_id)`;
  await sql`ALTER TABLE pledges ADD COLUMN IF NOT EXISTS refunded_at timestamptz`;

  // Pledges are signed while bidding, so an open offer needs its group payment key already.
  await sql`
    UPDATE sell_offers SET
      payment_prefix = encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'),
      payment_suffix = encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64')
    WHERE status = 'open' AND payment_prefix IS NULL`;
  // Sales still waiting for buyers to pledge after their deadline end here; pledges stay refundable.
  await sql`
    UPDATE sell_offers s SET status = 'unsold' WHERE s.status = 'sold' AND s.payment_txid IS NULL
      AND EXISTS (SELECT 1 FROM buy_offers b WHERE b.sell_offer_id = s.id AND b.status = 'won')`;
  await sql`
    UPDATE buy_offers b SET status = 'lost' FROM sell_offers s
    WHERE s.id = b.sell_offer_id AND s.status = 'unsold' AND b.status IN ('won', 'pledged')`;
}
