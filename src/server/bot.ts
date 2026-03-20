import type { Store } from "./storage/interface.js";
import type { RoomMessage } from "./types.js";

let _store: Store;

export function setBotStore(store: Store): void {
  _store = store;
}

// SSE connections: roomId -> set of writers
type SSEWriter = (data: string) => void;
const sseClients = new Map<string, Set<SSEWriter>>();

export function addSseClient(roomId: string, writer: SSEWriter): () => void {
  if (!sseClients.has(roomId)) sseClients.set(roomId, new Set());
  sseClients.get(roomId)!.add(writer);
  return () => sseClients.get(roomId)?.delete(writer);
}

// Generic room listeners (for protocol push: MCP, A2A, etc.)
type RoomListener = (msg: RoomMessage) => void;
const roomListeners = new Map<string, Set<RoomListener>>();

export function addRoomListener(roomId: string, listener: RoomListener): () => void {
  if (!roomListeners.has(roomId)) roomListeners.set(roomId, new Set());
  roomListeners.get(roomId)!.add(listener);
  return () => roomListeners.get(roomId)?.delete(listener);
}

// Global broadcast listeners (called on every broadcast with store access)
type BroadcastListener = (roomId: string, msg: RoomMessage, store: Store) => void;
const broadcastListeners = new Set<BroadcastListener>();

export function addBroadcastListener(listener: BroadcastListener): () => void {
  broadcastListeners.add(listener);
  return () => broadcastListeners.delete(listener);
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

  await _store.addMessage(msg);
  await broadcastToRoom(roomId, msg);
}

export async function broadcastToRoom(
  roomId: string,
  msg: RoomMessage,
): Promise<void> {
  // Push to SSE clients (raw JSON — writeSSE adds the SSE framing)
  const sseData = JSON.stringify(msg);
  for (const writer of sseClients.get(roomId) ?? []) {
    try {
      writer(sseData);
    } catch {
      // Client disconnected
    }
  }

  // Push to per-room listeners (MCP sessions, etc.)
  for (const listener of roomListeners.get(roomId) ?? []) {
    try {
      listener(msg);
    } catch {
      // Listener failed
    }
  }

  // Push to global broadcast listeners (A2A endpoint delivery, etc.)
  for (const listener of broadcastListeners) {
    try {
      listener(roomId, msg, _store);
    } catch {
      // Listener failed
    }
  }
}
