import { describe, it, expect } from "vitest";
import { a2a, resultText, resultData, isError, uniqueName, createRoom, joinRoom, sendMsg } from "../helpers.js";

// ============================================================
// message.send
// ============================================================
describe("A2A message.send", () => {
  // --- Positive ---
  it("sends a broadcast message", async () => {
    const { name } = await createRoom();
    const { agentToken } = await joinRoom(name, "agent1");
    const res = await sendMsg(agentToken, "Hello everyone!");
    expect(isError(res)).toBe(false);
    expect(resultText(res)).toContain("sent");
  });

  it("sends a DM to specific agent", async () => {
    const { name } = await createRoom();
    const { agentToken: token1 } = await joinRoom(name, "agent1");
    await joinRoom(name, "agent2");
    const res = await sendMsg(token1, "Private message", "agent2");
    expect(isError(res)).toBe(false);
    expect(resultText(res)).toContain("sent");
  });

  it("message appears in history after send", async () => {
    const { name, roomId } = await createRoom();
    const { agentToken } = await joinRoom(name, "agent1");
    await sendMsg(agentToken, "Test message body");
    const hist = await a2a("message.history", roomId, "", {});
    const data = resultData(hist);
    const found = data.messages.find((m: any) => m.body === "Test message body");
    expect(found).toBeTruthy();
    expect(found.from).toBe("agent1");
  });

  // --- Negative ---
  it("rejects send without agentToken", async () => {
    const res = await a2a("message.send", undefined, "hello");
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("agentToken");
  });

  it("rejects send with invalid agentToken", async () => {
    const res = await sendMsg("bad-token", "hello");
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("Invalid");
  });
});

// ============================================================
// message.history
// ============================================================
describe("A2A message.history", () => {
  // --- Positive ---
  it("returns message history with default limit", async () => {
    const { name, roomId } = await createRoom();
    const { agentToken } = await joinRoom(name, "agent1");
    await sendMsg(agentToken, "msg1");
    await sendMsg(agentToken, "msg2");
    const res = await a2a("message.history", roomId);
    expect(isError(res)).toBe(false);
    const data = resultData(res);
    expect(data.messages).toBeInstanceOf(Array);
    expect(data.messages.length).toBeGreaterThanOrEqual(2);
  });

  it("respects limit parameter", async () => {
    const { name, roomId } = await createRoom();
    const { agentToken } = await joinRoom(name, "agent1");
    for (let i = 0; i < 5; i++) await sendMsg(agentToken, `msg${i}`);
    const res = await a2a("message.history", roomId, "", { limit: 2 });
    const data = resultData(res);
    expect(data.messages.length).toBeLessThanOrEqual(2);
  });

  it("respects offset parameter", async () => {
    const { name, roomId } = await createRoom();
    const { agentToken } = await joinRoom(name, "agent1");
    for (let i = 0; i < 5; i++) await sendMsg(agentToken, `msg${i}`);
    const all = resultData(await a2a("message.history", roomId, "", { limit: 100 }));
    const offset = resultData(await a2a("message.history", roomId, "", { limit: 100, offset: 2 }));
    expect(offset.messages.length).toBe(all.messages.length - 2);
  });

  it("returns messages with correct fields", async () => {
    const { name, roomId } = await createRoom();
    const { agentToken } = await joinRoom(name, "agent1");
    await sendMsg(agentToken, "test body");
    const res = await a2a("message.history", roomId);
    const data = resultData(res);
    const msg = data.messages.find((m: any) => m.body === "test body");
    expect(msg).toBeTruthy();
    expect(msg.id).toBeTruthy();
    expect(msg.roomId).toBeTruthy();
    expect(msg.from).toBe("agent1");
    expect(msg.timestamp).toBeTruthy();
  });

  it("DM messages include 'to' field", async () => {
    const { name, roomId } = await createRoom();
    const { agentToken: t1 } = await joinRoom(name, "agent1");
    await joinRoom(name, "agent2");
    await sendMsg(t1, "dm text", "agent2");
    const res = await a2a("message.history", roomId, "", { limit: 100 });
    const data = resultData(res);
    const dm = data.messages.find((m: any) => m.body === "dm text");
    expect(dm).toBeTruthy();
    expect(dm.to).toBe("agent2");
  });

  // --- Negative ---
  it("rejects history without contextId", async () => {
    const res = await a2a("message.history");
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("required");
  });

  it("rejects history for non-existent room", async () => {
    const res = await a2a("message.history", "nonexistent-room-id");
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("not found");
  });
});
