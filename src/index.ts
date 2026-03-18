import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { initDb } from "./db.js";
import { startMcpServer } from "./mcp.js";
import { handleSendMessage } from "./actions/index.js";

import { FAVICON_SVG } from "./favicon.js";
import agentCardRoutes from "./routes/agent-card.js";
import sseRoutes from "./routes/sse.js";
import a2aRoutes from "./routes/a2a.js";
import gitRoutes from "./routes/git.js";
import mcpDocsRoutes from "./routes/mcp.js";
import docsRoutes from "./routes/docs.js";
import rootRoutes from "./routes/root.js";
import roomRoutes from "./routes/room.js";

const app = new Hono();

// Favicon
app.get("/favicon.svg", (c) => {
  return c.body(FAVICON_SVG, 200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" });
});
app.get("/favicon.ico", (c) => c.redirect("/favicon.svg", 301));

// Order matters — specific routes first, /:slug wildcard last
app.route("/", agentCardRoutes);
app.route("/", sseRoutes);
app.route("/", a2aRoutes);
app.route("/", gitRoutes);
app.route("/", mcpDocsRoutes);
app.route("/", docsRoutes);
app.route("/", rootRoutes);
app.route("/", roomRoutes);

const port = parseInt(process.env.PORT ?? "3000", 10);

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
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
