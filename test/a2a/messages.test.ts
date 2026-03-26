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
    const hist = await a2a("message.history", roomId, "", { agentToken });
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
    const res = await a2a("message.history", roomId, "", { agentToken });
    expect(isError(res)).toBe(false);
    const data = resultData(res);
    expect(data.messages).toBeInstanceOf(Array);
    expect(data.messages.length).toBeGreaterThanOrEqual(2);
  });

  it("respects limit parameter", async () => {
    const { name, roomId } = await createRoom();
    const { agentToken } = await joinRoom(name, "agent1");
    for (let i = 0; i < 5; i++) await sendMsg(agentToken, `msg${i}`);
    const res = await a2a("message.history", roomId, "", { agentToken, limit: 2 });
    const data = resultData(res);
    expect(data.messages.length).toBeLessThanOrEqual(2);
  });

  it("respects offset parameter", async () => {
    const { name, roomId } = await createRoom();
    const { agentToken } = await joinRoom(name, "agent1");
    for (let i = 0; i < 5; i++) await sendMsg(agentToken, `msg${i}`);
    const all = resultData(await a2a("message.history", roomId, "", { agentToken, limit: 100 }));
    const offset = resultData(await a2a("message.history", roomId, "", { agentToken, limit: 100, offset: 2 }));
    expect(offset.messages.length).toBe(all.messages.length - 2);
  });

  it("returns messages with correct fields", async () => {
    const { name, roomId } = await createRoom();
    const { agentToken } = await joinRoom(name, "agent1");
    await sendMsg(agentToken, "test body");
    const res = await a2a("message.history", roomId, "", { agentToken });
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
    const res = await a2a("message.history", roomId, "", { agentToken: t1, limit: 100 });
    const data = resultData(res);
    const dm = data.messages.find((m: any) => m.body === "dm text");
    expect(dm).toBeTruthy();
    expect(dm.to).toBe("agent2");
  });

  // --- Negative ---
  it("rejects history without agentToken", async () => {
    const { roomId } = await createRoom();
    const res = await a2a("message.history", roomId);
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("agentToken");
  });

  it("rejects history for wrong room", async () => {
    const { name } = await createRoom();
    const { agentToken } = await joinRoom(name, "agent1");
    const { roomId: otherRoomId } = await createRoom();
    const res = await a2a("message.history", otherRoomId, "", { agentToken });
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("does not belong");
  });
});

// ============================================================
// message.unread
// ============================================================
describe("A2A message.unread", () => {
  it("returns unread messages from another agent", async () => {
    const { name } = await createRoom();
    const { agentToken: t1 } = await joinRoom(name, "agent1");
    const { agentToken: t2 } = await joinRoom(name, "agent2");
    // agent1 sends 3 messages
    await sendMsg(t1, "msg1");
    await sendMsg(t1, "msg2");
    await sendMsg(t1, "msg3");
    // agent2 checks unread
    const res = await a2a("message.unread", undefined, "", { agentToken: t2 });
    expect(isError(res)).toBe(false);
    const data = resultData(res);
    expect(data.messages.length).toBe(3);
    expect(data.total).toBe(3);
  });

  it("returns empty on second call (already read)", async () => {
    const { name } = await createRoom();
    const { agentToken: t1 } = await joinRoom(name, "agent1");
    const { agentToken: t2 } = await joinRoom(name, "agent2");
    await sendMsg(t1, "msg1");
    // First call — returns 1
    const res1 = await a2a("message.unread", undefined, "", { agentToken: t2 });
    expect(resultData(res1).messages.length).toBe(1);
    // Second call — returns 0
    const res2 = await a2a("message.unread", undefined, "", { agentToken: t2 });
    expect(resultData(res2).messages.length).toBe(0);
  });

  it("returns only new messages after read", async () => {
    const { name } = await createRoom();
    const { agentToken: t1 } = await joinRoom(name, "agent1");
    const { agentToken: t2 } = await joinRoom(name, "agent2");
    await sendMsg(t1, "old msg");
    // Read all
    await a2a("message.unread", undefined, "", { agentToken: t2 });
    // Send 2 more
    await sendMsg(t1, "new msg 1");
    await sendMsg(t1, "new msg 2");
    // Should get only 2
    const res = await a2a("message.unread", undefined, "", { agentToken: t2 });
    const data = resultData(res);
    expect(data.messages.length).toBe(2);
    expect(data.messages[0].body).toBe("new msg 1");
    expect(data.messages[1].body).toBe("new msg 2");
  });

  it("rejects with invalid token", async () => {
    const res = await a2a("message.unread", undefined, "", { agentToken: "bad-token" });
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("Invalid");
  });
});
