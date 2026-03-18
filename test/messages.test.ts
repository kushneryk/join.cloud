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

  it("rejects after leaving (token invalidated)", async () => {
    const { roomId } = await createRoom();
    const join = await joinRoom(roomId, "agent1");
    const token = join.agentToken;
    await a2a("room.leave", undefined, "", { agentToken: token });
    const res = await a2a("message.send", undefined, "Hello after leave", { agentToken: token });
    expect(isError(res)).toBe(true);
  });

  it("DM to nonexistent agent succeeds (message stored)", async () => {
    const { roomId } = await createRoom();
    const join = await joinRoom(roomId, "agent1");
    const res = await a2a("message.send", undefined, "Hello ghost", { agentToken: join.agentToken, to: "nobody" });
    expect(resultText(res)).toContain("Message sent");
  });

  it("sends empty message text", async () => {
    const { roomId } = await createRoom();
    const join = await joinRoom(roomId, "agent1");
    const res = await a2a("message.send", undefined, "", { agentToken: join.agentToken });
    expect(resultText(res)).toContain("Message sent");
  });

  it("multiple agents can send messages in the same room", async () => {
    const { roomId } = await createRoom();
    const j1 = await joinRoom(roomId, "alpha");
    const j2 = await joinRoom(roomId, "beta");
    const r1 = await a2a("message.send", undefined, "from alpha", { agentToken: j1.agentToken });
    const r2 = await a2a("message.send", undefined, "from beta", { agentToken: j2.agentToken });
    expect(resultText(r1)).toContain("Message sent");
    expect(resultText(r2)).toContain("Message sent");
  });

  it("token implicitly identifies the room (no contextId needed)", async () => {
    const { roomId } = await createRoom();
    const join = await joinRoom(roomId, "agent1");
    // Send without contextId — the token maps to the room
    const res = await a2a("message.send", undefined, "No context needed", { agentToken: join.agentToken });
    expect(resultText(res)).toContain("Message sent");
    // Verify the message ended up in the right room
    const history = resultData(await a2a("message.history", roomId, "", { limit: 100 }));
    const found = history.messages.find((m: any) => m.body === "No context needed");
    expect(found).toBeDefined();
    expect(found.roomId).toBe(roomId);
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

  it("message appears in history with correct from/to/body", async () => {
    const { roomId } = await createRoom();
    const j1 = await joinRoom(roomId, "sender");
    await joinRoom(roomId, "receiver");
    await a2a("message.send", undefined, "Hello receiver", { agentToken: j1.agentToken, to: "receiver" });
    const data = resultData(await a2a("message.history", roomId, "", { limit: 100 }));
    const msg = data.messages.find((m: any) => m.body === "Hello receiver");
    expect(msg).toBeDefined();
    expect(msg.from).toBe("sender");
    expect(msg.to).toBe("receiver");
    expect(msg.body).toBe("Hello receiver");
    expect(msg.roomId).toBe(roomId);
    expect(msg.id).toBeDefined();
    expect(msg.timestamp).toBeDefined();
  });

  it("broadcast message has no 'to' field", async () => {
    const { roomId } = await createRoom();
    const join = await joinRoom(roomId, "broadcaster");
    await a2a("message.send", undefined, "To everyone", { agentToken: join.agentToken });
    const data = resultData(await a2a("message.history", roomId, "", { limit: 100 }));
    const msg = data.messages.find((m: any) => m.body === "To everyone");
    expect(msg).toBeDefined();
    expect(msg.from).toBe("broadcaster");
    expect(msg.to).toBeUndefined();
  });

  it("messages returned in chronological order", async () => {
    const { roomId } = await createRoom();
    const join = await joinRoom(roomId, "agent1");
    for (let i = 0; i < 5; i++) {
      await a2a("message.send", undefined, `chrono-${i}`, { agentToken: join.agentToken });
    }
    const data = resultData(await a2a("message.history", roomId, "", { limit: 100 }));
    const bodies = data.messages
      .filter((m: any) => m.body.startsWith("chrono-"))
      .map((m: any) => m.body);
    expect(bodies).toEqual(["chrono-0", "chrono-1", "chrono-2", "chrono-3", "chrono-4"]);
  });

  it("offset beyond total messages returns empty result", async () => {
    const { roomId } = await createRoom();
    const join = await joinRoom(roomId, "agent1");
    await a2a("message.send", undefined, "only one", { agentToken: join.agentToken });
    const data = resultData(await a2a("message.history", roomId, "", { limit: 100, offset: 999 }));
    expect(data.messages).toHaveLength(0);
  });

  it("history from multiple agents shows all messages", async () => {
    const { roomId } = await createRoom();
    const j1 = await joinRoom(roomId, "alice");
    const j2 = await joinRoom(roomId, "bob");
    await a2a("message.send", undefined, "alice says hi", { agentToken: j1.agentToken });
    await a2a("message.send", undefined, "bob says hi", { agentToken: j2.agentToken });
    await a2a("message.send", undefined, "alice again", { agentToken: j1.agentToken });
    const data = resultData(await a2a("message.history", roomId, "", { limit: 100 }));
    const fromAlice = data.messages.filter((m: any) => m.from === "alice");
    const fromBob = data.messages.filter((m: any) => m.from === "bob");
    expect(fromAlice.length).toBe(2);
    expect(fromBob.length).toBe(1);
  });

  it("empty room has no messages", async () => {
    const { roomId } = await createRoom();
    const data = resultData(await a2a("message.history", roomId));
    expect(data.messages).toHaveLength(0);
  });

  it("DM to nonexistent agent is stored in history", async () => {
    const { roomId } = await createRoom();
    const join = await joinRoom(roomId, "sender");
    await a2a("message.send", undefined, "message to ghost", { agentToken: join.agentToken, to: "ghost" });
    const data = resultData(await a2a("message.history", roomId, "", { limit: 100 }));
    const msg = data.messages.find((m: any) => m.body === "message to ghost");
    expect(msg).toBeDefined();
    expect(msg.to).toBe("ghost");
  });

  it("default limit is 20 messages", async () => {
    const { roomId } = await createRoom();
    const join = await joinRoom(roomId, "agent1");
    for (let i = 0; i < 25; i++) {
      await a2a("message.send", undefined, `bulk-${i}`, { agentToken: join.agentToken });
    }
    // Request without explicit limit
    const data = resultData(await a2a("message.history", roomId));
    expect(data.messages.length).toBe(20);
  });

  it("limit of 1 returns exactly one message", async () => {
    const { roomId } = await createRoom();
    const join = await joinRoom(roomId, "agent1");
    await a2a("message.send", undefined, "first", { agentToken: join.agentToken });
    await a2a("message.send", undefined, "second", { agentToken: join.agentToken });
    const data = resultData(await a2a("message.history", roomId, "", { limit: 1 }));
    expect(data.messages.length).toBe(1);
  });
});
