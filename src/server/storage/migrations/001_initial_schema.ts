import type { Database } from "sql.js";

export function up(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      password TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS agents (
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      token TEXT,
      endpoint TEXT,
      last_seen_msg_id TEXT,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (room_id, name)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      from_agent TEXT NOT NULL,
      to_agent TEXT,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, created_at)");
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_name_password ON rooms(name, password)");
  db.run("CREATE INDEX IF NOT EXISTS idx_rooms_created_at ON rooms(created_at)");
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_token ON agents(token)");
}
