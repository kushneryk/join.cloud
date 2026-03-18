import { Hono } from "hono";
import type { JsonRpcRequest, SendMessageParams } from "../a2a.js";
import { handleSendMessage } from "../actions/index.js";
import { DOCS_STRUCTURED } from "../docs.js";
import { isAgent, getA2aDocsHtml, getA2aDocs } from "../website.js";

const app = new Hono();

app.get("/a2a", (c) => {
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
      const result = await handleSendMessage(body.params as SendMessageParams);
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
        actions: DOCS_STRUCTURED.actions,
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

export default app;
