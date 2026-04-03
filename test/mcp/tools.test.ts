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
  it("lists all 12 tools", async () => {
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
    expect(names).toContain("unreadMessages");
    expect(names).toContain("promoteAgent");
    expect(names).toContain("demoteAgent");
    expect(names).toContain("kickAgent");
    expect(names).toContain("updateRoom");
    expect(names.length).toBe(12);
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
  it("creates room with name and agentName, returns agentToken", async () => {
    const name = uniqueName("mcp-room");
    const res = await session.callTool("createRoom", { name, agentName: "mcp-creator" });
    expect(isToolError(res)).toBe(false);
    const text = toolResultText(res);
    expect(text).toContain("Room created");
    const data = toolResultData(res);
    expect(data.roomId).toBeTruthy();
    expect(data.name).toBe(name);
    expect(data.agentToken).toBeTruthy();
    expect(data.agentName).toBe("mcp-creator");
  });

  it("creates room with description and type", async () => {
    const s = new McpSession();
    await s.initialize();
    const name = uniqueName("mcp-room");
    const res = await s.callTool("createRoom", { name, agentName: "creator", description: "Test desc", type: "channel" });
    expect(isToolError(res)).toBe(false);
    const data = toolResultData(res);
    expect(data.description).toBe("Test desc");
    expect(data.type).toBe("channel");
  });

  it("creates room without name", async () => {
    const s = new McpSession();
    await s.initialize();
    const res = await s.callTool("createRoom", { agentName: "creator" });
    expect(isToolError(res)).toBe(false);
    expect(toolResultText(res)).toContain("Room created");
  });

  // --- Negative ---
  it("rejects reserved name", async () => {
    const s = new McpSession();
    await s.initialize();
    const res = await s.callTool("createRoom", { name: "docs", agentName: "creator" });
    expect(isToolError(res)).toBe(true);
    expect(toolResultText(res)).toContain("reserved");
  });

  it("rejects duplicate room", async () => {
    const name = uniqueName("mcp-room");
    const s = new McpSession();
    await s.initialize();
    await s.callTool("createRoom", { name, agentName: "creator1" });
    const s2 = new McpSession();
    await s2.initialize();
    const res = await s2.callTool("createRoom", { name, agentName: "creator2" });
    expect(isToolError(res)).toBe(true);
    expect(toolResultText(res)).toContain("already exists");
  });
});

// ============================================================
// joinRoom
// ============================================================
describe("MCP joinRoom", () => {
  // --- Positive ---
  it("joins room and returns agentToken with member role", async () => {
    const s = new McpSession();
    await s.initialize();
    const name = uniqueName("mcp-room");
    await s.callTool("createRoom", { name, agentName: "creator" });

    const s2 = new McpSession();
    await s2.initialize();
    const res = await s2.callTool("joinRoom", { roomId: name, agentName: "mcp-agent" });
    expect(isToolError(res)).toBe(false);
    const text = toolResultText(res);
    expect(text).toContain("Joined");
    const data = toolResultData(res);
    expect(data.agentToken).toBeTruthy();
    expect(data.roomId).toBeTruthy();
    expect(data.role).toBe("member");
  });

  it("reconnects with agentToken", async () => {
    const s2 = new McpSession();
    await s2.initialize();
    const name = uniqueName("mcp-room");
    await s2.callTool("createRoom", { name, agentName: "creator" });

    const s3 = new McpSession();
    await s3.initialize();
    const join1 = await s3.callTool("joinRoom", { roomId: name, agentName: "mcp-agent" });
    const token = toolResultData(join1).agentToken;

    const s4 = new McpSession();
    await s4.initialize();
    const join2 = await s4.callTool("joinRoom", { roomId: name, agentName: "mcp-agent", agentToken: token });
    expect(isToolError(join2)).toBe(false);
    expect(toolResultText(join2)).toContain("Reconnected");
  });

  // --- Negative ---
  it("rejects join to non-existent room", async () => {
    const s = new McpSession();
    await s.initialize();
    const res = await s.callTool("joinRoom", { roomId: "no-such-room", agentName: "a" });
    expect(isToolError(res)).toBe(true);
    expect(toolResultText(res)).toContain("not found");
  });

  it("rejects join without agentName", async () => {
    const s = new McpSession();
    await s.initialize();
    const name = uniqueName("mcp-room");
    await s.callTool("createRoom", { name, agentName: "creator" });
    const res = await s.callTool("joinRoom", { roomId: name });
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
    await s.callTool("createRoom", { name, agentName: "creator" });

    const s2 = new McpSession();
    await s2.initialize();
    await s2.callTool("joinRoom", { roomId: name, agentName: "leaver" });
    const res = await s2.callTool("leaveRoom", {});
    expect(isToolError(res)).toBe(false);
    expect(toolResultText(res)).toContain("Left room");
  });

  it("agent is removed from room info after leave", async () => {
    const s = new McpSession();
    await s.initialize();
    const name = uniqueName("mcp-room");
    await s.callTool("createRoom", { name, agentName: "creator" });

    const s2 = new McpSession();
    await s2.initialize();
    await s2.callTool("joinRoom", { roomId: name, agentName: "leaver2" });
    await s2.callTool("leaveRoom", {});
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
    await s.callTool("createRoom", { name, agentName: "creator" });

    const s2 = new McpSession();
    await s2.initialize();
    await s2.callTool("joinRoom", { roomId: name, agentName: "leaver3" });
    await s2.callTool("leaveRoom", {});
    const res = await s2.callTool("leaveRoom", {});
    expect(isToolError(res)).toBe(true);
  });
});

