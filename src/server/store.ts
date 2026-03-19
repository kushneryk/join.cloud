import { timingSafeEqual } from "node:crypto";
import type { Room, RoomMessage, Agent } from "../types.js";
import { getDb, saveDb } from "./db.js";

type Row = Record<string, any>;

function query(sql: string, params: any[] = []): Row[] {
  const db = getDb();
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
  const db = getDb();
  db.run(sql, params);
  saveDb();
}

// --- Rooms ---

export async function createRoom(id: string, name: string, password?: string): Promise<Room> {
  try {
    run("INSERT INTO rooms (id, name, password) VALUES (?, ?, ?)", [id, name, password ?? ""]);
  } catch (e: any) {
    if (e?.message?.includes("UNIQUE constraint failed")) {
      const err = new Error(`Room "${name}" already exists`) as any;
      err.code = "23505";
      throw err;
    }
    throw e;
  }
  return {
    id,
    name,
    createdAt: new Date().toISOString(),
    agents: new Map(),
  };
}

export async function checkRoomPassword(id: string, password: string): Promise<boolean> {
  const rows = query("SELECT password FROM rooms WHERE id = ?", [id]);
  if (rows.length === 0) return false;
  const stored = rows[0].password as string;
  if (stored === "") return true;
  if (stored.length !== password.length) return false;
  return timingSafeEqual(Buffer.from(stored), Buffer.from(password));
}

export async function agentExistsInRoom(roomId: string, name: string): Promise<boolean> {
  const rows = query("SELECT 1 as x FROM agents WHERE room_id = ? AND name = ?", [roomId, name]);
  return rows.length > 0;
}

export async function getRoomById(id: string): Promise<Room | undefined> {
  const rows = query("SELECT * FROM rooms WHERE id = ?", [id]);
  if (rows.length === 0) return undefined;
  return buildRoom(rows[0]);
}

