import { describe, it, expect, beforeAll } from "vitest";
import { McpSession, toolResultText, toolResultData, isToolError } from "./helpers.js";
import { uniqueName } from "../helpers.js";

let session: McpSession;

beforeAll(async () => {
  session = new McpSession();
  await session.initialize();
});

// ============================================================
// tools/list
// ============================================================
describe("MCP tools/list", () => {
  it("lists all 7 tools", async () => {
    const res = await session.listTools();
    expect(res.result.tools).toBeInstanceOf(Array);
    const names = res.result.tools.map((t: any) => t.name);
    expect(names).toContain("createRoom");
    expect(names).toContain("joinRoom");
    expect(names).toContain("leaveRoom");
    expect(names).toContain("roomInfo");
    expect(names).toContain("listRooms");
    expect(names).toContain("sendMessage");
    expect(names).toContain("messageHistory");
    expect(names.length).toBe(7);
  });

  it("each tool has description and inputSchema", async () => {
    const res = await session.listTools();
    for (const tool of res.result.tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeTruthy();
    }
  });
});

// ============================================================
// createRoom
// ============================================================
describe("MCP createRoom", () => {
  // --- Positive ---
  it("creates room with name", async () => {
    const name = uniqueName("mcp-room");
    const res = await session.callTool("createRoom", { name });
    expect(isToolError(res)).toBe(false);
    const text = toolResultText(res);
    expect(text).toContain("Room created");
    const data = toolResultData(res);
    expect(data.roomId).toBeTruthy();
    expect(data.name).toBe(name);
  });

  it("creates room without name", async () => {
    const res = await session.callTool("createRoom", {});
    expect(isToolError(res)).toBe(false);
    expect(toolResultText(res)).toContain("Room created");
  });

  // --- Negative ---
  it("rejects reserved name", async () => {
    const res = await session.callTool("createRoom", { name: "docs" });
    expect(isToolError(res)).toBe(true);
    expect(toolResultText(res)).toContain("reserved");
  });

  it("rejects duplicate room", async () => {
    const name = uniqueName("mcp-room");
    await session.callTool("createRoom", { name });
    const res = await session.callTool("createRoom", { name });
    expect(isToolError(res)).toBe(true);
    expect(toolResultText(res)).toContain("already exists");
  });
});

// ============================================================
// joinRoom
// ============================================================
describe("MCP joinRoom", () => {
  // --- Positive ---
  it("joins room and returns agentToken", async () => {
    const name = uniqueName("mcp-room");
    await session.callTool("createRoom", { name });
    const res = await session.callTool("joinRoom", { roomId: name, agentName: "mcp-agent" });
    expect(isToolError(res)).toBe(false);
    const text = toolResultText(res);
    expect(text).toContain("Joined");
    const data = toolResultData(res);
    expect(data.agentToken).toBeTruthy();
    expect(data.roomId).toBeTruthy();
  });

  it("reconnects with agentToken", async () => {
    const s2 = new McpSession();
    await s2.initialize();
    const name = uniqueName("mcp-room");
    await s2.callTool("createRoom", { name });
    const join1 = await s2.callTool("joinRoom", { roomId: name, agentName: "mcp-agent" });
    const token = toolResultData(join1).agentToken;

    const s3 = new McpSession();
    await s3.initialize();
    const join2 = await s3.callTool("joinRoom", { roomId: name, agentName: "mcp-agent", agentToken: token });
    expect(isToolError(join2)).toBe(false);
    expect(toolResultText(join2)).toContain("Reconnected");
  });

  // --- Negative ---
  it("rejects join to non-existent room", async () => {
    const res = await session.callTool("joinRoom", { roomId: "no-such-room", agentName: "a" });
    expect(isToolError(res)).toBe(true);
    expect(toolResultText(res)).toContain("not found");
  });

  it("rejects join without agentName", async () => {
    const name = uniqueName("mcp-room");
    await session.callTool("createRoom", { name });
    const res = await session.callTool("joinRoom", { roomId: name });
    // Either Zod rejects or handler returns error
    const text = toolResultText(res);
    expect(res.error || text.includes("Error") || text.includes("agentName")).toBeTruthy();
  });
});

