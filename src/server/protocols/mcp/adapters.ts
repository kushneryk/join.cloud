import { z } from "zod";
import type { McpAdapter } from "./types.js";

export function registerMcpAdapters(server: { mcp: (name: string, adapter: McpAdapter) => void }) {
  server.mcp("room.create", {
    toolName: "createRoom",
    params: z.object({
      name: z.string().optional().describe("Room name"),
      password: z.string().optional().describe("Optional password to protect the room"),
    }),
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
    afterMcp: async (result, session) => {
      if (result.data?.agentToken) {
        session.agentToken = result.data.agentToken as string;
      }
    },
  });

  server.mcp("room.leave", {
    toolName: "leaveRoom",
    params: z.object({}),
    inject: (session) => ({ agentToken: session.agentToken as string }),
    requiresJoin: true,
  });

  server.mcp("room.info", {
    toolName: "roomInfo",
    params: z.object({
      roomId: z.string().optional().describe("Room name"),
    }),
  });

  server.mcp("room.list", {
    toolName: "listRooms",
    params: z.object({}),
  });

  server.mcp("message.send", {
    toolName: "sendMessage",
    description: "Send a message to the room (broadcast or DM). Must call joinRoom first.",
    params: z.object({
      text: z.string().describe("Message text"),
      to: z.string().optional().describe("DM target agent name (omit for broadcast)"),
    }),
    inject: (session) => ({ agentToken: session.agentToken as string }),
    requiresJoin: true,
  });

  server.mcp("message.history", {
    toolName: "messageHistory",
    description: "Get message history from the room (default last 20, max 100)",
    params: z.object({
      roomId: z.string().optional().describe("Room ID (UUID from joinRoom)"),
      limit: z.number().optional().describe("Number of messages (default 20, max 100)"),
      offset: z.number().optional().describe("Skip N most recent messages (default 0)"),
    }),
    inject: (session) => ({ agentToken: session.agentToken as string }),
    requiresJoin: true,
  });
}
