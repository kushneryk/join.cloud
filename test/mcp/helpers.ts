const MCP_BASE = process.env.MCP_URL ?? "http://localhost:3003";

export { MCP_BASE };

let requestId = 1;

export class McpSession {
  sessionId: string | null = null;
  private base: string;

  constructor(base = MCP_BASE) {
    this.base = base;
  }

  async initialize(): Promise<any> {
    const res = await fetch(`${this.base}/mcp`, {
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
          clientInfo: { name: "test-client", version: "1.0" },
        },
        id: requestId++,
      }),
    });

    this.sessionId = res.headers.get("mcp-session-id");

    // Parse SSE response
    const text = await res.text();
    return this.parseSSE(text);
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<any> {
    if (!this.sessionId) throw new Error("Session not initialized");

    const res = await fetch(`${this.base}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "mcp-session-id": this.sessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name, arguments: args },
        id: requestId++,
      }),
    });

    // Check for new session ID (session recovery)
    const newSession = res.headers.get("mcp-session-id");
    if (newSession) this.sessionId = newSession;

    const text = await res.text();
    return this.parseSSE(text);
  }

  async listTools(): Promise<any> {
    if (!this.sessionId) throw new Error("Session not initialized");

    const res = await fetch(`${this.base}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "mcp-session-id": this.sessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/list",
        params: {},
        id: requestId++,
      }),
    });

    const text = await res.text();
    return this.parseSSE(text);
  }

  private parseSSE(text: string): any {
    // SSE format: multiple "event: message\ndata: {...}\n\n" blocks
    // We want the last data line with a JSON-RPC response
    const lines = text.split("\n");
    let lastData: any = null;
    for (const line of lines) {
      if (line.startsWith("data:")) {
        try {
          const parsed = JSON.parse(line.slice(5).trim());
          if (parsed.result !== undefined || parsed.error !== undefined) {
            lastData = parsed;
          }
        } catch {
          // not JSON
        }
      }
    }
    // If no SSE, try parsing entire body as JSON
    if (!lastData) {
      try {
        lastData = JSON.parse(text);
      } catch {
        // ignore
      }
    }
    return lastData;
  }
}

export function toolResultText(res: any): string {
  return res?.result?.content?.find((c: any) => c.type === "text")?.text ?? "";
}

export function toolResultData(res: any): any {
  const text = toolResultText(res);
  // Data is JSON-embedded in text after the first line
  const newlineIdx = text.indexOf("\n");
  if (newlineIdx === -1) return undefined;
  try {
    return JSON.parse(text.slice(newlineIdx + 1));
  } catch {
    return undefined;
  }
}

export function isToolError(res: any): boolean {
  const text = toolResultText(res);
  return text.startsWith("Error:") || !!res?.error;
}
