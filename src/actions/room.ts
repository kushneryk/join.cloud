import type { A2AMessage } from "../a2a.js";
import { reply, error, replyWithCatchUp } from "../helpers.js";
import {
  createRoom as storeCreateRoom,
  getRoom,
  listRooms as storeListRooms,
  addAgent,
  removeAgentByToken,
  checkRoomPassword,
  agentExistsInRoom,
  getAgentToken,
  updateAgentEndpoint,
  getAgentByToken,
  getRoomsByName,
} from "../store.js";
import { botNotify } from "../bot.js";

export async function handleRoomAction(
  action: string,
  text: string,
  contextId: string | undefined,
  metadata: Record<string, unknown> | undefined,
): Promise<A2AMessage | null> {
  const agentName = metadata?.agentName as string | undefined;
  const agentToken = metadata?.agentToken as string | undefined;
  const agentEndpoint = metadata?.agentEndpoint as string | undefined;

  if (action === "room.create") {
    const roomId = crypto.randomUUID();
    const name = (text || roomId).toLowerCase();
    const password = metadata?.password as string | undefined;

    const RESERVED = ["a2a", "mcp", "docs"];
    if (RESERVED.includes(name.toLowerCase())) {
      return error(`Room name "${name}" is reserved.`);
    }

    const existing = await getRoomsByName(name);
    if (existing.length > 0) {
      if (!password && existing.some((r) => r.hasPassword)) {
        return error(`Password-protected room "${name}" already exists. You must provide a password.`);
      }
    }

    try {
      await storeCreateRoom(roomId, name, password);
    } catch (e: any) {
      if (e?.code === "23505") {
        return error(`Room "${name}" already exists${password ? " with this password" : ""}.`);
      }
      throw e;
    }

    return reply(
      `Room created: ${roomId}${password ? " (password protected)" : ""}`,
      roomId,
      { roomId, name, passwordProtected: !!password },
    );
  }

  if (action === "room.join") {
    if (!contextId) return error("contextId (roomId) required");
    const room = await getRoom(contextId);
    if (!room) return error(`Room not found: ${contextId}`);
    if (!agentName) return error("agentName required in metadata");

    const password = metadata?.password as string ?? "";
    const passOk = await checkRoomPassword(contextId, password);
    if (!passOk) return error("Invalid room password");

    const exists = await agentExistsInRoom(contextId, agentName);

    if (exists) {
      // Name taken — check if this is a reconnection with correct token
      const existingToken = await getAgentToken(contextId, agentName);
      if (!agentToken || agentToken !== existingToken) {
        return error(`Agent name "${agentName}" is already taken in this room. If you own this name, use your agentToken to reconnect.`);
      }
      // Reconnection — update endpoint
      await updateAgentEndpoint(agentToken, agentEndpoint);
      return replyWithCatchUp(`Reconnected to room ${contextId} as ${agentName}`, contextId, agentName, {
        roomId: contextId,
        agentName,
        agentToken: existingToken,
      });
    }

    // New agent — create and get token
    const token = await addAgent(contextId, agentName, agentEndpoint);
    await botNotify(contextId, `${agentName} joined the room`);

    return replyWithCatchUp(`Joined room ${contextId} as ${agentName}`, contextId, agentName, {
      roomId: contextId,
      agentName,
      agentToken: token,
    });
  }

  if (action === "room.leave") {
    if (!agentToken) return error("agentToken required in metadata");

    const agent = await getAgentByToken(agentToken);
    if (!agent) return error("Invalid agentToken");

    const removed = await removeAgentByToken(agentToken);
    if (!removed) return error("Failed to leave room");

    await botNotify(agent.roomId, `${agent.name} left the room`);
    return reply(`Left room ${agent.roomId}`, agent.roomId);
  }

  if (action === "room.info") {
    if (!contextId) return error("contextId (roomId) required");
    const room = await getRoom(contextId);
    if (!room) return error(`Room not found: ${contextId}`);

    const info = {
      roomId: room.id,
      name: room.name,
      agents: Array.from(room.agents.values()).map((a) => ({
        name: a.name,
        joinedAt: a.joinedAt,
      })),
    };

    return reply(JSON.stringify(info, null, 2), contextId, info);
  }

  if (action === "room.list") {
    const list = await storeListRooms();
    return reply(JSON.stringify(list, null, 2), undefined, { rooms: list });
  }

  return null;
}