export async function getRoom(idOrName: string): Promise<Room | undefined> {
  let rows = query("SELECT * FROM rooms WHERE id = ?", [idOrName]);

  if (rows.length === 0) {
    const lower = idOrName.toLowerCase();
    const colonIdx = lower.indexOf(":");
    if (colonIdx !== -1) {
      const name = lower.slice(0, colonIdx);
      const password = lower.slice(colonIdx + 1);
      rows = query("SELECT * FROM rooms WHERE name = ? AND password = ?", [name, password]);
    } else {
      rows = query("SELECT * FROM rooms WHERE name = ? AND password = ''", [lower]);
    }
  }

  if (rows.length === 0) return undefined;
  return buildRoom(rows[0]);
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

export async function listRooms(): Promise<
  Array<{ name: string; agents: number; createdAt: string }>
> {
  const rows = query(`
    SELECT r.name, r.created_at, COUNT(a.name) as agent_count
    FROM rooms r
    LEFT JOIN agents a ON a.room_id = r.id
    GROUP BY r.id, r.name, r.created_at
    ORDER BY r.created_at DESC
  `);
  return rows.map((r) => ({
    name: r.name,
    agents: r.agent_count,
    createdAt: r.created_at,
  }));
}

export async function deleteRoom(id: string): Promise<void> {
  run("DELETE FROM rooms WHERE id = ?", [id]);
}

export async function getRoomByNameAndPassword(
  name: string,
  password: string,
): Promise<Room | undefined> {
  const rows = query("SELECT * FROM rooms WHERE name = ? AND password = ?", [name.toLowerCase(), password]);
  if (rows.length === 0) return undefined;
  return buildRoom(rows[0]);
}

export async function getRoomsByName(
  name: string,
): Promise<Array<{ id: string; hasPassword: boolean }>> {
  const rows = query("SELECT id, password FROM rooms WHERE name = ?", [name.toLowerCase()]);
  return rows.map((r) => ({ id: r.id, hasPassword: r.password !== "" }));
}

// --- Agents ---

export async function addAgent(
  roomId: string,
  name: string,
  endpoint?: string,
): Promise<string> {
  const token = crypto.randomUUID();
  run(
    "INSERT INTO agents (room_id, name, token, endpoint) VALUES (?, ?, ?, ?)",
    [roomId, name, token, endpoint ?? null],
  );
  return token;
}

export async function getAgentToken(roomId: string, name: string): Promise<string | null> {
  const rows = query("SELECT token FROM agents WHERE room_id = ? AND name = ?", [roomId, name]);
  return rows[0]?.token ?? null;
}

export async function updateAgentEndpoint(token: string, endpoint?: string): Promise<void> {
  run("UPDATE agents SET endpoint = ? WHERE token = ?", [endpoint ?? null, token]);
}

export async function getAgentByToken(token: string): Promise<{ roomId: string; name: string; endpoint?: string } | undefined> {
  const rows = query("SELECT room_id, name, endpoint FROM agents WHERE token = ?", [token]);
  if (rows.length === 0) return undefined;
  return { roomId: rows[0].room_id, name: rows[0].name, endpoint: rows[0].endpoint ?? undefined };
}

export async function removeAgent(roomId: string, name: string): Promise<void> {
  run("DELETE FROM agents WHERE room_id = ? AND name = ?", [roomId, name]);
}

export async function removeAgentByToken(token: string): Promise<{ roomId: string; name: string } | undefined> {
  const rows = query("SELECT room_id, name FROM agents WHERE token = ?", [token]);
  if (rows.length === 0) return undefined;
  run("DELETE FROM agents WHERE token = ?", [token]);
  return { roomId: rows[0].room_id, name: rows[0].name };
}

export async function updateAgentLastSeen(
  roomId: string,
  name: string,
  messageId: string,
): Promise<void> {
  run(
    "UPDATE agents SET last_seen_msg_id = ? WHERE room_id = ? AND name = ?",
    [messageId, roomId, name],
  );
}

export async function getAgentLastSeen(
  roomId: string,
  name: string,
): Promise<string | null> {
  const rows = query(
    "SELECT last_seen_msg_id FROM agents WHERE room_id = ? AND name = ?",
    [roomId, name],
  );
  return rows[0]?.last_seen_msg_id ?? null;
}

export async function getLatestMessageId(
  roomId: string,
): Promise<string | null> {
  const rows = query(
    "SELECT id FROM messages WHERE room_id = ? ORDER BY created_at DESC LIMIT 1",
    [roomId],
  );
  return rows[0]?.id ?? null;
}

export async function getMessagesSince(
  roomId: string,
  afterMessageId: string,
): Promise<RoomMessage[]> {
  const rows = query(
    `SELECT * FROM messages
     WHERE room_id = ?
       AND created_at > (SELECT created_at FROM messages WHERE id = ?)
     ORDER BY created_at ASC`,
    [roomId, afterMessageId],
  );
  return rows.map((r) => ({
    id: r.id,
    roomId: r.room_id,
    from: r.from_agent,
    to: r.to_agent ?? undefined,
    body: r.body,
    timestamp: r.created_at,
  }));
}

export async function getRoomAgents(roomId: string): Promise<Agent[]> {
  const rows = query("SELECT * FROM agents WHERE room_id = ?", [roomId]);
  return rows.map((a) => ({
    name: a.name,
    token: a.token,
    endpoint: a.endpoint ?? undefined,
    joinedAt: a.joined_at,
  }));
}

// --- Messages ---

export async function addMessage(msg: RoomMessage): Promise<void> {
  run(
    "INSERT INTO messages (id, room_id, from_agent, to_agent, body) VALUES (?, ?, ?, ?, ?)",
    [msg.id, msg.roomId, msg.from, msg.to ?? null, msg.body],
  );
}

export async function getRoomMessages(
  roomId: string,
  limit: number = 20,
  offset: number = 0,
): Promise<RoomMessage[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const safeOffset = Math.max(offset, 0);
  const rows = query(
    "SELECT * FROM messages WHERE room_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
    [roomId, safeLimit, safeOffset],
  );
  return rows.reverse().map((r) => ({
    id: r.id,
    roomId: r.room_id,
    from: r.from_agent,
    to: r.to_agent ?? undefined,
    body: r.body,
    timestamp: r.created_at,
  }));
}
