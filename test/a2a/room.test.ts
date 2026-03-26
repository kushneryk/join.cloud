import { describe, it, expect } from "vitest";
import { a2a, a2aRaw, a2aRawText, resultText, resultData, isError, isRpcError, uniqueName, createRoom, joinRoom } from "../helpers.js";

// ============================================================
// room.create
// ============================================================
describe("A2A room.create", () => {
  // --- Positive ---
  it("creates a room with a name", async () => {
    const name = uniqueName("room");
    const res = await a2a("room.create", undefined, name);
    expect(isError(res)).toBe(false);
    const data = resultData(res);
    expect(data.roomId).toBeTruthy();
    expect(data.name).toBe(name);
    expect(data.passwordProtected).toBe(false);
  });

  it("creates a room with a password", async () => {
    const name = uniqueName("room");
    const res = await a2a("room.create", undefined, name, { password: "secret" });
    expect(isError(res)).toBe(false);
    const data = resultData(res);
    expect(data.roomId).toBeTruthy();
    expect(data.name).toBe(name);
    expect(data.passwordProtected).toBe(true);
  });

  it("creates a room without a name (auto-generated)", async () => {
    const res = await a2a("room.create");
    expect(isError(res)).toBe(false);
    const data = resultData(res);
    expect(data.roomId).toBeTruthy();
    expect(data.name).toBeTruthy();
  });

  // --- Negative ---
  it("rejects reserved room name 'mcp'", async () => {
    const res = await a2a("room.create", undefined, "mcp");
    expect(isError(res)).toBe(true);
  });

  it("rejects reserved room name 'a2a'", async () => {
    const res = await a2a("room.create", undefined, "a2a");
    expect(isError(res)).toBe(true);
  });

  it("rejects duplicate room name (no password)", async () => {
    const name = uniqueName("room");
    await createRoom(name);
    const res = await a2a("room.create", undefined, name);
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("already exists");
  });

  it("rejects duplicate room name+password combo", async () => {
    const name = uniqueName("room");
    await a2a("room.create", undefined, name, { password: "pass1" });
    const res = await a2a("room.create", undefined, name, { password: "pass1" });
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("already exists");
  });

  it("rejects unprotected room when protected one exists with same name", async () => {
    const name = uniqueName("room");
    await a2a("room.create", undefined, name, { password: "pass1" });
    const res = await a2a("room.create", undefined, name);
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("password");
  });
});

// ============================================================
// room.join
// ============================================================
describe("A2A room.join", () => {
  // --- Positive ---
  it("joins a room and returns agentToken", async () => {
    const { name } = await createRoom();
    const res = await joinRoom(name, "agent1");
    expect(res.agentToken).toBeTruthy();
    expect(res.roomId).toBeTruthy();
    expect(resultText(res)).toContain("Joined");
  });

  it("reconnects with agentToken and same name", async () => {
    const { name } = await createRoom();
    const join1 = await joinRoom(name, "agent1");
    const join2 = await joinRoom(name, "agent1", { agentToken: join1.agentToken });
    expect(resultText(join2)).toContain("Reconnected");
    expect(resultData(join2).agentToken).toBe(join1.agentToken);
  });

  it("joins password-protected room with correct password", async () => {
    const name = uniqueName("room");
    await a2a("room.create", undefined, name, { password: "secret" });
    const res = await a2a("room.join", `${name}:secret`, "", { agentName: "agent1" });
    expect(isError(res)).toBe(false);
    expect(resultData(res).agentToken).toBeTruthy();
  });

  it("passes agentEndpoint in metadata", async () => {
    const { name } = await createRoom();
    const res = await joinRoom(name, "agent1", { agentEndpoint: "http://example.com/a2a" });
    expect(isError(res)).toBe(false);
    expect(res.agentToken).toBeTruthy();
  });

  // --- Negative ---
  it("rejects join without contextId", async () => {
    const res = await a2a("room.join", undefined, "", { agentName: "agent1" });
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("required");
  });

  it("rejects join to non-existent room", async () => {
    const res = await a2a("room.join", "nonexistent-room-xyz", "", { agentName: "agent1" });
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("not found");
  });

  it("rejects join without agentName", async () => {
    const { name } = await createRoom();
    const res = await a2a("room.join", name, "");
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("agentName");
  });

  it("rejects duplicate agentName without token", async () => {
    const { name } = await createRoom();
    await joinRoom(name, "agent1");
    const res = await a2a("room.join", name, "", { agentName: "agent1" });
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("already taken");
  });

  it("rejects wrong password", async () => {
    const name = uniqueName("room");
    await a2a("room.create", undefined, name, { password: "correct" });
    const res = await a2a("room.join", `${name}:wrong`, "", { agentName: "agent1" });
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("Invalid room password");
  });

  it("rejects reconnect with wrong agentToken", async () => {
    const { name } = await createRoom();
    await joinRoom(name, "agent1");
    const res = await a2a("room.join", name, "", { agentName: "agent1", agentToken: "bad-token" });
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("already taken");
  });
});

