import postgres from "postgres";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://localhost:5432/joincloud";

export const sql = postgres(DATABASE_URL);

export async function initDb(): Promise<void> {
  // Suppress "relation already exists" notices on startup
  await sql`SET client_min_messages TO WARNING`;

  await sql`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      password TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS agents (
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      endpoint TEXT,
      last_seen_msg_id TEXT,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (room_id, name)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      from_agent TEXT NOT NULL,
      to_agent TEXT,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, created_at)
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_name_password ON rooms(name, password)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_rooms_created_at ON rooms(created_at)
  `;
}
