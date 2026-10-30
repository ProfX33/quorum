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
}
