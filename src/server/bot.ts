import type { A2AMessage, SendMessageParams } from "./a2a.js";
import { getRoom, addMessage, updateAgentLastSeen } from "./store.js";
import type { RoomMessage } from "../types.js";

// SSE connections: roomId -> set of writers
type SSEWriter = (data: string) => void;
const sseClients = new Map<string, Set<SSEWriter>>();

export function addSseClient(roomId: string, writer: SSEWriter): () => void {
  if (!sseClients.has(roomId)) sseClients.set(roomId, new Set());
  sseClients.get(roomId)!.add(writer);
  return () => sseClients.get(roomId)?.delete(writer);
}

// Generic room listeners (for MCP push, etc.)
type RoomListener = (msg: RoomMessage) => void;
const roomListeners = new Map<string, Set<RoomListener>>();

export function addRoomListener(roomId: string, listener: RoomListener): () => void {
  if (!roomListeners.has(roomId)) roomListeners.set(roomId, new Set());
  roomListeners.get(roomId)!.add(listener);
  return () => roomListeners.get(roomId)?.delete(listener);
}

export function cleanupRoomConnections(roomId: string): void {
  sseClients.delete(roomId);
  roomListeners.delete(roomId);
}

export async function botNotify(roomId: string, body: string): Promise<void> {
  const msg: RoomMessage = {
    id: crypto.randomUUID(),
    roomId,
    from: "room-bot",
    body,
    timestamp: new Date().toISOString(),
  };

  await addMessage(msg);
  await broadcastToRoom(roomId, msg);
}

export async function broadcastToRoom(
  roomId: string,
  msg: RoomMessage,
): Promise<void> {
  const room = await getRoom(roomId);
  if (!room) return;

  const a2aMessage: A2AMessage = {
    role: "agent",
    parts: [{ text: msg.body }],
    contextId: roomId,
    metadata: {
      joincloud: true,
      from: msg.from,
      to: msg.to,
      messageId: msg.id,
    },
  };

  // Push to SSE clients (raw JSON — writeSSE adds the SSE framing)
  const sseData = JSON.stringify(msg);
  for (const writer of sseClients.get(roomId) ?? []) {
    try {
      writer(sseData);
    } catch {
      // Client disconnected
    }
  }

  // Push to generic room listeners (MCP, etc.)
  for (const listener of roomListeners.get(roomId) ?? []) {
    try {
      listener(msg);
    } catch {
      // Listener failed
    }
  }

  // Push to agents with A2A endpoints (skip sender, skip room-bot)
  for (const [name, agent] of room.agents) {
    if (name === msg.from) continue;
    if (msg.to && msg.to !== name) continue;
    if (!agent.endpoint) continue;

    const rpcBody = {
      jsonrpc: "2.0" as const,
      method: "SendMessage",
      params: { message: a2aMessage } as SendMessageParams,
      id: Date.now(),
    };

    fetch(agent.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rpcBody),
    })
      .then(() => {
        // Mark this message as delivered to this agent
        updateAgentLastSeen(roomId, name, msg.id).catch(() => {});
      })
      .catch(() => {
        // Agent unreachable — last_seen not updated, will catch up later
      });
  }
}
