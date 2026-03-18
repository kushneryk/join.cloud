import { describe, it, expect } from "vitest";
import { a2a, resultText, resultData, isError, uniqueName, createRoom, joinRoom } from "./helpers.js";

const BASE = process.env.TEST_URL ?? "http://localhost:3000";

describe("help", () => {
  it("returns documentation", async () => {
    const res = await a2a("help");
    expect(resultText(res).length).toBeGreaterThan(100);
  });

  it("help response contains structured documentation data", async () => {
    const res = await a2a("help");
    const data = resultData(res);
    expect(data).toBeDefined();
    expect(data.documentation).toBeDefined();
    expect(data.documentation.actions).toBeDefined();
  });
});

describe("unknown action", () => {
  it("returns error for unknown action", async () => {
    const res = await a2a("nonexistent.action");
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("Unknown action");
  });

  it("error message suggests help", async () => {
    const res = await a2a("nonexistent.action");
    expect(resultText(res)).toContain("help");
  });

  it("another unknown action", async () => {
    const res = await a2a("foo.bar.baz");
    expect(isError(res)).toBe(true);
  });
});

describe("action aliases", () => {
  it("'create' alias works for room.create", async () => {
    const name = uniqueName("alias-create");
    const res = await a2a("create", undefined, name);
    const data = resultData(res);
    expect(data.roomId).toBeDefined();
  });

  it("'join' alias works for room.join", async () => {
    const { roomId } = await createRoom();
    const res = await a2a("join", roomId, "", { agentName: "aliasAgent" });
    expect(resultText(res)).toContain("Joined");
  });

  it("'leave' alias works for room.leave", async () => {
    const { roomId } = await createRoom();
    const join = await joinRoom(roomId, "agent1");
    const res = await a2a("leave", undefined, "", { agentToken: join.agentToken });
    expect(resultText(res)).toContain("Left");
  });

  it("'send' alias works for message.send", async () => {
    const { roomId } = await createRoom();
    const join = await joinRoom(roomId, "agent1");
    const res = await a2a("send", undefined, "Hello via alias", { agentToken: join.agentToken });
    expect(resultText(res)).toContain("Message sent");
  });

  it("'history' alias works for message.history", async () => {
    const { roomId } = await createRoom();
    const res = await a2a("history", roomId);
    expect(isError(res)).toBe(false);
  });

  it("'info' alias works for room.info", async () => {
    const { roomId } = await createRoom();
    const res = await a2a("info", roomId);
    const data = resultData(res);
    expect(data.roomId).toBe(roomId);
  });

  it("'list' alias works for room.list", async () => {
    const res = await a2a("list");
    const data = resultData(res);
    expect(Array.isArray(data.rooms)).toBe(true);
  });
});

describe("default chat (no action)", () => {
  it("no action without token returns docs", async () => {
    const res = await a2a("" as any, undefined, "Hello there");
    // When no action and no token, should return docs
    expect(resultText(res).length).toBeGreaterThan(50);
  });

  it("no action with token and contextId sends as chat message", async () => {
    const { roomId } = await createRoom();
    const join = await joinRoom(roomId, "chatter");
    // Send with no action but with agentToken + contextId
    const res = await fetch(`${BASE}/a2a`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "SendMessage",
        params: {
          message: {
            role: "user",
            parts: [{ text: "implicit chat message" }],
            contextId: roomId,
            metadata: { agentToken: join.agentToken },
          },
        },
      }),
    });
    const json = (await res.json()) as any;
    expect(resultText(json)).toContain("Message sent");
    // Verify message is in history
    const data = resultData(await a2a("message.history", roomId, "", { limit: 100 }));
    const msg = data.messages.find((m: any) => m.body === "implicit chat message");
    expect(msg).toBeDefined();
  });
});

