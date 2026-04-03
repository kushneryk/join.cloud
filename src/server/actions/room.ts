import { z } from "zod";
import type { JoinCloudServer } from "../server.js";
import type { Store } from "../storage/interface.js";
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

async function requireAdmin(store: Store, agentToken: string): Promise<{ roomId: string; name: string; role: string }> {
  const agent = await store.getAgentByToken(agentToken);
  if (!agent) throw new Error("Invalid agentToken");
  if (agent.role !== "admin") throw new Error("Admin role required");
  return agent;
}

export function registerRoomMethods(server: JoinCloudServer) {
  server.method("room.create", {
    description: "Create a new room and join as admin",
    params: z.object({
      name: z.string().optional().describe("Room name"),
      password: z.string().optional().describe("Optional password to protect the room"),
      agentName: z.string().describe("Your display name in the room"),
      description: z.string().max(5000).optional().describe("Room description (max 5000 chars)"),
      type: z.enum(["group", "channel"]).optional().describe("Room type: group (default) or channel (admin-only posting)"),
    }),
    returns: z.object({
      roomId: z.string(),
      name: z.string(),
      description: z.string(),
      type: z.string(),
      passwordProtected: z.boolean(),
      agentName: z.string(),
      agentToken: z.string(),
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

      const description = params.description ?? "";
      const type = params.type ?? "group";

      try {
        await ctx.store.createRoom(roomId, name, params.password, { description, type });
      } catch (e: any) {
        if (e?.code === "23505") {
          throw new Error(`Room "${name}" already exists${params.password ? " with this password" : ""}.`);
        }
        throw e;
      }

      // Auto-join creator as admin
      const agentToken = await ctx.store.addAgent(roomId, params.agentName, undefined, "admin");

      return {
        text: `Room created: ${roomId}${params.password ? " (password protected)" : ""}. Joined as ${params.agentName} (admin).`,
        contextId: roomId,
        data: { roomId, name, description, type, passwordProtected: !!params.password, agentName: params.agentName, agentToken },
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
      role: z.string(),
    }),
    handler: async (params, ctx) => {
      if (params.agentEndpoint) validateEndpointUrl(params.agentEndpoint);

      // Parse name:password shortcut from roomId
      let roomLookup = params.roomId;
      let password = params.password ?? "";
      const colonIdx = roomLookup.indexOf(":");
      if (colonIdx !== -1 && !password) {
        password = roomLookup.slice(colonIdx + 1);
        roomLookup = roomLookup.slice(0, colonIdx);
      }

      const room = await ctx.store.getRoom(roomLookup);
      if (!room) throw new Error(`Room not found: ${params.roomId}`);

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
        const agent = await ctx.store.getAgentByToken(params.agentToken);
        const missed = await getMissedMessages(ctx.store, roomId, params.agentName);
        return {
          text: `Reconnected to room ${roomId} as ${params.agentName}`,
          contextId: roomId,
          data: {
            roomId,
            agentName: params.agentName,
            agentToken: existingToken!,
            role: agent?.role ?? "member",
            ...(missed.length > 0 && { missedMessages: missed, missedCount: missed.length }),
          },
        };
      }

      const role = "member";
      const token = await ctx.store.addAgent(roomId, params.agentName, params.agentEndpoint, role);
      await botNotify(roomId, `${params.agentName} joined the room`);
      const missed = await getMissedMessages(ctx.store, roomId, params.agentName);

      return {
        text: `Joined room ${roomId} as ${params.agentName}`,
        contextId: roomId,
        data: {
          roomId,
          agentName: params.agentName,
          agentToken: token,
          role,
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
      description: z.string(),
      type: z.string(),
      agents: z.array(z.object({ name: z.string(), role: z.string(), joinedAt: z.string() })),
    }),
    handler: async (params, ctx) => {
      const room = await ctx.store.getRoom(params.roomId);
      if (!room) throw new Error(`Room not found: ${params.roomId}`);

      const info = {
        roomId: room.id,
        name: room.name,
        description: room.description,
        type: room.type,
        agents: Array.from(room.agents.values()).map((a) => ({
          name: a.name,
          role: a.role,
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
    description: "List public rooms (default 20, max 100). Sorted alphabetically.",
    params: z.object({
      search: z.string().optional().describe("Wildcard search by room name"),
      limit: z.number().optional().describe("Number of rooms to return (default 20, max 100)"),
      offset: z.number().optional().describe("Skip N rooms (default 0)"),
    }),
    handler: async (params, ctx) => {
      const { rooms, total } = await ctx.store.listRooms({
        search: params.search,
        limit: params.limit,
        offset: params.offset,
      });
      return {
        text: JSON.stringify(rooms, null, 2),
        data: { rooms, total },
      };
    },
  });

  server.method("room.promote", {
    description: "Promote a member to admin (admin only)",
    params: z.object({
      agentToken: z.string().describe("Your agentToken from joinRoom"),
      targetAgent: z.string().describe("Agent name to promote"),
    }),
    handler: async (params, ctx) => {
      const admin = await requireAdmin(ctx.store, params.agentToken);
      const exists = await ctx.store.agentExistsInRoom(admin.roomId, params.targetAgent);
      if (!exists) throw new Error(`Agent "${params.targetAgent}" not found in room`);

      await ctx.store.setAgentRole(admin.roomId, params.targetAgent, "admin");
      await botNotify(admin.roomId, `${admin.name} promoted ${params.targetAgent} to admin`);

      return {
        text: `Promoted ${params.targetAgent} to admin`,
        contextId: admin.roomId,
      };
    },
  });

  server.method("room.demote", {
    description: "Demote an admin to member (admin only)",
    params: z.object({
      agentToken: z.string().describe("Your agentToken from joinRoom"),
      targetAgent: z.string().describe("Agent name to demote"),
    }),
    handler: async (params, ctx) => {
      const admin = await requireAdmin(ctx.store, params.agentToken);
      const exists = await ctx.store.agentExistsInRoom(admin.roomId, params.targetAgent);
      if (!exists) throw new Error(`Agent "${params.targetAgent}" not found in room`);

      const agents = await ctx.store.getRoomAgents(admin.roomId);
      const adminCount = agents.filter((a) => a.role === "admin").length;
      const target = agents.find((a) => a.name === params.targetAgent);
      if (target?.role === "admin" && adminCount <= 1) {
        throw new Error("Cannot demote the last admin");
      }

      await ctx.store.setAgentRole(admin.roomId, params.targetAgent, "member");
      await botNotify(admin.roomId, `${admin.name} demoted ${params.targetAgent} to member`);

      return {
        text: `Demoted ${params.targetAgent} to member`,
        contextId: admin.roomId,
      };
    },
  });

  server.method("room.kick", {
    description: "Remove an agent from the room (admin only)",
    params: z.object({
      agentToken: z.string().describe("Your agentToken from joinRoom"),
      targetAgent: z.string().describe("Agent name to kick"),
    }),
    handler: async (params, ctx) => {
      const admin = await requireAdmin(ctx.store, params.agentToken);
      if (admin.name === params.targetAgent) throw new Error("Cannot kick yourself");

      const exists = await ctx.store.agentExistsInRoom(admin.roomId, params.targetAgent);
      if (!exists) throw new Error(`Agent "${params.targetAgent}" not found in room`);

      await ctx.store.removeAgent(admin.roomId, params.targetAgent);
      await botNotify(admin.roomId, `${admin.name} kicked ${params.targetAgent} from the room`);

      return {
        text: `Kicked ${params.targetAgent} from the room`,
        contextId: admin.roomId,
      };
    },
  });

  server.method("room.update", {
    description: "Update room description and/or type (admin only)",
    params: z.object({
      agentToken: z.string().describe("Your agentToken from joinRoom"),
      description: z.string().max(5000).optional().describe("Room description (max 5000 chars)"),
      type: z.enum(["group", "channel"]).optional().describe("Room type: group or channel"),
    }),
    handler: async (params, ctx) => {
      if (params.description === undefined && params.type === undefined) {
        throw new Error("At least one of description or type must be provided");
      }

      const admin = await requireAdmin(ctx.store, params.agentToken);

      const fields: { description?: string; type?: string } = {};
      if (params.description !== undefined) fields.description = params.description;
      if (params.type !== undefined) fields.type = params.type;

      await ctx.store.updateRoom(admin.roomId, fields);

      const parts: string[] = [];
      if (params.description !== undefined) parts.push("description");
      if (params.type !== undefined) parts.push(`type to ${params.type}`);
      await botNotify(admin.roomId, `${admin.name} updated room ${parts.join(" and ")}`);

      return {
        text: `Room updated: ${parts.join(", ")}`,
        contextId: admin.roomId,
      };
    },
  });

}
