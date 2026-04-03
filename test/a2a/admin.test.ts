import { describe, it, expect } from "vitest";
import { a2a, resultText, resultData, isError, uniqueName, createRoom, joinRoom, promoteAgent, demoteAgent, kickAgent, updateRoom } from "../helpers.js";

// ============================================================
// Roles
// ============================================================
describe("A2A admin roles", () => {
  it("room creator gets admin role", async () => {
    const { name } = await createRoom();
    const info = resultData(await a2a("room.info", name));
    const creator = info.agents.find((a: any) => a.name === "creator");
    expect(creator.role).toBe("admin");
  });

  it("subsequent joiner gets member role", async () => {
    const { name } = await createRoom();
    const { role } = await joinRoom(name, "agent1");
    expect(role).toBe("member");
    const info = resultData(await a2a("room.info", name));
    const agent1 = info.agents.find((a: any) => a.name === "agent1");
    expect(agent1.role).toBe("member");
  });
});

// ============================================================
// room.promote
// ============================================================
describe("A2A room.promote", () => {
  it("admin promotes member to admin", async () => {
    const { name, agentToken } = await createRoom();
    await joinRoom(name, "agent1");
    const res = await promoteAgent(agentToken, "agent1");
    expect(isError(res)).toBe(false);
    expect(resultText(res)).toContain("Promoted");
    // Verify role changed
    const info = resultData(await a2a("room.info", name));
    const agent1 = info.agents.find((a: any) => a.name === "agent1");
    expect(agent1.role).toBe("admin");
  });

  it("member cannot promote", async () => {
    const { name } = await createRoom();
    const { agentToken: memberToken } = await joinRoom(name, "agent1");
    await joinRoom(name, "agent2");
    const res = await promoteAgent(memberToken, "agent2");
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("Admin role required");
  });

  it("rejects promote of non-existent agent", async () => {
    const { agentToken } = await createRoom();
    const res = await promoteAgent(agentToken, "ghost");
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("not found");
  });
});

// ============================================================
// room.demote
// ============================================================
describe("A2A room.demote", () => {
  it("admin demotes another admin to member", async () => {
    const { name, agentToken } = await createRoom();
    await joinRoom(name, "agent1");
    await promoteAgent(agentToken, "agent1");
    const res = await demoteAgent(agentToken, "agent1");
    expect(isError(res)).toBe(false);
    expect(resultText(res)).toContain("Demoted");
    const info = resultData(await a2a("room.info", name));
    const agent1 = info.agents.find((a: any) => a.name === "agent1");
    expect(agent1.role).toBe("member");
  });

  it("member cannot demote", async () => {
    const { name } = await createRoom();
    const { agentToken: memberToken } = await joinRoom(name, "agent1");
    const res = await demoteAgent(memberToken, "creator");
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("Admin role required");
  });

  it("cannot demote the last admin", async () => {
    const { agentToken } = await createRoom();
    const res = await demoteAgent(agentToken, "creator");
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("last admin");
  });

  it("rejects demote of non-existent agent", async () => {
    const { agentToken } = await createRoom();
    const res = await demoteAgent(agentToken, "ghost");
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("not found");
  });
});

// ============================================================
// room.kick
// ============================================================
describe("A2A room.kick", () => {
  it("admin kicks member", async () => {
    const { name, agentToken } = await createRoom();
    await joinRoom(name, "agent1");
    const res = await kickAgent(agentToken, "agent1");
    expect(isError(res)).toBe(false);
    expect(resultText(res)).toContain("Kicked");
    // Verify removed
    const info = resultData(await a2a("room.info", name));
    const names = info.agents.map((a: any) => a.name);
    expect(names).not.toContain("agent1");
  });

  it("member cannot kick", async () => {
    const { name } = await createRoom();
    const { agentToken: memberToken } = await joinRoom(name, "agent1");
    await joinRoom(name, "agent2");
    const res = await kickAgent(memberToken, "agent2");
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("Admin role required");
  });

  it("cannot kick yourself", async () => {
    const { agentToken } = await createRoom();
    const res = await kickAgent(agentToken, "creator");
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("Cannot kick yourself");
  });

  it("rejects kick of non-existent agent", async () => {
    const { agentToken } = await createRoom();
    const res = await kickAgent(agentToken, "ghost");
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("not found");
  });
});

// ============================================================
// room.update
// ============================================================
describe("A2A room.update", () => {
  it("admin updates description", async () => {
    const { name, agentToken } = await createRoom();
    const res = await updateRoom(agentToken, { description: "New description" });
    expect(isError(res)).toBe(false);
    expect(resultText(res)).toContain("updated");
    const info = resultData(await a2a("room.info", name));
    expect(info.description).toBe("New description");
  });

  it("admin updates type (group to channel)", async () => {
    const { name, agentToken } = await createRoom();
    const res = await updateRoom(agentToken, { type: "channel" });
    expect(isError(res)).toBe(false);
    const info = resultData(await a2a("room.info", name));
    expect(info.type).toBe("channel");
  });

  it("admin updates type (channel to group)", async () => {
    const { name, agentToken } = await createRoom(undefined, undefined, { type: "channel" });
    const res = await updateRoom(agentToken, { type: "group" });
    expect(isError(res)).toBe(false);
    const info = resultData(await a2a("room.info", name));
    expect(info.type).toBe("group");
  });

  it("admin updates both description and type", async () => {
    const { name, agentToken } = await createRoom();
    const res = await updateRoom(agentToken, { description: "Desc", type: "channel" });
    expect(isError(res)).toBe(false);
    const info = resultData(await a2a("room.info", name));
    expect(info.description).toBe("Desc");
    expect(info.type).toBe("channel");
  });

  it("member cannot update", async () => {
    const { name } = await createRoom();
    const { agentToken: memberToken } = await joinRoom(name, "agent1");
    const res = await updateRoom(memberToken, { description: "Hacked" });
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("Admin role required");
  });

  it("rejects description over 5000 chars", async () => {
    const { agentToken } = await createRoom();
    const longDesc = "x".repeat(5001);
    const res = await updateRoom(agentToken, { description: longDesc });
    expect(isError(res)).toBe(true);
  });

  it("rejects update with no fields", async () => {
    const { agentToken } = await createRoom();
    const res = await updateRoom(agentToken, {});
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("At least one");
  });
});
