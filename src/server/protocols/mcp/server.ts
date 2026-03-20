import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { MethodRegistry, MethodContext } from "../../registry.js";
import type { Store } from "../../storage/interface.js";
import type { RoomMessage } from "../../types.js";
import { addRoomListener } from "../../bot.js";
import { generateDocs } from "../../website/docs.js";

// Active sessions with creation time for TTL cleanup
const sessions = new Map<string, {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
  cleanups: Array<() => void>;
  createdAt: number;
}>();

// Clean up stale sessions every 10 minutes (TTL: 1 hour)
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > 3600_000) {
      for (const fn of session.cleanups) fn();
      sessions.delete(id);
    }
  }
}, 600_000);

function createMcpServer(
  registry: MethodRegistry,
  store: Store,
  messageBuffer: RoomMessage[],
  addCleanup: (fn: () => void) => void,
): McpServer {
  const session: Record<string, unknown> = {};
  const mcpInstructions = generateDocs(registry);

  const server = new McpServer(
    { name: "Join.cloud", version: "0.1.0" },
    { capabilities: { logging: {}, resources: {}, prompts: {} }, instructions: mcpInstructions },
  );

  // Flush buffered room messages as MCP notifications before returning tool result
  async function flush(extra: { sendNotification: (n: any) => Promise<void> }) {
    for (const msg of messageBuffer.splice(0)) {
      await extra.sendNotification({
        method: "notifications/message" as const,
        params: {
          level: "info",
          logger: `room/${msg.roomId}`,
          data: { from: msg.from, to: msg.to, body: msg.body, timestamp: msg.timestamp },
        },
      }).catch(() => {});
    }
  }

  // Auto-generate MCP tools from registry
  for (const [methodName, decl] of registry.listMethods()) {
    const adapter = registry.getMcpAdapter(methodName);
    const toolName = adapter?.toolName ?? methodName;
    const description = adapter?.description ?? decl.description;
    const toolParams = adapter?.params ?? decl.params;

    // Extract zod shape for McpServer.tool()
    const shape = toolParams instanceof z.ZodObject
      ? (toolParams.shape as Record<string, z.ZodType>)
      : {};

    server.tool(toolName, description, shape, async (args, extra) => {
      await flush(extra);

      // Check requiresJoin
      if (adapter?.requiresJoin && !session.agentToken) {
        return { content: [{ type: "text" as const, text: "Error: Not joined to any room. Call joinRoom first." }] };
      }

      // Merge tool args with injected session values
      const fullParams = {
        ...args,
        ...(adapter?.inject?.(session) ?? {}),
      };

      const ctx: MethodContext = {
        store,
        method: methodName,
        protocol: "mcp",
        protocolMeta: { session, toolName },
      };

      try {
        const result = await registry.call(methodName, fullParams, ctx);

        // Run MCP-specific post-processing (e.g., capture agentToken, subscribe to room)
        if (adapter?.afterMcp) {
          await adapter.afterMcp(result, session, addCleanup);
        }

        // Auto-subscribe to room messages after join (if adapter set agentToken and we have a roomId)
        if (methodName === "room.join" && result.data?.roomId && session.agentToken) {
          const roomId = result.data.roomId as string;
          const cleanup = addRoomListener(roomId, (msg) => {
            messageBuffer.push(msg);
          });
          addCleanup(cleanup);
        }

        // Format response
        const text = result.text;
        const data = result.data;
        if (data) {
          return { content: [{ type: "text" as const, text: `${text}\n${JSON.stringify(data)}` }] };
        }
        return { content: [{ type: "text" as const, text }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
      }
    });
  }

  // Register empty resource/prompt list handlers for MCP spec compliance
  (server as any).setResourceRequestHandlers?.();
  (server as any).setPromptRequestHandlers?.();

  return server;
}

export function startMcpServer(registry: MethodRegistry, store: Store) {
  const mcpPort = parseInt(process.env.MCP_PORT ?? "3003", 10);
  const app = new Hono();

  app.use(
    "/mcp",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "mcp-session-id", "Last-Event-ID", "mcp-protocol-version"],
      exposeHeaders: ["mcp-session-id", "mcp-protocol-version"],
    }),
  );

  // POST /mcp — initialize or send JSON-RPC requests
  app.post("/mcp", async (c) => {
    const sessionId = c.req.header("mcp-session-id");

    if (sessionId && sessions.has(sessionId)) {
      return sessions.get(sessionId)!.transport.handleRequest(c.req.raw);
    }

    // New session or stale session — create fresh session
    const cleanups: Array<() => void> = [];
    const messageBuffer: RoomMessage[] = [];
    let newSessionId: string | undefined;

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => {
        newSessionId = id;
        sessions.set(id, { transport, server, cleanups, createdAt: Date.now() });
      },
      onsessionclosed: (id) => {
        const session = sessions.get(id);
        if (session) {
          for (const fn of session.cleanups) fn();
        }
        sessions.delete(id);
      },
    });

    const server = createMcpServer(
      registry,
      store,
      messageBuffer,
      (fn) => cleanups.push(fn),
    );
    await server.connect(transport);

    if (sessionId) {
      // Stale session — auto-initialize, then forward the original request
      const initReq = new Request(c.req.raw.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
          "mcp-protocol-version": "2025-03-26",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "recovered-session", version: "1.0" },
          },
          id: "__recovery_init__",
        }),
      });
      await transport.handleRequest(initReq);

      const body = await c.req.arrayBuffer();
      const newHeaders = new Headers(c.req.raw.headers);
      newHeaders.set("mcp-session-id", newSessionId!);
      const forwardReq = new Request(c.req.raw.url, {
        method: "POST",
        headers: newHeaders,
        body,
        // @ts-ignore — duplex required for streaming request bodies
        duplex: "half",
      });
      return transport.handleRequest(forwardReq);
    }

    return transport.handleRequest(c.req.raw);
  });

  // GET /mcp — SSE stream for server-to-client notifications
  app.get("/mcp", async (c) => {
    const sessionId = c.req.header("mcp-session-id");
    if (sessionId && sessions.has(sessionId)) {
      return sessions.get(sessionId)!.transport.handleRequest(c.req.raw);
    }
    return c.text("Session not found", 404);
  });

  // DELETE /mcp — close session
  app.delete("/mcp", async (c) => {
    const sessionId = c.req.header("mcp-session-id");
    if (sessionId && sessions.has(sessionId)) {
      return sessions.get(sessionId)!.transport.handleRequest(c.req.raw);
    }
    return c.text("Session not found", 404);
  });

  const server = serve({ fetch: app.fetch, port: mcpPort }, () => {
    console.log(`MCP server running on port ${mcpPort}`);
    console.log(`MCP endpoint: http://localhost:${mcpPort}/mcp`);
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`MCP port ${mcpPort} already in use — MCP server disabled`);
    } else {
      console.error("MCP server error:", err.message);
    }
  });

  return server;
}
