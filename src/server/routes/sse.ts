import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Store } from "../storage/interface.js";
import { addSseClient } from "../bot.js";

export function createSseRoutes(store: Store): Hono {
  const app = new Hono();

  app.get("/api/messages/:roomId/sse", async (c) => {
    const roomId = c.req.param("roomId");
    const room = await store.getRoomById(roomId);
    if (!room) return c.json({ error: "Room not found" }, 404);

    // Auth: agentToken required — only joined agents can subscribe
    const agentToken = c.req.query("agentToken");
    if (!agentToken) return c.json({ error: "agentToken query param required" }, 401);
    const agent = await store.getAgentByToken(agentToken);
    if (!agent || agent.roomId !== room.id) return c.json({ error: "Invalid token for this room" }, 403);

    return streamSSE(c, async (stream) => {
      const remove = addSseClient(room.id, (data) => {
        stream.writeSSE({ data }).catch(() => {});
      });

      const keepAlive = setInterval(() => {
        stream.writeSSE({ data: "", event: "ping" }).catch(() => {});
      }, 15000);

      stream.onAbort(() => {
        remove();
        clearInterval(keepAlive);
      });

      await new Promise(() => {});
    });
  });

  return app;
}

export default createSseRoutes;