describe("password-protected rooms", () => {
  it("allows joining with correct password", async () => {
    const { roomId } = await createRoom(undefined, "secret");
    const res = await joinRoom(roomId, "agent1", { password: "secret" });
    expect(resultText(res)).toContain("Joined");
  });

  it("rejects join with wrong password", async () => {
    const { roomId } = await createRoom(undefined, "secret");
    const res = await joinRoom(roomId, "agent1", { password: "wrong" });
    expect(isError(res)).toBe(true);
  });

  it("rejects join without password", async () => {
    const { roomId } = await createRoom(undefined, "secret");
    const res = await joinRoom(roomId, "agent1");
    expect(isError(res)).toBe(true);
  });

  it("password room accessible by roomId with password in metadata", async () => {
    const { roomId } = await createRoom(undefined, "pwtest");
    const res = await joinRoom(roomId, "agent1", { password: "pwtest" });
    expect(res.agentToken).toBeDefined();
  });

  it("password room accessible by name:password syntax", async () => {
    const name = uniqueName("pw-syntax");
    await createRoom(name, "mypass");
    const res = await a2a("room.info", `${name}:mypass`);
    const data = resultData(res);
    expect(data.name).toBe(name);
  });

  it("same name, different passwords are different rooms", async () => {
    const name = uniqueName("pw-diff");
    const r1 = await createRoom(name, "pass1");
    const r2 = await createRoom(name, "pass2");
    expect(r1.roomId).not.toBe(r2.roomId);
    // Join each room
    const j1 = await joinRoom(r1.roomId, "agent1", { password: "pass1" });
    const j2 = await joinRoom(r2.roomId, "agent1", { password: "pass2" });
    expect(j1.agentToken).toBeDefined();
    expect(j2.agentToken).toBeDefined();
    expect(j1.agentToken).not.toBe(j2.agentToken);
  });
});

describe("agent card endpoint", () => {
  it("returns valid JSON", async () => {
    const res = await fetch(`${BASE}/.well-known/agent-card.json`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.name).toBe("Join.cloud");
    expect(json.version).toBeDefined();
    expect(json.url).toBeDefined();
  });

  it("includes skills list", async () => {
    const res = await fetch(`${BASE}/.well-known/agent-card.json`);
    const json = (await res.json()) as any;
    expect(Array.isArray(json.skills)).toBe(true);
    expect(json.skills.length).toBeGreaterThan(0);
    const skillIds = json.skills.map((s: any) => s.id);
    expect(skillIds).toContain("room.create");
    expect(skillIds).toContain("message.send");
  });

  it("includes capabilities", async () => {
    const res = await fetch(`${BASE}/.well-known/agent-card.json`);
    const json = (await res.json()) as any;
    expect(json.capabilities).toBeDefined();
    expect(json.capabilities.streaming).toBe(true);
  });

  it("includes provider info", async () => {
    const res = await fetch(`${BASE}/.well-known/agent-card.json`);
    const json = (await res.json()) as any;
    expect(json.provider).toBeDefined();
    expect(json.provider.name).toBe("Join.cloud");
  });
});

describe("rpc.discover", () => {
  it("returns service discovery info", async () => {
    const res = await fetch(`${BASE}/a2a`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "rpc.discover" }),
    });
    const json = (await res.json()) as any;
    expect(json.result).toBeDefined();
    expect(json.result.name).toBe("Join.cloud");
    expect(json.result.version).toBeDefined();
  });

  it("discovery includes methods list", async () => {
    const res = await fetch(`${BASE}/a2a`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "rpc.discover" }),
    });
    const json = (await res.json()) as any;
    expect(Array.isArray(json.result.methods)).toBe(true);
    const names = json.result.methods.map((m: any) => m.name);
    expect(names).toContain("SendMessage");
    expect(names).toContain("rpc.discover");
  });

  it("discovery includes actions and endpoints", async () => {
    const res = await fetch(`${BASE}/a2a`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "rpc.discover" }),
    });
    const json = (await res.json()) as any;
    expect(json.result.actions).toBeDefined();
    expect(json.result.endpoints).toBeDefined();
    expect(json.result.endpoints.a2a).toBeDefined();
  });
});

describe("JSON-RPC error handling", () => {
  it("rejects invalid JSON", async () => {
    const res = await fetch(`${BASE}/a2a`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const json = (await res.json()) as any;
    expect(json.error).toBeDefined();
    expect(json.error.code).toBe(-32700);
  });

  it("rejects missing jsonrpc field", async () => {
    const res = await fetch(`${BASE}/a2a`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: 1, method: "SendMessage" }),
    });
    const json = (await res.json()) as any;
    expect(json.error).toBeDefined();
    expect(json.error.code).toBe(-32600);
  });

  it("rejects unknown method", async () => {
    const res = await fetch(`${BASE}/a2a`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "UnknownMethod" }),
    });
    const json = (await res.json()) as any;
    expect(json.error).toBeDefined();
    expect(json.error.code).toBe(-32601);
  });

  it("GetTask returns not implemented", async () => {
    const res = await fetch(`${BASE}/a2a`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "GetTask" }),
    });
    const json = (await res.json()) as any;
    expect(json.error).toBeDefined();
    expect(json.error.code).toBe(-32601);
    expect(json.error.message).toContain("GetTask");
  });
});
