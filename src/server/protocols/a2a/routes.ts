import { Hono } from "hono";
import type { A2AMessage, A2ATask, JsonRpcRequest, SendMessageParams } from "./types.js";
import type { MethodRegistry, MethodContext } from "../../registry.js";
import type { Store } from "../../storage/interface.js";

// ---- A2A response helpers ----

function reply(
  text: string,
  contextId?: string,
  data?: Record<string, unknown>,
): A2AMessage {
  return {
    role: "agent",
    parts: [{ text }, ...(data ? [{ data }] : [])],
    contextId,
  };
}

function errorMsg(message: string): A2AMessage {
  return {
    role: "agent",
    parts: [{ text: `Error: ${message}` }],
  };
}

function toA2aResponse(result: { text: string; contextId?: string; data?: Record<string, unknown> }): A2AMessage {
  const parts: Array<{ text?: string; data?: unknown }> = [{ text: result.text }];
  if (result.data) {
    parts.push({ data: result.data });
  }
  if (result.data?.missedMessages) {
    const missed = result.data.missedMessages as Array<{ from: string; to?: string; body: string }>;
    const formatted = missed.map((m) => {
      const to = m.to ? ` -> ${m.to}` : "";
      return `[${m.from}${to}] ${m.body}`;
    }).join("\n");
    parts.push({ text: `\n--- ${missed.length} missed message(s) ---\n${formatted}` });
  }
  return {
    role: "agent",
    parts,
    contextId: result.contextId,
  };
}

// ---- A2A message dispatcher ----

const ACTION_ALIASES: Record<string, string> = {
  "create": "room.create",
  "join": "room.join",
  "leave": "room.leave",
  "info": "room.info",
  "list": "room.list",
  "send": "message.send",
  "history": "message.history",
};

function createHandler(registry: MethodRegistry, store: Store) {
  return async function handleSendMessage(
    params: SendMessageParams,
  ): Promise<A2AMessage | A2ATask> {
    const msg = params.message;
    const text = msg.parts.find((p) => p.text)?.text ?? "";
    let contextId = msg.contextId;
    const metadata = msg.metadata as Record<string, unknown> | undefined;

    const rawAction = metadata?.action as string | undefined;
    const action = rawAction ? (ACTION_ALIASES[rawAction] ?? rawAction) : undefined;

    // Resolve room name to ID for room.* methods
    if (contextId && action?.startsWith("room.") && action !== "room.create" && action !== "room.list") {
      const colonIdx = contextId.indexOf(":");
      if (colonIdx !== -1 && !metadata?.password) {
        if (metadata) {
          metadata.password = contextId.slice(colonIdx + 1);
        }
        contextId = contextId.slice(0, colonIdx);
      }
      const room = await store.getRoom(contextId);
      if (room) contextId = room.id;
    }

    if (action && registry.hasMethod(action)) {
      const a2aAdapter = registry.getA2aAdapter(action);
      const methodParams = a2aAdapter?.mapParams
        ? a2aAdapter.mapParams({ text, contextId, metadata })
        : { ...metadata, ...(text && { text }), ...(contextId && { roomId: contextId }) };

      const ctx: MethodContext = {
        store,
        method: action,
        roomId: contextId,
        protocol: "a2a",
        protocolMeta: { contextId, metadata, text },
      };

      try {
        const result = await registry.call(action, methodParams, ctx);
        return toA2aResponse(result);
      } catch (e: any) {
        return errorMsg(e.message);
      }
    }

    if (action === "help") {
      const { generateDocs, generateStructuredDocs } = await import("../../website/docs.js");
      return reply(generateDocs(registry), undefined, { documentation: generateStructuredDocs(registry) });
    }

    if (action) {
      return errorMsg(`Unknown action: ${action}. Send metadata.action: "help" for full documentation.`);
    }

    // No action — default chat (send message if in room) or docs
    if (contextId && metadata?.agentToken) {
      if (registry.hasMethod("message.send")) {
        const a2aAdapter = registry.getA2aAdapter("message.send");
        const methodParams = a2aAdapter?.mapParams
          ? a2aAdapter.mapParams({ text, contextId, metadata })
          : { text, agentToken: metadata.agentToken, ...(metadata.to ? { to: metadata.to as string } : {}) };

        const ctx: MethodContext = {
          store,
          method: "message.send",
          roomId: contextId,
          protocol: "a2a",
          protocolMeta: { contextId, metadata, text },
        };

        try {
          const result = await registry.call("message.send", methodParams, ctx);
          return toA2aResponse(result);
        } catch (e: any) {
          return errorMsg(e.message);
        }
      }
    }

    const { generateDocs, generateStructuredDocs } = await import("../../website/docs.js");
    return reply(generateDocs(registry), undefined, { documentation: generateStructuredDocs(registry) });
  };
}

// ---- A2A HTTP routes ----

export function createA2aRoutes(registry: MethodRegistry, store: Store): Hono {
  const app = new Hono();
  const handler = createHandler(registry, store);

  app.get("/a2a", async (c) => {
    const { isAgent, getA2aDocsHtml, getA2aDocs } = await import("../../website/index.js");
    const ua = c.req.header("user-agent");
    const accept = c.req.header("accept");
    if (isAgent(ua, accept)) {
      return c.text(getA2aDocs());
    }
    return c.html(getA2aDocsHtml());
  });

  app.post("/a2a", async (c) => {
    let body: JsonRpcRequest;
    try {
      const rawText = await c.req.text();
      body = JSON.parse(rawText) as JsonRpcRequest;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({
        jsonrpc: "2.0",
        error: { code: -32700, message: `Parse error: ${msg}` },
        id: null,
      });
    }

    if (body.jsonrpc !== "2.0" || !body.method) {
      return c.json({
        jsonrpc: "2.0",
        error: { code: -32600, message: "Invalid request" },
        id: body?.id ?? null,
      });
    }

    if (body.method === "SendMessage") {
      try {
        const result = await handler(body.params as SendMessageParams);
        return c.json({ jsonrpc: "2.0", id: body.id, result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("SendMessage error:", message);
        return c.json({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32603, message },
        });
      }
    }

    if (body.method === "GetTask") {
      return c.json({
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32601, message: "GetTask not implemented" },
      });
    }

    if (body.method === "rpc.discover") {
      const { generateStructuredDocs } = await import("../../website/docs.js");
      const structuredDocs = generateStructuredDocs(registry);
      return c.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          name: "Join.cloud",
          version: "0.1.0",
          description: "A2A-compatible multi-party collaboration rooms for AI agents",
          methods: [
            { name: "SendMessage", description: "A2A standard — all Join.cloud operations go through this method via metadata.action" },
            { name: "rpc.discover", description: "This method — service discovery" },
          ],
          actions: (structuredDocs as any).actions,
          endpoints: {
            a2a: "POST /a2a",
            mcp: "POST /mcp",
            agentCard: "GET /.well-known/agent-card.json",
            sse: "GET /api/messages/:roomId/sse",
          },
        },
      });
    }

    return c.json({
      jsonrpc: "2.0",
      id: body.id,
      error: { code: -32601, message: `Method not found: ${body.method}. Try "SendMessage" or "rpc.discover"` },
    });
  });

  return app;
}
