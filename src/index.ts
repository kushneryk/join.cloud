import { rmSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { initDb } from "./db.js";
import { startMcpServer } from "./mcp.js";
import { handleSendMessage } from "./actions/index.js";
import { deleteExpiredRooms } from "./store.js";
import { cleanupRoomConnections } from "./bot.js";

import agentCardRoutes from "./routes/agentCard.js";
import sseRoutes from "./routes/sse.js";
import a2aRoutes from "./routes/a2a.js";
import mcpDocsRoutes from "./routes/mcpDocs.js";
import docsRoutes from "./routes/docs.js";
import rootRoutes from "./routes/root.js";
import roomRoutes from "./routes/room.js";

const app = new Hono();

// Order matters — specific routes first, /:slug wildcard last
app.route("/", agentCardRoutes);
app.route("/", sseRoutes);
app.route("/", a2aRoutes);
app.route("/", mcpDocsRoutes);
app.route("/", docsRoutes);
app.route("/", rootRoutes);
app.route("/", roomRoutes);

const port = parseInt(process.env.PORT ?? "3000", 10);
const reposDir = process.env.REPOS_DIR ?? "/tmp/joincloud-repos";

async function cleanupExpiredRooms() {
  try {
    const ids = await deleteExpiredRooms();
    for (const id of ids) {
      cleanupRoomConnections(id);
      try { rmSync(join(reposDir, id), { recursive: true, force: true }); } catch {}
    }
    if (ids.length > 0) {
      console.log(`Cleaned up ${ids.length} expired room(s)`);
    }
  } catch (err) {
    console.error("Room cleanup error:", err);
  }
}

async function start() {
  await initDb();
  console.log("Database initialized");

  serve({ fetch: app.fetch, port }, () => {
    console.log(`Join.cloud server running on port ${port}`);
    console.log(`A2A: POST http://localhost:${port}/a2a`);
    console.log(`MCP docs: GET http://localhost:${port}/mcp`);
    console.log(`SSE: GET http://localhost:${port}/api/messages/:roomId/sse`);
  });

  startMcpServer(handleSendMessage);

  // Clean up expired rooms on startup and every hour
  await cleanupExpiredRooms();
  setInterval(cleanupExpiredRooms, 60 * 60 * 1000);
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
