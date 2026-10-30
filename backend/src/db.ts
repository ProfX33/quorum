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
}
