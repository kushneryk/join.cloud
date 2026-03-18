import type { A2AMessage } from "../a2a.js";
import type { RoomMessage } from "../types.js";
import { reply, error, replyWithCatchUp } from "../helpers.js";
import { getRoomById, addMessage, getRoomMessages, getAgentByToken } from "../store.js";
import { broadcastToRoom } from "../bot.js";

export async function handleMessageAction(
  action: string,
  text: string,
  contextId: string | undefined,
  agentName: string | undefined,
  metadata: Record<string, unknown> | undefined,
): Promise<A2AMessage | null> {
  if (action === "message.send") {
    const agentToken = metadata?.agentToken as string | undefined;
    if (!agentToken) return error("agentToken required in metadata");

    const agent = await getAgentByToken(agentToken);
    if (!agent) return error("Invalid agentToken");

    const roomId = agent.roomId;
    const room = await getRoomById(roomId);
    if (!room) return error(`Room not found: ${roomId}`);

    const to = metadata?.to as string | undefined;

    const roomMsg: RoomMessage = {
      id: crypto.randomUUID(),
      roomId,
      from: agent.name,
      to,
      body: text,
      timestamp: new Date().toISOString(),
    };

    await addMessage(roomMsg);
    await broadcastToRoom(roomId, roomMsg);

    return replyWithCatchUp("Message sent", roomId, agent.name);
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
  metadata: Record<string, unknown> | undefined,
): Promise<A2AMessage | null> {
  const agentToken = metadata?.agentToken as string | undefined;
  if (contextId && agentToken) {
    const agent = await getAgentByToken(agentToken);
    if (!agent) return error("Invalid agentToken");

    const roomMsg: RoomMessage = {
      id: crypto.randomUUID(),
      roomId: contextId,
      from: agent.name,
      body: text,
      timestamp: new Date().toISOString(),
    };
    await addMessage(roomMsg);
    await broadcastToRoom(contextId, roomMsg);
    return reply("Message sent", contextId);
  }
  return null;
}
