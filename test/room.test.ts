import { describe, it, expect } from "vitest";
import { a2a, resultText, resultData, isError, uniqueName, createRoom, joinRoom } from "./helpers.js";

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
  it("joins an existing room", async () => {
    const { roomId } = await createRoom();
    const res = await joinRoom(roomId, "agent1");
    expect(resultText(res)).toContain("Joined");
  });

  it("joins by room name", async () => {
    const { name } = await createRoom();
    const res = await joinRoom(name, "agent1");
    expect(resultText(res)).toContain("Joined");
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

  it("allows reconnection with same agent name", async () => {
    const { roomId } = await createRoom();
    await joinRoom(roomId, "agent1");
    const res = await joinRoom(roomId, "agent1");
    expect(isError(res)).toBe(false);
    expect(resultText(res)).toContain("Joined");
  });
});

describe("room.leave", () => {
  it("leaves a room", async () => {
    const { roomId } = await createRoom();
    await joinRoom(roomId, "agent1");
    const res = await a2a("room.leave", roomId, "", { agentName: "agent1" });
    expect(resultText(res)).toContain("Left");
  });

  it("rejects leave without agentName", async () => {
    const { roomId } = await createRoom();
    const res = await a2a("room.leave", roomId, "");
    expect(isError(res)).toBe(true);
  });

  it("rejects leave from nonexistent room", async () => {
    const res = await a2a("room.leave", "nonexistent-xyz", "", { agentName: "agent1" });
    expect(isError(res)).toBe(true);
  });

  it("rejects leave if not in room", async () => {
    const { roomId } = await createRoom();
    const res = await a2a("room.leave", roomId, "", { agentName: "ghost" });
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

describe("room methods accept names, others require UUID", () => {
  it("room.info accepts name", async () => {
    const { name } = await createRoom();
    const res = await a2a("room.info", name);
    expect(isError(res)).toBe(false);
  });

  it("message.send rejects room name", async () => {
    const { name, roomId } = await createRoom();
    await joinRoom(roomId, "agent1");
    const res = await a2a("message.send", name, "hello", { agentName: "agent1" });
    expect(isError(res)).toBe(true);
  });

  it("git.commit rejects room name", async () => {
    const { name, roomId } = await createRoom();
    await joinRoom(roomId, "dev");
    const res = await a2a("git.commit", name, "", {
      agentName: "dev",
      commitMessage: "test",
      changes: [{ path: "f.txt", content: "x" }],
    });
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