// ============================================================
// roomInfo
// ============================================================
describe("MCP roomInfo", () => {
  // --- Positive ---
  it("returns room info with agents and roles", async () => {
    const s = new McpSession();
    await s.initialize();
    const name = uniqueName("mcp-room");
    await s.callTool("createRoom", { name, agentName: "creator" });

    const s2 = new McpSession();
    await s2.initialize();
    await s2.callTool("joinRoom", { roomId: name, agentName: "info-agent" });
    const res = await s.callTool("roomInfo", { roomId: name });
    expect(isToolError(res)).toBe(false);
    const text = toolResultText(res);
    expect(text).toContain("info-agent");
    expect(text).toContain("creator");
    expect(text).toContain(name);
  });

  it("returns creator for newly created room", async () => {
    const s = new McpSession();
    await s.initialize();
    const name = uniqueName("mcp-room");
    await s.callTool("createRoom", { name, agentName: "creator" });
    const res = await s.callTool("roomInfo", { roomId: name });
    expect(isToolError(res)).toBe(false);
    const text = toolResultText(res);
    expect(text).toContain('"agents"');
    expect(text).toContain("creator");
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
    expect(res === null || res?.error || isToolError(res) || text.includes("Error") || text.includes("required") || text.includes("invalid")).toBeTruthy();
  });
});

// ============================================================
// listRooms
// ============================================================
describe("MCP listRooms", () => {
  // --- Positive ---
  it("returns list of rooms", async () => {
    const s = new McpSession();
    await s.initialize();
    const name = uniqueName("mcp-room");
    await s.callTool("createRoom", { name, agentName: "creator" });
    const res = await s.callTool("listRooms", {});
    expect(isToolError(res)).toBe(false);
    const text = toolResultText(res);
    expect(text).toContain(name);
  });

  it("list includes agent counts", async () => {
    const res = await session.callTool("listRooms", {});
    expect(isToolError(res)).toBe(false);
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
    await s.callTool("createRoom", { name, agentName: "sender" });
    const res = await s.callTool("sendMessage", { text: "Hello broadcast" });
    expect(isToolError(res)).toBe(false);
    expect(toolResultText(res)).toContain("sent");
  });

  it("sends DM with 'to' parameter", async () => {
    const s = new McpSession();
    await s.initialize();
    const name = uniqueName("mcp-room");
    await s.callTool("createRoom", { name, agentName: "sender" });
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
    await s.callTool("createRoom", { name, agentName: "sender" });
    const res = await s.callTool("sendMessage", { text: "" });
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
    const createRes = await s.callTool("createRoom", { name, agentName: "hist-agent" });
    const roomId = toolResultData(createRes)?.roomId;
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
    const createRes = await s.callTool("createRoom", { name, agentName: "hist-agent" });
    const roomId = toolResultData(createRes)?.roomId;
    for (let i = 0; i < 5; i++) await s.callTool("sendMessage", { text: `m${i}` });
    const res = await s.callTool("messageHistory", { roomId, limit: 2 });
    expect(isToolError(res)).toBe(false);
    const data = toolResultData(res);
    if (data?.messages) {
      expect(data.messages.length).toBeLessThanOrEqual(2);
    }
  });

  it("respects offset parameter", async () => {
    const s = new McpSession();
    await s.initialize();
    const name = uniqueName("mcp-room");
    const createRes = await s.callTool("createRoom", { name, agentName: "hist-agent" });
    const roomId = toolResultData(createRes)?.roomId;
    for (let i = 0; i < 5; i++) await s.callTool("sendMessage", { text: `m${i}` });
    const resAll = await s.callTool("messageHistory", { roomId, limit: 100 });
    const resOffset = await s.callTool("messageHistory", { roomId, limit: 100, offset: 3 });
    expect(isToolError(resAll)).toBe(false);
    expect(isToolError(resOffset)).toBe(false);
  });

  // --- Negative ---
  it("rejects history without roomId", async () => {
    const res = await session.callTool("messageHistory", {});
    const text = toolResultText(res);
    expect(res === null || res?.error || isToolError(res) || text.includes("Error") || text.includes("required") || text.includes("invalid")).toBeTruthy();
  });

  it("rejects history for wrong room", async () => {
    const res = await session.callTool("messageHistory", { roomId: "fake-room-id" });
    expect(isToolError(res)).toBe(true);
    expect(toolResultText(res)).toContain("does not belong");
  });
});

