import { z } from "zod";
import type { RoomMessage } from "../types.js";
import type { JoinCloudServer } from "../server.js";
import { broadcastToRoom } from "../bot.js";
import { getMissedMessages } from "../helpers.js";

export function registerMessageMethods(server: JoinCloudServer) {
  server.method("message.send", {
    description: "Send a message to the room (broadcast or DM)",
    params: z.object({
      text: z.string().describe("Message text"),
      agentToken: z.string().describe("Your agentToken from joinRoom"),
      to: z.string().optional().describe("DM target agent name (omit for broadcast)"),
    }),
    handler: async (params, ctx) => {
      const agent = await ctx.store.getAgentByToken(params.agentToken);
      if (!agent) throw new Error("Invalid agentToken");

      const roomId = agent.roomId;
      const room = await ctx.store.getRoomById(roomId);
      if (!room) throw new Error(`Room not found: ${roomId}`);

      const roomMsg: RoomMessage = {
        id: crypto.randomUUID(),
        roomId,
        from: agent.name,
        to: params.to,
        body: params.text,
        timestamp: new Date().toISOString(),
      };

      await ctx.store.addMessage(roomMsg);
      await broadcastToRoom(roomId, roomMsg);
      const missed = await getMissedMessages(ctx.store, roomId, agent.name);

      return {
        text: "Message sent",
        contextId: roomId,
        data: {
          ...(missed.length > 0 && { missedMessages: missed, missedCount: missed.length }),
        },
      };
    },
  });

  server.method("message.history", {
    description: "Get message history (default last 20, max 100)",
    params: z.object({
      roomId: z.string().describe("Room ID"),
      agentToken: z.string().describe("Your agentToken from joinRoom"),
      limit: z.number().optional().describe("Number of messages (default 20, max 100)"),
      offset: z.number().optional().describe("Skip N most recent messages (default 0)"),
    }),
    handler: async (params, ctx) => {
      const agent = await ctx.store.getAgentByToken(params.agentToken);
      if (!agent) throw new Error("Invalid agentToken");
      if (agent.roomId !== params.roomId) throw new Error("agentToken does not belong to this room");

      const room = await ctx.store.getRoomById(params.roomId);
      if (!room) throw new Error(`Room not found: ${params.roomId}`);

      const { messages, total } = await ctx.store.getRoomMessages(params.roomId, params.limit ?? 20, params.offset ?? 0);
      return {
        text: JSON.stringify(messages, null, 2),
        contextId: params.roomId,
        data: { messages, total },
      };
    },
  });

}
