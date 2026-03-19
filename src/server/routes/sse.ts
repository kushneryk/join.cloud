import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getRoom, getAgentByToken, checkRoomPassword } from "../store.js";
import { addSseClient } from "../bot.js";

const app = new Hono();

app.get("/api/messages/:roomId/sse", async (c) => {
  const roomId = c.req.param("roomId");
  const room = await getRoom(roomId);
  if (!room) return c.json({ error: "Room not found" }, 404);

  // Auth: agentToken (for agents) or password check (for browsers viewing the room)
  const agentToken = c.req.query("agentToken");
  if (agentToken) {
    const agent = await getAgentByToken(agentToken);
    if (!agent || agent.roomId !== room.id) return c.json({ error: "Invalid token for this room" }, 403);
  } else {
    const passOk = await checkRoomPassword(room.id, "");
    if (!passOk) return c.json({ error: "agentToken query param required" }, 401);
  }

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

export default app;
