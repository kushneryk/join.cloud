import { describe, it, expect } from "vitest";
import { a2a, resultText, resultData, isError, uniqueName, createRoom, joinRoom, getToken } from "./helpers.js";

describe("room.create", () => {
  it("creates a room with a name", async () => {
    const name = uniqueName("create");
    const res = await a2a("room.create", undefined, name);
    const data = resultData(res);
    expect(data.roomId).toBeDefined();
    expect(data.name).toBe(name);
  });

  it("creates a room with a password", async () => {
    const name = uniqueName("create-pw");
    const res = await a2a("room.create", undefined, name, { password: "secret" });
    const data = resultData(res);
    expect(data.passwordProtected).toBe(true);
  });

  it("rejects duplicate room name+password", async () => {
    const name = uniqueName("dup");
    await a2a("room.create", undefined, name);
    const res = await a2a("room.create", undefined, name);
    expect(isError(res)).toBe(true);
  });

  it("rejects reserved name 'a2a'", async () => {
    const res = await a2a("room.create", undefined, "a2a");
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("reserved");
  });

  it("rejects reserved name 'mcp'", async () => {
    const res = await a2a("room.create", undefined, "mcp");
    expect(isError(res)).toBe(true);
  });
});

describe("room.join", () => {
  it("joins and returns agentToken", async () => {
    const { roomId } = await createRoom();
    const res = await joinRoom(roomId, "agent1");
    expect(resultText(res)).toContain("Joined");
    expect(res.agentToken).toBeDefined();
    expect(res.agentToken.length).toBeGreaterThan(10);
  });

  it("joins by room name", async () => {
    const { name } = await createRoom();
    const res = await joinRoom(name, "agent1");
    expect(resultText(res)).toContain("Joined");
    expect(res.agentToken).toBeDefined();
  });

  it("rejects join without agentName", async () => {
    const { roomId } = await createRoom();
    const res = await a2a("room.join", roomId, "");
    expect(isError(res)).toBe(true);
  });

  it("rejects join to nonexistent room", async () => {
    const res = await joinRoom("nonexistent-room-xyz", "agent1");
    expect(isError(res)).toBe(true);
  });

  it("allows reconnection with same name and correct token", async () => {
    const { roomId } = await createRoom();
    const first = await joinRoom(roomId, "agent1");
    const token = first.agentToken;
    const res = await joinRoom(roomId, "agent1", { agentToken: token });
    expect(isError(res)).toBe(false);
    expect(resultText(res)).toContain("Reconnected");
  });

  it("rejects reconnection with same name but wrong token", async () => {
    const { roomId } = await createRoom();
    await joinRoom(roomId, "agent1");
    const res = await joinRoom(roomId, "agent1", { agentToken: "wrong-token" });
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("already taken");
  });

  it("rejects reconnection with same name but no token", async () => {
    const { roomId } = await createRoom();
    await joinRoom(roomId, "agent1");
    const res = await joinRoom(roomId, "agent1");
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("already taken");
  });
});

describe("room.leave", () => {
  it("leaves a room with token", async () => {
    const { roomId } = await createRoom();
    const join = await joinRoom(roomId, "agent1");
    const res = await a2a("room.leave", undefined, "", { agentToken: join.agentToken });
    expect(resultText(res)).toContain("Left");
  });

  it("rejects leave without token", async () => {
    const { roomId } = await createRoom();
    const res = await a2a("room.leave", roomId, "");
    expect(isError(res)).toBe(true);
  });

  it("rejects leave with invalid token", async () => {
    const res = await a2a("room.leave", undefined, "", { agentToken: "invalid-token" });
    expect(isError(res)).toBe(true);
  });
});

describe("room.info", () => {
  it("returns room details", async () => {
    const { roomId, name } = await createRoom();
    await joinRoom(roomId, "agent1");
    const res = await a2a("room.info", roomId);
    const data = resultData(res);
    expect(data.name).toBe(name);
    expect(data.agents).toHaveLength(1);
    expect(data.agents[0].name).toBe("agent1");
  });

  it("works with room name", async () => {
    const { name } = await createRoom();
    const res = await a2a("room.info", name);
    const data = resultData(res);
    expect(data.name).toBe(name);
  });

  it("rejects without contextId", async () => {
    const res = await a2a("room.info");
    expect(isError(res)).toBe(true);
  });

  it("rejects nonexistent room", async () => {
    const res = await a2a("room.info", "nonexistent-xyz");
    expect(isError(res)).toBe(true);
  });
});

describe("room.list", () => {
  it("returns a list of rooms", async () => {
    await createRoom();
    const res = await a2a("room.list");
    const data = resultData(res);
    expect(Array.isArray(data.rooms)).toBe(true);
    expect(data.rooms.length).toBeGreaterThan(0);
  });
});
