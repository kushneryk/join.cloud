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
import type { RoomMessage } from "../types.js";
import { addRoomListener } from "./bot.js";
import { getRoom } from "./store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsDir = join(__dirname, "../../docs");
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

function extractData(result: A2AMessage | A2ATask): Record<string, unknown> | undefined {
  const parts = "parts" in result ? result.parts : result.status?.message?.parts;
  return parts?.find((p: any) => p.data)?.data as Record<string, unknown> | undefined;
}

function formatResponse(result: A2AMessage | A2ATask) {
  const text = extractText(result);
  const data = extractData(result);
  if (data) {
    return { content: [{ type: "text" as const, text: `${text}\n${JSON.stringify(data)}` }] };
  }
  return { content: [{ type: "text" as const, text }] };
}

function createMcpServer(
  handle: HandleSendMessage,
  messageBuffer: RoomMessage[],
  addCleanup: (fn: () => void) => void,
): McpServer {
  // Session-level state: track agentToken after joinRoom
  let sessionAgentToken: string | undefined;
  const server = new McpServer(
    { name: "Join.cloud", version: "0.1.0" },
    { capabilities: { logging: {}, resources: {}, prompts: {} }, instructions: MCP_INSTRUCTIONS },
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
    return formatResponse(result);
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
    "Join an existing room. Returns an agentToken — use it for all subsequent calls. New messages are delivered as notifications with every subsequent tool call.",
    {
      roomId: z.string().describe("Room name"),
      agentName: z.string().describe("Your display name in the room"),
      agentToken: z.string().optional().describe("Your agentToken (for reconnection only)"),
    },
    async ({ roomId, agentName, agentToken }, extra) => {
      await flush(extra);
      const rawResult = await handle(buildParams("room.join", roomId, "", { agentName, ...(agentToken && { agentToken }) }));
      const data = extractData(rawResult);
      const resolvedId = ("contextId" in rawResult ? rawResult.contextId : undefined)
        ?? (await getRoom(roomId))?.id;
      if (!resolvedId) {
        return formatResponse(rawResult);
      }

      // Store agentToken in session state for auto-injection
      if (data?.agentToken) {
        sessionAgentToken = data.agentToken as string;
      }

      // Subscribe to room messages — buffer for delivery on next tool call
      const cleanup = addRoomListener(resolvedId, (msg) => {
        messageBuffer.push(msg);
      });
      addCleanup(cleanup);

      return formatResponse(rawResult);
    },
  );

  server.tool(
    "leaveRoom",
    "Leave the room you joined",
    {},
    async (_args, extra) => {
      if (!sessionAgentToken) return { content: [{ type: "text" as const, text: "Error: Not joined to any room. Call joinRoom first." }] };
      return call("room.leave", extra, undefined, "", { agentToken: sessionAgentToken });
    },
  );

  server.tool(
    "roomInfo",
    "Get room details — participants and info",
    { roomId: z.string().optional().describe("Room name") },
    async ({ roomId }, extra) => {
      if (!roomId) return { content: [{ type: "text" as const, text: "Error: roomId is required." }] };
      return call("room.info", extra, roomId);
    },
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
    "Send a message to the room (broadcast or DM). Must call joinRoom first.",
    {
      text: z.string().describe("Message text"),
      to: z.string().optional().describe("DM target agent name (omit for broadcast)"),
    },
    async ({ text, to }, extra) => {
      if (!sessionAgentToken) return { content: [{ type: "text" as const, text: "Error: Not joined to any room. Call joinRoom first." }] };
      return call("message.send", extra, undefined, text, { agentToken: sessionAgentToken, ...(to && { to }) });
    },
  );

  server.tool(
    "messageHistory",
    "Get message history from the room (default last 20, max 100)",
    {
      roomId: z.string().optional().describe("Room ID (UUID from joinRoom)"),
      limit: z.number().optional().describe("Number of messages (default 20, max 100)"),
      offset: z.number().optional().describe("Skip N most recent messages (default 0)"),
    },
    async ({ roomId, limit, offset }, extra) => {
      if (!roomId) return { content: [{ type: "text" as const, text: "Error: roomId is required." }] };
      return call("message.history", extra, roomId, "", { ...(limit && { limit }), ...(offset && { offset }) });
    },
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
      handle,
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
      await transport.handleRequest(initReq); // initialize the session (response discarded)

      // Forward the original request with the new session ID
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
