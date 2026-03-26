import { describe, it, expect, afterEach } from "vitest";
import { JoinCloud, Room } from "../../src/client/index.js";
import { uniqueName } from "../helpers.js";

const SERVER = process.env.TEST_URL ?? "http://localhost:3000";

function client() {
  return new JoinCloud(SERVER, { persist: false });
}

const rooms: Room[] = [];
afterEach(async () => {
  for (const r of rooms.splice(0)) {
    try { r.close(); } catch {}
  }
});

// ============================================================
// JoinCloud constructor
// ============================================================
describe("SDK JoinCloud constructor", () => {
  it("defaults to join.cloud", () => {
    const jc = new JoinCloud();
    expect(jc.serverUrl).toBe("https://join.cloud");
  });

  it("accepts custom server URL", () => {
    const jc = new JoinCloud("http://localhost:9999");
    expect(jc.serverUrl).toBe("http://localhost:9999");
  });

  it("strips trailing slash", () => {
    const jc = new JoinCloud("http://localhost:3000/");
    expect(jc.serverUrl).toBe("http://localhost:3000");
  });
});

// ============================================================
// listRooms
// ============================================================
describe("SDK listRooms", () => {
  // --- Positive ---
  it("returns array of rooms", async () => {
    const jc = client();
    await jc.createRoom(uniqueName("sdk-room"));
    const { rooms: list, total } = await jc.listRooms();
    expect(list).toBeInstanceOf(Array);
    expect(list.length).toBeGreaterThan(0);
    expect(typeof total).toBe("number");
  });

  it("rooms have expected fields", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name);
    const { rooms: list } = await jc.listRooms();
    const room = list.find((r) => r.name === name);
    expect(room).toBeTruthy();
    expect(room!.createdAt).toBeTruthy();
    expect(typeof room!.agents).toBe("number");
  });

  // --- Negative ---
  it("throws on unreachable server", async () => {
    const jc = new JoinCloud("http://localhost:1", { persist: false });
    await expect(jc.listRooms()).rejects.toThrow();
  });
});

// ============================================================
// createRoom
// ============================================================
describe("SDK createRoom", () => {
  // --- Positive ---
  it("creates room and returns roomId + name", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    const result = await jc.createRoom(name);
    expect(result.roomId).toBeTruthy();
    expect(result.name).toBe(name);
  });

  it("creates room with password", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    const result = await jc.createRoom(name, { password: "secret" });
    expect(result.roomId).toBeTruthy();
  });

  // --- Negative ---
  it("throws for reserved name", async () => {
    const jc = client();
    await expect(jc.createRoom("mcp")).rejects.toThrow();
  });

  it("throws for duplicate room", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name);
    await expect(jc.createRoom(name)).rejects.toThrow(/already exists/i);
  });
});

// ============================================================
// roomInfo
// ============================================================
describe("SDK roomInfo", () => {
  // --- Positive ---
  it("returns room info", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name);
    const info = await jc.roomInfo(name);
    expect(info.roomId).toBeTruthy();
    expect(info.name).toBe(name);
    expect(info.agents).toBeInstanceOf(Array);
  });

  it("includes agents in info", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name);
    const room = await jc.joinRoom(name, { name: "sdk-agent" });
    rooms.push(room);
    const info = await jc.roomInfo(name);
    expect(info.agents.length).toBe(1);
    expect(info.agents[0].name).toBe("sdk-agent");
    expect(info.agents[0].joinedAt).toBeTruthy();
  });

  // --- Negative ---
  it("throws for non-existent room", async () => {
    const jc = client();
    await expect(jc.roomInfo("nonexistent-room-xyz")).rejects.toThrow(/not found/i);
  });
});

// ============================================================
// joinRoom
// ============================================================
describe("SDK joinRoom", () => {
  // --- Positive ---
  it("returns Room instance with properties", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name);
    const room = await jc.joinRoom(name, { name: "agent1" });
    rooms.push(room);
    expect(room).toBeInstanceOf(Room);
    expect(room.roomName).toBe(name);
    expect(room.roomId).toBeTruthy();
    expect(room.agentName).toBe("agent1");
    expect(room.agentToken).toBeTruthy();
  });

  it("SSE is connected after joinRoom resolves", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name);
    const room = await jc.joinRoom(name, { name: "agent1" });
    rooms.push(room);
    // connected() should resolve immediately since joinRoom awaits it
    await expect(room.connected()).resolves.toBeUndefined();
  });

  it("joins with password (colon syntax)", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name, { password: "pass" });
    const room = await jc.joinRoom(`${name}:pass`, { name: "agent1" });
    rooms.push(room);
    expect(room.agentToken).toBeTruthy();
  });

  it("joins with password (separate param)", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name, { password: "Secret123" });
    const room = await jc.joinRoom(name, { name: "agent1", password: "Secret123" });
    rooms.push(room);
    expect(room.agentToken).toBeTruthy();
  });

  it("joins with uppercase password (colon syntax)", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name, { password: "MyPass_XYZ" });
    const room = await jc.joinRoom(`${name}:MyPass_XYZ`, { name: "agent1" });
    rooms.push(room);
    expect(room.agentToken).toBeTruthy();
  });

  it("rejects wrong password", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name, { password: "correct" });
    await expect(jc.joinRoom(`${name}:wrong`, { name: "a" })).rejects.toThrow(/invalid room password/i);
  });

  // --- Negative ---
  it("throws for non-existent room", async () => {
    const jc = client();
    await expect(jc.joinRoom("no-such-room", { name: "a" })).rejects.toThrow(/not found/i);
  });

  it("throws for duplicate agent name", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name);
    const room = await jc.joinRoom(name, { name: "agent1" });
    rooms.push(room);
    const jc2 = client();
    await expect(jc2.joinRoom(name, { name: "agent1" })).rejects.toThrow(/already taken/i);
  });
});

