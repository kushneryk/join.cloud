import { describe, it, expect } from "vitest";
import { a2a, a2aRaw, a2aRawText, resultText, resultData, isError, isRpcError, BASE } from "../helpers.js";

// ============================================================
// JSON-RPC protocol compliance & special methods
// ============================================================
describe("A2A protocol", () => {
  // --- rpc.discover ---
  it("rpc.discover returns service info", async () => {
    const res = await a2aRaw({ jsonrpc: "2.0", id: 1, method: "rpc.discover", params: {} });
    expect(res.result).toBeTruthy();
    expect(res.result.name).toBe("Join.cloud");
    expect(res.result.methods).toBeInstanceOf(Array);
    expect(res.result.endpoints).toBeTruthy();
    expect(res.result.actions).toBeTruthy();
  });

  it("rpc.discover includes expected endpoints", async () => {
    const res = await a2aRaw({ jsonrpc: "2.0", id: 1, method: "rpc.discover", params: {} });
    expect(res.result.endpoints.a2a).toContain("/a2a");
    expect(res.result.endpoints.mcp).toContain("/mcp");
    expect(res.result.endpoints.sse).toContain("/sse");
  });

  // --- help action ---
  it("help action returns documentation", async () => {
    const res = await a2a("help");
    expect(isError(res)).toBe(false);
    const text = resultText(res);
    expect(text.length).toBeGreaterThan(100);
    const data = resultData(res);
    expect(data.documentation).toBeTruthy();
  });

  it("help includes structured docs", async () => {
    const res = await a2a("help");
    const data = resultData(res);
    expect(data.documentation.actions).toBeTruthy();
    expect(data.documentation.actions.room).toBeTruthy();
    expect(data.documentation.actions.messages).toBeTruthy();
  });

  // --- action aliases ---
  it("alias 'create' works same as 'room.create'", async () => {
    const name = `alias-${Date.now()}`;
    const res = await a2a("create", undefined, name, { agentName: "creator" });
    expect(isError(res)).toBe(false);
    expect(resultData(res).roomId).toBeTruthy();
  });

  it("alias 'list' works same as 'room.list'", async () => {
    const res = await a2a("list");
    expect(isError(res)).toBe(false);
    expect(resultData(res).rooms).toBeInstanceOf(Array);
  });

  // --- Error handling ---
  it("returns parse error for invalid JSON", async () => {
    const res = await a2aRawText("not json at all");
    expect(res.error).toBeTruthy();
    expect(res.error.code).toBe(-32700);
  });

  it("returns invalid request for missing jsonrpc version", async () => {
    const res = await a2aRaw({ id: 1, method: "SendMessage", params: {} });
    expect(res.error).toBeTruthy();
    expect(res.error.code).toBe(-32600);
  });

  it("returns invalid request for missing method", async () => {
    const res = await a2aRaw({ jsonrpc: "2.0", id: 1, params: {} });
    expect(res.error).toBeTruthy();
    expect(res.error.code).toBe(-32600);
  });

  it("returns method not found for unknown method", async () => {
    const res = await a2aRaw({ jsonrpc: "2.0", id: 1, method: "UnknownMethod", params: {} });
    expect(res.error).toBeTruthy();
    expect(res.error.code).toBe(-32601);
  });

  it("returns error for GetTask (not implemented)", async () => {
    const res = await a2aRaw({ jsonrpc: "2.0", id: 1, method: "GetTask", params: { taskId: "x" } });
    expect(res.error).toBeTruthy();
    expect(res.error.code).toBe(-32601);
  });

  it("returns error for unknown action", async () => {
    const res = await a2a("nonexistent.action");
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("Unknown action");
  });

  // --- Default chat (no action) ---
  it("no action returns docs when not in room", async () => {
    const res = await a2aRaw({
      jsonrpc: "2.0", id: 1, method: "SendMessage",
      params: { message: { role: "user", parts: [{ text: "hello" }] } },
    });
    expect(res.result).toBeTruthy();
    const text = res.result.parts?.find((p: any) => p.text)?.text ?? "";
    expect(text.length).toBeGreaterThan(50);
  });
});