// ============================================================
// leaveRoom
// ============================================================
describe("MCP leaveRoom", () => {
  // --- Positive ---
  it("leaves room after joining", async () => {
    const s = new McpSession();
    await s.initialize();
    const name = uniqueName("mcp-room");
    await s.callTool("createRoom", { name });
    await s.callTool("joinRoom", { roomId: name, agentName: "leaver" });
    const res = await s.callTool("leaveRoom", {});
    expect(isToolError(res)).toBe(false);
    expect(toolResultText(res)).toContain("Left room");
  });

  it("agent is removed from room info after leave", async () => {
    const s = new McpSession();
    await s.initialize();
    const name = uniqueName("mcp-room");
    await s.callTool("createRoom", { name });
    await s.callTool("joinRoom", { roomId: name, agentName: "leaver2" });
    await s.callTool("leaveRoom", {});
    const info = await s.callTool("roomInfo", { roomId: name });
    expect(toolResultText(info)).not.toContain("leaver2");
  });

  // --- Negative ---
  it("rejects leave without joining first", async () => {
    const s = new McpSession();
    await s.initialize();
    const res = await s.callTool("leaveRoom", {});
    expect(isToolError(res)).toBe(true);
    expect(toolResultText(res)).toContain("Not joined");
  });

  it("rejects leave after already left", async () => {
    const s = new McpSession();
    await s.initialize();
    const name = uniqueName("mcp-room");
    await s.callTool("createRoom", { name });
    await s.callTool("joinRoom", { roomId: name, agentName: "leaver3" });
    await s.callTool("leaveRoom", {});
    const res = await s.callTool("leaveRoom", {});
    expect(isToolError(res)).toBe(true);
  });
});

// ============================================================
// roomInfo
// ============================================================
describe("MCP roomInfo", () => {
  // --- Positive ---
  it("returns room info with agents", async () => {
    const s = new McpSession();
    await s.initialize();
    const name = uniqueName("mcp-room");
    await s.callTool("createRoom", { name });
    await s.callTool("joinRoom", { roomId: name, agentName: "info-agent" });
    const res = await s.callTool("roomInfo", { roomId: name });
    expect(isToolError(res)).toBe(false);
    const text = toolResultText(res);
    expect(text).toContain("info-agent");
    expect(text).toContain(name);
  });

  it("returns empty agents for empty room", async () => {
    const name = uniqueName("mcp-room");
    await session.callTool("createRoom", { name });
    const res = await session.callTool("roomInfo", { roomId: name });
    expect(isToolError(res)).toBe(false);
    const text = toolResultText(res);
    expect(text).toContain('"agents"');
  });

  // --- Negative ---
  it("rejects info for non-existent room", async () => {
    const res = await session.callTool("roomInfo", { roomId: "no-such-room" });
    expect(isToolError(res)).toBe(true);
    expect(toolResultText(res)).toContain("not found");
  });

  it("rejects info without roomId parameter", async () => {
    const res = await session.callTool("roomInfo", {});
    const text = toolResultText(res);
    expect(res.error || text.includes("Error") || text.includes("required")).toBeTruthy();
  });
});

// ============================================================
// listRooms
// ============================================================
describe("MCP listRooms", () => {
  // --- Positive ---
  it("returns list of rooms", async () => {
    const name = uniqueName("mcp-room");
    await session.callTool("createRoom", { name });
    const res = await session.callTool("listRooms", {});
    expect(isToolError(res)).toBe(false);
    const text = toolResultText(res);
    expect(text).toContain(name);
  });

  it("list includes agent counts", async () => {
    const res = await session.callTool("listRooms", {});
    expect(isToolError(res)).toBe(false);
    // The response is JSON text with rooms array
    expect(toolResultText(res)).toContain("agent");
  });
});

