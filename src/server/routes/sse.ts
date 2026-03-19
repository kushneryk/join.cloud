import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getRoom } from "../store.js";
import { addSseClient } from "../bot.js";

const app = new Hono();

app.get("/api/messages/:roomId/sse", async (c) => {
  const roomId = c.req.param("roomId");
  const room = await getRoom(roomId);
  if (!room) return c.json({ error: "Room not found" }, 404);

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
