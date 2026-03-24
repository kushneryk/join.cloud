import { z } from "zod";
import type { JoinCloudServer } from "../server.js";
import { botNotify } from "../bot.js";
import { getMissedMessages } from "../helpers.js";

const RESERVED = ["a2a", "mcp", "docs"];

function validateEndpointUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid endpoint URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Endpoint URL must use http or https");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]" || hostname === "0.0.0.0") {
    throw new Error("Endpoint URL must not point to localhost");
  }
  const parts = hostname.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) {
    const [a, b] = parts.map(Number);
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 127 || a === 0) {
      throw new Error("Endpoint URL must not point to a private IP address");
    }
  }
}

export function registerRoomMethods(server: JoinCloudServer) {
  server.method("room.create", {
    description: "Create a new room",
    params: z.object({
      name: z.string().optional().describe("Room name"),
      password: z.string().optional().describe("Optional password to protect the room"),
    }),
    returns: z.object({
      roomId: z.string(),
      name: z.string(),
      passwordProtected: z.boolean(),
    }),
    handler: async (params, ctx) => {
      const roomId = crypto.randomUUID();
      const name = (params.name || roomId).toLowerCase();

      if (RESERVED.includes(name.toLowerCase())) {
        throw new Error(`Room name "${name}" is reserved.`);
      }

      const existing = await ctx.store.getRoomsByName(name);
      if (existing.length > 0) {
        if (!params.password && existing.some((r) => r.hasPassword)) {
          throw new Error(`Password-protected room "${name}" already exists. You must provide a password.`);
        }
      }

      try {
        await ctx.store.createRoom(roomId, name, params.password);
      } catch (e: any) {
        if (e?.code === "23505") {
          throw new Error(`Room "${name}" already exists${params.password ? " with this password" : ""}.`);
        }
        throw e;
      }

      return {
        text: `Room created: ${roomId}${params.password ? " (password protected)" : ""}`,
        contextId: roomId,
        data: { roomId, name, passwordProtected: !!params.password },
      };
    },
  });

  server.method("room.join", {
    description: "Join a room. Returns agentToken for all subsequent calls. Pass agentToken to reconnect.",
    params: z.object({
      roomId: z.string().describe("Room ID or name"),
      agentName: z.string().describe("Your display name in the room"),
      agentToken: z.string().optional().describe("Your agentToken (for reconnection only)"),
      agentEndpoint: z.string().optional().describe("A2A endpoint URL for receiving messages"),
      password: z.string().optional().describe("Room password"),
    }),
    returns: z.object({
      roomId: z.string(),
      agentName: z.string(),
      agentToken: z.string(),
    }),
    handler: async (params, ctx) => {
      if (params.agentEndpoint) validateEndpointUrl(params.agentEndpoint);

      const room = await ctx.store.getRoom(params.roomId);
      if (!room) throw new Error(`Room not found: ${params.roomId}`);

      const password = params.password ?? "";
      const passOk = await ctx.store.checkRoomPassword(room.id, password);
      if (!passOk) throw new Error("Invalid room password");

      const roomId = room.id;
      const exists = await ctx.store.agentExistsInRoom(roomId, params.agentName);

      if (exists) {
        const existingToken = await ctx.store.getAgentToken(roomId, params.agentName);
        if (!params.agentToken || params.agentToken !== existingToken) {
          throw new Error(`Agent name "${params.agentName}" is already taken in this room. If you own this name, use your agentToken to reconnect.`);
        }
        await ctx.store.updateAgentEndpoint(params.agentToken, params.agentEndpoint);
        const missed = await getMissedMessages(ctx.store, roomId, params.agentName);
        return {
          text: `Reconnected to room ${roomId} as ${params.agentName}`,
          contextId: roomId,
          data: {
            roomId,
            agentName: params.agentName,
            agentToken: existingToken!,
            ...(missed.length > 0 && { missedMessages: missed, missedCount: missed.length }),
          },
        };
      }

      const token = await ctx.store.addAgent(roomId, params.agentName, params.agentEndpoint);
      await botNotify(roomId, `${params.agentName} joined the room`);
      const missed = await getMissedMessages(ctx.store, roomId, params.agentName);

      return {
        text: `Joined room ${roomId} as ${params.agentName}`,
        contextId: roomId,
        data: {
          roomId,
          agentName: params.agentName,
          agentToken: token,
          ...(missed.length > 0 && { missedMessages: missed, missedCount: missed.length }),
        },
      };
    },
  });

  server.method("room.leave", {
    description: "Leave a room",
    params: z.object({
      agentToken: z.string().describe("Your agentToken from joinRoom"),
    }),
    handler: async (params, ctx) => {
      const agent = await ctx.store.getAgentByToken(params.agentToken);
      if (!agent) throw new Error("Invalid agentToken");

      const removed = await ctx.store.removeAgentByToken(params.agentToken);
      if (!removed) throw new Error("Failed to leave room");

      await botNotify(agent.roomId, `${agent.name} left the room`);
      return {
        text: `Left room ${agent.roomId}`,
        contextId: agent.roomId,
      };
    },
  });

  server.method("room.info", {
    description: "Get room details and participants",
    params: z.object({
      roomId: z.string().describe("Room ID or name"),
    }),
    returns: z.object({
      roomId: z.string(),
      name: z.string(),
      agents: z.array(z.object({ name: z.string(), joinedAt: z.string() })),
    }),
    handler: async (params, ctx) => {
      const room = await ctx.store.getRoom(params.roomId);
      if (!room) throw new Error(`Room not found: ${params.roomId}`);

      const info = {
        roomId: room.id,
        name: room.name,
        agents: Array.from(room.agents.values()).map((a) => ({
          name: a.name,
          joinedAt: a.joinedAt,
        })),
      };

      return {
        text: JSON.stringify(info, null, 2),
        contextId: room.id,
        data: info,
      };
    },
  });

  server.method("room.list", {
    description: "List all rooms",
    params: z.object({}),
    handler: async (_params, ctx) => {
      const list = await ctx.store.listRooms();
      return {
        text: JSON.stringify(list, null, 2),
        data: { rooms: list },
      };
    },
  });

}
