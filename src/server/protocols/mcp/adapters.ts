import { z } from "zod";
import type { McpAdapter } from "./types.js";

export function registerMcpAdapters(server: { mcp: (name: string, adapter: McpAdapter) => void }) {
  server.mcp("room.create", {
    toolName: "createRoom",
    description: "Create a new collaboration room and join as admin. Returns the room ID and agentToken for all subsequent calls.",
    params: z.object({
      name: z.string().optional().describe("Room name"),
      password: z.string().optional().describe("Optional password to protect the room"),
      agentName: z.string().describe("Your display name in the room"),
      description: z.string().optional().describe("Room description (max 5000 chars)"),
      type: z.enum(["group", "channel"]).optional().describe("Room type: group (default) or channel (admin-only posting)"),
    }),
    annotations: {
      title: "Create Room",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    afterMcp: async (result, session) => {
      if (result.data?.agentToken) {
        session.agentToken = result.data.agentToken as string;
      }
    },
  });

  server.mcp("room.join", {
    toolName: "joinRoom",
    description: "Join an existing room. Returns an agentToken — use it for all subsequent calls. New messages are delivered as notifications with every subsequent tool call.",
    params: z.object({
      roomId: z.string().describe("Room name (or name:password for password-protected rooms)"),
      agentName: z.string().describe("Your display name in the room"),
      password: z.string().optional().describe("Room password (alternative to name:password syntax)"),
      agentToken: z.string().optional().describe("Your agentToken (for reconnection only)"),
    }),
    annotations: {
      title: "Join Room",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    afterMcp: async (result, session) => {
      if (result.data?.agentToken) {
        session.agentToken = result.data.agentToken as string;
      }
    },
  });

  server.mcp("room.leave", {
    toolName: "leaveRoom",
    description: "Leave the current room and release your agent name.",
    params: z.object({}),
    annotations: {
      title: "Leave Room",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    inject: (session) => ({ agentToken: session.agentToken as string }),
    requiresJoin: true,
  });

  server.mcp("room.info", {
    toolName: "roomInfo",
    description: "Get room details including name, description, type, participants, and their roles.",
    params: z.object({
      roomId: z.string().optional().describe("Room name"),
    }),
    annotations: {
      title: "Room Info",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  });

  server.mcp("room.list", {
    toolName: "listRooms",
    description: "List public rooms on the server. Sorted alphabetically.",
    params: z.object({
      search: z.string().optional().describe("Wildcard search by room name"),
      limit: z.number().optional().describe("Number of rooms (default 20, max 100)"),
      offset: z.number().optional().describe("Skip N rooms (default 0)"),
    }),
    annotations: {
      title: "List Rooms",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  });

  server.mcp("message.send", {
    toolName: "sendMessage",
    description: "Send a message to the room (broadcast or DM). Must call joinRoom first.",
    params: z.object({
      text: z.string().describe("Message text"),
      to: z.string().optional().describe("DM target agent name (omit for broadcast)"),
    }),
    annotations: {
      title: "Send Message",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inject: (session) => ({ agentToken: session.agentToken as string }),
    requiresJoin: true,
  });

  server.mcp("message.history", {
    toolName: "messageHistory",
    description: "Get message history from the room (default last 20, max 100).",
    params: z.object({
      roomId: z.string().optional().describe("Room ID (UUID from joinRoom)"),
      limit: z.number().optional().describe("Number of messages (default 20, max 100)"),
      offset: z.number().optional().describe("Skip N most recent messages (default 0)"),
    }),
    annotations: {
      title: "Message History",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inject: (session) => ({ agentToken: session.agentToken as string }),
    requiresJoin: true,
  });

  server.mcp("message.unread", {
    toolName: "unreadMessages",
    description: "Get unread messages since your last check. Marks them as read.",
    params: z.object({}),
    annotations: {
      title: "Unread Messages",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inject: (session) => ({ agentToken: session.agentToken as string }),
    requiresJoin: true,
  });

  server.mcp("room.promote", {
    toolName: "promoteAgent",
    description: "Promote a member to admin (admin only).",
    params: z.object({
      targetAgent: z.string().describe("Agent name to promote"),
    }),
    annotations: {
      title: "Promote Agent",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inject: (session) => ({ agentToken: session.agentToken as string }),
    requiresJoin: true,
  });

  server.mcp("room.demote", {
    toolName: "demoteAgent",
    description: "Demote an admin to member (admin only).",
    params: z.object({
      targetAgent: z.string().describe("Agent name to demote"),
    }),
    annotations: {
      title: "Demote Agent",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inject: (session) => ({ agentToken: session.agentToken as string }),
    requiresJoin: true,
  });

  server.mcp("room.kick", {
    toolName: "kickAgent",
    description: "Remove an agent from the room (admin only).",
    params: z.object({
      targetAgent: z.string().describe("Agent name to kick"),
    }),
    annotations: {
      title: "Kick Agent",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    inject: (session) => ({ agentToken: session.agentToken as string }),
    requiresJoin: true,
  });

  server.mcp("room.update", {
    toolName: "updateRoom",
    description: "Update room description and/or type (admin only).",
    params: z.object({
      description: z.string().optional().describe("Room description (max 5000 chars)"),
      type: z.enum(["group", "channel"]).optional().describe("Room type: group or channel"),
    }),
    annotations: {
      title: "Update Room",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inject: (session) => ({ agentToken: session.agentToken as string }),
    requiresJoin: true,
  });
}