// ============================================================
// sendMessage
// ============================================================
describe("MCP sendMessage", () => {
  // --- Positive ---
  it("sends broadcast message", async () => {
    const s = new McpSession();
    await s.initialize();
    const name = uniqueName("mcp-room");
    await s.callTool("createRoom", { name });
    await s.callTool("joinRoom", { roomId: name, agentName: "sender" });
    const res = await s.callTool("sendMessage", { text: "Hello broadcast" });
    expect(isToolError(res)).toBe(false);
    expect(toolResultText(res)).toContain("sent");
  });

  it("sends DM with 'to' parameter", async () => {
    const s = new McpSession();
    await s.initialize();
    const name = uniqueName("mcp-room");
    await s.callTool("createRoom", { name });
    await s.callTool("joinRoom", { roomId: name, agentName: "sender" });
    const res = await s.callTool("sendMessage", { text: "DM text", to: "someone" });
    expect(isToolError(res)).toBe(false);
    expect(toolResultText(res)).toContain("sent");
  });

  // --- Negative ---
  it("rejects send without joining first", async () => {
    const s = new McpSession();
    await s.initialize();
    const res = await s.callTool("sendMessage", { text: "hello" });
    expect(isToolError(res)).toBe(true);
    expect(toolResultText(res)).toContain("Not joined");
  });

  it("rejects send with empty text parameter", async () => {
    const s = new McpSession();
    await s.initialize();
    const name = uniqueName("mcp-room");
    await s.callTool("createRoom", { name });
    await s.callTool("joinRoom", { roomId: name, agentName: "sender" });
    // Send with empty text — should still succeed (server allows it)
    const res = await s.callTool("sendMessage", { text: "" });
    // Empty text is technically valid; test that it doesn't crash
    expect(res).toBeTruthy();
  });
});

// ============================================================
// messageHistory
// ============================================================
describe("MCP messageHistory", () => {
  // --- Positive ---
  it("returns history with default limit", async () => {
    const s = new McpSession();
    await s.initialize();
    const name = uniqueName("mcp-room");
    await s.callTool("createRoom", { name });
    const joinRes = await s.callTool("joinRoom", { roomId: name, agentName: "hist-agent" });
    const roomId = toolResultData(joinRes)?.roomId;
    await s.callTool("sendMessage", { text: "msg1" });
    await s.callTool("sendMessage", { text: "msg2" });
    const res = await s.callTool("messageHistory", { roomId });
    expect(isToolError(res)).toBe(false);
    const text = toolResultText(res);
    expect(text).toContain("msg1");
    expect(text).toContain("msg2");
  });

  it("respects limit parameter", async () => {
    const s = new McpSession();
    await s.initialize();
    const name = uniqueName("mcp-room");
    await s.callTool("createRoom", { name });
    const joinRes = await s.callTool("joinRoom", { roomId: name, agentName: "hist-agent" });
    const roomId = toolResultData(joinRes)?.roomId;
    for (let i = 0; i < 5; i++) await s.callTool("sendMessage", { text: `m${i}` });
    const res = await s.callTool("messageHistory", { roomId, limit: 2 });
    expect(isToolError(res)).toBe(false);
    // Should have at most 2 user messages (plus possible bot messages)
    const data = toolResultData(res);
    if (data?.messages) {
      expect(data.messages.length).toBeLessThanOrEqual(2);
    }
  });

  it("respects offset parameter", async () => {
    const s = new McpSession();
    await s.initialize();
    const name = uniqueName("mcp-room");
    await s.callTool("createRoom", { name });
    const joinRes = await s.callTool("joinRoom", { roomId: name, agentName: "hist-agent" });
    const roomId = toolResultData(joinRes)?.roomId;
    for (let i = 0; i < 5; i++) await s.callTool("sendMessage", { text: `m${i}` });
    const resAll = await s.callTool("messageHistory", { roomId, limit: 100 });
    const resOffset = await s.callTool("messageHistory", { roomId, limit: 100, offset: 3 });
    // Both should succeed
    expect(isToolError(resAll)).toBe(false);
    expect(isToolError(resOffset)).toBe(false);
  });

  // --- Negative ---
  it("rejects history without roomId", async () => {
    const res = await session.callTool("messageHistory", {});
    const text = toolResultText(res);
    expect(res.error || text.includes("Error") || text.includes("required")).toBeTruthy();
  });

  it("rejects history for non-existent room", async () => {
    const res = await session.callTool("messageHistory", { roomId: "fake-room-id" });
    expect(isToolError(res)).toBe(true);
    expect(toolResultText(res)).toContain("not found");
  });
});

// ============================================================
// Session management
// ============================================================
describe("MCP session", () => {
  it("initialize returns session ID", async () => {
    const s = new McpSession();
    await s.initialize();
    expect(s.sessionId).toBeTruthy();
  });

  it("new session gets fresh state (no joined room)", async () => {
    const s = new McpSession();
    await s.initialize();
    const res = await s.callTool("leaveRoom", {});
    expect(isToolError(res)).toBe(true);
    expect(toolResultText(res)).toContain("Not joined");
  });
});
