import { describe, it, expect } from "vitest";
import { a2a, resultText, resultData, isError, createRoom, joinRoom } from "./helpers.js";

describe("message.send", () => {
  it("sends a broadcast message with token", async () => {
    const { roomId } = await createRoom();
    const join = await joinRoom(roomId, "agent1");
    const res = await a2a("message.send", undefined, "Hello!", { agentToken: join.agentToken });
    expect(resultText(res)).toContain("Message sent");
  });

  it("sends a DM", async () => {
    const { roomId } = await createRoom();
    const join1 = await joinRoom(roomId, "agent1");
    await joinRoom(roomId, "agent2");
    const res = await a2a("message.send", undefined, "Secret", { agentToken: join1.agentToken, to: "agent2" });
    expect(resultText(res)).toContain("Message sent");
  });

  it("rejects without agentToken", async () => {
    const { roomId } = await createRoom();
    const res = await a2a("message.send", roomId, "Hello");
    expect(isError(res)).toBe(true);
  });

  it("rejects with invalid token", async () => {
    const res = await a2a("message.send", undefined, "Hello", { agentToken: "invalid-token" });
    expect(isError(res)).toBe(true);
  });
});

describe("message.history", () => {
  it("returns messages", async () => {
    const { roomId } = await createRoom();
    const join = await joinRoom(roomId, "agent1");
    await a2a("message.send", undefined, "msg1", { agentToken: join.agentToken });
    await a2a("message.send", undefined, "msg2", { agentToken: join.agentToken });
    const res = await a2a("message.history", roomId);
    const data = resultData(res);
    expect(data.messages.length).toBeGreaterThanOrEqual(2);
  });

  it("respects limit parameter", async () => {
    const { roomId } = await createRoom();
    const join = await joinRoom(roomId, "agent1");
    for (let i = 0; i < 5; i++) {
      await a2a("message.send", undefined, `msg${i}`, { agentToken: join.agentToken });
    }
    const res = await a2a("message.history", roomId, "", { limit: 2 });
    const data = resultData(res);
    expect(data.messages.length).toBe(2);
  });

  it("respects offset parameter", async () => {
    const { roomId } = await createRoom();
    const join = await joinRoom(roomId, "agent1");
    for (let i = 0; i < 5; i++) {
      await a2a("message.send", undefined, `msg${i}`, { agentToken: join.agentToken });
    }
    const all = resultData(await a2a("message.history", roomId, "", { limit: 100 }));
    const offset = resultData(await a2a("message.history", roomId, "", { limit: 100, offset: 2 }));
    expect(offset.messages.length).toBe(all.messages.length - 2);
  });

  it("caps limit at 100", async () => {
    const { roomId } = await createRoom();
    const res = await a2a("message.history", roomId, "", { limit: 999 });
    expect(isError(res)).toBe(false);
  });

  it("rejects without contextId", async () => {
    const res = await a2a("message.history");
    expect(isError(res)).toBe(true);
  });

  it("rejects nonexistent room", async () => {
    const res = await a2a("message.history", "nonexistent-xyz");
    expect(isError(res)).toBe(true);
  });
});