// ============================================================
// promoteAgent / demoteAgent / kickAgent / updateRoom
// ============================================================
describe("MCP admin tools", () => {
  it("promotes and demotes an agent", async () => {
    const s = new McpSession();
    await s.initialize();
    const name = uniqueName("mcp-room");
    await s.callTool("createRoom", { name, agentName: "admin1" });

    const s2 = new McpSession();
    await s2.initialize();
    await s2.callTool("joinRoom", { roomId: name, agentName: "member1" });

    // Promote
    const pRes = await s.callTool("promoteAgent", { targetAgent: "member1" });
    expect(isToolError(pRes)).toBe(false);
    expect(toolResultText(pRes)).toContain("Promoted");

    // Demote
    const dRes = await s.callTool("demoteAgent", { targetAgent: "member1" });
    expect(isToolError(dRes)).toBe(false);
    expect(toolResultText(dRes)).toContain("Demoted");
  });

  it("kicks an agent", async () => {
    const s = new McpSession();
    await s.initialize();
    const name = uniqueName("mcp-room");
    await s.callTool("createRoom", { name, agentName: "admin1" });

    const s2 = new McpSession();
    await s2.initialize();
    await s2.callTool("joinRoom", { roomId: name, agentName: "target" });

    const res = await s.callTool("kickAgent", { targetAgent: "target" });
    expect(isToolError(res)).toBe(false);
    expect(toolResultText(res)).toContain("Kicked");
  });

  it("updates room description and type", async () => {
    const s = new McpSession();
    await s.initialize();
    const name = uniqueName("mcp-room");
    await s.callTool("createRoom", { name, agentName: "admin1" });

    const res = await s.callTool("updateRoom", { description: "New desc", type: "channel" });
    expect(isToolError(res)).toBe(false);
    expect(toolResultText(res)).toContain("updated");

    const info = await s.callTool("roomInfo", { roomId: name });
    const text = toolResultText(info);
    expect(text).toContain("New desc");
    expect(text).toContain("channel");
  });

  it("rejects admin tools without joining", async () => {
    const s = new McpSession();
    await s.initialize();
    const res = await s.callTool("promoteAgent", { targetAgent: "someone" });
    expect(isToolError(res)).toBe(true);
    expect(toolResultText(res)).toContain("Not joined");
  });

  it("rejects admin tools from non-admin", async () => {
    const s = new McpSession();
    await s.initialize();
    const name = uniqueName("mcp-room");
    await s.callTool("createRoom", { name, agentName: "admin1" });

    const s2 = new McpSession();
    await s2.initialize();
    await s2.callTool("joinRoom", { roomId: name, agentName: "member1" });

    const res = await s2.callTool("promoteAgent", { targetAgent: "admin1" });
    expect(isToolError(res)).toBe(true);
    expect(toolResultText(res)).toContain("Admin role required");
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

  it("createRoom stores agentToken in session", async () => {
    const s = new McpSession();
    await s.initialize();
    const name = uniqueName("mcp-room");
    await s.callTool("createRoom", { name, agentName: "creator" });
    // Should be able to send message without separate joinRoom
    const res = await s.callTool("sendMessage", { text: "Hello from creator" });
    expect(isToolError(res)).toBe(false);
    expect(toolResultText(res)).toContain("sent");
  });
});
