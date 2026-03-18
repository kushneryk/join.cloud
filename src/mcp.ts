import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SendMessageParams, A2AMessage, A2ATask } from "./a2a.js";
import type { RoomMessage } from "./types.js";
import { addRoomListener } from "./bot.js";
import { getRoom } from "./store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsDir = join(__dirname, "../docs");
const MCP_INSTRUCTIONS = readFileSync(join(docsDir, "connect-mcp.md"), "utf-8");

type HandleSendMessage = (params: SendMessageParams) => Promise<A2AMessage | A2ATask>;

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

function buildParams(action: string, roomId?: string, text?: string, extra?: Record<string, unknown>): SendMessageParams {
  return {
    message: {
      role: "user",
      parts: [{ text: text ?? "" }],
      ...(roomId && { contextId: roomId }),
      metadata: { action, ...extra },
    },
  };
}

function extractText(result: A2AMessage | A2ATask): string {
  const parts = "parts" in result ? result.parts : result.status?.message?.parts;
  return parts?.find((p: any) => p.text)?.text ?? "OK";
}

function createMcpServer(
  handle: HandleSendMessage,
  messageBuffer: RoomMessage[],
  addCleanup: (fn: () => void) => void,
): McpServer {
  const server = new McpServer(
    { name: "Join.cloud", version: "0.1.0" },
    { capabilities: { logging: {} }, instructions: MCP_INSTRUCTIONS },
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

  async function call(action: string, extra: any, roomId?: string, text?: string, params?: Record<string, unknown>) {
    await flush(extra);
    const result = await handle(buildParams(action, roomId, text, params));
    return { content: [{ type: "text" as const, text: extractText(result) }] };
  }

  // --- Room tools ---

  server.tool(
    "createRoom",
    "Create a new collaboration room",
    { name: z.string().optional().describe("Room name") },
    async ({ name }, extra) => call("room.create", extra, undefined, name ?? ""),
  );

  server.tool(
    "joinRoom",
    "Join an existing room. New messages are delivered as notifications with every subsequent tool call.",
    {
      roomId: z.string().describe("Room name"),
      agentName: z.string().describe("Your name in the room"),
    },
    async ({ roomId, agentName }, extra) => {
      await flush(extra);
      const rawResult = await handle(buildParams("room.join", roomId, "", { agentName }));
      const resolvedId = ("contextId" in rawResult ? rawResult.contextId : undefined)
        ?? (await getRoom(roomId))?.id;
      if (!resolvedId) {
        return { content: [{ type: "text" as const, text: extractText(rawResult) }] };
      }

      // Subscribe to room messages — buffer for delivery on next tool call
      const cleanup = addRoomListener(resolvedId, (msg) => {
        messageBuffer.push(msg);
      });
      addCleanup(cleanup);

      return { content: [{ type: "text" as const, text: extractText(rawResult) }] };
    },
  );

  server.tool(
    "leaveRoom",
    "Leave a room",
    {
      roomId: z.string().describe("Room name"),
      agentName: z.string().describe("Your name"),
    },
    async ({ roomId, agentName }, extra) => call("room.leave", extra, roomId, "", { agentName }),
  );

  server.tool(
    "roomInfo",
    "Get room details — participants and info",
    { roomId: z.string().describe("Room name") },
    async ({ roomId }, extra) => call("room.info", extra, roomId),
  );

  server.tool(
    "listRooms",
    "List all available rooms",
    {},
    async (_args, extra) => call("room.list", extra),
  );

  // --- Message tools ---

  server.tool(
    "sendMessage",
    "Send a message to the room (broadcast or DM)",
    {
      roomId: z.string().describe("Room ID (UUID from joinRoom)"),
      agentName: z.string().describe("Your name"),
      text: z.string().describe("Message text"),
      to: z.string().optional().describe("DM target agent name (omit for broadcast)"),
    },
    async ({ roomId, agentName, text, to }, extra) =>
      call("message.send", extra, roomId, text, { agentName, ...(to && { to }) }),
  );

  server.tool(
    "messageHistory",
    "Get message history from the room (default last 20, max 100)",
    {
      roomId: z.string().describe("Room ID (UUID from joinRoom)"),
      limit: z.number().optional().describe("Number of messages (default 20, max 100)"),
      offset: z.number().optional().describe("Skip N most recent messages (default 0)"),
    },
    async ({ roomId, limit, offset }, extra) =>
      call("message.history", extra, roomId, "", { ...(limit && { limit }), ...(offset && { offset }) }),
  );

  return server;
}

export function startMcpServer(handle: HandleSendMessage) {
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

    // Stale session ID — tell client to re-initialize
    if (sessionId) {
      return c.json(
        { jsonrpc: "2.0", error: { code: -32000, message: "Session expired. Please reconnect." }, id: null },
        404,
      );
    }

    // New session (no session ID = initialize request)
    const cleanups: Array<() => void> = [];
    const messageBuffer: RoomMessage[] = [];

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => {
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
      handle,
      messageBuffer,
      (fn) => cleanups.push(fn),
    );
    await server.connect(transport);
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
}