// ============================================================
// Room.send
// ============================================================
describe("SDK Room.send", () => {
  // --- Positive ---
  it("sends broadcast message", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name);
    const room = await jc.joinRoom(name, { name: "sender" });
    rooms.push(room);
    await expect(room.send("hello")).resolves.toBeUndefined();
  });

  it("sends DM with to option", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name);
    const room = await jc.joinRoom(name, { name: "sender" });
    rooms.push(room);
    await expect(room.send("dm text", { to: "someone" })).resolves.toBeUndefined();
  });

  // --- Negative ---
  it("throws after leaving room", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name);
    const room = await jc.joinRoom(name, { name: "sender" });
    await room.leave();
    await expect(room.send("hello")).rejects.toThrow();
  });
});

// ============================================================
// Room.getHistory
// ============================================================
describe("SDK Room.getHistory", () => {
  // --- Positive ---
  it("returns message array with total", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name);
    const room = await jc.joinRoom(name, { name: "hist-agent" });
    rooms.push(room);
    await room.send("msg1");
    await room.send("msg2");
    const { messages: msgs, total } = await room.getHistory();
    expect(msgs).toBeInstanceOf(Array);
    expect(msgs.length).toBeGreaterThanOrEqual(2);
    expect(typeof total).toBe("number");
  });

  it("respects limit option", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name);
    const room = await jc.joinRoom(name, { name: "hist-agent" });
    rooms.push(room);
    for (let i = 0; i < 5; i++) await room.send(`m${i}`);
    const { messages: msgs } = await room.getHistory({ limit: 2 });
    expect(msgs.length).toBeLessThanOrEqual(2);
  });

  it("respects offset option", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name);
    const room = await jc.joinRoom(name, { name: "hist-agent" });
    rooms.push(room);
    for (let i = 0; i < 5; i++) await room.send(`m${i}`);
    const { messages: all } = await room.getHistory({ limit: 100 });
    const { messages: offset } = await room.getHistory({ limit: 100, offset: 2 });
    expect(offset.length).toBe(all.length - 2);
  });

  it("messages have correct fields", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name);
    const room = await jc.joinRoom(name, { name: "hist-agent" });
    rooms.push(room);
    await room.send("test body");
    const { messages: msgs } = await room.getHistory();
    const msg = msgs.find((m) => m.body === "test body");
    expect(msg).toBeTruthy();
    expect(msg!.id).toBeTruthy();
    expect(msg!.roomId).toBeTruthy();
    expect(msg!.from).toBe("hist-agent");
    expect(msg!.timestamp).toBeTruthy();
  });

  // --- Negative ---
  // getHistory uses roomId so it works even after close, but bad roomId would fail
  it("returns empty for fresh room", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name);
    const room = await jc.joinRoom(name, { name: "hist-agent" });
    rooms.push(room);
    const { messages: msgs } = await room.getHistory();
    // Only bot join message
    const userMsgs = msgs.filter((m) => m.from !== "room-bot");
    expect(userMsgs.length).toBe(0);
  });
});

// ============================================================
// Room.leave
// ============================================================
describe("SDK Room.leave", () => {
  // --- Positive ---
  it("leaves room successfully", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name);
    const room = await jc.joinRoom(name, { name: "leaver" });
    await expect(room.leave()).resolves.toBeUndefined();
  });

  it("agent removed from room info after leave", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name);
    const room = await jc.joinRoom(name, { name: "leaver" });
    await room.leave();
    const info = await jc.roomInfo(name);
    expect(info.agents.find((a) => a.name === "leaver")).toBeUndefined();
  });

  // --- Negative ---
  it("throws when leaving with invalid token (already left)", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name);
    const room = await jc.joinRoom(name, { name: "leaver" });
    await room.leave();
    await expect(room.leave()).rejects.toThrow();
  });
});

// ============================================================
// Room.close
// ============================================================
describe("SDK Room.close", () => {
  it("closes SSE without leaving room", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name);
    const room = await jc.joinRoom(name, { name: "closer" });
    room.close();
    // Agent should still be in room
    const info = await jc.roomInfo(name);
    expect(info.agents.find((a) => a.name === "closer")).toBeTruthy();
  });
});

// ============================================================
// Room events
// ============================================================
describe("SDK Room events", () => {
  it("emits 'message' for incoming messages", async () => {
    const jc1 = client();
    const jc2 = client();
    const name = uniqueName("sdk-room");
    await jc1.createRoom(name);
    const room1 = await jc1.joinRoom(name, { name: "listener" });
    rooms.push(room1);

    const received: any[] = [];
    room1.on("message", (msg) => received.push(msg));

    const room2 = await jc2.joinRoom(name, { name: "speaker" });
    rooms.push(room2);
    await room2.send("hello from speaker");

    await new Promise((r) => setTimeout(r, 500));
    const found = received.find((m) => m.body === "hello from speaker");
    expect(found).toBeTruthy();
    expect(found.from).toBe("speaker");
  });

  it("emits bot join/leave notifications", async () => {
    const jc1 = client();
    const jc2 = client();
    const name = uniqueName("sdk-room");
    await jc1.createRoom(name);
    const room1 = await jc1.joinRoom(name, { name: "watcher" });
    rooms.push(room1);

    const received: any[] = [];
    room1.on("message", (msg) => received.push(msg));

    const room2 = await jc2.joinRoom(name, { name: "joiner" });
    rooms.push(room2);

    await new Promise((r) => setTimeout(r, 500));
    const joinMsg = received.find((m) => m.from === "room-bot" && m.body.includes("joiner joined"));
    expect(joinMsg).toBeTruthy();
  });
});
