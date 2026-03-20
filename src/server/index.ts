import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { JoinCloudServer } from "./server.js";
import { createSqliteStore } from "./storage/sqlite.js";
import { registerRoomMethods } from "./actions/room.js";
import { registerMessageMethods } from "./actions/messages.js";
import { setWebsiteRegistry } from "./website/index.js";
import { setBotStore } from "./bot.js";

// Protocols — each protocol registers its own adapters + routes
import { registerA2aAdapters, createA2aRoutes, createAgentCardRoutes, startA2aPushDelivery } from "./protocols/a2a/index.js";
import { registerMcpAdapters, startMcpServer } from "./protocols/mcp/index.js";

// Non-protocol routes
import { createSseRoutes } from "./routes/sse.js";
import { createGitRoutes } from "./routes/git.js";

// Website routes
import staticRoutes from "./website/routes/static.js";
import mcpDocsRoutes from "./website/routes/mcp-docs.js";
import docsRoutes from "./website/routes/docs.js";
import rootRoutes from "./website/routes/root.js";
import { createRoomRoutes } from "./website/routes/room.js";

import type { Store } from "./storage/interface.js";
import type { MethodRegistry } from "./registry.js";

export function createDefaultServer(): JoinCloudServer {
  const store = createSqliteStore();
  const server = new JoinCloudServer({ store });

  // Register core methods (protocol-agnostic)
  registerRoomMethods(server);
  registerMessageMethods(server);

  // Register protocol adapters
  registerA2aAdapters(server);
  registerMcpAdapters(server);

  return server;
}

// Default website routes — used when no override is provided
export function createWebsiteRoutes(store: Store, registry: MethodRegistry, baseUrl: string): Hono {
  const website = new Hono();
  setWebsiteRegistry(registry);
  website.route("/", staticRoutes);
  website.route("/", mcpDocsRoutes);
  website.route("/", docsRoutes);
  website.route("/", rootRoutes);
  website.route("/", createRoomRoutes(store));
  return website;
}

export interface StartServerOptions {
  websiteRoutes?: Hono;
}

export function startServer(customServer?: JoinCloudServer, options?: StartServerOptions) {
  const server = customServer ?? createDefaultServer();
  const port = parseInt(process.env.PORT ?? "3000", 10);
  const baseUrl = process.env.BASE_URL ?? `http://localhost:${port}`;

  // Wire up store to broadcast system
  setBotStore(server.store);
  startA2aPushDelivery();

  const app = new Hono();

  // API & protocol routes (always mounted)
  app.route("/", createAgentCardRoutes(server.registry, baseUrl));
  app.route("/", createSseRoutes(server.store));
  app.route("/", createA2aRoutes(server.registry, server.store));
  app.route("/", createGitRoutes(server.store));

  // Website routes — use override or default
  const website = options?.websiteRoutes ?? createWebsiteRoutes(server.store, server.registry, baseUrl);
  app.route("/", website);

  // Mount any custom routes from the server
  app.route("/", server.app);

  const httpServer = serve({ fetch: app.fetch, port }, () => {
    console.log(`Join.cloud server running on port ${port}`);
    console.log(`A2A: POST http://localhost:${port}/a2a`);
    console.log(`MCP docs: GET http://localhost:${port}/mcp`);
    console.log(`SSE: GET http://localhost:${port}/api/messages/:roomId/sse`);
  });

  const mcpServer = startMcpServer(server.registry, server.store);

  return { httpServer, mcpServer, server };
}

// Re-export for consumers
export { JoinCloudServer } from "./server.js";
export { MethodRegistry } from "./registry.js";
export type { MethodDeclaration, MethodResult, MethodContext, BeforeProcessor, AfterProcessor } from "./registry.js";
export type { McpAdapter } from "./protocols/mcp/types.js";
export type { A2aAdapter } from "./protocols/a2a/types.js";
export type { HttpAdapter } from "./protocols/http/types.js";
export type { Store } from "./storage/interface.js";

// Bot/broadcast system
export { setBotStore, botNotify, broadcastToRoom, addSseClient, addRoomListener } from "./bot.js";

// Protocol routes & setup
export { createA2aRoutes, createAgentCardRoutes, startA2aPushDelivery } from "./protocols/a2a/index.js";
export { startMcpServer } from "./protocols/mcp/index.js";

// Non-protocol routes
export { createSseRoutes } from "./routes/sse.js";
export { createGitRoutes } from "./routes/git.js";

// Git utilities
export { initRepo, repoDir, REPOS_DIR } from "./git.js";

// Domain types
export type { Room, Agent, RoomMessage } from "./types.js";

// Website & docs
export { setWebsiteRegistry } from "./website/index.js";
export { DOCS as DOC_BLOCKS, HEADER as DOC_HEADER, generateA2aMethodsTable, generateMcpMethodsTable } from "./website/docs.js";

// Auto-start when run directly (npm start / node dist/server/index.js)
const isDirectRun = process.argv[1]?.endsWith("server/index.js");
if (isDirectRun) {
  const server = createDefaultServer();
  server.store.init().then(() => {
    console.log("Database initialized");
    startServer(server);
  }).catch((err) => {
    console.error("Failed to start:", err);
    process.exit(1);
  });
}
