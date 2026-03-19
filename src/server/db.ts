import initSqlJs, { type Database } from "sql.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

let db: Database;

const DATA_DIR = process.env.JOINCLOUD_DATA_DIR ?? join(homedir(), ".joincloud");
const DB_FILE = join(DATA_DIR, "data.db");

export function getDb(): Database {
  return db;
}

export async function initDb(): Promise<void> {
  const SQL = await initSqlJs();

  mkdirSync(DATA_DIR, { recursive: true });

  if (existsSync(DB_FILE)) {
    const buffer = readFileSync(DB_FILE);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Enable WAL mode and foreign keys
  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA foreign_keys=ON");

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

  saveDb();
}

export function saveDb(): void {
  const data = db.export();
  writeFileSync(DB_FILE, Buffer.from(data));
}