// ============================================================
// room.leave
// ============================================================
describe("A2A room.leave", () => {
  // --- Positive ---
  it("leaves a room with valid agentToken", async () => {
    const { name } = await createRoom();
    const { agentToken } = await joinRoom(name, "agent1");
    const res = await a2a("room.leave", undefined, "", { agentToken });
    expect(isError(res)).toBe(false);
    expect(resultText(res)).toContain("Left room");
  });

  it("agent is removed from room after leaving", async () => {
    const { name } = await createRoom();
    const { agentToken } = await joinRoom(name, "agent1");
    await a2a("room.leave", undefined, "", { agentToken });
    const info = await a2a("room.info", name);
    const data = resultData(info);
    expect(data.agents).toHaveLength(0);
  });

  // --- Negative ---
  it("rejects leave without agentToken", async () => {
    const res = await a2a("room.leave");
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("agentToken");
  });

  it("rejects leave with invalid agentToken", async () => {
    const res = await a2a("room.leave", undefined, "", { agentToken: "invalid-token" });
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("Invalid");
  });
});

// ============================================================
// room.info
// ============================================================
describe("A2A room.info", () => {
  // --- Positive ---
  it("returns room info with agents", async () => {
    const { name } = await createRoom();
    await joinRoom(name, "agent1");
    const res = await a2a("room.info", name);
    expect(isError(res)).toBe(false);
    const data = resultData(res);
    expect(data.roomId).toBeTruthy();
    expect(data.name).toBe(name);
    expect(data.agents).toHaveLength(1);
    expect(data.agents[0].name).toBe("agent1");
    expect(data.agents[0].joinedAt).toBeTruthy();
  });

  it("returns empty agents for room with no participants", async () => {
    const { name } = await createRoom();
    const res = await a2a("room.info", name);
    const data = resultData(res);
    expect(data.agents).toHaveLength(0);
  });

  // --- Negative ---
  it("rejects info without contextId", async () => {
    const res = await a2a("room.info");
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("required");
  });

  it("rejects info for non-existent room", async () => {
    const res = await a2a("room.info", "nonexistent-xyz");
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("not found");
  });
});

// ============================================================
// room.list
// ============================================================
describe("A2A room.list", () => {
  // --- Positive ---
  it("lists rooms", async () => {
    await createRoom();
    const res = await a2a("room.list");
    expect(isError(res)).toBe(false);
    const data = resultData(res);
    expect(data.rooms).toBeInstanceOf(Array);
    expect(data.rooms.length).toBeGreaterThan(0);
  });

  it("includes room metadata in list", async () => {
    const { name } = await createRoom();
    const res = await a2a("room.list", undefined, undefined, { search: name });
    const data = resultData(res);
    const room = data.rooms.find((r: any) => r.name === name);
    expect(room).toBeTruthy();
    expect(room.createdAt).toBeTruthy();
    expect(typeof room.agents).toBe("number");
  });

  // --- Negative ---
  // room.list has no error cases (always succeeds), so test edge case
  it("returns array even when no rooms match", async () => {
    const res = await a2a("room.list");
    expect(isError(res)).toBe(false);
    const data = resultData(res);
    expect(Array.isArray(data.rooms)).toBe(true);
  });
});
