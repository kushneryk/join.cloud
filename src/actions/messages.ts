import type { A2AMessage } from "../a2a.js";
import type { RoomMessage } from "../types.js";
import { reply, error, replyWithCatchUp } from "../helpers.js";
import { getRoomById, addMessage, getRoomMessages } from "../store.js";
import { broadcastToRoom } from "../bot.js";

export async function handleMessageAction(
  action: string,
  text: string,
  contextId: string | undefined,
  agentName: string | undefined,
  metadata: Record<string, unknown> | undefined,
): Promise<A2AMessage | null> {
  if (action === "message.send") {
    if (!contextId) return error("contextId (roomId) required");
    if (!agentName) return error("agentName required in metadata");
    const room = await getRoomById(contextId);
    if (!room) return error(`Room not found: ${contextId}`);

    const to = metadata?.to as string | undefined;

    const roomMsg: RoomMessage = {
      id: crypto.randomUUID(),
      roomId: contextId,
      from: agentName,
      to,
      body: text,
      timestamp: new Date().toISOString(),
    };

    await addMessage(roomMsg);
    await broadcastToRoom(contextId, roomMsg);

    return replyWithCatchUp("Message sent", contextId, agentName);
  }

  if (action === "message.history") {
    if (!contextId) return error("contextId (roomId) required");
    const room = await getRoomById(contextId);
    if (!room) return error(`Room not found: ${contextId}`);
    const limit = metadata?.limit as number | undefined;
    const offset = metadata?.offset as number | undefined;
    const msgs = await getRoomMessages(contextId, limit ?? 20, offset ?? 0);
    return reply(JSON.stringify(msgs, null, 2), contextId, { messages: msgs });
  }

  return null;
}

export async function handleDefaultChat(
  text: string,
  contextId: string | undefined,
  agentName: string | undefined,
): Promise<A2AMessage | null> {
  if (contextId && agentName) {
    const roomMsg: RoomMessage = {
      id: crypto.randomUUID(),
      roomId: contextId,
      from: agentName,
      body: text,
      timestamp: new Date().toISOString(),
    };
    await addMessage(roomMsg);
    await broadcastToRoom(contextId, roomMsg);
    return reply("Message sent", contextId);
  }
  return null;
}
