import { timingSafeEqual, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import initSqlJs, { type Database } from "sql.js";
import type { Room, RoomMessage, Agent } from "../types.js";
import type { Store } from "./interface.js";

type Row = Record<string, any>;

/** Hash a room password for storage. Empty string stays empty (no password). */
function hashPassword(password: string): string {
  if (password === "") return "";
  return createHash("sha256").update(password).digest("hex");
}

export function createSqliteStore(dataDir?: string): Store {
  const DATA_DIR = dataDir ?? process.env.JOINCLOUD_DATA_DIR ?? join(homedir(), ".joincloud");
  const DB_FILE = join(DATA_DIR, "data.db");

  let db: Database;

  function query(sql: string, params: any[] = []): Row[] {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows: Row[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }

  function run(sql: string, params: any[] = []): void {
    db.run(sql, params);
    save();
  }

  function save(): void {
    const data = db.export();
    writeFileSync(DB_FILE, Buffer.from(data));
  }

  async function buildRoom(row: Row): Promise<Room> {
    const agents = query("SELECT * FROM agents WHERE room_id = ?", [row.id]);
    const agentMap = new Map<string, Agent>();
    for (const a of agents) {
      agentMap.set(a.name, {
        name: a.name,
        token: a.token,
        endpoint: a.endpoint ?? undefined,
        joinedAt: a.joined_at,
      });
    }
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      agents: agentMap,
    };
  }

  const store: Store = {
    async init() {
      const SQL = await initSqlJs();
      mkdirSync(DATA_DIR, { recursive: true });

      if (existsSync(DB_FILE)) {
        const buffer = readFileSync(DB_FILE);
        db = new SQL.Database(buffer);
      } else {
        db = new SQL.Database();
      }

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
          is_human INTEGER NOT NULL DEFAULT 0,
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

      save();
    },

    async createRoom(id, name, password?) {
      try {
        run("INSERT INTO rooms (id, name, password) VALUES (?, ?, ?)", [id, name, hashPassword(password ?? "")]);
      } catch (e: any) {
        if (e?.message?.includes("UNIQUE constraint failed")) {
          const err = new Error(`Room "${name}" already exists`) as any;
          err.code = "23505";
          throw err;
        }
        throw e;
      }
      return { id, name, createdAt: new Date().toISOString(), agents: new Map() };
    },

    async checkRoomPassword(id, password) {
      const rows = query("SELECT password FROM rooms WHERE id = ?", [id]);
      if (rows.length === 0) return false;
      const stored = rows[0].password as string;
      if (stored === "") return true;
      const hashed = hashPassword(password);
      // Both are SHA-256 hex digests (64 chars), so timingSafeEqual is safe
      if (stored.length !== hashed.length) return false;
      return timingSafeEqual(Buffer.from(stored), Buffer.from(hashed));
    },

    async agentExistsInRoom(roomId, name) {
      const rows = query("SELECT 1 as x FROM agents WHERE room_id = ? AND name = ?", [roomId, name]);
      return rows.length > 0;
    },

    async getRoomById(id) {
      const rows = query("SELECT * FROM rooms WHERE id = ?", [id]);
      if (rows.length === 0) return undefined;
      return buildRoom(rows[0]);
    },

    async getRoom(idOrName) {
      let rows = query("SELECT * FROM rooms WHERE id = ?", [idOrName]);

      if (rows.length === 0) {
        const lower = idOrName.toLowerCase();
        const colonIdx = lower.indexOf(":");
        if (colonIdx !== -1) {
          const name = lower.slice(0, colonIdx);
          const password = lower.slice(colonIdx + 1);
          rows = query("SELECT * FROM rooms WHERE name = ? AND password = ?", [name, hashPassword(password)]);
        } else {
          rows = query("SELECT * FROM rooms WHERE name = ? AND password = ''", [lower]);
        }
      }

      if (rows.length === 0) return undefined;
      return buildRoom(rows[0]);
    },

    async listRooms() {
      const rows = query(`
        SELECT r.name, r.created_at, COUNT(a.name) as agent_count
        FROM rooms r
        LEFT JOIN agents a ON a.room_id = r.id
        GROUP BY r.id, r.name, r.created_at
        ORDER BY r.created_at DESC
      `);
      return rows.map((r) => ({ name: r.name, agents: r.agent_count, createdAt: r.created_at }));
    },

    async deleteRoom(id) {
      run("DELETE FROM rooms WHERE id = ?", [id]);
    },

    async getRoomByNameAndPassword(name, password) {
      const rows = query("SELECT * FROM rooms WHERE name = ? AND password = ?", [name.toLowerCase(), hashPassword(password)]);
      if (rows.length === 0) return undefined;
      return buildRoom(rows[0]);
    },

    async getRoomsByName(name) {
      const rows = query("SELECT id, password FROM rooms WHERE name = ?", [name.toLowerCase()]);
      return rows.map((r) => ({ id: r.id, hasPassword: r.password !== "" }));
    },

    async addAgent(roomId, name, endpoint?, isHuman?) {
      const token = crypto.randomUUID();
      run("INSERT INTO agents (room_id, name, token, endpoint, is_human) VALUES (?, ?, ?, ?, ?)", [roomId, name, token, endpoint ?? null, isHuman ? 1 : 0]);
      return token;
    },

    async getAgentToken(roomId, name) {
      const rows = query("SELECT token FROM agents WHERE room_id = ? AND name = ?", [roomId, name]);
      return rows[0]?.token ?? null;
    },

    async updateAgentEndpoint(token, endpoint?) {
      run("UPDATE agents SET endpoint = ? WHERE token = ?", [endpoint ?? null, token]);
    },

    async getAgentByToken(token) {
      const rows = query("SELECT room_id, name, endpoint FROM agents WHERE token = ?", [token]);
      if (rows.length === 0) return undefined;
      return { roomId: rows[0].room_id, name: rows[0].name, endpoint: rows[0].endpoint ?? undefined };
    },

    async removeAgent(roomId, name) {
      run("DELETE FROM agents WHERE room_id = ? AND name = ?", [roomId, name]);
    },

    async removeAgentByToken(token) {
      const rows = query("SELECT room_id, name FROM agents WHERE token = ?", [token]);
      if (rows.length === 0) return undefined;
      run("DELETE FROM agents WHERE token = ?", [token]);
      return { roomId: rows[0].room_id, name: rows[0].name };
    },

    async updateAgentLastSeen(roomId, name, messageId) {
      run("UPDATE agents SET last_seen_msg_id = ? WHERE room_id = ? AND name = ?", [messageId, roomId, name]);
    },

    async getAgentLastSeen(roomId, name) {
      const rows = query("SELECT last_seen_msg_id FROM agents WHERE room_id = ? AND name = ?", [roomId, name]);
      return rows[0]?.last_seen_msg_id ?? null;
    },

    async getLatestMessageId(roomId) {
      const rows = query("SELECT id FROM messages WHERE room_id = ? ORDER BY created_at DESC LIMIT 1", [roomId]);
      return rows[0]?.id ?? null;
    },

    async getMessagesSince(roomId, afterMessageId) {
      const rows = query(
        `SELECT * FROM messages WHERE room_id = ? AND created_at > (SELECT created_at FROM messages WHERE id = ?) ORDER BY created_at ASC`,
        [roomId, afterMessageId],
      );
      return rows.map((r) => ({
        id: r.id, roomId: r.room_id, from: r.from_agent,
        to: r.to_agent ?? undefined, body: r.body, timestamp: r.created_at,
      }));
    },

    async getRoomAgents(roomId) {
      const rows = query("SELECT * FROM agents WHERE room_id = ?", [roomId]);
      return rows.map((a) => ({
        name: a.name, token: a.token,
        endpoint: a.endpoint ?? undefined, isHuman: !!a.is_human, joinedAt: a.joined_at,
      }));
    },

    async addMessage(msg) {
      run("INSERT INTO messages (id, room_id, from_agent, to_agent, body) VALUES (?, ?, ?, ?, ?)",
        [msg.id, msg.roomId, msg.from, msg.to ?? null, msg.body]);
    },

    async getRoomMessages(roomId, limit = 20, offset = 0) {
      const safeLimit = Math.min(Math.max(limit, 1), 100);
      const safeOffset = Math.max(offset, 0);
      const rows = query(
        "SELECT * FROM messages WHERE room_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
        [roomId, safeLimit, safeOffset],
      );
      return rows.reverse().map((r) => ({
        id: r.id, roomId: r.room_id, from: r.from_agent,
        to: r.to_agent ?? undefined, body: r.body, timestamp: r.created_at,
      }));
    },
  };

  return store;
}
