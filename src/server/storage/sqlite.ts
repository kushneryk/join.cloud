import { timingSafeEqual, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import initSqlJs, { type Database } from "sql.js";
import type { Room, RoomMessage, Agent, AgentRole } from "../types.js";
import type { Store } from "./interface.js";
import { runMigrations } from "./migrations/index.js";

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
        role: (a.role ?? "member") as AgentRole,
        endpoint: a.endpoint ?? undefined,
        joinedAt: a.joined_at,
      });
    }
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? "",
      type: row.type ?? "group",
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

      runMigrations(db);
      save();
    },

    async createRoom(id, name, password?, options?) {
      const description = options?.description ?? "";
      const type = options?.type ?? "group";
      try {
        run("INSERT INTO rooms (id, name, password, description, type) VALUES (?, ?, ?, ?, ?)", [id, name, hashPassword(password ?? ""), description, type]);
      } catch (e: any) {
        if (e?.message?.includes("UNIQUE constraint failed")) {
          const err = new Error(`Room "${name}" already exists`) as any;
          err.code = "23505";
          throw err;
        }
        throw e;
      }
      return { id, name, description, type: type as Room["type"], createdAt: new Date().toISOString(), agents: new Map() };
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
        rows = query("SELECT * FROM rooms WHERE name = ?", [idOrName.toLowerCase()]);
      }
      if (rows.length === 0) return undefined;
      return buildRoom(rows[0]);
    },

    async listRooms(options: { search?: string; limit?: number; offset?: number } = {}) {
      const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
      const offset = Math.max(options.offset ?? 0, 0);
      const countParams: unknown[] = [];
      let where = "WHERE r.password = ''";
      if (options.search) {
        where += " AND r.name LIKE ?";
        countParams.push(`%${options.search}%`);
      }
      const totalRow = query(`SELECT COUNT(*) as total FROM rooms r ${where}`, countParams);
      const total = totalRow[0]?.total as number ?? 0;
      const params = [...countParams, limit, offset];
      const rows = query(`
        SELECT r.name, r.description, r.type, r.created_at, COUNT(a.name) as agent_count
        FROM rooms r
        LEFT JOIN agents a ON a.room_id = r.id
        ${where}
        GROUP BY r.id, r.name, r.created_at
        ORDER BY r.name ASC
        LIMIT ? OFFSET ?
      `, params);
      return {
        rooms: rows.map((r) => ({ name: r.name, description: r.description ?? "", type: r.type ?? "group", agents: r.agent_count, createdAt: r.created_at })),
        total,
      };
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

    async updateRoom(roomId, fields) {
      const sets: string[] = [];
      const params: any[] = [];
      if (fields.description !== undefined) {
        sets.push("description = ?");
        params.push(fields.description);
      }
      if (fields.type !== undefined) {
        sets.push("type = ?");
        params.push(fields.type);
      }
      if (sets.length === 0) return;
      params.push(roomId);
      run(`UPDATE rooms SET ${sets.join(", ")} WHERE id = ?`, params);
    },

    async addAgent(roomId, name, endpoint?, role?) {
      const token = crypto.randomUUID();
      run("INSERT INTO agents (room_id, name, token, endpoint, role) VALUES (?, ?, ?, ?, ?)", [roomId, name, token, endpoint ?? null, role ?? "member"]);
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
      const rows = query("SELECT room_id, name, role, endpoint FROM agents WHERE token = ?", [token]);
      if (rows.length === 0) return undefined;
      return { roomId: rows[0].room_id, name: rows[0].name, role: rows[0].role ?? "member", endpoint: rows[0].endpoint ?? undefined };
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
        role: (a.role ?? "member") as AgentRole,
        endpoint: a.endpoint ?? undefined, joinedAt: a.joined_at,
      }));
    },

    async setAgentRole(roomId, name, role) {
      run("UPDATE agents SET role = ? WHERE room_id = ? AND name = ?", [role, roomId, name]);
    },

    async addMessage(msg) {
      run("INSERT INTO messages (id, room_id, from_agent, to_agent, body) VALUES (?, ?, ?, ?, ?)",
        [msg.id, msg.roomId, msg.from, msg.to ?? null, msg.body]);
    },

    async getRoomMessages(roomId, limit = 20, offset = 0) {
      const safeLimit = Math.min(Math.max(limit, 1), 100);
      const safeOffset = Math.max(offset, 0);
      const totalRow = query("SELECT COUNT(*) as total FROM messages WHERE room_id = ?", [roomId]);
      const total = totalRow[0]?.total as number ?? 0;
      const rows = query(
        "SELECT * FROM messages WHERE room_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
        [roomId, safeLimit, safeOffset],
      );
      const messages = rows.reverse().map((r) => ({
        id: r.id, roomId: r.room_id, from: r.from_agent,
        to: r.to_agent ?? undefined, body: r.body, timestamp: r.created_at,
      }));
      return { messages, total };
    },
  };

  return store;
}
