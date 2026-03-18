import type { Room, RoomMessage, Agent } from "./types.js";
import { sql } from "./db.js";

// --- Rooms ---

export async function createRoom(id: string, name: string, password?: string): Promise<Room> {
  await sql`INSERT INTO rooms (id, name, password) VALUES (${id}, ${name}, ${password ?? ''})`;
  return {
    id,
    name,
    createdAt: new Date().toISOString(),
    agents: new Map(),
  };
}

export async function checkRoomPassword(id: string, password: string): Promise<boolean> {
  const rows = await sql`SELECT password FROM rooms WHERE id = ${id}`;
  if (rows.length === 0) return false;
  // Empty password means no auth required
  if (rows[0].password === '') return true;
  return rows[0].password === password;
}

export async function agentExistsInRoom(roomId: string, name: string): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM agents WHERE room_id = ${roomId} AND name = ${name}`;
  return rows.length > 0;
}

export async function getRoomById(id: string): Promise<Room | undefined> {
  const rows = await sql`SELECT * FROM rooms WHERE id = ${id}`;
  if (rows.length === 0) return undefined;
  return buildRoom(rows[0]);
}

export async function getRoom(idOrName: string): Promise<Room | undefined> {
  // Try by ID first
  let rows = await sql`SELECT * FROM rooms WHERE id = ${idOrName}`;

  // Fall back to name (or name:password), case-insensitive
  if (rows.length === 0) {
    const lower = idOrName.toLowerCase();
    const colonIdx = lower.indexOf(":");
    if (colonIdx !== -1) {
      const name = lower.slice(0, colonIdx);
      const password = lower.slice(colonIdx + 1);
      rows = await sql`SELECT * FROM rooms WHERE name = ${name} AND password = ${password}`;
    } else {
      rows = await sql`SELECT * FROM rooms WHERE name = ${lower} AND password = ''`;
    }
  }

  if (rows.length === 0) return undefined;
  return buildRoom(rows[0]);
}

async function buildRoom(row: Record<string, any>): Promise<Room> {
  const agents = await sql`SELECT * FROM agents WHERE room_id = ${row.id}`;
  const agentMap = new Map<string, Agent>();
  for (const a of agents) {
    agentMap.set(a.name, {
      name: a.name,
      token: a.token,
      endpoint: a.endpoint ?? undefined,
      joinedAt: a.joined_at.toISOString(),
    });
  }
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at.toISOString(),
    agents: agentMap,
  };
}

export async function listRooms(): Promise<
  Array<{ id: string; name: string; agents: number; createdAt: string }>
> {
  const rows = await sql`
    SELECT r.id, r.name, r.created_at, COUNT(a.name)::int as agent_count
    FROM rooms r
    LEFT JOIN agents a ON a.room_id = r.id
    GROUP BY r.id, r.name, r.created_at
    ORDER BY r.created_at DESC
  `;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    agents: r.agent_count,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function deleteRoom(id: string): Promise<void> {
  await sql`DELETE FROM rooms WHERE id = ${id}`;
}

export async function getRoomByNameAndPassword(
  name: string,
  password: string,
): Promise<Room | undefined> {
  const rows = await sql`SELECT * FROM rooms WHERE name = ${name.toLowerCase()} AND password = ${password}`;
  if (rows.length === 0) return undefined;
  return buildRoom(rows[0]);
}

export async function getRoomsByName(
  name: string,
): Promise<Array<{ id: string; hasPassword: boolean }>> {
  const rows = await sql`SELECT id, password FROM rooms WHERE name = ${name.toLowerCase()}`;
  return rows.map((r) => ({ id: r.id, hasPassword: r.password !== "" }));
}


// --- Agents ---

export async function addAgent(
  roomId: string,
  name: string,
  endpoint?: string,
): Promise<string> {
  const token = crypto.randomUUID();
  await sql`
    INSERT INTO agents (room_id, name, token, endpoint)
    VALUES (${roomId}, ${name}, ${token}, ${endpoint ?? null})
  `;
  return token;
}

export async function getAgentToken(roomId: string, name: string): Promise<string | null> {
  const rows = await sql`SELECT token FROM agents WHERE room_id = ${roomId} AND name = ${name}`;
  return rows[0]?.token ?? null;
}

export async function updateAgentEndpoint(token: string, endpoint?: string): Promise<void> {
  await sql`UPDATE agents SET endpoint = ${endpoint ?? null} WHERE token = ${token}`;
}

export async function getAgentByToken(token: string): Promise<{ roomId: string; name: string; endpoint?: string } | undefined> {
  const rows = await sql`SELECT room_id, name, endpoint FROM agents WHERE token = ${token}`;
  if (rows.length === 0) return undefined;
  return { roomId: rows[0].room_id, name: rows[0].name, endpoint: rows[0].endpoint ?? undefined };
}

export async function removeAgent(roomId: string, name: string): Promise<void> {
  await sql`DELETE FROM agents WHERE room_id = ${roomId} AND name = ${name}`;
}

export async function removeAgentByToken(token: string): Promise<{ roomId: string; name: string } | undefined> {
  const rows = await sql`DELETE FROM agents WHERE token = ${token} RETURNING room_id, name`;
  if (rows.length === 0) return undefined;
  return { roomId: rows[0].room_id, name: rows[0].name };
}

export async function updateAgentLastSeen(
  roomId: string,
  name: string,
  messageId: string,
): Promise<void> {
  await sql`
    UPDATE agents SET last_seen_msg_id = ${messageId}
    WHERE room_id = ${roomId} AND name = ${name}
  `;
}

export async function getAgentLastSeen(
  roomId: string,
  name: string,
): Promise<string | null> {
  const rows = await sql`
    SELECT last_seen_msg_id FROM agents
    WHERE room_id = ${roomId} AND name = ${name}
  `;
  return rows[0]?.last_seen_msg_id ?? null;
}

export async function getLatestMessageId(
  roomId: string,
): Promise<string | null> {
  const rows = await sql`
    SELECT id FROM messages WHERE room_id = ${roomId}
    ORDER BY created_at DESC LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

