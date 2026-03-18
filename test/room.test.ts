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

  it("rejects reserved name 'docs'", async () => {
    const res = await a2a("room.create", undefined, "docs");
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("reserved");
  });

  it("lowercases room names on create", async () => {
    const name = uniqueName("UPPER");
    const res = await a2a("room.create", undefined, name);
    const data = resultData(res);
    expect(data.name).toBe(name.toLowerCase());
  });

  it("auto-generates name when text is empty", async () => {
    const res = await a2a("room.create", undefined, "");
    const data = resultData(res);
    expect(data.roomId).toBeDefined();
    expect(data.name).toBeDefined();
    // auto-generated name equals the roomId (UUID)
    expect(data.name).toBe(data.roomId);
  });

  it("allows same name with different passwords (different rooms)", async () => {
    const name = uniqueName("multi-pw");
    const res1 = await a2a("room.create", undefined, name, { password: "pass1" });
    const res2 = await a2a("room.create", undefined, name, { password: "pass2" });
    const data1 = resultData(res1);
    const data2 = resultData(res2);
    expect(data1.roomId).toBeDefined();
    expect(data2.roomId).toBeDefined();
    expect(data1.roomId).not.toBe(data2.roomId);
  });

  it("rejects creating non-password room when password-protected room with same name exists", async () => {
    const name = uniqueName("pw-block");
    await a2a("room.create", undefined, name, { password: "secret" });
    const res = await a2a("room.create", undefined, name);
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

  it("multiple agents can join the same room", async () => {
    const { roomId } = await createRoom();
    const r1 = await joinRoom(roomId, "alpha");
    const r2 = await joinRoom(roomId, "beta");
    const r3 = await joinRoom(roomId, "gamma");
    expect(r1.agentToken).toBeDefined();
    expect(r2.agentToken).toBeDefined();
    expect(r3.agentToken).toBeDefined();
    // All tokens should be different
    expect(new Set([r1.agentToken, r2.agentToken, r3.agentToken]).size).toBe(3);
  });

  it("join after leave re-uses the same name", async () => {
    const { roomId } = await createRoom();
    const first = await joinRoom(roomId, "agent1");
    await a2a("room.leave", undefined, "", { agentToken: first.agentToken });
    // Now the name should be free again
    const second = await joinRoom(roomId, "agent1");
    expect(resultText(second)).toContain("Joined");
    expect(second.agentToken).toBeDefined();
    // New token should differ from the old one
    expect(second.agentToken).not.toBe(first.agentToken);
  });

  it("case-insensitive room name lookup on join", async () => {
    const name = uniqueName("casetest");
    await createRoom(name);
    // Join using uppercase version of the name
    const res = await joinRoom(name.toUpperCase(), "agent1");
    // getRoom lowercases, so it should find the room
    expect(isError(res)).toBe(false);
    expect(res.agentToken).toBeDefined();
  });

  it("rejects join without contextId", async () => {
    const res = await a2a("room.join", undefined, "", { agentName: "agent1" });
    expect(isError(res)).toBe(true);
  });

  it("reconnection returns the same agentToken", async () => {
    const { roomId } = await createRoom();
    const first = await joinRoom(roomId, "agent1");
    const token = first.agentToken;
    const second = await joinRoom(roomId, "agent1", { agentToken: token });
    const secondToken = getToken(second);
    expect(secondToken).toBe(token);
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

  it("cannot leave twice with the same token", async () => {
    const { roomId } = await createRoom();
    const join = await joinRoom(roomId, "agent1");
    await a2a("room.leave", undefined, "", { agentToken: join.agentToken });
    const res = await a2a("room.leave", undefined, "", { agentToken: join.agentToken });
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

  it("shows correct agent count after multiple joins", async () => {
    const { roomId } = await createRoom();
    await joinRoom(roomId, "a1");
    await joinRoom(roomId, "a2");
    await joinRoom(roomId, "a3");
    const res = await a2a("room.info", roomId);
    const data = resultData(res);
    expect(data.agents).toHaveLength(3);
    const names = data.agents.map((a: any) => a.name).sort();
    expect(names).toEqual(["a1", "a2", "a3"]);
  });

  it("shows correct agent count after join and leave", async () => {
    const { roomId } = await createRoom();
    const j1 = await joinRoom(roomId, "stays");
    const j2 = await joinRoom(roomId, "leaves");
    await a2a("room.leave", undefined, "", { agentToken: j2.agentToken });
    const res = await a2a("room.info", roomId);
    const data = resultData(res);
    expect(data.agents).toHaveLength(1);
    expect(data.agents[0].name).toBe("stays");
  });

  it("shows zero agents for empty room", async () => {
    const { roomId } = await createRoom();
    const res = await a2a("room.info", roomId);
    const data = resultData(res);
    expect(data.agents).toHaveLength(0);
  });

  it("returns roomId in info data", async () => {
    const { roomId } = await createRoom();
    const res = await a2a("room.info", roomId);
    const data = resultData(res);
    expect(data.roomId).toBe(roomId);
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

  it("newly created room appears in the list", async () => {
    const { roomId, name } = await createRoom();
    const res = await a2a("room.list");
    const data = resultData(res);
    const found = data.rooms.find((r: any) => r.id === roomId);
    expect(found).toBeDefined();
    expect(found.name).toBe(name);
  });

  it("list includes agent count", async () => {
    const { roomId } = await createRoom();
    await joinRoom(roomId, "a1");
    await joinRoom(roomId, "a2");
    const res = await a2a("room.list");
    const data = resultData(res);
    const found = data.rooms.find((r: any) => r.id === roomId);
    expect(found).toBeDefined();
    expect(found.agents).toBe(2);
  });
});
