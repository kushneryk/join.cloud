import type { A2AMessage } from "../a2a.js";
import { reply, error, replyWithCatchUp } from "../helpers.js";
import {
  createRoom as storeCreateRoom,
  getRoom,
  listRooms as storeListRooms,
  addAgent,
  removeAgent,
  checkRoomPassword,
  agentExistsInRoom,
  getRoomsByName,
} from "../store.js";
import { botNotify } from "../bot.js";
import { listFiles, getPendingCommits } from "../git.js";

export async function handleRoomAction(
  action: string,
  text: string,
  contextId: string | undefined,
  metadata: Record<string, unknown> | undefined,
): Promise<A2AMessage | null> {
  const agentName = metadata?.agentName as string | undefined;
  const agentEndpoint = metadata?.agentEndpoint as string | undefined;

  if (action === "room.create") {
    const roomId = crypto.randomUUID();
    const name = (text || roomId).toLowerCase();
    const password = metadata?.password as string | undefined;

    // Reserved names (used for doc pages)
    const RESERVED = ["a2a", "mcp", "docs"];
    if (RESERVED.includes(name.toLowerCase())) {
      return error(`Room name "${name}" is reserved.`);
    }

    // Validate name:password uniqueness rules
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
    if (exists) return error(`Agent name "${agentName}" is already taken in this room`);

    try {
      await addAgent(contextId, agentName, agentEndpoint);
    } catch {
      return error(`Agent name "${agentName}" is already taken in this room`);
    }
    await botNotify(contextId, `${agentName} joined the room`);

    return replyWithCatchUp(`Joined room ${contextId} as ${agentName}`, contextId, agentName, {
      roomId: contextId,
      agentName,
    });
  }

  if (action === "room.leave") {
    if (!contextId) return error("contextId (roomId) required");
    const room = await getRoom(contextId);
    if (!room) return error(`Room not found: ${contextId}`);
    if (!agentName) return error("agentName required in metadata");

    if (!room.agents.has(agentName)) return error(`Agent "${agentName}" is not in this room`);

    await removeAgent(contextId, agentName);
    await botNotify(contextId, `${agentName} left the room`);

    return reply(`Left room ${contextId}`, contextId);
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
      fileCount: (await listFiles(contextId)).length,
      pendingCommits: (await getPendingCommits(contextId)).length,
    };

    return reply(JSON.stringify(info, null, 2), contextId, info);
  }

  if (action === "room.list") {
    const list = await storeListRooms();
    return reply(JSON.stringify(list, null, 2), undefined, { rooms: list });
  }

  return null;
}