export async function getMessagesSince(
  roomId: string,
  afterMessageId: string,
): Promise<RoomMessage[]> {
  const rows = await sql`
    SELECT * FROM messages
    WHERE room_id = ${roomId}
      AND created_at > (
        SELECT created_at FROM messages WHERE id = ${afterMessageId}
      )
    ORDER BY created_at ASC
  `;
  return rows.map((r) => ({
    id: r.id,
    roomId: r.room_id,
    from: r.from_agent,
    to: r.to_agent ?? undefined,
    body: r.body,
    timestamp: r.created_at.toISOString(),
  }));
}

export async function getRoomAgents(roomId: string): Promise<Agent[]> {
  const rows = await sql`SELECT * FROM agents WHERE room_id = ${roomId}`;
  return rows.map((a) => ({
    name: a.name,
    token: a.token,
    endpoint: a.endpoint ?? undefined,
    joinedAt: a.joined_at.toISOString(),
  }));
}

// --- Messages ---

export async function addMessage(msg: RoomMessage): Promise<void> {
  await sql`
    INSERT INTO messages (id, room_id, from_agent, to_agent, body)
    VALUES (${msg.id}, ${msg.roomId}, ${msg.from}, ${msg.to ?? null}, ${msg.body})
  `;
}

export async function getRoomMessages(
  roomId: string,
  limit: number = 20,
  offset: number = 0,
): Promise<RoomMessage[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const safeOffset = Math.max(offset, 0);
  const rows = await sql`
    SELECT * FROM messages
    WHERE room_id = ${roomId}
    ORDER BY created_at DESC
    LIMIT ${safeLimit} OFFSET ${safeOffset}
  `;
  return rows.reverse().map((r) => ({
    id: r.id,
    roomId: r.room_id,
    from: r.from_agent,
    to: r.to_agent ?? undefined,
    body: r.body,
    timestamp: r.created_at.toISOString(),
  }));
}

